// Dynamic sources are deliberately narrower than Roam's rendered query UIs:
// each adapter must resolve to explicit page/block UIDs before place resolution.

export const DYNAMIC_SOURCE_LIMIT = 250;

export const QUERY_RESULT_PULL = `[
  :block/uid :node/title :block/string
  {:block/page [:block/uid :node/title]}
]`;

export const DYNAMIC_ENTITY_PATTERN = `[
  :block/uid :node/title :block/string
]`;

const QUERY_COMPONENT = /^\s*\{\{(?:\[\[)?query(?:\]\])?\s*:[\s\S]*\}\}\s*$/iu;
const CODE_FENCE = /^```([^\r\n`]*)[ \t]*\r?\n([\s\S]*?)\r?\n?```[ \t]*$/u;
const DATALOG_LANGUAGES = new Set([
  "clj",
  "clojure",
  "commonlisp",
  "datalog",
  "datascript",
]);

function list(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function sourceDiagnostic(code, definition, message, detail = null) {
  return {
    key: [code, definition.sourceBlockUid, detail].filter(Boolean).join(":"),
    code,
    severity: "warning",
    sourceBlockUid: definition.sourceBlockUid,
    message,
    ...(detail ? { detail } : {}),
  };
}

export function parseDatalogCodeBlock(blockString) {
  const match = String(blockString ?? "").trim().match(CODE_FENCE);
  if (!match) return null;
  const language = match[1].trim().toLocaleLowerCase();
  const query = match[2].trim();
  if (!DATALOG_LANGUAGES.has(language) || !query) return null;
  return { language, query };
}

export function parseDynamicSourceDefinition(
  block,
  { sourceBlockUid = null, viaBlockRefUid = null } = {},
) {
  const definitionBlockUid = block?.[":block/uid"] ?? null;
  const localSourceUid = sourceBlockUid ?? definitionBlockUid;
  if (!definitionBlockUid || !localSourceUid) return null;
  const blockString = String(block?.[":block/string"] ?? "").trim();
  if (QUERY_COMPONENT.test(blockString)) {
    return {
      kind: "roam-query",
      sourceBlockUid: localSourceUid,
      definitionBlockUid,
      viaBlockRefUid,
    };
  }
  const datalog = parseDatalogCodeBlock(blockString);
  if (!datalog) return null;
  return {
    kind: "datalog",
    sourceBlockUid: localSourceUid,
    definitionBlockUid,
    viaBlockRefUid,
    language: datalog.language,
    query: datalog.query,
  };
}

export function normalizeUidCollection(value) {
  if (!Array.isArray(value)) {
    throw new TypeError("Datalog must return an array of UIDs.");
  }
  let values;
  if (value.every((item) => typeof item === "string")) {
    values = value;
  } else if (
    value.every(
      (item) => Array.isArray(item) && item.length === 1 && typeof item[0] === "string",
    )
  ) {
    values = value.map(([uid]) => uid);
  } else {
    throw new TypeError(
      "Datalog must return a flat UID collection or a one-column UID relation.",
    );
  }
  const seen = new Set();
  const output = [];
  for (const valueUid of values) {
    const uid = valueUid.trim();
    if (!uid) {
      throw new TypeError("Datalog returned an empty UID.");
    }
    if (seen.has(uid)) continue;
    seen.add(uid);
    output.push(uid);
  }
  return output;
}

function identityFromEntity(entity) {
  const entityUid = entity?.[":block/uid"] ?? null;
  if (!entityUid) return null;
  if (typeof entity?.[":node/title"] === "string") {
    return {
      identityKind: "page",
      entityUid,
      title: entity[":node/title"],
      allowInlineCoordinates: false,
    };
  }
  if (typeof entity?.[":block/string"] === "string") {
    return {
      identityKind: "block",
      entityUid,
      title: entity[":block/string"],
      allowInlineCoordinates: true,
    };
  }
  return null;
}

function nativeQueryIdentity(result) {
  if (typeof result?.[":node/title"] === "string") {
    return identityFromEntity(result);
  }
  const [page] = list(result?.[":block/page"]);
  const pageUid = page?.[":block/uid"] ?? null;
  if (!pageUid) return null;
  return {
    identityKind: "page",
    entityUid: pageUid,
    title: typeof page?.[":node/title"] === "string" ? page[":node/title"] : null,
    allowInlineCoordinates: false,
  };
}

function contributionFromIdentity(identity, definition, queryResultUid = null) {
  if (!identity) return null;
  return {
    ...identity,
    provenance: {
      sourceBlockUid: definition.sourceBlockUid,
      originBlockUid: queryResultUid ?? identity.entityUid,
      viaBlockRefUid: definition.viaBlockRefUid,
      sourceKind: definition.kind,
      definitionBlockUid: definition.definitionBlockUid,
      ...(queryResultUid ? { queryResultUid } : {}),
    },
  };
}

function contribution(entity, definition, queryResultUid = null) {
  return contributionFromIdentity(
    identityFromEntity(entity),
    definition,
    queryResultUid,
  );
}

function truncationDiagnostic(definition, total, returned) {
  return sourceDiagnostic(
    "source.dynamic-results-truncated",
    definition,
    `This dynamic source returned ${total} results; only the first ${returned} are being mapped.`,
    `${returned}/${total}`,
  );
}

async function compileRoamQuery(api, definition) {
  const response = await api.roamQuery({
    uid: definition.definitionBlockUid,
    offset: 0,
    limit: DYNAMIC_SOURCE_LIMIT,
    pull: QUERY_RESULT_PULL,
  });
  if (!response || !Array.isArray(response.results)) {
    throw new TypeError("Roam returned an unexpected native-query result shape.");
  }
  const diagnostics = [];
  const total = Number.isFinite(response.total) ? response.total : response.results.length;
  const results = response.results.slice(0, DYNAMIC_SOURCE_LIMIT);
  if (total > results.length) {
    diagnostics.push(truncationDiagnostic(definition, total, results.length));
  }
  const contributions = [];
  for (const result of results) {
    const resultUid = result?.[":block/uid"] ?? null;
    const next = contributionFromIdentity(
      nativeQueryIdentity(result),
      definition,
      resultUid,
    );
    if (next) {
      contributions.push(next);
      continue;
    }
    diagnostics.push(
      sourceDiagnostic(
        "source.dynamic-result-invalid",
        definition,
        "A native-query result did not resolve to a page or a block with a containing page and was skipped.",
        resultUid,
      ),
    );
  }
  return {
    definition,
    contributions,
    diagnostics,
    watchUids: [definition.definitionBlockUid],
    report: {
      kind: definition.kind,
      definitionBlockUid: definition.definitionBlockUid,
      total,
      returned: results.length,
      truncated: total > results.length,
    },
  };
}

async function pullUidEntities(api, uids) {
  if (uids.length === 0) return [];
  if (typeof api.pullMany === "function") {
    return list(await api.pullMany(DYNAMIC_ENTITY_PATTERN, uids));
  }
  return Promise.all(uids.map((uid) => api.pull(DYNAMIC_ENTITY_PATTERN, uid)));
}

async function compileDatalog(api, definition) {
  const raw = await api.datalogQuery(definition.query);
  const allUids = normalizeUidCollection(raw);
  const truncated = allUids.length > DYNAMIC_SOURCE_LIMIT;
  const uids = allUids.slice(0, DYNAMIC_SOURCE_LIMIT);
  const entities = await pullUidEntities(api, uids);
  const entityByUid = new Map(
    entities
      .filter((entity) => entity?.[":block/uid"])
      .map((entity) => [entity[":block/uid"], entity]),
  );
  const diagnostics = [];
  if (truncated) {
    diagnostics.push(truncationDiagnostic(definition, allUids.length, uids.length));
  }
  const contributions = [];
  for (const uid of uids) {
    const next = contribution(entityByUid.get(uid), definition);
    if (next) {
      contributions.push(next);
      continue;
    }
    diagnostics.push(
      sourceDiagnostic(
        "source.dynamic-uid-missing",
        definition,
        "A Datalog result UID did not resolve to a Roam page or block and was skipped.",
        uid,
      ),
    );
  }
  return {
    definition,
    contributions,
    diagnostics,
    watchUids: [definition.definitionBlockUid],
    report: {
      kind: definition.kind,
      definitionBlockUid: definition.definitionBlockUid,
      total: allUids.length,
      returned: uids.length,
      truncated,
    },
  };
}

async function compileOne(api, definition) {
  try {
    return definition.kind === "roam-query"
      ? await compileRoamQuery(api, definition)
      : await compileDatalog(api, definition);
  } catch (error) {
    const code =
      definition.kind === "roam-query"
        ? "source.roam-query-failed"
        : "source.datalog-query-failed";
    const label = definition.kind === "roam-query" ? "native query" : "Datalog query";
    return {
      definition,
      contributions: [],
      diagnostics: [
        sourceDiagnostic(
          code,
          definition,
          `The ${label} could not be executed: ${error?.message ?? String(error)}`,
        ),
      ],
      watchUids: [definition.definitionBlockUid],
      report: {
        kind: definition.kind,
        definitionBlockUid: definition.definitionBlockUid,
        total: 0,
        returned: 0,
        truncated: false,
        failed: true,
      },
    };
  }
}

export function compileDynamicSources(api, definitions) {
  return Promise.all(definitions.map((definition) => compileOne(api, definition)));
}

export const __test = { identityFromEntity, nativeQueryIdentity };
