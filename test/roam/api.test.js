import test from "node:test";
import assert from "node:assert/strict";

import { createRoamApi } from "../../src/roam/api.js";

function fakeAlpha() {
  const calls = [];
  return {
    calls,
    alpha: {
      data: {
        async: { pull() {}, pull_many() {} },
        addPullWatch() {},
        removePullWatch() {},
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

test("page navigation opens a page outline in Roam's right sidebar", async () => {
  const { alpha, calls } = fakeAlpha();
  const api = createRoamApi(alpha);

  await api.openPageInSidebar("page-uid");

  assert.deepEqual(calls, [
    [
      "sidebar",
      { window: { type: "outline", "block-uid": "page-uid" } },
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
