export const BASEMAP_SETTINGS_KEY = "basemap-provider-configurations";
export const BASEMAP_SETTINGS_VERSION = 1;
export const OPENFREEMAP_STYLE_BASE_URL = "https://tiles.openfreemap.org/styles";
export const DEFAULT_MAP_STYLE = `${OPENFREEMAP_STYLE_BASE_URL}/liberty`;
export const EOX_SATELLITE_TILE_URL =
  "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg";

const DEFAULT_REFERENCE = "streets";
const OPENFREEMAP_VARIANTS = Object.freeze([
  Object.freeze({
    id: "liberty",
    label: "Liberty",
    aliases: ["streets", "street", "classic"],
  }),
  Object.freeze({ id: "positron", label: "Positron", aliases: [] }),
  Object.freeze({ id: "bright", label: "Bright", aliases: [] }),
  Object.freeze({ id: "dark", label: "Dark", aliases: [] }),
  Object.freeze({ id: "fiord", label: "Fiord", aliases: [] }),
]);
const MAPTILER_VARIANTS = Object.freeze([
  Object.freeze({ id: "satellite", label: "Satellite", styleId: "satellite-v4" }),
  Object.freeze({ id: "hybrid", label: "Hybrid", styleId: "hybrid-v4" }),
]);

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function normalizedReference(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/gu, " ")
    .toLocaleLowerCase();
}

function settingError(message) {
  const error = new Error(message);
  error.name = "BasemapSettingsError";
  return error;
}

function normalizeMapTilerConfiguration(raw, { strict }) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    if (strict) throw settingError("MapTiler needs a provider configuration.");
    return null;
  }
  const apiKey = String(raw.apiKey ?? "").trim();
  if (!apiKey) {
    if (strict) throw settingError("MapTiler needs a public browser key.");
    return null;
  }
  return { apiKey };
}

function mapTilerEntries(configuration) {
  return MAPTILER_VARIANTS.map((variant) => ({
    id: `maptiler:${variant.id}`,
    name: `MapTiler ${variant.label}`,
    provider: "maptiler",
    variant: variant.id,
    builtIn: false,
    aliases: [],
    notice: `MapTiler ${variant.label} uses the graph's public MapTiler browser key. Requests count against that account; MapTiler's Free plan is for personal and non-commercial use.`,
    buildStyle: () => mapTilerStyleUrl(variant.styleId, configuration.apiKey),
  }));
}

// A provider owns credential validation and the catalog entries it contributes.
// Adding another keyed provider means adding one adapter and one settings card;
// source compilation, map blocks, and the renderer keep the same contract.
const PROVIDER_ADAPTERS = Object.freeze({
  maptiler: Object.freeze({
    normalize: normalizeMapTilerConfiguration,
    entries: mapTilerEntries,
  }),
});

export function prepareProviderConfiguration(provider, raw) {
  const id = normalizedReference(provider);
  const adapter = PROVIDER_ADAPTERS[id];
  if (!adapter) throw settingError(`The basemap provider “${provider}” is not supported yet.`);
  return adapter.normalize(raw, { strict: true });
}

function readStoredProviders(value) {
  const container = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  if (
    Object.hasOwn(container, "version") &&
    container.version !== BASEMAP_SETTINGS_VERSION
  ) {
    return {
      configurations: {},
      passthrough: {},
      supported: false,
      warnings: [
        `Basemap settings version ${String(container.version)} cannot be edited by this build; version ${BASEMAP_SETTINGS_VERSION} is supported.`,
      ],
    };
  }

  const source =
    container.providers &&
    typeof container.providers === "object" &&
    !Array.isArray(container.providers)
      ? container.providers
      : {};
  const configurations = {};
  const passthrough = {};
  const warnings = [];
  for (const [provider, raw] of Object.entries(source)) {
    const adapter = PROVIDER_ADAPTERS[provider];
    if (!adapter) {
      passthrough[provider] = clone(raw);
      continue;
    }
    const configuration = adapter.normalize(raw, { strict: false });
    if (configuration) configurations[provider] = configuration;
    else warnings.push(`Ignored the invalid ${provider} basemap configuration.`);
  }
  return { configurations, passthrough, supported: true, warnings };
}

export function eoxSatelliteStyle() {
  return {
    version: 8,
    sources: {
      "roam-map/eox-satellite-context": {
        type: "raster",
        tiles: [EOX_SATELLITE_TILE_URL],
        tileSize: 256,
        minzoom: 0,
        maxzoom: 14,
        attribution:
          '<a href="https://cloudless.eox.at/">EOxCloudless</a> by <a href="https://eox.at/">EOX IT Services GmbH</a> (Contains modified Copernicus Sentinel data 2016; <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>)',
      },
    },
    layers: [
      {
        id: "roam-map/eox-satellite-context",
        type: "raster",
        source: "roam-map/eox-satellite-context",
      },
    ],
  };
}

export function mapTilerStyleUrl(styleId, apiKey) {
  const url = new URL(`https://api.maptiler.com/maps/${encodeURIComponent(styleId)}/style.json`);
  url.searchParams.set("key", String(apiKey ?? "").trim());
  return url.toString();
}

export function openFreeMapStyleUrl(styleId) {
  return `${OPENFREEMAP_STYLE_BASE_URL}/${encodeURIComponent(styleId)}`;
}

function openFreeMapEntries() {
  return OPENFREEMAP_VARIANTS.map((variant) => ({
    id: `openfreemap:${variant.id}`,
    name: `OpenFreeMap ${variant.label}`,
    provider: "openfreemap",
    variant: variant.id,
    builtIn: true,
    aliases: [variant.label, ...variant.aliases],
    notice: null,
    buildStyle: () => openFreeMapStyleUrl(variant.id),
  }));
}

function builtInEntries() {
  return [
    ...openFreeMapEntries(),
    {
      id: "eox-satellite-context",
      name: "EOX Satellite Context",
      provider: "eox",
      variant: "satellite-context",
      builtIn: true,
      aliases: ["satellite", "eox", "eox 2016", "EOxCloudless 2016"],
      notice:
        "Sentinel-2 context mosaic from 2016 at 10 m resolution, useful through zoom 14. EOX rate-limits its free service; check its terms for your use.",
      buildStyle: eoxSatelliteStyle,
    },
  ];
}

function configuredEntries(configurations) {
  return Object.entries(configurations).flatMap(([provider, configuration]) =>
    PROVIDER_ADAPTERS[provider]?.entries(configuration) ?? [],
  );
}

function publicEntry(entry) {
  return {
    id: entry.id,
    name: entry.name,
    provider: entry.provider,
    variant: entry.variant,
    builtIn: entry.builtIn,
    notice: entry.notice,
    settingValue: entry.name,
  };
}

function entryIndex(entries) {
  const index = new Map();
  for (const entry of entries) {
    for (const reference of [entry.id, entry.name, ...(entry.aliases ?? [])]) {
      const normalized = normalizedReference(reference);
      if (normalized && !index.has(normalized)) index.set(normalized, entry);
    }
  }
  return index;
}

function resolution(entries, reference) {
  const index = entryIndex(entries);
  const requested = String(reference ?? DEFAULT_REFERENCE).trim() || DEFAULT_REFERENCE;
  const matched = index.get(normalizedReference(requested));
  const fallback = index.get(normalizedReference(DEFAULT_REFERENCE));
  const entry = matched ?? fallback;
  const error = matched
    ? null
    : new Error(
        `Basemap “${requested}” is not configured in this graph. OpenFreeMap Liberty is being shown instead.`,
      );
  const style = entry.buildStyle();
  return {
    ...publicEntry(entry),
    requested,
    style,
    fingerprint: typeof style === "string" ? style : `${entry.id}:${JSON.stringify(style)}`,
    error,
    fallback: !matched,
  };
}

export function resolveBuiltInBasemap(reference) {
  return resolution(builtInEntries(), reference);
}

export function redactBasemapSecrets(value) {
  return String(value ?? "")
    .replace(
      /([?&](?:api[_-]?key|access[_-]?token|subscription[_-]?key|token|key)=)[^&#\s"']+/giu,
      "$1[redacted]",
    )
    .replace(
      /(["']?(?:api[_-]?key|access[_-]?token|subscription[_-]?key|token|key)["']?\s*[:=]\s*["']?)[^&,\s"'}]+/giu,
      "$1[redacted]",
    );
}

export function safeBasemapError(error) {
  const safe = new Error(redactBasemapSecrets(error?.message ?? error ?? "Unknown map error"));
  safe.name = error?.name ?? "Error";
  return safe;
}

export function createBasemapRegistry({ settings = null } = {}) {
  const stored = readStoredProviders(settings?.get?.(BASEMAP_SETTINGS_KEY));
  let configurations = stored.configurations;
  let passthrough = stored.passthrough;
  let supported = stored.supported;
  let warnings = stored.warnings;
  let revision = 0;
  const listeners = new Set();

  function entries() {
    return [...builtInEntries(), ...configuredEntries(configurations)];
  }

  function notify() {
    revision += 1;
    for (const listener of [...listeners]) listener(revision);
  }

  function writeBlockReason() {
    if (!supported) return warnings[0];
    if (settings?.canSet === false) {
      return "Only a graph administrator can change these extension settings.";
    }
    return null;
  }

  return {
    get canSet() {
      return writeBlockReason() == null;
    },
    get writeBlockReason() {
      return writeBlockReason();
    },
    get revision() {
      return revision;
    },
    list() {
      return entries().map(publicEntry);
    },
    describe(reference) {
      const resolved = resolution(entries(), reference);
      const { style: _style, fingerprint: _fingerprint, ...description } = resolved;
      return description;
    },
    resolve(reference) {
      return resolution(entries(), reference);
    },
    getProviderConfiguration(provider) {
      return clone(configurations[normalizedReference(provider)] ?? null);
    },
    getWarnings() {
      return [...warnings];
    },
    async replaceProviderConfiguration(provider, next) {
      const blocked = writeBlockReason();
      if (blocked) throw settingError(blocked);
      const id = normalizedReference(provider);
      const adapter = PROVIDER_ADAPTERS[id];
      if (!adapter) throw settingError(`The basemap provider “${provider}” is not supported yet.`);
      const prepared = next == null ? null : adapter.normalize(next, { strict: true });
      const nextConfigurations = { ...configurations };
      if (prepared) nextConfigurations[id] = prepared;
      else delete nextConfigurations[id];
      const storedProviders = { ...passthrough, ...nextConfigurations };
      if (typeof settings?.set === "function") {
        await settings.set(BASEMAP_SETTINGS_KEY, {
          version: BASEMAP_SETTINGS_VERSION,
          providers: storedProviders,
        });
      }
      configurations = nextConfigurations;
      supported = true;
      warnings = [];
      notify();
      return clone(configurations[id] ?? null);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      listeners.clear();
    },
  };
}

export const __test = {
  configuredEntries,
  normalizedReference,
  readStoredProviders,
};
