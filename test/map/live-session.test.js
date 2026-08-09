import test from "node:test";
import assert from "node:assert/strict";

import { createLiveMapSession } from "../../src/map/live-session.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function compiled(entityUids = [], sourceWatchUids = [], attributeWatchUids = []) {
  return {
    sourceItems: entityUids.map((entityUid) => ({ entityUid })),
    sourceWatchUids,
    attributeWatchUids,
    featureCollection: { type: "FeatureCollection", features: [] },
    diagnostics: [],
    counts: { sources: entityUids.length, mapped: 0, unmapped: entityUids.length },
  };
}

function watchApi() {
  const added = [];
  const removed = [];
  return {
    added,
    removed,
    addPullWatch: async (pattern, uid, callback) => added.push({ pattern, uid, callback }),
    removePullWatch: async (pattern, uid, callback) => removed.push({ pattern, uid, callback }),
  };
}

test("a stale compilation cannot overwrite a newer refresh", async () => {
  const first = deferred();
  const second = deferred();
  const queue = [first, second];
  const states = [];
  const api = watchApi();
  const session = createLiveMapSession({
    api,
    mapUid: "map",
    compile: () => queue.shift().promise,
    onState: (state) => states.push(state),
    debounceMs: 0,
  });

  const starting = session.start();
  while (queue.length === 2) await Promise.resolve();
  const refreshing = session.refresh("manual");
  while (queue.length === 1) await Promise.resolve();
  second.resolve(compiled(["new"]));
  await refreshing;
  first.resolve(compiled(["old"]));
  await starting;

  assert.deepEqual(
    states.filter(({ type }) => type === "result").map(({ result }) => result.sourceItems[0].entityUid),
    ["new"],
  );
  await session.stop();
});

test("place, source, and attribute dependency watches are diffed as results change", async () => {
  const api = watchApi();
  const results = [
    compiled(["a", "keep"], ["source-a"], ["attribute-a"]),
    compiled(["b", "keep"], ["source-b"], ["attribute-b"]),
  ];
  const session = createLiveMapSession({
    api,
    mapUid: "map",
    compile: async () => results.shift(),
    debounceMs: 0,
  });
  await session.start();
  await session.refresh("manual");

  assert.ok(api.added.some(({ uid }) => uid === "a"));
  assert.ok(api.added.some(({ uid }) => uid === "b"));
  assert.ok(api.added.some(({ uid }) => uid === "source-a"));
  assert.ok(api.added.some(({ uid }) => uid === "source-b"));
  assert.ok(api.added.some(({ uid }) => uid === "attribute-a"));
  assert.ok(api.added.some(({ uid }) => uid === "attribute-b"));
  assert.ok(api.removed.some(({ uid }) => uid === "a"));
  assert.ok(api.removed.some(({ uid }) => uid === "source-a"));
  assert.ok(api.removed.some(({ uid }) => uid === "attribute-a"));
  assert.equal(api.removed.some(({ uid }) => uid === "keep"), false);

  await session.stop();
  assert.ok(api.removed.some(({ uid }) => uid === "map"));
  assert.ok(api.removed.some(({ uid }) => uid === "b"));
  assert.ok(api.removed.some(({ uid }) => uid === "keep"));
});

test("rapid watch callbacks coalesce and duplicate sessions clean up independently", async () => {
  const api = watchApi();
  let compiles = 0;
  const makeSession = () =>
    createLiveMapSession({
      api,
      mapUid: "same-map",
      compile: async () => {
        compiles += 1;
        return compiled([]);
      },
      debounceMs: 1,
    });
  const first = makeSession();
  const second = makeSession();
  await first.start();
  await second.start();
  const mapWatches = api.added.filter(({ uid }) => uid === "same-map");
  assert.equal(mapWatches.length, 2);
  assert.notEqual(mapWatches[0].callback, mapWatches[1].callback);

  mapWatches[0].callback();
  mapWatches[0].callback();
  mapWatches[0].callback();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(compiles, 3);

  await first.stop();
  assert.equal(
    api.removed.some(({ callback }) => callback === mapWatches[0].callback),
    true,
  );
  assert.equal(
    api.removed.some(({ callback }) => callback === mapWatches[1].callback),
    false,
  );
  await second.stop();
});

test("stop waits for an in-flight watch registration to remove itself", async () => {
  const registration = deferred();
  const removed = [];
  const session = createLiveMapSession({
    api: {
      addPullWatch: () => registration.promise,
      removePullWatch: async (_pattern, uid) => removed.push(uid),
    },
    mapUid: "map",
    compile: async () => compiled([]),
  });
  const starting = session.start();
  await Promise.resolve();
  const stopping = session.stop();
  registration.resolve();
  await Promise.all([starting, stopping]);
  assert.deepEqual(removed, ["map"]);
});

test("a stale refresh cannot leave stale dynamic watches installed", async () => {
  const oldRemoval = deferred();
  const removalStarted = deferred();
  const active = new Set();
  const results = [compiled(["old-place"]), compiled(["stale-place"]), compiled(["new-place"])];
  const session = createLiveMapSession({
    api: {
      addPullWatch: async (_pattern, uid) => active.add(uid),
      removePullWatch: async (_pattern, uid) => {
        if (uid === "old-place") {
          removalStarted.resolve();
          await oldRemoval.promise;
        }
        active.delete(uid);
      },
    },
    mapUid: "map",
    compile: async () => results.shift(),
    debounceMs: 0,
  });

  await session.start();
  const staleRefresh = session.refresh("stale");
  await removalStarted.promise;
  const currentRefresh = session.refresh("current");
  oldRemoval.resolve();
  await Promise.all([staleRefresh, currentRefresh]);

  assert.deepEqual([...active].sort(), ["map", "new-place"]);
  await session.stop();
});

test("watch failures describe only dependencies that are still wanted", async () => {
  const statuses = [];
  const results = [compiled(["gone"]), compiled([])];
  const session = createLiveMapSession({
    api: {
      addPullWatch: async (_pattern, uid) => {
        if (uid === "gone") throw new Error("cannot watch gone");
      },
      removePullWatch: async () => {},
    },
    mapUid: "map",
    compile: async () => results.shift(),
    onState: (state) => {
      if (state.type === "watch-status") statuses.push(state.failures);
    },
  });

  await session.start();
  await session.refresh("remove-source");

  assert.equal(statuses[0][0].uid, "gone");
  assert.deepEqual(statuses.at(-1), []);
  await session.stop();
});
