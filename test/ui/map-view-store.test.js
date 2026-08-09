import test from "node:test";
import assert from "node:assert/strict";

import {
  getMapViewActions,
  getMapViewSnapshot,
  registerMapView,
  subscribeMapView,
  __test,
} from "../../src/ui/map-view-store.js";

test("a registered view publishes live snapshots to its subscribers", () => {
  const actions = { select: () => {}, openInSidebar: () => {} };
  const handle = registerMapView("view-1", { actions });
  let notified = 0;
  const unsubscribe = subscribeMapView("view-1", () => {
    notified += 1;
  });

  const first = { results: [{ entityUid: "a" }], selectedEntityUid: null };
  handle.publish(first);
  assert.equal(getMapViewSnapshot("view-1"), first);
  assert.equal(getMapViewActions("view-1"), actions);
  assert.equal(notified, 1);

  const second = { results: [{ entityUid: "a" }], selectedEntityUid: "a" };
  handle.publish(second);
  assert.equal(getMapViewSnapshot("view-1"), second);
  assert.equal(notified, 2);

  unsubscribe();
  handle.dispose();
  assert.equal(__test.views.has("view-1"), false);
});

test("subscribing before the view registers still receives the first publish", () => {
  let notified = 0;
  const unsubscribe = subscribeMapView("view-early", () => {
    notified += 1;
  });
  assert.equal(getMapViewSnapshot("view-early"), null);

  const handle = registerMapView("view-early", { actions: {} });
  handle.publish({ results: [] });
  assert.ok(notified >= 1);
  assert.deepEqual(getMapViewSnapshot("view-early"), { results: [] });

  handle.dispose();
  unsubscribe();
  assert.equal(__test.views.has("view-early"), false);
});

test("separate view instances stay isolated", () => {
  const first = registerMapView("view-a", { actions: { select: () => "a" } });
  const second = registerMapView("view-b", { actions: { select: () => "b" } });
  first.publish({ results: [{ entityUid: "only-a" }] });
  second.publish({ results: [{ entityUid: "only-b" }] });

  assert.equal(getMapViewSnapshot("view-a").results[0].entityUid, "only-a");
  assert.equal(getMapViewSnapshot("view-b").results[0].entityUid, "only-b");
  assert.notEqual(getMapViewActions("view-a"), getMapViewActions("view-b"));

  first.dispose();
  assert.equal(getMapViewSnapshot("view-a"), null);
  assert.equal(getMapViewActions("view-a"), null);
  assert.equal(getMapViewSnapshot("view-b").results[0].entityUid, "only-b");
  second.dispose();
});

test("dispose clears state, notifies subscribers, and ignores later publishes", () => {
  const handle = registerMapView("view-dispose", { actions: {} });
  handle.publish({ results: [{ entityUid: "x" }] });
  let notified = 0;
  const unsubscribe = subscribeMapView("view-dispose", () => {
    notified += 1;
  });

  handle.dispose();
  assert.equal(notified, 1);
  assert.equal(getMapViewSnapshot("view-dispose"), null);
  assert.equal(getMapViewActions("view-dispose"), null);

  handle.publish({ results: [{ entityUid: "late" }] });
  assert.equal(getMapViewSnapshot("view-dispose"), null);
  unsubscribe();
  assert.equal(__test.views.has("view-dispose"), false);
});
