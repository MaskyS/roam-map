// Map options are durable, readable configuration beneath the map block.
// Presentation values stay independent of MapLibre objects and UI instances.
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
export const MAP_SIZE_ATTRIBUTE = "map/size";
export const MIN_MAP_HEIGHT = 220;
export const MAX_MAP_HEIGHT = 1200;
export const MIN_MAP_WIDTH = 280;
export const MAX_MAP_WIDTH = 1600;
export const DEFAULT_MAP_MAX_WIDTH = 760;
export const DEFAULT_MAP_SIZE = Object.freeze({ maxWidth: null, height: null });
export const DEFAULT_MAP_OPTIONS = Object.freeze({
  basemap: "streets",
  size: DEFAULT_MAP_SIZE,
});

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

function normalizePixelValue(raw, min, max) {
  if (raw == null || raw === "") return null;
  const text = String(raw).trim().replace(/px$/iu, "").trim();
  if (!/^\d+$/u.test(text)) return null;
  const value = Number(text);
  return Number.isInteger(value) && value >= min && value <= max ? value : null;
}

function clampPixelValue(raw, min, max) {
  const value = Math.round(Number(raw));
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function normalizeMapHeight(raw) {
  return normalizePixelValue(raw, MIN_MAP_HEIGHT, MAX_MAP_HEIGHT);
}

export function clampMapHeight(raw) {
  return clampPixelValue(raw, MIN_MAP_HEIGHT, MAX_MAP_HEIGHT);
}

export function normalizeMapWidth(raw) {
  return normalizePixelValue(raw, MIN_MAP_WIDTH, MAX_MAP_WIDTH);
}

export function clampMapWidth(raw) {
  return clampPixelValue(raw, MIN_MAP_WIDTH, MAX_MAP_WIDTH);
}

function normalizeSizeDimension(raw, normalize) {
  const value = String(raw ?? "").trim();
  if (value.toLocaleLowerCase() === "auto") return { valid: true, value: null };
  const normalized = normalize(value);
  return { valid: normalized != null, value: normalized };
}

export function normalizeMapSize(raw) {
  if (raw == null || raw === "") return null;
  const match = String(raw).match(
    /^\s*(auto|\d+(?:\s*px)?)\s*(?:×|x)\s*(auto|\d+(?:\s*px)?)\s*$/iu,
  );
  if (!match) return null;
  const maxWidth = normalizeSizeDimension(match[1], normalizeMapWidth);
  const height = normalizeSizeDimension(match[2], normalizeMapHeight);
  if (!maxWidth.valid || !height.valid) return null;
  if (maxWidth.value == null && height.value == null) return null;
  return { maxWidth: maxWidth.value, height: height.value };
}

export function normalizeMapSizeValue(size) {
  if (size == null || typeof size !== "object") return null;
  const maxWidth = size.maxWidth == null ? null : normalizeMapWidth(size.maxWidth);
  const height = size.height == null ? null : normalizeMapHeight(size.height);
  if (size.maxWidth != null && maxWidth == null) return null;
  if (size.height != null && height == null) return null;
  if (maxWidth == null && height == null) return null;
  return { maxWidth, height };
}

function parseMapSize(raw, diagnostics, mapUid) {
  if (raw == null) return DEFAULT_MAP_SIZE;
  const size = normalizeMapSize(raw);
  if (size) return size;
  diagnostics.push(
    optionDiagnostic(
      "options.invalid-size",
      mapUid,
      `map/size must be “max-width × height”; use auto for either dimension, widths from ${MIN_MAP_WIDTH} to ${MAX_MAP_WIDTH}, and heights from ${MIN_MAP_HEIGHT} to ${MAX_MAP_HEIGHT}.`,
      String(raw),
    ),
  );
  return DEFAULT_MAP_SIZE;
}

function configuredAttribute(root, attributeTitle, legacyAttributeUid) {
  const currentRelations = currentAttributeRelations(root, attributeTitle);
  if (currentRelations.length > 0) {
    return {
      values: currentAttributeValues(root, attributeTitle),
      sourceUids: currentRelations.map(attributeSourceUid).filter(Boolean),
    };
  }
  const legacyRelations = legacyAttributeRelations(root, legacyAttributeUid);
  return {
    values: legacyAttributeValues(root, legacyAttributeUid),
    sourceUids: legacyRelations
      .map((triple) => refUid(svPart(triple?.[1], "source")))
      .filter(Boolean),
  };
}

function recognizedSourceUids(...configurations) {
  const uids = new Set();
  for (const configuration of configurations) {
    for (const uid of configuration.sourceUids) uids.add(uid);
  }
  return uids;
}

export function compileMapOptions({
  root,
  basemapAttributeUid = null,
  sizeAttributeUid = null,
}) {
  const diagnostics = [];
  const mapUid = root?.[":block/uid"] ?? "unknown";
  const basemap = configuredAttribute(root, BASEMAP_ATTRIBUTE, basemapAttributeUid);
  const size = configuredAttribute(root, MAP_SIZE_ATTRIBUTE, sizeAttributeUid);
  const distinctBasemaps = [...new Set(basemap.values.map((value) => String(value).trim()))];
  const distinctSizes = [...new Set(size.values.map((value) => String(value).trim()))];
  const sizeSourceUids = [...new Set(size.sourceUids)];
  if (distinctBasemaps.length > 1) {
    diagnostics.push(
      optionDiagnostic(
        "options.conflicting-basemap",
        mapUid,
        "map/basemap has more than one value; the first value is being used.",
        distinctBasemaps.join(" | "),
      ),
    );
  }
  if (sizeSourceUids.length > 1 || distinctSizes.length > 1) {
    diagnostics.push(
      optionDiagnostic(
        "options.conflicting-size",
        mapUid,
        sizeSourceUids.length > 1
          ? "map/size appears more than once; the first value is shown, but resizing cannot save until the duplicate blocks are removed."
          : "map/size has more than one value; the first value is shown.",
        distinctSizes.join(" | "),
      ),
    );
  }
  return {
    options: {
      basemap: parseBasemap(basemap.values[0], diagnostics, mapUid),
      size: parseMapSize(size.values[0], diagnostics, mapUid),
    },
    optionSourceUids: {
      basemap: [...new Set(basemap.sourceUids)],
      size: sizeSourceUids,
    },
    diagnostics,
    recognizedBlockUids: recognizedSourceUids(basemap, size),
  };
}

export const __test = { parseBasemap, parseMapSize };
