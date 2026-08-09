import test from "node:test";
import assert from "node:assert/strict";

import {
  createInlineMapRuntime,
  MAP_LAYER_ID,
  MAP_SOURCE_ID,
  SATELLITE_TILE_URL,
} from "../../src/maplibre/runtime.js";
import {
  DEFAULT_MARKER_COLOR,
  DEFAULT_MARKER_IMAGE_ID,
  SELECTED_ENTITY_STATE_KEY,
  SELECTED_POINT_LAYER_ID,
} from "../../src/maplibre/runtime-constants.js";
import { FEATURE_PROPERTIES } from "../../src/map/feature-properties.js";
import { __test as layerTest } from "../../src/map/layers.js";
import { circularImageId } from "../../src/maplibre/image-assets.js";
import {
  BASEMAP_SETTINGS_VERSION,
  CUSTOM_BASEMAP_KINDS,
  createBasemapRegistry,
} from "../../src/settings/basemap-registry.js";

class FakeBounds {
  constructor() {
    this.coordinates = [];
  }

  extend(coordinates) {
    this.coordinates.push(coordinates);
    return this;
  }
}

class FakeMap {
  static instances = [];

  constructor(options) {
    this.options = options;
    this.events = new Map();
    this.sources = new Map();
    this.layers = new Map();
    this.layerOrder = [];
    this.images = new Map();
    this.globalState = new Map();
    this.zoom = options.zoom;
    this.canvas = { style: {} };
    this.removed = false;
    this.dragRotate = { disable() {} };
    this.touchZoomRotate = { disableRotation() {} };
    FakeMap.instances.push(this);
  }

  eventKey(type, layer) {
    return `${type}:${layer ?? ""}`;
  }

  on(type, layerOrHandler, maybeHandler) {
    const layer = typeof layerOrHandler === "string" ? layerOrHandler : null;
    const handler = maybeHandler ?? layerOrHandler;
    this.events.set(this.eventKey(type, layer), handler);
  }

  off(type, layerOrHandler, maybeHandler) {
    const layer = typeof layerOrHandler === "string" ? layerOrHandler : null;
    const handler = maybeHandler ?? layerOrHandler;
    const key = this.eventKey(type, layer);
    if (this.events.get(key) === handler) this.events.delete(key);
  }

  emit(type, event = {}, layer = null) {
    this.events.get(this.eventKey(type, layer))?.(event);
  }

  addSource(id, specification) {
    this.sources.set(id, {
      data: specification.data,
      setData(value) {
        this.data = value;
      },
    });
  }

  getSource(id) {
    return this.sources.get(id) ?? null;
  }

  addLayer(layer, beforeId = null) {
    this.layers.set(layer.id, layer);
    this.layerOrder = this.layerOrder.filter((id) => id !== layer.id);
    const beforeIndex = beforeId ? this.layerOrder.indexOf(beforeId) : -1;
    if (beforeIndex >= 0) this.layerOrder.splice(beforeIndex, 0, layer.id);
    else this.layerOrder.push(layer.id);
  }

  getLayer(id) {
    return this.layers.get(id) ?? null;
  }

  removeLayer(id) {
    this.layers.delete(id);
    this.layerOrder = this.layerOrder.filter((layerId) => layerId !== id);
  }

  moveLayer(id, beforeId = null) {
    if (!this.layers.has(id)) throw new Error(`Unknown layer: ${id}`);
    this.layerOrder = this.layerOrder.filter((layerId) => layerId !== id);
    const beforeIndex = beforeId ? this.layerOrder.indexOf(beforeId) : -1;
    if (beforeIndex >= 0) this.layerOrder.splice(beforeIndex, 0, id);
    else this.layerOrder.push(id);
  }

  addImage(id, image, options) {
    this.images.set(id, { image, options });
  }

  hasImage(id) {
    return this.images.has(id);
  }

  removeImage(id) {
    this.images.delete(id);
  }

  getCanvas() {
    return this.canvas;
  }

  setPaintProperty(layerId, name, value) {
    this.layers.get(layerId).paint[name] = value;
  }

  setStyle(style) {
    this.lastStyle = style;
    this.styles = [...(this.styles ?? []), style];
    this.sources.clear();
    this.layers.clear();
    this.layerOrder = [];
    this.images.clear();
    this.globalState.clear();
    this.emit("style.load");
  }

  easeTo(options) {
    this.lastEase = options;
    if (Number.isFinite(options.zoom)) this.zoom = options.zoom;
  }

  getZoom() {
    return this.zoom;
  }

  setGlobalStateProperty(key, value) {
    this.globalState.set(key, value);
    this.globalStateChanges = [...(this.globalStateChanges ?? []), [key, value]];
  }

  fitBounds(bounds, options) {
    this.lastBounds = bounds;
    this.lastFitOptions = options;
  }

  resize() {
    this.resized = true;
  }

  remove() {
    this.removed = true;
  }
}

const fakeLibrary = { Map: FakeMap, LngLatBounds: FakeBounds };
const collection = (...coordinates) => ({
  type: "FeatureCollection",
  features: coordinates.map(([lon, lat], index) => ({
    type: "Feature",
    id: `page:${index}`,
    geometry: { type: "Point", coordinates: [lon, lat] },
    properties: {
      [FEATURE_PROPERTIES.entityUid]: `p${index}`,
      [FEATURE_PROPERTIES.label]: `Place ${index}`,
    },
  })),
});

test("data refreshes reuse one map and fit handles single and multiple points", () => {
  FakeMap.instances.length = 0;
  const selected = [];
  const runtime = createInlineMapRuntime({
    container: {},
    mapLibrary: fakeLibrary,
    onMarkerClick: (event) => selected.push(event),
  });
  const map = FakeMap.instances[0];
  map.emit("load");
  const source = map.getSource(MAP_SOURCE_ID);
  assert.ok(source);
  assert.ok(map.getLayer(MAP_LAYER_ID));
  assert.ok(map.hasImage(DEFAULT_MARKER_IMAGE_ID));

  const first = collection([57.5, -20.16]);
  runtime.setData(first);
  runtime.fit(first, { animate: false });
  assert.deepEqual(map.lastEase.center, [57.5, -20.16]);
  assert.equal(map.lastEase.zoom, 13);

  const second = collection([57.5, -20.16], [55.5, -21.1]);
  runtime.setData(second);
  runtime.fit(second, { animate: false });
  assert.equal(FakeMap.instances.length, 1);
  assert.equal(source.data, second);
  assert.deepEqual(map.lastBounds.coordinates, [[57.5, -20.16], [55.5, -21.1]]);

  map.emit("click", {
    features: [...second.features, second.features[0]],
    point: { x: 12, y: 18 },
    lngLat: { lng: 57.5, lat: -20.16 },
    originalEvent: { clientX: 212, clientY: 318, shiftKey: true },
  });
  assert.deepEqual(selected[0], {
    entityUids: ["p0", "p1"],
    coincidentEntityUids: ["p0", "p1"],
    point: { x: 12, y: 18 },
    lngLat: { lng: 57.5, lat: -20.16 },
    clientPoint: { x: 212, y: 318 },
    modifiers: { altKey: false, ctrlKey: false, metaKey: false, shiftKey: true },
  });

  runtime.remove();
  runtime.remove();
  assert.equal(map.removed, true);
  assert.equal(map.events.size, 0);
});

test("overlapping nearby markers select the point nearest the click", () => {
  FakeMap.instances.length = 0;
  const selected = [];
  const runtime = createInlineMapRuntime({
    container: {},
    mapLibrary: fakeLibrary,
    onMarkerClick: (event) => selected.push(event),
  });
  const map = FakeMap.instances[0];
  const data = collection([10, 10], [14, 10]);
  runtime.setData(data);
  map.project = ([x, y]) => ({ x, y });

  map.emit("click", {
    features: [data.features[1], data.features[0]],
    point: { x: 11, y: 10 },
  });

  assert.deepEqual(selected[0].entityUids, ["p0", "p1"]);
  assert.deepEqual(selected[0].coincidentEntityUids, ["p0"]);
  runtime.remove();
});

test("markers at the same visible point remain available in the chooser", () => {
  FakeMap.instances.length = 0;
  const selected = [];
  const runtime = createInlineMapRuntime({
    container: {},
    mapLibrary: fakeLibrary,
    onMarkerClick: (event) => selected.push(event),
  });
  const map = FakeMap.instances[0];
  const data = collection([10, 10], [10, 10]);
  runtime.setData(data);
  map.project = ([x, y]) => ({ x, y });

  map.emit("click", {
    features: data.features,
    point: { x: 10, y: 10 },
  });

  assert.deepEqual(selected[0].entityUids, ["p0", "p1"]);
  assert.deepEqual(selected[0].coincidentEntityUids, ["p0", "p1"]);
  runtime.remove();
});

test("native layers share the compiled source and runtime images survive style replacement", async () => {
  FakeMap.instances.length = 0;
  const selected = [];
  const loadedAssets = [];
  const runtime = createInlineMapRuntime({
    container: {},
    mapLibrary: fakeLibrary,
    loadAsset: async (asset) => {
      loadedAssets.push(asset.id);
      const options = { pixelRatio: 2 };
      return {
        image: { width: 64, height: 64, data: new Uint8ClampedArray(64 * 64 * 4) },
        options,
        variants: [
          {
            id: circularImageId(asset.id),
            image: { width: 64, height: 64, data: new Uint8ClampedArray(64 * 64 * 4) },
            options,
          },
        ],
      };
    },
    onMarkerClick: (event) => selected.push(event),
  });
  const map = FakeMap.instances[0];
  map.emit("load");
  const portraitLayer = {
    id: "people-portraits",
    type: "symbol",
    source: MAP_SOURCE_ID,
    filter: ["has", "Profile Picture"],
    layout: {
      "icon-image": [
        "image",
        ["concat", ["get", "Profile Picture"], "#circle"],
      ],
    },
  };
  runtime.setLayers([portraitLayer]);
  assert.deepEqual(map.getLayer("people-portraits"), portraitLayer);

  const asset = {
    id: "roam-map:image:portrait",
    sourceUrl: "https://example.com/portrait.png",
  };
  await runtime.setAssets([asset]);
  assert.deepEqual(loadedAssets, [asset.id]);
  assert.equal(map.images.get(asset.id).options.pixelRatio, 2);
  assert.equal(map.images.get(circularImageId(asset.id)).options.pixelRatio, 2);

  const data = collection([57.5, -20.16]);
  runtime.setData(data);
  map.emit("click", { features: [data.features[0]] });
  assert.deepEqual(selected[0].entityUids, ["p0"]);
  assert.deepEqual(selected[0].coincidentEntityUids, ["p0"]);

  runtime.setBasemap("satellite");
  assert.ok(map.getLayer("people-portraits"));
  assert.ok(map.hasImage(DEFAULT_MARKER_IMAGE_ID));
  assert.ok(map.hasImage(asset.id));
  assert.ok(map.hasImage(circularImageId(asset.id)));

  await runtime.setAssets([]);
  assert.equal(map.hasImage(asset.id), false);
  assert.equal(map.hasImage(circularImageId(asset.id)), false);

  await runtime.setAssets([asset]);
  assert.deepEqual(loadedAssets, [asset.id, asset.id]);
  assert.equal(map.hasImage(asset.id), true);
  assert.equal(map.hasImage(circularImageId(asset.id)), true);

  runtime.setLayers([]);
  assert.equal(map.getLayer("people-portraits"), null);
  assert.equal(map.events.has("mouseenter:people-portraits"), false);
  runtime.remove();
});

test("a failed image keeps the base point and registered fallback available", async () => {
  FakeMap.instances.length = 0;
  const failures = [];
  const runtime = createInlineMapRuntime({
    container: {},
    mapLibrary: fakeLibrary,
    loadAsset: async () => {
      throw new Error("unavailable");
    },
    onAssetError: (failure) => failures.push(failure),
  });
  const map = FakeMap.instances[0];
  map.emit("load");
  await runtime.setAssets([
    { id: "roam-map:image:missing", sourceUrl: "https://example.com/missing.png" },
  ]);

  assert.equal(failures.length, 1);
  assert.ok(map.getLayer(MAP_LAYER_ID));
  assert.ok(map.hasImage(DEFAULT_MARKER_IMAGE_ID));
  assert.equal(map.hasImage("roam-map:image:missing"), false);
  runtime.remove();
});

test("a basemap swap restores the data overlay and fixed default marker", () => {
  FakeMap.instances.length = 0;
  const runtime = createInlineMapRuntime({ container: {}, mapLibrary: fakeLibrary });
  const map = FakeMap.instances[0];
  map.emit("load");
  const data = collection([57.5, -20.16]);
  runtime.setData(data);

  runtime.setBasemap("satellite");

  assert.equal(
    map.lastStyle.sources["roam-map/eox-satellite-context"].tiles[0],
    SATELLITE_TILE_URL,
  );
  assert.match(
    map.lastStyle.sources["roam-map/eox-satellite-context"].attribution,
    /EOxCloudless/u,
  );
  assert.equal(map.getSource(MAP_SOURCE_ID).data, data);
  assert.equal(map.getLayer(MAP_LAYER_ID).paint["circle-color"], DEFAULT_MARKER_COLOR);
  assert.ok(map.events.has("style.load:"));

  runtime.remove();
  assert.equal(map.events.size, 0);
});

test("named MapTiler basemaps reapply changed keys without exposing them in status or errors", async () => {
  FakeMap.instances.length = 0;
  let stored = {
    version: 1,
    providers: { maptiler: { apiKey: "first/private-key" } },
  };
  const registry = createBasemapRegistry({
    settings: {
      get: () => stored,
      set: async (_key, value) => {
        stored = value;
      },
    },
  });
  const statuses = [];
  const errors = [];
  const runtime = createInlineMapRuntime({
    container: {},
    mapLibrary: fakeLibrary,
    resolveBasemap: (reference) => registry.resolve(reference),
    onBasemap: (status) => statuses.push(status),
    onError: (error) => errors.push(error),
  });
  const map = FakeMap.instances[0];
  map.emit("load");

  runtime.setBasemap("MapTiler Hybrid");
  assert.equal(
    map.lastStyle,
    "https://api.maptiler.com/maps/hybrid-v4/style.json?key=first%2Fprivate-key",
  );
  assert.doesNotMatch(JSON.stringify(statuses.at(-1)), /first|private-key/u);

  await registry.replaceProviderConfiguration("maptiler", {
    apiKey: "second/private-key",
  });
  runtime.setBasemap("MapTiler Hybrid");
  assert.equal(map.styles.length, 2);
  assert.match(map.lastStyle, /second%2Fprivate-key/u);

  map.emit("error", {
    error: new Error(`Request failed for ${map.lastStyle}`),
  });
  assert.doesNotMatch(errors.at(-1).message, /second|private-key/u);
  assert.match(errors.at(-1).message, /key=\[redacted\]/u);
  runtime.remove();
});

test("a graph-defined external style URL passes through the catalog and restores the overlay", () => {
  FakeMap.instances.length = 0;
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
          },
        ],
      }),
    },
  });
  const statuses = [];
  const runtime = createInlineMapRuntime({
    container: {},
    mapLibrary: fakeLibrary,
    resolveBasemap: (reference) => registry.resolve(reference),
    onBasemap: (status) => statuses.push(status),
  });
  const map = FakeMap.instances[0];
  map.emit("load");
  const data = collection([57.5, -20.16]);
  runtime.setData(data);

  runtime.setBasemap("MapLibre Demo");

  assert.equal(map.lastStyle, "https://demotiles.maplibre.org/style.json");
  assert.equal(statuses.at(-1).name, "MapLibre Demo");
  assert.doesNotMatch(JSON.stringify(statuses.at(-1)), /demotiles/u);
  assert.equal(map.getSource(MAP_SOURCE_ID).data, data);
  assert.ok(map.getLayer(MAP_LAYER_ID));
  runtime.remove();
});

test("focus zooms in to 15, preserves closer zoom, and uses a transient offset", () => {
  FakeMap.instances.length = 0;
  const runtime = createInlineMapRuntime({ container: {}, mapLibrary: fakeLibrary });
  const map = FakeMap.instances[0];
  map.emit("load");

  map.zoom = 8;
  runtime.focus([57.5, -20.16], { offset: [140, -15] });
  assert.deepEqual(map.lastEase, {
    center: [57.5, -20.16],
    zoom: 15,
    offset: [140, -15],
    duration: 450,
    essential: false,
  });

  map.zoom = 17;
  runtime.focus([57.51, -20.17]);
  assert.equal(map.lastEase.zoom, 17);
  assert.deepEqual(map.lastEase.offset, [0, 0]);

  const lastValidCamera = map.lastEase;
  runtime.focus([Number.NaN, -20.17]);
  assert.equal(map.lastEase, lastValidCamera);
  runtime.remove();
});

test("selection uses global state and keeps the reserved ring above custom layers", () => {
  FakeMap.instances.length = 0;
  const runtime = createInlineMapRuntime({ container: {}, mapLibrary: fakeLibrary });
  const map = FakeMap.instances[0];
  map.emit("load");

  const ring = map.getLayer(SELECTED_POINT_LAYER_ID);
  assert.ok(ring);
  assert.deepEqual(layerTest.validationMessages(ring), []);
  assert.deepEqual(ring.filter, [
    "all",
    ["has", FEATURE_PROPERTIES.entityUid],
    [
      "==",
      ["get", FEATURE_PROPERTIES.entityUid],
      ["global-state", SELECTED_ENTITY_STATE_KEY],
    ],
  ]);
  assert.equal(map.events.has(`mouseenter:${SELECTED_POINT_LAYER_ID}`), false);

  runtime.setLayers([
    {
      id: "custom-markers",
      type: "circle",
      source: MAP_SOURCE_ID,
      paint: { "circle-color": "#ff0000" },
    },
  ]);
  runtime.setSelectedEntityUid("p0");
  assert.equal(map.globalState.get(SELECTED_ENTITY_STATE_KEY), "p0");
  assert.equal(map.layerOrder.at(-1), SELECTED_POINT_LAYER_ID);

  runtime.setBasemap("satellite");
  assert.ok(map.getLayer("custom-markers"));
  assert.ok(map.getLayer(SELECTED_POINT_LAYER_ID));
  assert.equal(map.layerOrder.at(-1), SELECTED_POINT_LAYER_ID);
  assert.equal(map.globalState.get(SELECTED_ENTITY_STATE_KEY), "p0");

  runtime.setSelectedEntityUid(null);
  assert.equal(map.globalState.get(SELECTED_ENTITY_STATE_KEY), null);
  runtime.remove();
});
