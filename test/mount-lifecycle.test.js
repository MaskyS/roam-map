import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

import { createMapMountLifecycle, identifyMapMount } from "../src/mount-lifecycle.js";

async function settle() {
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  await Promise.resolve();
}

function fakeRoots() {
  const roots = [];
  return {
    roots,
    client: {
      createRoot(container) {
        const root = {
          container,
          rendered: null,
          unmounted: false,
          render(value) {
            this.rendered = value;
          },
          unmount() {
            this.unmounted = true;
          },
        };
        roots.push(root);
        return root;
      },
    },
  };
}

test("identity separates direct definitions from block-reference hosts", () => {
  const dom = new JSDOM(`
    <div data-block-uid="host">
      <span class="rm-block-ref" data-uid="definition">
        <button class="rm-xparser-default-map">map</button>
      </span>
    </div>
  `);
  const button = dom.window.document.querySelector("button");
  assert.deepEqual(identifyMapMount(button), {
    definitionUid: "definition",
    hostUid: "host",
  });
});

test("mounts verified map buttons independently and restores them on cleanup", async () => {
  const dom = new JSDOM(`
    <body>
      <div data-block-uid="definition">
        <button class="rm-xparser-default-map">map</button>
      </div>
      <div data-block-uid="host">
        <span class="rm-block-ref" data-uid="definition">
          <button class="rm-xparser-default-map">map</button>
        </span>
      </div>
    </body>
  `);
  const { roots, client } = fakeRoots();
  const views = [];
  const lifecycle = createMapMountLifecycle({
    document: dom.window.document,
    MutationObserver: dom.window.MutationObserver,
    ReactDOMClient: client,
    api: {
      pull: async (_pattern, uid) => ({
        ":block/uid": uid,
        ":block/string": "{{[[map]]}}",
      }),
    },
    createView: (identity) => {
      views.push(identity);
      return identity;
    },
  });
  lifecycle.start();
  await settle();

  assert.equal(lifecycle.size, 2);
  assert.equal(roots.length, 2);
  assert.deepEqual(views.map(({ definitionUid, hostUid }) => ({ definitionUid, hostUid })), [
    { definitionUid: "definition", hostUid: "definition" },
    { definitionUid: "definition", hostUid: "host" },
  ]);
  assert.notEqual(views[0].mountId, views[1].mountId);
  const buttons = [...dom.window.document.querySelectorAll("button")];
  assert.ok(buttons.every((button) => button.style.display === "none"));

  buttons[1].remove();
  await settle();
  assert.equal(lifecycle.size, 1);
  assert.equal(roots[1].unmounted, true);

  lifecycle.stop();
  assert.equal(lifecycle.size, 0);
  assert.equal(roots[0].unmounted, true);
  assert.equal(buttons[0].style.display, "");
  assert.equal(dom.window.document.querySelectorAll(".rrm-mount").length, 0);
});

test("rendered lookalikes are not mounted unless graph data contains a map definition", async () => {
  const dom = new JSDOM(`
    <body><div data-block-uid="not-map"><button class="rm-xparser-default-map">map</button></div></body>
  `);
  const { client } = fakeRoots();
  const lifecycle = createMapMountLifecycle({
    document: dom.window.document,
    MutationObserver: dom.window.MutationObserver,
    ReactDOMClient: client,
    api: { pull: async () => ({ ":block/string": "ordinary text" }) },
    createView: (identity) => identity,
  });
  lifecycle.start();
  await settle();
  assert.equal(lifecycle.size, 0);
  lifecycle.stop();
});
