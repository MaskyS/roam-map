import test from "node:test";
import assert from "node:assert/strict";

import { createDirectSourceCompiler } from "../../src/map/direct-sources.js";

test("a late-created map/size attribute block stays configuration, not a source", async () => {
  const root = {
    ":block/uid": "map",
    ":block/string": "{{map}}",
    ":block/children": [
      {
        ":block/uid": "size-block",
        ":block/order": 0,
        ":block/string": "map/size:: 900 × 420",
        ":block/refs": [{ ":block/uid": "size-page", ":node/title": "map/size" }],
      },
      {
        ":block/uid": "basemap-block",
        ":block/order": 1,
        ":block/string": "[[map/basemap]]:: OpenFreeMap Dark",
        ":block/refs": [{ ":block/uid": "basemap-page", ":node/title": "map/basemap" }],
      },
      {
        ":block/uid": "place-block",
        ":block/order": 2,
        ":block/string": "[[Port Louis]]",
        ":block/refs": [{ ":block/uid": "port-louis", ":node/title": "Port Louis" }],
      },
    ],
  };
  const api = {
    pull: async () => root,
    pullByTitle: async () => null,
  };
  const compiler = createDirectSourceCompiler(api);

  const source = await compiler.compile("map");

  assert.deepEqual(
    source.contributions.map(({ entityUid }) => entityUid),
    ["port-louis"],
  );
});

test("option attribute pages are re-resolved until they exist, then cached", async () => {
  let exists = false;
  let lookups = 0;
  const api = {
    pull: async () => ({
      ":block/uid": "map",
      ":block/string": "{{map}}",
      ":block/children": [],
    }),
    pullByTitle: async (_pattern, title) => {
      lookups += 1;
      return exists ? { ":block/uid": `uid-${title}` } : null;
    },
  };
  const compiler = createDirectSourceCompiler(api);

  await compiler.compile("map");
  assert.equal(lookups, 2);

  exists = true;
  await compiler.compile("map");
  assert.equal(lookups, 4);

  await compiler.compile("map");
  assert.equal(lookups, 4);
});
