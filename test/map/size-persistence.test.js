import test from "node:test";
import assert from "node:assert/strict";

import {
  clearMapSize,
  mapSizeBlockString,
  persistMapSize,
} from "../../src/map/size-persistence.js";

function fakeApi() {
  const calls = [];
  return {
    calls,
    api: {
      async createChildBlock(value) {
        calls.push(["create", value]);
        return "new-size";
      },
      async updateBlockString(...args) {
        calls.push(["update", ...args]);
      },
      async deleteBlock(...args) {
        calls.push(["delete", ...args]);
      },
    },
  };
}

test("one completed resize creates one readable map/size child", async () => {
  const { api, calls } = fakeApi();

  const uid = await persistMapSize({
    api,
    mapUid: "map",
    size: { maxWidth: 900, height: 480 },
  });

  assert.equal(uid, "new-size");
  assert.equal(
    mapSizeBlockString({ maxWidth: null, height: 480 }),
    "map/size:: auto × 480",
  );
  assert.deepEqual(calls, [
    [
      "create",
      { parentUid: "map", order: "last", string: "map/size:: 900 × 480" },
    ],
  ]);
});

test("later two-dimensional resizes update the same block once", async () => {
  const { api, calls } = fakeApi();

  const uid = await persistMapSize({
    api,
    mapUid: "map",
    size: { maxWidth: 760, height: 520 },
    sourceUids: ["size", "size"],
  });

  assert.equal(uid, "size");
  assert.deepEqual(calls, [["update", "size", "map/size:: 760 × 520"]]);
});

test("reset deletes the sole durable size and otherwise does nothing", async () => {
  const { api, calls } = fakeApi();

  assert.equal(await clearMapSize({ api }), false);
  assert.equal(await clearMapSize({ api, sourceUids: ["size"] }), true);

  assert.deepEqual(calls, [["delete", "size"]]);
});

test("ambiguous or entirely responsive size writes fail without changing Roam", async () => {
  const { api, calls } = fakeApi();

  await assert.rejects(
    persistMapSize({
      api,
      mapUid: "map",
      size: { maxWidth: 900, height: 480 },
      sourceUids: ["size-a", "size-b"],
    }),
    /appears more than once/u,
  );
  assert.throws(
    () => mapSizeBlockString({ maxWidth: null, height: null }),
    /outside the supported range/u,
  );
  assert.deepEqual(calls, []);
});
