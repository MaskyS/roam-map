import test from "node:test";
import assert from "node:assert/strict";

import { compileMarkerClick } from "../../src/map/marker-click.js";

const blockRef = (uid, string = "code") => ({ ":block/uid": uid, ":block/string": string });
const block = (uid, order, string, refs = [], children = []) => ({
  ":block/uid": uid,
  ":block/order": order,
  ":block/string": string,
  ":block/refs": refs,
  ":block/children": children,
});

test("an inline roam/render code block becomes the marker-click component", () => {
  const code = block(
    "marker-click-code",
    0,
    "```jsx\nfunction markerClick({ args }) { return <div>{args[1]}</div>; }\n```",
  );
  const container = block("marker-click", 0, "Marker click", [], [code]);
  const root = block("map", 0, "{{map}}", [], [container]);

  const result = compileMarkerClick(root);

  assert.deepEqual(result.markerClick, {
    codeBlockUid: "marker-click-code",
    language: "jsx",
  });
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.watchUids, []);
  assert.deepEqual([...result.recognizedBlockUids], ["marker-click", "marker-click-code"]);
});

test("a block reference can reuse marker-click code from elsewhere", () => {
  const reference = block(
    "component-ref",
    0,
    "((shared-marker-click))",
    [blockRef("shared-marker-click")],
  );
  const root = block("map", 0, "{{map}}", [], [
    block("marker-click", 0, "MARKER CLICK", [], [reference]),
  ]);

  const result = compileMarkerClick(root);

  assert.deepEqual(result.markerClick, {
    codeBlockUid: "shared-marker-click",
    language: null,
  });
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.watchUids, ["shared-marker-click"]);
});

test("invalid and duplicate Marker click blocks stay configuration, not sources", () => {
  const invalidChild = block("invalid-child", 0, "ordinary text", [], [
    block("nested", 0, "[[Not a source]]"),
  ]);
  const first = block("first", 0, "Marker click", [], [invalidChild]);
  const second = block("second", 1, "Marker click", [], [
    block("second-code", 0, "```javascript\nfunction markerClick() { return null; }\n```"),
  ]);
  const result = compileMarkerClick(block("map", 0, "{{map}}", [], [first, second]));

  assert.equal(result.markerClick, null);
  assert.deepEqual(
    result.diagnostics.map(({ code }) => code),
    ["marker-click.multiple-components", "marker-click.invalid-component"],
  );
  assert.deepEqual(
    [...result.recognizedBlockUids],
    ["first", "invalid-child", "nested", "second", "second-code"],
  );
});
