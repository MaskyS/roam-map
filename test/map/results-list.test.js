import test from "node:test";
import assert from "node:assert/strict";

import { compileResultsList } from "../../src/map/results-list.js";

const blockRef = (uid, string = "code") => ({ ":block/uid": uid, ":block/string": string });
const block = (uid, order, string, refs = [], children = []) => ({
  ":block/uid": uid,
  ":block/order": order,
  ":block/string": string,
  ":block/refs": refs,
  ":block/children": children,
});

test("an inline roam/render code block becomes the results-list component", () => {
  const code = block(
    "results-list-code",
    0,
    "```jsx\nfunction resultsList({ args }) { return <div>{args[1]}</div>; }\n```",
  );
  const container = block("results-list", 0, "Results list", [], [code]);
  const root = block("map", 0, "{{map}}", [], [container]);

  const result = compileResultsList(root);

  assert.deepEqual(result.resultsList, {
    codeBlockUid: "results-list-code",
    language: "jsx",
  });
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.watchUids, []);
  assert.deepEqual([...result.recognizedBlockUids], ["results-list", "results-list-code"]);
});

test("a block reference can reuse results-list code from elsewhere", () => {
  const reference = block(
    "component-ref",
    0,
    "((shared-results-list))",
    [blockRef("shared-results-list")],
  );
  const root = block("map", 0, "{{map}}", [], [
    block("results-list", 0, "RESULTS LIST", [], [reference]),
  ]);

  const result = compileResultsList(root);

  assert.deepEqual(result.resultsList, {
    codeBlockUid: "shared-results-list",
    language: null,
  });
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.watchUids, ["shared-results-list"]);
});

test("invalid and duplicate Results list blocks stay configuration, not sources", () => {
  const invalidChild = block("invalid-child", 0, "ordinary text", [], [
    block("nested", 0, "[[Not a source]]"),
  ]);
  const first = block("first", 0, "Results list", [], [invalidChild]);
  const second = block("second", 1, "Results list", [], [
    block("second-code", 0, "```jsx\nfunction x() { return null; }\n```"),
  ]);
  const root = block("map", 0, "{{map}}", [], [first, second]);

  const result = compileResultsList(root);

  assert.equal(result.resultsList, null);
  assert.deepEqual(
    result.diagnostics.map(({ code }) => code).sort(),
    ["results-list.invalid-component", "results-list.multiple-components"],
  );
  assert.ok(result.recognizedBlockUids.has("first"));
  assert.ok(result.recognizedBlockUids.has("invalid-child"));
  assert.ok(result.recognizedBlockUids.has("nested"));
  assert.ok(result.recognizedBlockUids.has("second"));
  assert.ok(result.recognizedBlockUids.has("second-code"));
});

test("a map without a Results list block compiles to the stock list", () => {
  const root = block("map", 0, "{{map}}", [], [
    block("place", 0, "[[Port Louis]]", [blockRef("port-louis")]),
  ]);

  const result = compileResultsList(root);

  assert.equal(result.resultsList, null);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual([...result.recognizedBlockUids], []);
  assert.deepEqual(result.watchUids, []);
});
