// Map options are durable configuration on the map block itself. This module
// deliberately handles only basemaps; feature styling belongs in native MapLibre layers.
import {
  attributeSourceUid,
  currentAttributeRelations,
  currentAttributeValues,
  legacyAttributeRelations,
  legacyAttributeValues,
  refUid,
  svPart,
} from "../roam/attribute-values.js";

export const BASEMAP_ATTRIBUTE = "map/basemap";
export const DEFAULT_MAP_OPTIONS = Object.freeze({ basemap: "streets" });

const BASEMAP_ALIASES = new Map([
  ["classic", "streets"],
  ["liberty", "streets"],
  ["street", "streets"],
  ["streets", "streets"],
  ["satellite", "satellite"],
]);

function optionDiagnostic(code, mapUid, message, detail = null) {
  return {
    key: [code, mapUid, detail].filter(Boolean).join(":"),
    code,
    severity: "warning",
    sourceBlockUid: mapUid,
    message,
    ...(detail ? { detail } : {}),
  };
}

function parseBasemap(raw, diagnostics, mapUid) {
  if (raw == null) return DEFAULT_MAP_OPTIONS.basemap;
  const value = String(raw).trim();
  const alias = BASEMAP_ALIASES.get(value.toLocaleLowerCase());
  if (alias) return alias;
  if (value && value.length <= 120 && !/[\r\n]/u.test(value)) return value;
  diagnostics.push(
    optionDiagnostic(
      "options.invalid-basemap",
      mapUid,
      "map/basemap must be a configured basemap name of 120 characters or fewer; streets is being used.",
      value,
    ),
  );
  return DEFAULT_MAP_OPTIONS.basemap;
}

function configuredValues(root, basemapAttributeUid) {
  const current = currentAttributeValues(root, BASEMAP_ATTRIBUTE);
  if (current.length > 0) return current;
  return legacyAttributeValues(root, basemapAttributeUid);
}

function recognizedSourceUids(root, basemapAttributeUid) {
  const uids = new Set();
  for (const relation of currentAttributeRelations(root, BASEMAP_ATTRIBUTE)) {
    const uid = attributeSourceUid(relation);
    if (uid) uids.add(uid);
  }
  for (const triple of legacyAttributeRelations(root, basemapAttributeUid)) {
    const uid = refUid(svPart(triple?.[1], "source"));
    if (uid) uids.add(uid);
  }
  return uids;
}

export function compileMapOptions({ root, basemapAttributeUid = null }) {
  const diagnostics = [];
  const mapUid = root?.[":block/uid"] ?? "unknown";
  const values = configuredValues(root, basemapAttributeUid);
  const distinct = [...new Set(values.map((value) => String(value).trim()))];
  if (distinct.length > 1) {
    diagnostics.push(
      optionDiagnostic(
        "options.conflicting-basemap",
        mapUid,
        "map/basemap has more than one value; the first value is being used.",
        distinct.join(" | "),
      ),
    );
  }
  return {
    options: { basemap: parseBasemap(values[0], diagnostics, mapUid) },
    diagnostics,
    recognizedBlockUids: recognizedSourceUids(root, basemapAttributeUid),
  };
}

export const __test = { parseBasemap };
