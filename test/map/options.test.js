import test from "node:test";
import assert from "node:assert/strict";

import {
  BASEMAP_ATTRIBUTE,
  compileMapOptions,
  DEFAULT_MAP_OPTIONS,
} from "../../src/map/options.js";

function relation(value, sourceUid) {
  return {
    ":harc/a": [{ ":node/title": BASEMAP_ATTRIBUTE }],
    ":harc/v": [{ ":harc/v-string": value }],
    ":harc/a-source": [{ ":block/uid": sourceUid }],
  };
}

function sv(value) {
  return { value };
}

test("current basemap attributes become one durable map option", () => {
  const root = {
    ":block/uid": "map",
    ":harc/_e": [relation("satellite", "basemap")],
  };
  const result = compileMapOptions({ root });

  assert.deepEqual(result.options, { basemap: "satellite" });
  assert.deepEqual([...result.recognizedBlockUids], ["basemap"]);
  assert.deepEqual(result.diagnostics, []);
});

test("legacy basemap attributes remain readable without restoring prototype marker options", () => {
  const root = {
    ":block/uid": "map",
    ":entity/attrs": [
      [
        sv([":block/uid", "map"]),
        { source: [":block/uid", "basemap"], value: [":block/uid", "attr-basemap"] },
        sv("MapTiler Hybrid"),
      ],
    ],
  };
  const result = compileMapOptions({ root, basemapAttributeUid: "attr-basemap" });

  assert.equal(result.options.basemap, "MapTiler Hybrid");
  assert.deepEqual([...result.recognizedBlockUids], ["basemap"]);
});

test("invalid basemap values fall back with a local diagnostic", () => {
  const root = {
    ":block/uid": "map",
    ":harc/_e": [relation("x".repeat(121), "basemap")],
  };
  const result = compileMapOptions({ root });

  assert.deepEqual(result.options, DEFAULT_MAP_OPTIONS);
  assert.equal(result.diagnostics[0].code, "options.invalid-basemap");
});
