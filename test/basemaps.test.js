import test from "node:test";
import assert from "node:assert/strict";

import {
  BASEMAP_SETTINGS_KEY,
  EOX_SATELLITE_TILE_URL,
  createBasemapRegistry,
  mapTilerStyleUrl,
  openFreeMapStyleUrl,
  prepareProviderConfiguration,
  redactBasemapSecrets,
} from "../src/basemaps.js";

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
  assert.match(eox.notice, /10 m/u);
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
