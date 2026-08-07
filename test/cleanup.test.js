import test from "node:test";
import assert from "node:assert/strict";

import { createCleanupScope } from "../src/cleanup.js";

test("cleanup scopes dispose in reverse order and only once", async () => {
  const calls = [];
  const scope = createCleanupScope();
  scope.add(() => calls.push("observer"));
  scope.add(async () => calls.push("watch"));
  scope.add(() => calls.push("map"));

  await scope.dispose();
  await scope.dispose();
  assert.deepEqual(calls, ["map", "watch", "observer"]);
});

test("removing one cleanup early keeps it out of the final disposal", async () => {
  const calls = [];
  const scope = createCleanupScope();
  const remove = scope.add(() => calls.push("root"));
  remove();
  await scope.dispose();
  assert.deepEqual(calls, ["root"]);
});
