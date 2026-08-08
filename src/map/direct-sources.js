// Reads only direct outline sources and returns contributions with provenance.
// Deduplication is intentionally left to the central compiler so future query sources compose.
import { parseMapDefinitions } from "./definition.js";
import { compileMapLayers } from "./layers.js";
import { compileMarkerClick } from "./marker-click.js";
import { BASEMAP_ATTRIBUTE, compileMapOptions } from "./options.js";

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
    :block/uid :block/string :block/order
    {:block/refs [:block/uid :node/title :block/string]}
    {:block/children ...}
  ]}
]`;

const REFERENCED_BLOCK_PATTERN = `[
  :block/uid :block/string
  {:block/refs [:block/uid :node/title :block/string]}
]`;

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
  let basemapAttributeUidPromise = null;

  function basemapAttributeUid() {
    if (!basemapAttributeUidPromise) {
      if (typeof api.pullByTitle !== "function") return Promise.resolve(null);
      basemapAttributeUidPromise = api
        .pullByTitle("[:block/uid]", BASEMAP_ATTRIBUTE)
        .then((entity) => entity?.[":block/uid"] ?? null);
    }
    return basemapAttributeUidPromise;
  }

  async function compile(mapUid) {
    const [root, attributeUid] = await Promise.all([
      api.pull(SOURCE_TREE_PATTERN, mapUid),
      basemapAttributeUid(),
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
          `The inline source “${definition.argument}” is recognized but is not part of the direct-reference milestone.`,
        ),
      );
    }

    const sourceBlocks = descendants(root);
    const layerResult = compileMapLayers(sourceBlocks);
    const optionsResult = compileMapOptions({ root, basemapAttributeUid: attributeUid });
    const markerClickResult = compileMarkerClick(root);
    diagnostics.push(...layerResult.diagnostics);
    diagnostics.push(...optionsResult.diagnostics);
    diagnostics.push(...markerClickResult.diagnostics);
    const configurationBlockUids = new Set([
      ...layerResult.recognizedBlockUids,
      ...optionsResult.recognizedBlockUids,
      ...markerClickResult.recognizedBlockUids,
    ]);
    const contributions = [];
    const watchUids = new Set(markerClickResult.watchUids);
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

    for (const block of sourceBlocks) {
      const sourceBlockUid = block?.[":block/uid"];
      if (!sourceBlockUid) continue;
      if (configurationBlockUids.has(sourceBlockUid)) continue;
      const children = orderedChildren(block);
      const refs = splitRefs(block);
      let pageRefs = removeNestedNamespaceRefs(block, refs.pageRefs).map((page) => ({
        ...page,
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
            ...page,
            provenance: {
              sourceBlockUid,
              originBlockUid: blockUid,
              viaBlockRefUid: blockUid,
            },
          }));
          pageRefs.push(...referencedRefs);
        }
      }

      pageRefs = uniqueBy(pageRefs, "pageUid");
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
      layers: layerResult.layers,
      markerClick: markerClickResult.markerClick,
    };
  }

  return { compile };
}

export const __test = {
  descendants,
  orderedChildren,
  removeNestedNamespaceRefs,
  splitRefs,
  topLevelPageReferenceTitles,
};
