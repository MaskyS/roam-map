import test from "node:test";
import assert from "node:assert/strict";

import {
  createMarkerClickContext,
  encodeMarkerClickContext,
  MARKER_CLICK_CONTEXT_VERSION,
  markerClickInvocation,
} from "../../src/ui/marker-click-context.js";

function feature(entityUid, description = "A place") {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [57, -20] },
    properties: {
      "roam/entityUid": entityUid,
      "roam/identityKind": entityUid === "other-uid" ? "block" : "page",
      Description: description,
    },
  };
}

test("marker-click context round-trips a JSON-safe click and all coincident features", () => {
  const first = feature("page-uid", 'Curly }} braces, "quotes", and café');
  const second = feature("other-uid");
  const context = createMarkerClickContext({
    mapUid: "map-uid",
    clickId: 7,
    entityUids: ["page-uid", "other-uid"],
    features: [first, second],
    point: { x: 120, y: 80 },
    lngLat: { lng: 57, lat: -20 },
    clientPoint: { x: 420, y: 280 },
    modifiers: { metaKey: true },
  });
  const encoded = encodeMarkerClickContext(context);
  const invocation = markerClickInvocation("marker-click-code", context);

  assert.equal(context.version, MARKER_CLICK_CONTEXT_VERSION);
  assert.equal(context.entityUid, "page-uid");
  assert.equal(context.identityKind, "page");
  assert.deepEqual(context.coincidentEntityUids, ["page-uid", "other-uid"]);
  assert.equal(context.feature, first);
  assert.equal("assets" in context, false);
  assert.deepEqual(context.modifiers, {
    altKey: false,
    ctrlKey: false,
    metaKey: true,
    shiftKey: false,
  });
  assert.deepEqual(JSON.parse(decodeURIComponent(encoded)), context);
  assert.ok(invocation.startsWith("{{roam/render: ((marker-click-code)) \""));
  assert.ok(invocation.endsWith("\"}}"));
  assert.equal(invocation.includes("Curly }} braces"), false);
});

test("marker-click context keeps all hits but exposes only selectable marker identities", () => {
  const first = feature("page-uid");
  const second = feature("other-uid");
  const context = createMarkerClickContext({
    mapUid: "map-uid",
    clickId: 1,
    entityUids: ["page-uid", "other-uid"],
    coincidentEntityUids: ["other-uid", "stale-uid"],
    features: [first, second],
  });

  assert.equal(context.entityUid, "other-uid");
  assert.equal(context.identityKind, "block");
  assert.equal(context.feature, second);
  assert.deepEqual(context.entityUids, ["page-uid", "other-uid"]);
  assert.deepEqual(context.coincidentEntityUids, ["other-uid"]);
});

test("clickId makes repeated clicks distinct even when they hit the same marker", () => {
  const base = {
    mapUid: "map-uid",
    entityUids: ["page-uid"],
    features: [feature("page-uid")],
  };
  const first = markerClickInvocation(
    "marker-click-code",
    createMarkerClickContext({ ...base, clickId: 1 }),
  );
  const second = markerClickInvocation(
    "marker-click-code",
    createMarkerClickContext({ ...base, clickId: 2 }),
  );

  assert.notEqual(first, second);
});

test("marker-click code UIDs cannot alter the generated component invocation", () => {
  assert.throws(
    () => markerClickInvocation("bad}} uid", {}),
    /valid Roam code-block UID/u,
  );
});
