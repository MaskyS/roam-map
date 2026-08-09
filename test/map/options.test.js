import test from "node:test";
import assert from "node:assert/strict";

import {
  BASEMAP_ATTRIBUTE,
  DEFAULT_MAP_OPTIONS,
  MAP_SIZE_ATTRIBUTE,
  MAX_MAP_HEIGHT,
  MAX_MAP_WIDTH,
  MIN_MAP_HEIGHT,
  MIN_MAP_WIDTH,
  clampMapHeight,
  clampMapWidth,
  compileMapOptions,
  normalizeMapSize,
  normalizeMapSizeValue,
} from "../../src/map/options.js";

function relation(value, sourceUid, title = BASEMAP_ATTRIBUTE) {
  return {
    ":harc/a": [{ ":node/title": title }],
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

  assert.deepEqual(result.options, {
    basemap: "satellite",
    size: { maxWidth: null, height: null },
  });
  assert.deepEqual([...result.recognizedBlockUids], ["basemap"]);
  assert.deepEqual(result.optionSourceUids, { basemap: ["basemap"], size: [] });
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

test("map/size accepts one atomic max-width and height value", () => {
  const root = {
    ":block/uid": "map",
    ":harc/_e": [relation("900px × 480px", "size", MAP_SIZE_ATTRIBUTE)],
  };

  const result = compileMapOptions({ root });

  assert.deepEqual(result.options.size, { maxWidth: 900, height: 480 });
  assert.deepEqual(result.optionSourceUids, { basemap: [], size: ["size"] });
  assert.deepEqual([...result.recognizedBlockUids], ["size"]);
  assert.deepEqual(result.diagnostics, []);
});

test("map/size can leave either dimension responsive", () => {
  assert.deepEqual(normalizeMapSize("auto × 480"), {
    maxWidth: null,
    height: 480,
  });
  assert.deepEqual(normalizeMapSize("900 x auto"), {
    maxWidth: 900,
    height: null,
  });
  assert.equal(normalizeMapSize("auto × auto"), null);
});

test("legacy attribute storage remains readable for the canonical map/size option", () => {
  const root = {
    ":block/uid": "map",
    ":entity/attrs": [
      [
        sv([":block/uid", "map"]),
        { source: [":block/uid", "size"], value: [":block/uid", "attr-size"] },
        sv("640 × 420"),
      ],
    ],
  };

  const result = compileMapOptions({ root, sizeAttributeUid: "attr-size" });

  assert.deepEqual(result.options.size, { maxWidth: 640, height: 420 });
  assert.deepEqual(result.optionSourceUids.size, ["size"]);
});

test("invalid and duplicate map sizes remain visible as local diagnostics", () => {
  const invalid = compileMapOptions({
    root: {
      ":block/uid": "map",
      ":harc/_e": [relation("100 × 100", "size", MAP_SIZE_ATTRIBUTE)],
    },
  });
  assert.deepEqual(invalid.options.size, { maxWidth: null, height: null });
  assert.equal(invalid.diagnostics[0].code, "options.invalid-size");

  const duplicate = compileMapOptions({
    root: {
      ":block/uid": "map",
      ":harc/_e": [
        relation("640 × 400", "size-a", MAP_SIZE_ATTRIBUTE),
        relation("900 × 500", "size-b", MAP_SIZE_ATTRIBUTE),
      ],
    },
  });
  assert.deepEqual(duplicate.options.size, { maxWidth: 640, height: 400 });
  assert.equal(duplicate.diagnostics[0].code, "options.conflicting-size");
  assert.deepEqual(duplicate.optionSourceUids.size, ["size-a", "size-b"]);
});

test("size normalization and interactive clamping share explicit bounds", () => {
  assert.deepEqual(
    normalizeMapSizeValue({ maxWidth: MIN_MAP_WIDTH, height: MAX_MAP_HEIGHT }),
    { maxWidth: MIN_MAP_WIDTH, height: MAX_MAP_HEIGHT },
  );
  assert.equal(normalizeMapSizeValue({ maxWidth: MIN_MAP_WIDTH - 1, height: 420 }), null);
  assert.equal(normalizeMapSize(`${MAX_MAP_WIDTH}px x ${MIN_MAP_HEIGHT}px`).maxWidth, MAX_MAP_WIDTH);
  assert.equal(clampMapHeight(100), MIN_MAP_HEIGHT);
  assert.equal(clampMapHeight(2000), MAX_MAP_HEIGHT);
  assert.equal(clampMapWidth(100), MIN_MAP_WIDTH);
  assert.equal(clampMapWidth(2000), MAX_MAP_WIDTH);
});
