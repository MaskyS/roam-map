import test from "node:test";
import assert from "node:assert/strict";

import {
  clampMapWidthToHost,
  resizedMapSize,
} from "../../src/ui/map-resize-geometry.js";

test("small pointer jitter does not turn one-axis intent into two saved dimensions", () => {
  const result = resizedMapSize({
    availableWidth: 1000,
    baseSize: { maxWidth: null, height: null },
    deltaX: 3,
    deltaY: 80,
    startHeight: 360,
    startWidth: 760,
  });

  assert.equal(result.changedMaxWidth, false);
  assert.equal(result.changedHeight, true);
  assert.deepEqual(result.size, { maxWidth: null, height: 440 });
});

test("a diagonal drag updates both dimensions", () => {
  const result = resizedMapSize({
    availableWidth: 1000,
    baseSize: { maxWidth: 760, height: 360 },
    deltaX: 90,
    deltaY: 60,
    startHeight: 360,
    startWidth: 760,
  });

  assert.equal(result.changedMaxWidth, true);
  assert.equal(result.changedHeight, true);
  assert.deepEqual(result.size, { maxWidth: 850, height: 420 });
});

test("maximum width never exceeds the space supplied by the Roam host", () => {
  assert.equal(clampMapWidthToHost(1200, 700), 700);
  const result = resizedMapSize({
    availableWidth: 700,
    baseSize: { maxWidth: 900, height: 480 },
    deltaX: 100,
    deltaY: 0,
    startHeight: 480,
    startWidth: 700,
  });

  assert.equal(result.changedMaxWidth, false);
  assert.deepEqual(result.size, { maxWidth: 900, height: 480 });
});
