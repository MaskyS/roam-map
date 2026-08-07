import test from "node:test";
import assert from "node:assert/strict";

import { compileMapPresentation, MAP_FIELDS } from "../src/map-presentation.js";

function relation(title, value, sourceUid, nested = []) {
  return {
    ":block/uid": `harc-${sourceUid}`,
    ":harc/a": [{ ":node/title": title }],
    ":harc/v": [value],
    ":harc/a-source": [{ ":block/uid": sourceUid }],
    ":harc/_e": nested,
  };
}

function block(uid, string, refs = [], attrs = []) {
  return {
    ":block/uid": uid,
    ":block/string": string,
    ":block/refs": refs,
    ":entity/attrs": attrs,
  };
}

function sv(value) {
  return { value };
}

function legacy(entityUid, attributeUid, sourceUid, value) {
  return [
    sv([":block/uid", entityUid]),
    { source: [":block/uid", sourceUid], value: [":block/uid", attributeUid] },
    sv(value),
  ];
}

test("current attributes compile a satellite basemap and one relationship-scoped marker", () => {
  const root = block("map", "{{map}}");
  root[":harc/_e"] = [
    relation(MAP_FIELDS.basemap, { ":harc/v-string": "satellite" }, "basemap"),
    relation(MAP_FIELDS.color, { ":harc/v-string": "#2457a6" }, "global-color"),
    relation(
      MAP_FIELDS.marker,
      { ":block/uid": "port", ":node/title": "Port Louis" },
      "port-marker",
      [
        relation(MAP_FIELDS.color, { ":harc/v-string": "#d9822b" }, "port-color"),
        relation(MAP_FIELDS.radius, { ":harc/v-string": "13" }, "port-radius"),
      ],
    ),
  ];
  const descendants = [
    block("basemap", "map/basemap:: satellite"),
    block("global-color", "map/color:: #2457a6"),
    block("port-marker", "map/marker:: [[Port Louis]]"),
    block("port-color", "map/color:: #d9822b"),
    block("port-radius", "map/radius:: 13"),
  ];

  const result = compileMapPresentation({ root, descendants });

  assert.deepEqual(result.presentation, {
    basemap: "satellite",
    marker: { color: "#2457a6", radius: 8 },
  });
  assert.deepEqual(result.sources, [
    {
      kind: "page",
      pageUid: "port",
      title: "Port Louis",
      presentation: { color: "#d9822b", radius: 13 },
      provenance: [
        { sourceBlockUid: "port-marker", originBlockUid: "port-marker", viaBlockRefUid: null },
      ],
    },
  ]);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(
    result.recognizedAttributeBlockUids,
    new Set(["basemap", "global-color", "port-marker", "port-color", "port-radius"]),
  );
});

test("legacy attribute triples retain the same map and marker meaning", () => {
  const attributeUids = new Map([
    [MAP_FIELDS.basemap, "a-basemap"],
    [MAP_FIELDS.marker, "a-marker"],
    [MAP_FIELDS.color, "a-color"],
    [MAP_FIELDS.radius, "a-radius"],
  ]);
  const marker = block(
    "marker",
    "map/marker:: [[Curepipe]]",
    [{ ":block/uid": "curepipe", ":node/title": "Curepipe" }],
    [
      legacy("marker", "a-color", "marker-color", "tomato"),
      legacy("marker", "a-radius", "marker-radius", "11"),
    ],
  );
  const root = block("map", "{{map}}", [], [
    legacy("map", "a-basemap", "basemap", "streets"),
    legacy("map", "a-marker", "marker", [":block/uid", "curepipe"]),
  ]);

  const result = compileMapPresentation({
    root,
    descendants: [block("basemap", "map/basemap:: streets"), marker],
    attributeUids,
  });

  assert.equal(result.presentation.basemap, "streets");
  assert.deepEqual(result.sources[0].presentation, { color: "tomato", radius: 11 });
  assert.equal(result.sources[0].pageUid, "curepipe");
  assert.deepEqual(result.diagnostics, []);
});

test("invalid presentation values remain local diagnostics and fall back safely", () => {
  const root = block("map", "{{map}}");
  root[":harc/_e"] = [
    relation(MAP_FIELDS.basemap, { ":harc/v-string": "moon" }, "basemap"),
    relation(MAP_FIELDS.color, { ":harc/v-string": "not a color" }, "color"),
    relation(MAP_FIELDS.radius, { ":harc/v-string": "200" }, "radius"),
  ];

  const result = compileMapPresentation({ root, descendants: [] });

  assert.deepEqual(result.presentation, {
    basemap: "streets",
    marker: { color: "#137cbd", radius: 8 },
  });
  assert.deepEqual(
    new Set(result.diagnostics.map(({ code }) => code)),
    new Set([
      "presentation.invalid-basemap",
      "presentation.invalid-color",
      "presentation.invalid-radius",
    ]),
  );
});
