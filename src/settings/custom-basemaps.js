// Custom basemaps are graph-wide catalog records, independent of MapLibre map
// instances. This module validates their durable shape and builds raster styles.
export const CUSTOM_BASEMAP_KINDS = Object.freeze({
  style: "style-url",
  raster: "raster-tiles",
});

const CUSTOM_RASTER_SOURCE_ID = "roam-map/custom-raster-basemap";
const CUSTOM_RASTER_LAYER_ID = "roam-map/custom-raster-basemap";
const MAX_NAME_LENGTH = 80;
const MAX_URL_LENGTH = 4096;
const MAX_TEXT_LENGTH = 2000;

function settingError(message) {
  const error = new Error(message);
  error.name = "BasemapSettingsError";
  return error;
}

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function normalizedName(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/gu, " ")
    .toLocaleLowerCase();
}

function normalizedText(
  value,
  { label, required = false, maxLength = MAX_TEXT_LENGTH, singleLine = true, strict },
) {
  const text = String(value ?? "").trim();
  if (!text && required) {
    if (strict) throw settingError(`${label} is required.`);
    return null;
  }
  if ((singleLine && /\r|\n/u.test(text)) || text.length > maxLength) {
    if (strict) {
      throw settingError(
        singleLine
          ? `${label} must be one line of at most ${maxLength} characters.`
          : `${label} must be at most ${maxLength} characters.`,
      );
    }
    return null;
  }
  return text;
}

function httpUrl(value, { label, strict }) {
  const text = normalizedText(value, {
    label,
    required: true,
    maxLength: MAX_URL_LENGTH,
    strict,
  });
  if (!text) return null;
  try {
    const url = new URL(text);
    if (url.protocol === "http:" || url.protocol === "https:") return text;
  } catch {
    // The shared message below is clearer than URL's browser-specific error.
  }
  if (strict) throw settingError(`${label} must be a complete HTTP(S) URL.`);
  return null;
}

function rasterTemplateUrl(value, { strict }) {
  const url = httpUrl(value, { label: "Raster tile URL", strict });
  if (!url) return null;
  const xyz = ["{z}", "{x}", "{y}"].every((token) => url.includes(token));
  const projectedBounds = url.includes("{bbox-epsg-3857}");
  if (xyz || projectedBounds) return url;
  if (strict) {
    throw settingError(
      "Raster tile URL must contain {z}, {x}, and {y}, or {bbox-epsg-3857} for a WMS request.",
    );
  }
  return null;
}

function zoom(value, { label, fallback, strict }) {
  if (value == null || value === "") return fallback;
  const number = Number(value);
  if (Number.isInteger(number) && number >= 0 && number <= 24) return number;
  if (strict) throw settingError(`${label} must be a whole number from 0 to 24.`);
  return null;
}

function tileSize(value, { strict }) {
  const number = value == null || value === "" ? 256 : Number(value);
  if (number === 256 || number === 512) return number;
  if (strict) throw settingError("Raster tile size must be 256 or 512 pixels.");
  return null;
}

function customBasemapId(value, { strict }) {
  const id = String(value ?? "").trim();
  if (/^[a-z0-9][a-z0-9_-]{0,63}$/u.test(id)) return id;
  if (strict) throw settingError("A custom basemap needs a stable identifier.");
  return null;
}

function customIdFromName(name, existing = []) {
  const base = String(name)
    .normalize("NFKD")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 56) || "basemap";
  const taken = new Set(existing.map(({ id }) => id));
  if (!taken.has(base)) return base;
  let suffix = 2;
  while (taken.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

function normalizeAliases(value, currentName) {
  const aliases = Array.isArray(value) ? value : [];
  return [
    ...new Set(
      aliases
        .map((alias) => String(alias ?? "").trim())
        .filter(
          (alias) =>
            alias &&
            alias.length <= MAX_NAME_LENGTH &&
            !/[\r\n]/u.test(alias) &&
            normalizedName(alias) !== normalizedName(currentName),
        ),
    ),
  ];
}

export function prepareCustomBasemap(raw, { strict = true, existing = [] } = {}) {
  const source = plainObject(raw);
  if (!source) {
    if (strict) throw settingError("A custom basemap needs a configuration.");
    return null;
  }
  const name = normalizedText(source.name, {
    label: "Basemap name",
    required: true,
    maxLength: MAX_NAME_LENGTH,
    strict,
  });
  if (!name) return null;
  const id = source.id
    ? customBasemapId(source.id, { strict })
    : customIdFromName(name, existing);
  if (!id) return null;
  const kind = String(source.kind ?? "").trim();
  if (!Object.values(CUSTOM_BASEMAP_KINDS).includes(kind)) {
    if (strict) throw settingError("Choose a complete style URL or a raster tile template.");
    return null;
  }
  const notice = normalizedText(source.notice, {
    label: "Basemap notice",
    maxLength: MAX_TEXT_LENGTH,
    singleLine: false,
    strict,
  });
  if (notice == null) return null;

  if (kind === CUSTOM_BASEMAP_KINDS.style) {
    const url = httpUrl(source.url, { label: "Style URL", strict });
    if (!url) return null;
    return { id, name, kind, url, notice, aliases: normalizeAliases(source.aliases, name) };
  }

  const url = rasterTemplateUrl(source.url, { strict });
  const attribution = normalizedText(source.attribution, {
    label: "Raster attribution",
    required: true,
    maxLength: MAX_TEXT_LENGTH,
    singleLine: false,
    strict,
  });
  const minZoom = zoom(source.minZoom, { label: "Minimum zoom", fallback: 0, strict });
  const maxZoom = zoom(source.maxZoom, { label: "Maximum zoom", fallback: 22, strict });
  const preparedTileSize = tileSize(source.tileSize, { strict });
  const scheme = source.scheme == null || source.scheme === "" ? "xyz" : String(source.scheme);
  if (!url || !attribution || minZoom == null || maxZoom == null || preparedTileSize == null) {
    return null;
  }
  if (minZoom > maxZoom) {
    if (strict) throw settingError("Minimum zoom must not be greater than maximum zoom.");
    return null;
  }
  if (scheme !== "xyz" && scheme !== "tms") {
    if (strict) throw settingError("Raster tile scheme must be xyz or tms.");
    return null;
  }
  return {
    id,
    name,
    kind,
    url,
    attribution,
    tileSize: preparedTileSize,
    minZoom,
    maxZoom,
    scheme,
    notice,
    aliases: normalizeAliases(source.aliases, name),
  };
}

const HTML_ESCAPES = Object.freeze({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
});

// MapLibre's AttributionControl renders attribution with innerHTML, and this
// value syncs graph-wide through extension settings, so it must never carry
// markup written by another graph member.
export function escapeAttributionHtml(text) {
  return String(text).replace(/[&<>"']/g, (character) => HTML_ESCAPES[character]);
}

export function customRasterStyle(configuration) {
  return {
    version: 8,
    sources: {
      [CUSTOM_RASTER_SOURCE_ID]: {
        type: "raster",
        tiles: [configuration.url],
        tileSize: configuration.tileSize,
        minzoom: configuration.minZoom,
        maxzoom: configuration.maxZoom,
        scheme: configuration.scheme,
        attribution: escapeAttributionHtml(configuration.attribution),
      },
    },
    layers: [
      {
        id: CUSTOM_RASTER_LAYER_ID,
        type: "raster",
        source: CUSTOM_RASTER_SOURCE_ID,
      },
    ],
  };
}

export function customBasemapEntry(configuration) {
  return {
    id: `custom:${configuration.id}`,
    name: configuration.name,
    provider: "custom",
    variant: configuration.kind,
    builtIn: false,
    aliases: configuration.aliases,
    notice: configuration.notice || null,
    buildStyle: () =>
      configuration.kind === CUSTOM_BASEMAP_KINDS.style
        ? configuration.url
        : customRasterStyle(configuration),
  };
}

export function customEntries(configurations) {
  return configurations.map(customBasemapEntry);
}
