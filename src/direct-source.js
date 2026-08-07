import { parseMapDefinitions } from "./map-definition.js";
import { compileMapLayers } from "./map-layers.js";
import { compileMapPresentation, MAP_FIELDS } from "./map-presentation.js";

export const SOURCE_TREE_PATTERN = `[
  :block/uid :block/string :block/order :entity/attrs
  {:block/refs [:block/uid :node/title :block/string]}
  {:harc/_e [
    :block/uid
    {:harc/a [:block/uid :node/title]}
    {:harc/v [:block/uid :node/title :block/string :harc/v-string :harc.text/string]}
    {:harc/a-source [:block/uid]}
    {:harc/v-source [:block/uid]}
    {:harc/_e [
      :block/uid
      {:harc/a [:block/uid :node/title]}
      {:harc/v [:block/uid :node/title :block/string :harc/v-string :harc.text/string]}
      {:harc/a-source [:block/uid]}
      {:harc/v-source [:block/uid]}
    ]}
  ]}
  {:block/children ...}
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
  let attributeUidsPromise = null;

  function mapAttributeUids() {
    if (!attributeUidsPromise) {
      if (typeof api.pullByTitle !== "function") return Promise.resolve(new Map());
      attributeUidsPromise = Promise.all(
        Object.values(MAP_FIELDS).map(async (title) => {
          const entity = await api.pullByTitle("[:block/uid]", title);
          return [title, entity?.[":block/uid"] ?? null];
        }),
      ).then((entries) => new Map(entries.filter(([, uid]) => uid)));
    }
    return attributeUidsPromise;
  }

  async function compile(mapUid) {
    const [root, attributeUids] = await Promise.all([
      api.pull(SOURCE_TREE_PATTERN, mapUid),
      mapAttributeUids(),
    ]);
    if (!root) {
      return {
        definition: null,
        items: [],
        diagnostics: [
          sourceDiagnostic("source.map-not-found", mapUid, "The map definition block no longer exists."),
        ],
        watchUids: [],
        presentation: null,
        layers: [],
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
    const presentationResult = compileMapPresentation({
      root,
      descendants: sourceBlocks,
      attributeUids,
    });
    diagnostics.push(...layerResult.diagnostics);
    diagnostics.push(...presentationResult.diagnostics);
    const contributions = [...presentationResult.sources];
    const watchUids = new Set();
    for (const block of sourceBlocks) {
      const sourceBlockUid = block?.[":block/uid"];
      if (!sourceBlockUid) continue;
      if (layerResult.recognizedBlockUids.has(sourceBlockUid)) continue;
      if (presentationResult.recognizedAttributeBlockUids.has(sourceBlockUid)) continue;
      const children = orderedChildren(block);
      const refs = splitRefs(block);
      let pageRefs = removeNestedNamespaceRefs(block, refs.pageRefs).map((page) => ({
        ...page,
        provenance: { sourceBlockUid, originBlockUid: sourceBlockUid, viaBlockRefUid: null },
      }));

      if (children.length === 0 && refs.blockRefs.length > 0) {
        for (const { blockUid } of refs.blockRefs) {
          watchUids.add(blockUid);
          const referenced = await api.pull(REFERENCED_BLOCK_PATTERN, blockUid);
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

    const byPageUid = new Map();
    for (const contribution of contributions) {
      const provenance = Array.isArray(contribution.provenance)
        ? contribution.provenance
        : [contribution.provenance];
      const existing = byPageUid.get(contribution.pageUid);
      if (existing) {
        existing.provenance.push(...provenance);
      } else {
        byPageUid.set(contribution.pageUid, {
          kind: "page",
          pageUid: contribution.pageUid,
          title: contribution.title,
          ...(contribution.presentation ? { presentation: contribution.presentation } : {}),
          provenance,
        });
      }
    }

    return {
      definition,
      items: [...byPageUid.values()],
      diagnostics,
      watchUids: [...watchUids],
      presentation: presentationResult.presentation,
      layers: layerResult.layers,
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
