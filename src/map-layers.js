import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import { MAP_SOURCE_ID, RUNTIME_LAYER_PREFIX } from "./map-contract.js";

const EMPTY_COLLECTION = Object.freeze({ type: "FeatureCollection", features: [] });
const LAYER_FENCE_START = /^```maplibre-layer(?:\s|$)/u;
const LAYER_FENCE = /^```maplibre-layer\s*\n([\s\S]*?)\n?```$/u;
const NORMALIZED_LAYER_FENCE =
  /^```(?:json|javascript|plain text)\s*\nmaplibre-layer\s*\n([\s\S]*?)\n?```$/u;
const JSON_FENCE = /^```(?:json|javascript|plain text)\s*\n([\s\S]*?)\n?```$/u;
const LAYER_CONTAINER = /^maplibre[ -]layer$/iu;

function list(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function orderedChildren(block) {
  return [...list(block?.[":block/children"])].sort(
    (left, right) => (left?.[":block/order"] ?? 0) - (right?.[":block/order"] ?? 0),
  );
}

function diagnostic(code, sourceBlockUid, message, detail = null) {
  return {
    key: [code, sourceBlockUid, detail].filter(Boolean).join(":"),
    code,
    severity: "warning",
    sourceBlockUid,
    message,
    ...(detail ? { detail } : {}),
  };
}

function validationMessages(layer) {
  const style = {
    version: 8,
    sources: {
      [MAP_SOURCE_ID]: { type: "geojson", data: EMPTY_COLLECTION },
    },
    layers: [layer],
  };
  return validateStyleMin(style).map(({ message }) => message);
}

function parseLayerJson(sourceBlockUid, json) {
  let layer;
  try {
    layer = JSON.parse(json);
  } catch (error) {
    return {
      layer: null,
      diagnostic: diagnostic(
        "layer.invalid-json",
        sourceBlockUid,
        "This maplibre-layer block is not valid JSON.",
        error?.message ?? String(error),
      ),
    };
  }

  if (!layer || typeof layer !== "object" || Array.isArray(layer)) {
    return {
      layer: null,
      diagnostic: diagnostic(
        "layer.invalid-specification",
        sourceBlockUid,
        "A maplibre-layer block must contain one MapLibre layer object.",
      ),
    };
  }
  if (typeof layer.id !== "string" || !layer.id.trim()) {
    return {
      layer: null,
      diagnostic: diagnostic(
        "layer.missing-id",
        sourceBlockUid,
        "A MapLibre layer needs a non-empty id.",
      ),
    };
  }
  if (layer.id.startsWith(RUNTIME_LAYER_PREFIX)) {
    return {
      layer: null,
      diagnostic: diagnostic(
        "layer.reserved-id",
        sourceBlockUid,
        `Layer IDs beginning with ${RUNTIME_LAYER_PREFIX} are reserved for Roam Map.`,
        layer.id,
      ),
    };
  }
  if (layer.source !== MAP_SOURCE_ID) {
    return {
      layer: null,
      diagnostic: diagnostic(
        "layer.unsupported-source",
        sourceBlockUid,
        `This milestone accepts layers over the compiled ${MAP_SOURCE_ID} GeoJSON source.`,
        String(layer.source ?? "missing source"),
      ),
    };
  }
  if ("source-layer" in layer) {
    return {
      layer: null,
      diagnostic: diagnostic(
        "layer.unsupported-source-layer",
        sourceBlockUid,
        "GeoJSON layers must not declare source-layer.",
      ),
    };
  }

  const errors = validationMessages(layer);
  if (errors.length > 0) {
    return {
      layer: null,
      diagnostic: diagnostic(
        "layer.invalid-specification",
        sourceBlockUid,
        "MapLibre rejected this layer specification.",
        errors.join(" | "),
      ),
    };
  }
  return { layer: structuredClone(layer), diagnostic: null };
}

function parseLayer(block) {
  const sourceBlockUid = block?.[":block/uid"] ?? "unknown";
  const source = String(block?.[":block/string"] ?? "").trim();
  const directMatch = source.match(LAYER_FENCE) ?? source.match(NORMALIZED_LAYER_FENCE);
  if (directMatch) {
    return {
      ...parseLayerJson(sourceBlockUid, directMatch[1]),
      recognizedBlockUids: [sourceBlockUid],
    };
  }
  if (LAYER_FENCE_START.test(source) || /\nmaplibre-layer\s*\n/u.test(source)) {
    return {
      layer: null,
      diagnostic: diagnostic(
        "layer.invalid-code-block",
        sourceBlockUid,
        "A compact maplibre-layer block must contain one closed JSON code fence.",
      ),
      recognizedBlockUids: [sourceBlockUid],
    };
  }
  if (!LAYER_CONTAINER.test(source)) return null;

  const children = orderedChildren(block);
  const recognizedBlockUids = [
    sourceBlockUid,
    ...children.map((child) => child?.[":block/uid"]).filter(Boolean),
  ];
  if (children.length !== 1) {
    return {
      layer: null,
      diagnostic: diagnostic(
        "layer.invalid-container",
        sourceBlockUid,
        "A MapLibre layer block needs exactly one code-block child containing JSON.",
      ),
      recognizedBlockUids,
    };
  }
  const childString = String(children[0]?.[":block/string"] ?? "").trim();
  const jsonMatch = childString.match(JSON_FENCE);
  if (!jsonMatch) {
    return {
      layer: null,
      diagnostic: diagnostic(
        "layer.invalid-container",
        sourceBlockUid,
        "The child of a MapLibre layer block must be a code block containing JSON.",
      ),
      recognizedBlockUids,
    };
  }
  return {
    ...parseLayerJson(sourceBlockUid, jsonMatch[1]),
    recognizedBlockUids,
  };
}

export function compileMapLayers(blocks) {
  const layers = [];
  const diagnostics = [];
  const recognizedBlockUids = new Set();
  const layerIds = new Set();

  for (const block of blocks) {
    const blockUid = block?.[":block/uid"];
    if (blockUid && recognizedBlockUids.has(blockUid)) continue;
    const parsed = parseLayer(block);
    if (!parsed) continue;
    const sourceBlockUid = block?.[":block/uid"] ?? "unknown";
    for (const uid of parsed.recognizedBlockUids) recognizedBlockUids.add(uid);
    if (parsed.diagnostic) {
      diagnostics.push(parsed.diagnostic);
      continue;
    }
    if (layerIds.has(parsed.layer.id)) {
      diagnostics.push(
        diagnostic(
          "layer.duplicate-id",
          sourceBlockUid,
          "Every layer in one map needs a distinct id.",
          parsed.layer.id,
        ),
      );
      continue;
    }
    layerIds.add(parsed.layer.id);
    layers.push(parsed.layer);
  }

  return { layers, diagnostics, recognizedBlockUids };
}

export const __test = { parseLayer, validationMessages };
