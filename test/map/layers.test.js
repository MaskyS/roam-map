import test from "node:test";
import assert from "node:assert/strict";

import { createDirectSourceCompiler } from "../../src/map/direct-sources.js";
import { MAP_SOURCE_ID } from "../../src/maplibre/runtime-constants.js";
import { compileMapLayers } from "../../src/map/layers.js";

function codeBlock(uid, layer, language = "json") {
  const body = typeof layer === "string" ? layer : JSON.stringify(layer, null, 2);
  return {
    ":block/uid": uid,
    ":block/order": 0,
    ":block/string": [`\`\`\`${language}`, body, "```"].join("\n"),
  };
}

function layerContainer(uid, layer) {
  return {
    ":block/uid": uid,
    ":block/order": 0,
    ":block/string": "MapLibre layer",
    ":block/children": [codeBlock(`${uid}-json`, layer, "json")],
  };
}

test("validated native MapLibre layers retain outline order", () => {
  const circle = {
    id: "people-base",
    type: "circle",
    source: MAP_SOURCE_ID,
    paint: { "circle-color": "#6f42c1", "circle-radius": 12 },
  };
  const portraits = {
    id: "people-portraits",
    type: "symbol",
    source: MAP_SOURCE_ID,
    filter: ["has", "Profile Picture"],
    layout: {
      "icon-image": [
        "coalesce",
        ["image", ["concat", ["get", "Profile Picture"], "#circle"]],
        ["image", "roam-map/default-marker"],
      ],
      "icon-size": 1,
      "icon-overlap": "always",
    },
  };
  const circleBlock = layerContainer("circle", circle);
  const portraitBlock = layerContainer("portraits", portraits);
  const result = compileMapLayers([circleBlock, portraitBlock]);

  assert.deepEqual(result.layers, [circle, portraits]);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(
    [...result.recognizedBlockUids],
    ["circle", "circle-json", "portraits", "portraits-json"],
  );
});

test("the durable Roam form is a readable parent with one ordinary JSON code block", () => {
  const layer = { id: "places", type: "circle", source: MAP_SOURCE_ID };
  const parent = layerContainer("layer", layer);
  const result = compileMapLayers([parent, parent[":block/children"][0]]);

  assert.deepEqual(result.layers, [layer]);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual([...result.recognizedBlockUids], ["layer", "layer-json"]);
});

test("compact layer fences are not a second configuration grammar", () => {
  const layer = { id: "places", type: "circle", source: MAP_SOURCE_ID };
  const block = codeBlock("layer", `maplibre-layer\n${JSON.stringify(layer)}`, "javascript");
  const result = compileMapLayers([block]);

  assert.deepEqual(result.layers, []);
  assert.deepEqual(result.diagnostics, []);
});

test("Roam code blocks may store the closing fence immediately after JSON", () => {
  const layer = { id: "places", type: "circle", source: MAP_SOURCE_ID };
  const child = {
    ":block/uid": "json",
    ":block/string": `\`\`\`javascript\n${JSON.stringify(layer)}\`\`\``,
  };
  const parent = {
    ":block/uid": "layer",
    ":block/string": "MapLibre layer",
    ":block/children": [child],
  };
  const result = compileMapLayers([parent, child]);

  assert.deepEqual(result.layers, [layer]);
  assert.deepEqual(result.diagnostics, []);
});

test("invalid, duplicate, reserved, and foreign-source layers are local diagnostics", () => {
  const valid = { id: "places", type: "circle", source: MAP_SOURCE_ID };
  const blocks = [
    layerContainer("bad-json", "{"),
    layerContainer("first", valid),
    layerContainer("duplicate", valid),
    layerContainer("reserved", { ...valid, id: "roam-map/private" }),
    layerContainer("foreign", { ...valid, id: "foreign", source: "another-source" }),
  ];
  const result = compileMapLayers(blocks);

  assert.deepEqual(result.layers, [valid]);
  assert.deepEqual(
    result.diagnostics.map(({ code }) => code),
    ["layer.invalid-json", "layer.duplicate-id", "layer.reserved-id", "layer.unsupported-source"],
  );
});

test("direct sources treat canonical MapLibre layers as configuration, not source leaves", async () => {
  const circle = { id: "places", type: "circle", source: MAP_SOURCE_ID };
  const root = {
    ":block/uid": "map",
    ":block/string": "{{map}}",
    ":block/children": [layerContainer("layer", circle)],
  };
  const compiler = createDirectSourceCompiler({ pull: async () => root });
  const result = await compiler.compile("map");

  assert.deepEqual(result.contributions, []);
  assert.deepEqual(result.layers, [circle]);
  assert.deepEqual(result.diagnostics, []);
});
