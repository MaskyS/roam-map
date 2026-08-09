import test from "node:test";
import assert from "node:assert/strict";

import {
  BASEMAP_SETTINGS_KEY,
  BASEMAP_SETTINGS_VERSION,
  CUSTOM_BASEMAP_KINDS,
  EOX_SATELLITE_TILE_URL,
  createBasemapRegistry,
  mapTilerStyleUrl,
  openFreeMapStyleUrl,
  prepareCustomBasemap,
  prepareProviderConfiguration,
  redactBasemapSecrets,
} from "../../src/settings/basemap-registry.js";

test("five OpenFreeMap styles and EOX resolve through the same built-in catalog", () => {
  const registry = createBasemapRegistry();
  assert.deepEqual(
    registry.list().map(({ id, name }) => ({ id, name })),
    [
      { id: "openfreemap:liberty", name: "OpenFreeMap Liberty" },
      { id: "openfreemap:positron", name: "OpenFreeMap Positron" },
      { id: "openfreemap:bright", name: "OpenFreeMap Bright" },
      { id: "openfreemap:dark", name: "OpenFreeMap Dark" },
      { id: "openfreemap:fiord", name: "OpenFreeMap Fiord" },
      { id: "eox-satellite-context", name: "EOX Satellite Context" },
    ],
  );

  for (const variant of ["liberty", "positron", "bright", "dark", "fiord"]) {
    const basemap = registry.resolve(variant);
    assert.equal(basemap.provider, "openfreemap");
    assert.equal(basemap.variant, variant);
    assert.equal(basemap.style, openFreeMapStyleUrl(variant));
  }
  assert.equal(registry.resolve("streets").id, "openfreemap:liberty");

  const eox = registry.resolve("satellite");
  const source = eox.style.sources["roam-map/eox-satellite-context"];
  assert.equal(eox.id, "eox-satellite-context");
  assert.equal(source.tiles[0], EOX_SATELLITE_TILE_URL);
  assert.equal(source.maxzoom, 14);
  assert.match(source.attribution, /2016/u);
  assert.match(source.attribution, /CC BY 4\.0/u);
  assert.equal(eox.notice, null);
});

test("one MapTiler provider configuration contributes Satellite and Hybrid without exposing its key", () => {
  const settings = {
    get: (key) =>
      key === BASEMAP_SETTINGS_KEY
        ? {
            version: 1,
            providers: { maptiler: { apiKey: "work/key" } },
          }
        : null,
  };
  const registry = createBasemapRegistry({ settings });
  assert.deepEqual(
    registry.list().map(({ name }) => name),
    [
      "OpenFreeMap Liberty",
      "OpenFreeMap Positron",
      "OpenFreeMap Bright",
      "OpenFreeMap Dark",
      "OpenFreeMap Fiord",
      "EOX Satellite Context",
      "MapTiler Satellite",
      "MapTiler Hybrid",
    ],
  );
  assert.doesNotMatch(JSON.stringify(registry.list()), /work\/key/u);

  const hybrid = registry.resolve("MapTiler Hybrid");
  assert.equal(hybrid.provider, "maptiler");
  assert.equal(hybrid.variant, "hybrid");
  assert.equal(
    hybrid.style,
    "https://api.maptiler.com/maps/hybrid-v4/style.json?key=work%2Fkey",
  );
  assert.doesNotMatch(JSON.stringify(registry.describe(hybrid.id)), /work%2Fkey|work\/key/u);
});

test("rotating a provider key notifies mounted maps while preserving other provider records", async () => {
  const saved = [];
  const settings = {
    canSet: true,
    get: () => ({
      version: 1,
      providers: {
        maptiler: { apiKey: "first-key" },
        "future-provider": { credential: "preserve-without-reading" },
      },
    }),
    set: async (key, value) => saved.push({ key, value }),
  };
  const registry = createBasemapRegistry({ settings });
  const revisions = [];
  const unsubscribe = registry.subscribe((revision) => revisions.push(revision));

  await registry.replaceProviderConfiguration("maptiler", { apiKey: "second-key" });

  assert.equal(saved[0].key, BASEMAP_SETTINGS_KEY);
  assert.deepEqual(saved[0].value.providers.maptiler, { apiKey: "second-key" });
  assert.deepEqual(saved[0].value.providers["future-provider"], {
    credential: "preserve-without-reading",
  });
  assert.match(registry.resolve("MapTiler Satellite").style, /second-key/u);
  assert.deepEqual(revisions, [1]);
  unsubscribe();
});

test("invalid provider settings fail without saving and unknown names visibly fall back", async () => {
  const writes = [];
  const registry = createBasemapRegistry({
    settings: { get: () => null, set: async (...args) => writes.push(args) },
  });
  await assert.rejects(
    registry.replaceProviderConfiguration("maptiler", { apiKey: "" }),
    /public browser key/u,
  );
  assert.deepEqual(writes, []);

  const unknown = registry.resolve("Moon Photos");
  assert.equal(unknown.id, "openfreemap:liberty");
  assert.equal(unknown.fallback, true);
  assert.match(unknown.error.message, /not configured/u);
});

test("provider validation and secret redaction cover authenticated style URLs", () => {
  assert.throws(
    () => prepareProviderConfiguration("unknown", { apiKey: "value" }),
    /not supported/u,
  );
  assert.deepEqual(prepareProviderConfiguration("maptiler", { apiKey: " value " }), {
    apiKey: "value",
  });
  assert.equal(
    mapTilerStyleUrl("satellite-v4", "a key"),
    "https://api.maptiler.com/maps/satellite-v4/style.json?key=a+key",
  );
  assert.equal(
    redactBasemapSecrets(
      "Failed https://api.maptiler.com/maps/hybrid-v4/style.json?key=private-value&x=1",
    ),
    "Failed https://api.maptiler.com/maps/hybrid-v4/style.json?key=[redacted]&x=1",
  );
  assert.equal(
    redactBasemapSecrets("https://example.test/style?api_key=one&access-token=two"),
    "https://example.test/style?api_key=[redacted]&access-token=[redacted]",
  );
});

test("removing a provider configuration removes only that provider's catalog entries", async () => {
  const writes = [];
  const registry = createBasemapRegistry({
    settings: {
      get: () => ({ version: 1, providers: { maptiler: { apiKey: "first" } } }),
      set: async (_key, value) => writes.push(value),
    },
  });
  await registry.replaceProviderConfiguration("maptiler", null);
  assert.deepEqual(registry.list().map(({ name }) => name), [
    "OpenFreeMap Liberty",
    "OpenFreeMap Positron",
    "OpenFreeMap Bright",
    "OpenFreeMap Dark",
    "OpenFreeMap Fiord",
    "EOX Satellite Context",
  ]);
  assert.deepEqual(writes[0].providers, {});
});

test("an unknown stored schema version is read-only rather than guessed or overwritten", async () => {
  const registry = createBasemapRegistry({
    settings: {
      get: () => ({
        version: 99,
        providers: { maptiler: { apiKey: "do-not-use" } },
      }),
      set: async () => assert.fail("must not overwrite a future schema"),
    },
  });
  assert.equal(registry.canSet, false);
  assert.deepEqual(registry.list().map(({ name }) => name), [
    "OpenFreeMap Liberty",
    "OpenFreeMap Positron",
    "OpenFreeMap Bright",
    "OpenFreeMap Dark",
    "OpenFreeMap Fiord",
    "EOX Satellite Context",
  ]);
  assert.match(registry.getWarnings()[0], /version 99/u);
  await assert.rejects(
    registry.replaceProviderConfiguration("maptiler", { apiKey: "replacement" }),
    /version 99/u,
  );
});

test("non-admin graph members cannot replace provider configurations", async () => {
  const registry = createBasemapRegistry({
    settings: { canSet: false, get: () => null, set: async () => assert.fail("must not write") },
  });
  assert.equal(registry.canSet, false);
  await assert.rejects(
    registry.replaceProviderConfiguration("maptiler", { apiKey: "value" }),
    /graph administrator/u,
  );
});

test("a complete external style URL becomes a named basemap without exposing its URL publicly", () => {
  const registry = createBasemapRegistry({
    settings: {
      get: () => ({
        version: BASEMAP_SETTINGS_VERSION,
        providers: {},
        basemaps: [
          {
            id: "maplibre-demo",
            name: "MapLibre Demo",
            kind: CUSTOM_BASEMAP_KINDS.style,
            url: "https://demotiles.maplibre.org/style.json",
            notice: "Demonstration service",
            aliases: [],
          },
        ],
      }),
    },
  });

  const resolved = registry.resolve("MapLibre Demo");
  assert.equal(resolved.id, "custom:maplibre-demo");
  assert.equal(resolved.provider, "custom");
  assert.equal(resolved.style, "https://demotiles.maplibre.org/style.json");
  assert.equal(resolved.notice, "Demonstration service");
  assert.doesNotMatch(JSON.stringify(registry.list()), /demotiles/u);
  assert.doesNotMatch(JSON.stringify(registry.describe("MapLibre Demo")), /demotiles/u);
});

test("a custom raster tile template compiles to an attributed MapLibre style", async () => {
  const writes = [];
  const registry = createBasemapRegistry({
    settings: {
      canSet: true,
      get: () => null,
      set: async (_key, value) => writes.push(value),
    },
  });

  const saved = await registry.replaceCustomBasemap(null, {
    name: "Regional Imagery",
    kind: CUSTOM_BASEMAP_KINDS.raster,
    url: "https://tiles.example.test/{z}/{x}/{y}.png?key=public-key",
    attribution: "Imagery © Example · Data © OpenStreetMap contributors",
    tileSize: 512,
    minZoom: 2,
    maxZoom: 18,
    scheme: "tms",
    notice: "Imagery date varies by region.",
  });

  assert.equal(saved.id, "regional-imagery");
  assert.equal(writes[0].version, BASEMAP_SETTINGS_VERSION);
  assert.deepEqual(writes[0].providers, {});
  assert.equal(writes[0].basemaps[0].name, "Regional Imagery");
  const resolved = registry.resolve("Regional Imagery");
  const source = resolved.style.sources["roam-map/custom-raster-basemap"];
  assert.deepEqual(source.tiles, [
    "https://tiles.example.test/{z}/{x}/{y}.png?key=public-key",
  ]);
  assert.equal(source.tileSize, 512);
  assert.equal(source.minzoom, 2);
  assert.equal(source.maxzoom, 18);
  assert.equal(source.scheme, "tms");
  assert.match(source.attribution, /OpenStreetMap/u);
});

test("custom basemap validation rejects unsafe or incomplete catalog records", async () => {
  assert.throws(
    () =>
      prepareCustomBasemap({
        name: "Local file",
        kind: CUSTOM_BASEMAP_KINDS.style,
        url: "file:///tmp/style.json",
      }),
    /HTTP\(S\)/u,
  );
  assert.throws(
    () =>
      prepareCustomBasemap({
        name: "No credits",
        kind: CUSTOM_BASEMAP_KINDS.raster,
        url: "https://tiles.example.test/{z}/{x}/{y}.png",
      }),
    /attribution is required/u,
  );
  assert.throws(
    () =>
      prepareCustomBasemap({
        name: "Not a template",
        kind: CUSTOM_BASEMAP_KINDS.raster,
        url: "https://tiles.example.test/one-image.png",
        attribution: "© Example",
      }),
    /\{z\}.*\{x\}.*\{y\}/u,
  );

  const registry = createBasemapRegistry({
    settings: { canSet: true, get: () => null, set: async () => null },
  });
  await assert.rejects(
    registry.replaceCustomBasemap(null, {
      name: "OpenFreeMap Liberty",
      kind: CUSTOM_BASEMAP_KINDS.style,
      url: "https://example.test/style.json",
    }),
    /conflicts/u,
  );
});

test("editing a custom basemap retains its former readable name as an alias", async () => {
  const writes = [];
  const registry = createBasemapRegistry({
    settings: { canSet: true, get: () => null, set: async (_key, value) => writes.push(value) },
  });
  const added = await registry.replaceCustomBasemap(null, {
    name: "First Name",
    kind: CUSTOM_BASEMAP_KINDS.style,
    url: "https://example.test/first.json",
  });
  const updated = await registry.replaceCustomBasemap(added.id, {
    ...added,
    name: "Better Name",
    url: "https://example.test/better.json",
  });

  assert.deepEqual(updated.aliases, ["First Name"]);
  assert.equal(registry.resolve("First Name").name, "Better Name");
  assert.equal(registry.resolve("Better Name").style, "https://example.test/better.json");
  assert.equal(writes.at(-1).version, BASEMAP_SETTINGS_VERSION);
});

test("version 1 provider settings migrate on the next catalog write without losing unknown data", async () => {
  const writes = [];
  const registry = createBasemapRegistry({
    settings: {
      canSet: true,
      get: () => ({
        version: 1,
        providers: {
          maptiler: { apiKey: "existing-key" },
          "future-provider": { keep: true },
        },
        "future-root-field": { keep: true },
      }),
      set: async (_key, value) => writes.push(value),
    },
  });

  await registry.replaceCustomBasemap(null, {
    name: "External Style",
    kind: CUSTOM_BASEMAP_KINDS.style,
    url: "https://example.test/style.json",
  });

  assert.equal(writes[0].version, BASEMAP_SETTINGS_VERSION);
  assert.deepEqual(writes[0].providers.maptiler, { apiKey: "existing-key" });
  assert.deepEqual(writes[0].providers["future-provider"], { keep: true });
  assert.deepEqual(writes[0]["future-root-field"], { keep: true });
  assert.equal(writes[0].basemaps[0].name, "External Style");
});

test("custom basemaps are removable and obey graph-admin settings permissions", async () => {
  const registry = createBasemapRegistry({
    settings: {
      canSet: false,
      get: () => ({
        version: BASEMAP_SETTINGS_VERSION,
        providers: {},
        basemaps: [
          {
            id: "external",
            name: "External",
            kind: CUSTOM_BASEMAP_KINDS.style,
            url: "https://example.test/style.json",
          },
        ],
      }),
      set: async () => assert.fail("must not write"),
    },
  });
  await assert.rejects(registry.removeCustomBasemap("external"), /graph administrator/u);

  const writes = [];
  const editable = createBasemapRegistry({
    settings: {
      canSet: true,
      get: () => ({
        version: BASEMAP_SETTINGS_VERSION,
        providers: {},
        basemaps: registry.listCustomBasemaps(),
      }),
      set: async (_key, value) => writes.push(value),
    },
  });
  assert.equal(await editable.removeCustomBasemap("custom:external"), true);
  assert.deepEqual(writes[0].basemaps, []);
  assert.equal(editable.resolve("External").fallback, true);
});
