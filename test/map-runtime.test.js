import test from "node:test";
import assert from "node:assert/strict";

import {
  createInlineMapRuntime,
  MAP_LAYER_ID,
  MAP_SOURCE_ID,
  SATELLITE_TILE_URL,
} from "../src/map-runtime.js";
import { DEFAULT_MARKER_IMAGE_ID, FEATURE_PROPERTIES } from "../src/map-contract.js";
import { circularImageId } from "../src/image-assets.js";

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
    this.images = new Map();
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

  addLayer(layer) {
    this.layers.set(layer.id, layer);
  }

  getLayer(id) {
    return this.layers.get(id) ?? null;
  }

  removeLayer(id) {
    this.layers.delete(id);
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
    this.sources.clear();
    this.layers.clear();
    this.images.clear();
    this.emit("style.load");
  }

  easeTo(options) {
    this.lastEase = options;
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
      [FEATURE_PROPERTIES.pageUid]: `p${index}`,
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
    onFeature: (feature) => selected.push(feature),
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

  map.emit("click", { features: [second.features[0]] }, MAP_LAYER_ID);
  assert.equal(selected[0].pageUid, "p0");
  assert.equal(selected[0].label, "Place 0");

  runtime.remove();
  runtime.remove();
  assert.equal(map.removed, true);
  assert.equal(map.events.size, 0);
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
    onFeature: (feature) => selected.push(feature),
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
  map.emit("click", { features: [data.features[0]] }, "people-portraits");
  assert.equal(selected[0].pageUid, "p0");

  runtime.setPresentation({ basemap: "satellite" });
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
  assert.equal(map.events.has("click:people-portraits"), false);
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

test("presentation updates style markers and restores the data overlay after a basemap swap", () => {
  FakeMap.instances.length = 0;
  const runtime = createInlineMapRuntime({ container: {}, mapLibrary: fakeLibrary });
  const map = FakeMap.instances[0];
  map.emit("load");
  const data = collection([57.5, -20.16]);
  data.features[0].properties.markerColor = "#d9822b";
  data.features[0].properties.markerRadius = 13;
  runtime.setData(data);

  runtime.setPresentation({
    basemap: "satellite",
    marker: { color: "#2457a6", radius: 9 },
  });

  assert.equal(map.lastStyle.sources["roam-map-satellite"].tiles[0], SATELLITE_TILE_URL);
  assert.match(map.lastStyle.sources["roam-map-satellite"].attribution, /EOxCloudless/u);
  assert.equal(map.getSource(MAP_SOURCE_ID).data, data);
  assert.deepEqual(map.getLayer(MAP_LAYER_ID).paint["circle-color"], [
    "coalesce",
    ["get", "markerColor"],
    "#2457a6",
  ]);
  assert.ok(map.events.has("style.load:"));

  runtime.remove();
  assert.equal(map.events.size, 0);
});
