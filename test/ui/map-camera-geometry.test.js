import test from "node:test";
import assert from "node:assert/strict";

import { mapSelectionOffset } from "../../src/ui/map-camera-geometry.js";

function rectangle(left, top, width, height) {
  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
  };
}

test("a desktop results panel and toolbar center the point in the visible map", () => {
  assert.deepEqual(
    mapSelectionOffset({
      frameRect: rectangle(100, 50, 760, 420),
      toolbarRect: rectangle(100, 440, 760, 30),
      resultsPanelRect: rectangle(100, 50, 280, 390),
    }),
    [140, -15],
  );
});

test("a full-width narrow results panel moves the point into the map above it", () => {
  assert.deepEqual(
    mapSelectionOffset({
      frameRect: rectangle(0, 0, 400, 300),
      toolbarRect: rectangle(0, 270, 400, 30),
      resultsPanelRect: rectangle(0, 120, 400, 150),
    }),
    [0, -90],
  );
});

test("toolbar-only and unobscured maps use their measured visible centers", () => {
  const frameRect = rectangle(20, 30, 760, 420);
  assert.deepEqual(
    mapSelectionOffset({
      frameRect,
      toolbarRect: rectangle(20, 420, 760, 30),
    }),
    [0, -15],
  );
  assert.deepEqual(mapSelectionOffset({ frameRect }), [0, 0]);
});

test("invalid and non-overlapping rectangles do not distort the camera", () => {
  assert.deepEqual(mapSelectionOffset(), [0, 0]);
  assert.deepEqual(
    mapSelectionOffset({
      frameRect: rectangle(0, 0, 400, 300),
      resultsPanelRect: rectangle(500, 0, 200, 300),
    }),
    [0, 0],
  );
});
