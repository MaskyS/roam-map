import test from "node:test";
import assert from "node:assert/strict";

import { createMapCompiler } from "../../src/map/compiler.js";
import { createDirectSourceCompiler } from "../../src/map/direct-sources.js";
import { FEATURE_PROPERTIES } from "../../src/map/feature-properties.js";
import { createPlaceResolver } from "../../src/map/place-records.js";

function contribution(entityUid, sourceBlockUid, identityKind = "page") {
  return {
    entityUid,
    identityKind,
    title: entityUid.toUpperCase(),
    provenance: { sourceBlockUid, originBlockUid: sourceBlockUid, viaBlockRefUid: null },
  };
}

function placeRecord({ entityUid, identityKind }) {
  return {
    entityUid,
    identityKind,
    label: entityUid.toUpperCase(),
    diagnostics: [],
    assets: [],
    attributeUids: [],
    feature: {
      type: "Feature",
      id: `${identityKind}:${entityUid}`,
      geometry: { type: "Point", coordinates: [57, -20] },
      properties: { [FEATURE_PROPERTIES.entityUid]: entityUid },
    },
  };
}

test("the central compiler merges provenance and resolves distinct entities in one batch", async () => {
  const resolvedBatches = [];
  const compiler = createMapCompiler({
    sourceCompiler: {
      compile: async () => ({
        definition: { raw: "{{map}}" },
        contributions: [
          contribution("a", "source-a"),
          contribution("b", "source-b", "block"),
          contribution("a", "source-a-again"),
        ],
        watchUids: [],
        options: { basemap: "streets", size: { maxWidth: 900, height: 480 } },
        optionSourceUids: { size: ["size-source"] },
        layers: [],
        markerClick: { codeBlockUid: "marker-click-code", language: "jsx" },
        diagnostics: [],
      }),
    },
    placeResolver: {
      resolveEntities: async (items) => {
        resolvedBatches.push(items.map(({ identityKind, entityUid }) => `${identityKind}:${entityUid}`));
        return items.map(placeRecord);
      },
    },
  });

  const result = await compiler.compile("map");

  assert.deepEqual(resolvedBatches, [["page:a", "block:b"]]);
  assert.deepEqual(result.sourceItems.map(({ entityUid }) => entityUid), ["a", "b"]);
  assert.deepEqual(result.sourceItems[0].provenance.map(({ sourceBlockUid }) => sourceBlockUid), [
    "source-a",
    "source-a-again",
  ]);
  assert.deepEqual(
    result.featureCollection.features[0].properties[FEATURE_PROPERTIES.sourceBlockUids],
    ["source-a", "source-a-again"],
  );
  assert.deepEqual(result.markerClick, {
    codeBlockUid: "marker-click-code",
    language: "jsx",
  });
  assert.deepEqual(result.options, {
    basemap: "streets",
    size: { maxWidth: 900, height: 480 },
  });
  assert.deepEqual(result.optionSourceUids, { size: ["size-source"] });
});

test("direct bare and named block sources compile through the real location resolver", async () => {
  const makeBlock = (uid, order, string, children = []) => ({
    ":block/uid": uid,
    ":block/order": order,
    ":block/string": string,
    ":block/children": children,
    ":block/refs": [],
  });
  const bare = makeBlock("bare", 0, "geo:-20.1609,57.5012;u=14.4");
  const named = makeBlock("named", 1, "Paris meeting point", [
    makeBlock("named-coordinates", 0, "Coordinates:: geo:48.8566,2.3522"),
  ]);
  const root = makeBlock("map", 0, "{{map}}", [bare, named]);
  const entities = new Map([
    ["bare", bare],
    ["named", named],
  ]);
  const api = {
    pull: async (_pattern, uid) => (uid === "map" ? root : entities.get(uid) ?? null),
    pullByTitle: async () => null,
    pullMany: async (_pattern, uids) => uids.map((uid) => entities.get(uid)).filter(Boolean),
  };
  const compiler = createMapCompiler({
    sourceCompiler: createDirectSourceCompiler(api),
    placeResolver: createPlaceResolver(api),
  });

  const result = await compiler.compile("map");

  assert.deepEqual(result.counts, { sources: 2, mapped: 2, unmapped: 0 });
  assert.deepEqual(
    result.featureCollection.features.map((feature) => ({
      id: feature.id,
      geometry: feature.geometry.coordinates,
      identityKind: feature.properties[FEATURE_PROPERTIES.identityKind],
      uncertainty: feature.properties[FEATURE_PROPERTIES.uncertaintyMeters],
    })),
    [
      {
        id: "block:bare",
        geometry: [57.5012, -20.1609],
        identityKind: "block",
        uncertainty: 14.4,
      },
      {
        id: "block:named",
        geometry: [2.3522, 48.8566],
        identityKind: "block",
        uncertainty: null,
      },
    ],
  );
  assert.deepEqual(result.diagnostics, []);
});

test("native-query containing pages and exact Datalog UIDs use the page resolver", async () => {
  const makeBlock = (uid, order, string, children = []) => ({
    ":block/uid": uid,
    ":block/order": order,
    ":block/string": string,
    ":block/children": children,
    ":block/refs": [],
  });
  const native = makeBlock("native-query", 0, "{{query: [[Map point]]}}");
  const datalog = makeBlock(
    "datalog-query",
    1,
    "```datalog\n[:find [?uid ...] :where [?page :block/uid ?uid]]\n```",
  );
  const root = makeBlock("map", 0, "{{map}}", [native, datalog]);
  const metadataCoordinates = makeBlock(
    "metadata-coordinates",
    0,
    "Coordinates:: geo:-20.1609,57.5012;u=3",
  );
  const metadata = makeBlock("metadata", 0, "roam/meta::", [metadataCoordinates]);
  const nativeEffort = {
    ":block/uid": "native-effort",
    ":node/title": "[[Efforts]]/Native example",
    ":block/children": [metadata],
  };
  const coordinates = makeBlock("effort-coordinates", 0, "Coordinates:: geo:48.8566,2.3522");
  const effort = {
    ":block/uid": "effort",
    ":node/title": "[[Efforts]]/Example",
    ":block/children": [coordinates],
  };
  const entities = new Map([
    ["native-effort", nativeEffort],
    ["effort", effort],
  ]);
  const api = {
    pull: async (_pattern, uid) => (uid === "map" ? root : entities.get(uid) ?? null),
    pullByTitle: async () => null,
    pullMany: async (_pattern, uids) => uids.map((uid) => entities.get(uid)).filter(Boolean),
    roamQuery: async () => ({
      total: 1,
      results: [
        {
          ":block/uid": "metadata",
          ":block/string": "roam/meta::",
          ":block/page": {
            ":block/uid": "native-effort",
            ":node/title": "[[Efforts]]/Native example",
          },
        },
      ],
    }),
    datalogQuery: async () => ["effort"],
  };
  const compiler = createMapCompiler({
    sourceCompiler: createDirectSourceCompiler(api),
    placeResolver: createPlaceResolver(api),
  });

  const result = await compiler.compile("map");

  assert.deepEqual(result.counts, { sources: 2, mapped: 2, unmapped: 0 });
  assert.deepEqual(
    result.featureCollection.features.map(({ id }) => id),
    ["page:native-effort", "page:effort"],
  );
  assert.deepEqual(
    result.dynamicSources.map(({ kind, total, returned }) => ({ kind, total, returned })),
    [
      { kind: "roam-query", total: 1, returned: 1 },
      { kind: "datalog", total: 1, returned: 1 },
    ],
  );
  assert.deepEqual(result.diagnostics, []);
});
