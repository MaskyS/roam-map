import test from "node:test";
import assert from "node:assert/strict";

import { createRoamApi } from "../../src/roam/api.js";

function fakeAlpha() {
  const calls = [];
  return {
    calls,
    alpha: {
      data: {
        async: {
          pull() {},
          pull_many() {},
          q(...value) {
            calls.push(["datalog", ...value]);
            return ["page-uid"];
          },
        },
        roamQuery(value) {
          calls.push(["roam-query", value]);
          return { total: 0, results: [] };
        },
        block: {
          create(value) {
            calls.push(["create", value]);
          },
          update(value) {
            calls.push(["update", value]);
          },
          delete(value) {
            calls.push(["delete", value]);
          },
        },
        addPullWatch() {},
        removePullWatch() {},
      },
      util: {
        generateUID() {
          return "new-size";
        },
      },
      ui: {
        mainWindow: {
          openPage() {
            calls.push(["main"]);
          },
        },
        rightSidebar: {
          addWindow(value) {
            calls.push(["sidebar", value]);
          },
        },
        components: {
          renderString(value) {
            calls.push(["render", value]);
          },
          unmountNode(value) {
            calls.push(["unmount", value]);
          },
        },
      },
    },
  };
}

test("entity navigation opens a page or block outline in Roam's right sidebar", async () => {
  const { alpha, calls } = fakeAlpha();
  const api = createRoamApi(alpha);

  await api.openEntityInSidebar("entity-uid");

  assert.deepEqual(calls, [
    [
      "sidebar",
      { window: { type: "outline", "block-uid": "entity-uid" } },
    ],
  ]);
});

test("Roam-owned marker-click mounts use the documented render and unmount APIs", async () => {
  const { alpha, calls } = fakeAlpha();
  const api = createRoamApi(alpha);
  const element = {};

  await api.renderRoamString({ element, string: "{{roam/render: ((code))}}" });
  await api.unmountRoamNode(element);

  assert.deepEqual(calls, [
    ["render", { el: element, string: "{{roam/render: ((code))}}" }],
    ["unmount", { el: element }],
  ]);
});

test("durable map options use Roam's documented block write APIs", async () => {
  const { alpha, calls } = fakeAlpha();
  const api = createRoamApi(alpha);

  const uid = await api.createChildBlock({
    parentUid: "map-uid",
    order: "last",
    string: "map/size:: 900 × 480",
  });
  await api.updateBlockString("size-uid", "map/size:: 760 × 520");
  await api.deleteBlock("size-uid");

  assert.equal(uid, "new-size");
  assert.deepEqual(calls, [
    [
      "create",
      {
        location: { "parent-uid": "map-uid", order: "last" },
        block: { uid: "new-size", string: "map/size:: 900 × 480" },
      },
    ],
    ["update", { block: { uid: "size-uid", string: "map/size:: 760 × 520" } }],
    ["delete", { block: { uid: "size-uid" } }],
  ]);
});

test("dynamic sources use Roam's documented native-query and async Datalog APIs", async () => {
  const { alpha, calls } = fakeAlpha();
  const api = createRoamApi(alpha);

  await api.roamQuery({ uid: "query-uid", limit: 250 });
  const datalog = await api.datalogQuery(
    "[:find [?uid ...] :where [?e :block/uid ?uid]]",
  );

  assert.deepEqual(datalog, ["page-uid"]);
  assert.deepEqual(calls, [
    ["roam-query", { uid: "query-uid", limit: 250 }],
    ["datalog", "[:find [?uid ...] :where [?e :block/uid ?uid]]"],
  ]);
});
