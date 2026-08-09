// Reads map outline sources and returns contributions with provenance.
// Deduplication is intentionally left to the central compiler so source kinds compose.
import { parseMapDefinitions } from "./definition.js";
import { isGeoUri } from "../geo-uri.js";
import { currentAttributeValues } from "../roam/attribute-values.js";
import {
  compileDynamicSources,
  parseDynamicSourceDefinition,
} from "./dynamic-sources.js";
import { compileMapLayers } from "./layers.js";
import { compileMarkerClick } from "./marker-click.js";
import { compileResultsList } from "./results-list.js";
import {
  BASEMAP_ATTRIBUTE,
  MAP_SIZE_ATTRIBUTE,
  compileMapOptions,
} from "./options.js";
import { PLACE_FIELDS } from "./place-records.js";

export const SOURCE_TREE_PATTERN = `[
  :block/uid :block/string :block/order :entity/attrs
  {:block/refs [:block/uid :node/title :block/string]}
  {:harc/_e [
    :block/uid
    {:harc/a [:block/uid :node/title]}
    {:harc/v [:block/uid :node/title :block/string :harc/v-string :harc.text/string]}
    {:harc/a-source [:block/uid]}
    {:harc/v-source [:block/uid]}
  ]}
  {:block/children [
    :block/uid :block/string :block/order :entity/attrs
    {:block/refs [:block/uid :node/title :block/string]}
    {:harc/_e [
      :block/uid
      {:harc/a [:block/uid :node/title]}
      {:harc/v [:block/uid :node/title :block/string :harc/v-string :harc.text/string]}
      {:harc/a-source [:block/uid]}
      {:harc/v-source [:block/uid]}
    ]}
    {:block/children ...}
  ]}
]`;

const REFERENCED_BLOCK_PATTERN = `[
  :block/uid :block/string
  {:block/refs [:block/uid :node/title :block/string]}
]`;

// Matches blocks written as map/basemap:: or map/size:: attribute syntax.
// Attribute-relation recognition can lag while the attribute pages or their
// index entries are still settling, so the block text itself is authoritative
// for keeping option blocks out of the source set.
const OPTION_ATTRIBUTE_BLOCK = /^(?:\[\[)?map\/(?:basemap|size)(?:\]\])?::/u;
const ATTRIBUTE_BLOCK = /^(?:\[\[[^\]]+\]\]|[^:\n]+)::/u;
const COORDINATES_ATTRIBUTE_BLOCK = new RegExp(
  `^(?:\\[\\[)?${PLACE_FIELDS.coordinates}(?:\\]\\])?::`,
  "u",
);

function list(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function blockOrder(block) {
  return Number.isFinite(block?.[":block/order"]) ? block[":block/order"] : 0;
}

function orderedChildren(block) {
  return [...list(block?.[":block/children"])].sort(
    (left, right) => blockOrder(left) - blockOrder(right),
  );
}

function descendants(root) {
  const output = [];
  function visit(block) {
    for (const child of orderedChildren(block)) {
      output.push(child);
      visit(child);
    }
  }
  visit(root);
  return output;
}

function claimBlockTree(uids, block) {
  const uid = block?.[":block/uid"];
  if (uid) uids.add(uid);
  for (const child of descendants(block)) {
    if (child?.[":block/uid"]) uids.add(child[":block/uid"]);
  }
}

function locationAttributeChildren(block) {
  const direct = orderedChildren(block);
  const metadata = direct.filter((child) => child?.[":block/string"] === "roam/meta::");
  return [
    ...direct.filter((child) =>
      COORDINATES_ATTRIBUTE_BLOCK.test(String(child?.[":block/string"] ?? "").trim()),
    ),
    ...metadata.flatMap((child) =>
      orderedChildren(child).filter((grandchild) =>
        COORDINATES_ATTRIBUTE_BLOCK.test(
          String(grandchild?.[":block/string"] ?? "").trim(),
        ),
      ),
    ),
  ];
}

function hasCurrentLocationAttribute(block) {
  const direct = orderedChildren(block);
  const metadata = direct.filter((child) => child?.[":block/string"] === "roam/meta::");
  return [block, ...metadata].some(
    (entity) => currentAttributeValues(entity, PLACE_FIELDS.coordinates).length > 0,
  );
}

function authoredAttributeUids(block) {
  const uids = new Set();
  for (const child of orderedChildren(block)) {
    const string = String(child?.[":block/string"] ?? "").trim();
    if (ATTRIBUTE_BLOCK.test(string)) {
      if (child?.[":block/uid"]) uids.add(child[":block/uid"]);
      continue;
    }
    if (string !== "roam/meta::") continue;
    if (child?.[":block/uid"]) uids.add(child[":block/uid"]);
    for (const descendant of descendants(child)) {
      if (descendant?.[":block/uid"]) uids.add(descendant[":block/uid"]);
    }
  }
  return uids;
}

function splitRefs(block) {
  const pageRefs = [];
  const blockRefs = [];
  for (const ref of list(block?.[":block/refs"])) {
    const uid = ref?.[":block/uid"];
    if (!uid) continue;
    if (typeof ref?.[":node/title"] === "string") {
      pageRefs.push({ pageUid: uid, title: ref[":node/title"] });
    } else if (typeof ref?.[":block/string"] === "string") {
      blockRefs.push({ blockUid: uid });
    }
  }
  return { pageRefs, blockRefs };
}

function topLevelPageReferenceTitles(blockString) {
  const source = String(blockString ?? "");
  const titles = [];
  let cursor = 0;
  while (cursor < source.length - 1) {
    if (source[cursor] !== "[" || source[cursor + 1] !== "[") {
      cursor += 1;
      continue;
    }
    const contentStart = cursor + 2;
    let depth = 1;
    let index = contentStart;
    while (index < source.length - 1 && depth > 0) {
      if (source[index] === "[" && source[index + 1] === "[") {
        depth += 1;
        index += 2;
        continue;
      }
      if (source[index] === "]" && source[index + 1] === "]") {
        depth -= 1;
        if (depth === 0) {
          const title = source.slice(contentStart, index).trim();
          if (title) titles.push(title);
        }
        index += 2;
        continue;
      }
      index += 1;
    }
    cursor = depth === 0 ? index : contentStart;
  }
  return titles;
}

function removeNestedNamespaceRefs(block, pageRefs) {
  const outerTitles = new Set(topLevelPageReferenceTitles(block?.[":block/string"]));
  if (outerTitles.size === 0) return pageRefs;
  return pageRefs.filter(({ title }) => {
    if (outerTitles.has(title)) return true;
    return ![...outerTitles].some((outerTitle) => outerTitle.includes(`[[${title}]]`));
  });
}

function uniqueBy(items, key) {
  const seen = new Set();
  return items.filter((item) => {
    const value = item[key];
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function sourceDiagnostic(code, sourceBlockUid, message, detail = null) {
  return {
    key: [code, sourceBlockUid, detail].filter(Boolean).join(":"),
    code,
    severity: "warning",
    sourceBlockUid,
    message,
    ...(detail ? { detail } : {}),
  };
}

export function createDirectSourceCompiler(api) {
  let optionAttributeUidsPromise = null;

  function optionAttributeUids() {
    if (!optionAttributeUidsPromise) {
      if (typeof api.pullByTitle !== "function") {
        return Promise.resolve({ basemap: null, size: null });
      }
      optionAttributeUidsPromise = Promise.all(
        [BASEMAP_ATTRIBUTE, MAP_SIZE_ATTRIBUTE].map(async (title) => {
          const entity = await api.pullByTitle("[:block/uid]", title);
          return [title, entity?.[":block/uid"] ?? null];
        }),
      ).then((entries) => Object.fromEntries(entries));
    }
    return optionAttributeUidsPromise.then((uids) => {
      // Option attribute pages are created the first time an option is written,
      // so an unresolved page must be retried on the next compile rather than
      // cached; otherwise late-written option blocks leak into sources.
      if (
        uids[BASEMAP_ATTRIBUTE] == null ||
        uids[MAP_SIZE_ATTRIBUTE] == null
      ) {
        optionAttributeUidsPromise = null;
      }
      return {
        basemap: uids[BASEMAP_ATTRIBUTE],
        size: uids[MAP_SIZE_ATTRIBUTE],
      };
    });
  }

  async function compile(mapUid) {
    const [root, attributeUids] = await Promise.all([
      api.pull(SOURCE_TREE_PATTERN, mapUid),
      optionAttributeUids(),
    ]);
    if (!root) {
      return {
        definition: null,
        contributions: [],
        diagnostics: [
          sourceDiagnostic("source.map-not-found", mapUid, "The map definition block no longer exists."),
        ],
        watchUids: [],
        options: null,
        layers: [],
        markerClick: null,
        resultsList: null,
      };
    }

    const definition = parseMapDefinitions(root[":block/string"])[0] ?? null;
    const diagnostics = [];
    if (!definition) {
      diagnostics.push(
        sourceDiagnostic(
          "source.map-definition-missing",
          mapUid,
          "The mounted block no longer contains a map component.",
        ),
      );
    } else if (definition.argument) {
      diagnostics.push(
        sourceDiagnostic(
          "source.inline-not-supported-yet",
          mapUid,
          `The inline source “${definition.argument}” is recognized but is not supported. Add source blocks beneath the map instead.`,
        ),
      );
    }

    const sourceBlocks = descendants(root);
    const directChildren = orderedChildren(root);
    const layerResult = compileMapLayers(sourceBlocks);
    const optionsResult = compileMapOptions({
      root,
      basemapAttributeUid: attributeUids.basemap,
      sizeAttributeUid: attributeUids.size,
    });
    const markerClickResult = compileMarkerClick(root);
    const resultsListResult = compileResultsList(root);
    diagnostics.push(...layerResult.diagnostics);
    diagnostics.push(...optionsResult.diagnostics);
    diagnostics.push(...markerClickResult.diagnostics);
    diagnostics.push(...resultsListResult.diagnostics);
    const configurationBlockUids = new Set([
      ...layerResult.recognizedBlockUids,
      ...optionsResult.recognizedBlockUids,
      ...markerClickResult.recognizedBlockUids,
      ...resultsListResult.recognizedBlockUids,
    ]);
    const dynamicDefinitions = [];
    for (const child of directChildren) {
      const dynamic = parseDynamicSourceDefinition(child);
      if (!dynamic) continue;
      dynamicDefinitions.push(dynamic);
      claimBlockTree(configurationBlockUids, child);
    }
    const blockLocationSources = new Map();
    for (const block of sourceBlocks) {
      const entityUid = block?.[":block/uid"];
      const string = String(block?.[":block/string"] ?? "").trim();
      if (!entityUid || configurationBlockUids.has(entityUid)) continue;
      const inline = isGeoUri(string);
      const attributed =
        locationAttributeChildren(block).length > 0 || hasCurrentLocationAttribute(block);
      if (!inline && !attributed) continue;
      blockLocationSources.set(entityUid, { inline, title: string });
      for (const uid of authoredAttributeUids(block)) configurationBlockUids.add(uid);
    }
    for (const block of sourceBlocks) {
      const uid = block?.[":block/uid"];
      if (!uid) continue;
      if (OPTION_ATTRIBUTE_BLOCK.test(String(block?.[":block/string"] ?? "").trim())) {
        configurationBlockUids.add(uid);
      }
    }
    const contributions = [];
    const watchUids = new Set([
      ...markerClickResult.watchUids,
      ...resultsListResult.watchUids,
    ]);
    const referencedBlockUids = new Set();
    for (const block of sourceBlocks) {
      const uid = block?.[":block/uid"];
      if (!uid || configurationBlockUids.has(uid)) continue;
      if (orderedChildren(block).length > 0) continue;
      for (const { blockUid } of splitRefs(block).blockRefs) referencedBlockUids.add(blockUid);
    }
    const referencedBlocks =
      referencedBlockUids.size === 0
        ? []
        : typeof api.pullMany === "function"
          ? await api.pullMany(REFERENCED_BLOCK_PATTERN, [...referencedBlockUids])
          : await Promise.all(
              [...referencedBlockUids].map((uid) => api.pull(REFERENCED_BLOCK_PATTERN, uid)),
            );
    const referencedByUid = new Map(
      referencedBlocks
        .filter((block) => block?.[":block/uid"])
        .map((block) => [block[":block/uid"], block]),
    );

    for (const child of directChildren) {
      const sourceBlockUid = child?.[":block/uid"];
      if (!sourceBlockUid || configurationBlockUids.has(sourceBlockUid)) continue;
      if (orderedChildren(child).length > 0) continue;
      const refs = splitRefs(child);
      if (refs.pageRefs.length > 0 || refs.blockRefs.length !== 1) continue;
      const [{ blockUid }] = refs.blockRefs;
      const referenced = referencedByUid.get(blockUid);
      if (!referenced) continue;
      const dynamic = parseDynamicSourceDefinition(referenced, {
        sourceBlockUid,
        viaBlockRefUid: blockUid,
      });
      if (!dynamic) continue;
      dynamicDefinitions.push(dynamic);
      claimBlockTree(configurationBlockUids, child);
    }

    const dynamicResults = await compileDynamicSources(api, dynamicDefinitions);
    const dynamicBySourceUid = new Map(
      dynamicResults.map((result) => [result.definition.sourceBlockUid, result]),
    );
    for (const result of dynamicResults) {
      diagnostics.push(...result.diagnostics);
      for (const uid of result.watchUids) watchUids.add(uid);
    }

    for (const block of sourceBlocks) {
      const sourceBlockUid = block?.[":block/uid"];
      if (!sourceBlockUid) continue;
      const dynamic = dynamicBySourceUid.get(sourceBlockUid);
      if (dynamic) {
        contributions.push(...dynamic.contributions);
        continue;
      }
      if (configurationBlockUids.has(sourceBlockUid)) continue;
      const blockLocation = blockLocationSources.get(sourceBlockUid);
      if (blockLocation) {
        contributions.push({
          identityKind: "block",
          entityUid: sourceBlockUid,
          title: blockLocation.title,
          allowInlineCoordinates: blockLocation.inline,
          provenance: {
            sourceBlockUid,
            originBlockUid: sourceBlockUid,
            viaBlockRefUid: null,
          },
        });
        continue;
      }
      const children = orderedChildren(block);
      const refs = splitRefs(block);
      let pageRefs = removeNestedNamespaceRefs(block, refs.pageRefs).map((page) => ({
        identityKind: "page",
        entityUid: page.pageUid,
        title: page.title,
        allowInlineCoordinates: false,
        provenance: { sourceBlockUid, originBlockUid: sourceBlockUid, viaBlockRefUid: null },
      }));

      if (children.length === 0 && refs.blockRefs.length > 0) {
        for (const { blockUid } of refs.blockRefs) {
          watchUids.add(blockUid);
          const referenced = referencedByUid.get(blockUid);
          if (!referenced) {
            diagnostics.push(
              sourceDiagnostic(
                "source.missing-block-reference",
                sourceBlockUid,
                "A leaf block reference could not be resolved.",
                blockUid,
              ),
            );
            continue;
          }
          const referencedRefs = splitRefs(referenced).pageRefs.map((page) => ({
            identityKind: "page",
            entityUid: page.pageUid,
            title: page.title,
            allowInlineCoordinates: false,
            provenance: {
              sourceBlockUid,
              originBlockUid: blockUid,
              viaBlockRefUid: blockUid,
            },
          }));
          pageRefs.push(...referencedRefs);
        }
      }

      pageRefs = uniqueBy(pageRefs, "entityUid");
      if (pageRefs.length === 1) {
        contributions.push(pageRefs[0]);
        continue;
      }
      if (pageRefs.length > 1) {
        diagnostics.push(
          sourceDiagnostic(
            "source.ambiguous-page-references",
            sourceBlockUid,
            "A direct source block must resolve to one distinct page; split multiple page references into child blocks.",
            pageRefs.map(({ title }) => title).join(" | "),
          ),
        );
        continue;
      }
      const string = String(block?.[":block/string"] ?? "").trim();
      if (children.length === 0 && string) {
        diagnostics.push(
          sourceDiagnostic(
            "source.unrecognized-leaf",
            sourceBlockUid,
            "This leaf does not contain a page reference that the direct-source adapter can map.",
            string,
          ),
        );
      }
    }

    return {
      definition,
      contributions,
      diagnostics,
      watchUids: [...watchUids],
      options: optionsResult.options,
      optionSourceUids: optionsResult.optionSourceUids,
      layers: layerResult.layers,
      markerClick: markerClickResult.markerClick,
      resultsList: resultsListResult.resultsList,
      dynamicSources: dynamicResults.map(({ report }) => report),
    };
  }

  return { compile };
}

export const __test = {
  descendants,
  authoredAttributeUids,
  hasCurrentLocationAttribute,
  locationAttributeChildren,
  orderedChildren,
  removeNestedNamespaceRefs,
  splitRefs,
  topLevelPageReferenceTitles,
};
