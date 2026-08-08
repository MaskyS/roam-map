import test from "node:test";
import assert from "node:assert/strict";

import { createMapCompiler } from "../../src/map/compiler.js";
import { FEATURE_PROPERTIES } from "../../src/map/feature-properties.js";

function contribution(pageUid, sourceBlockUid) {
  return {
    pageUid,
    title: pageUid.toUpperCase(),
    provenance: { sourceBlockUid, originBlockUid: sourceBlockUid, viaBlockRefUid: null },
  };
}

function placeRecord(pageUid) {
  return {
    label: pageUid.toUpperCase(),
    diagnostics: [],
    assets: [],
    attributeUids: [],
    feature: {
      type: "Feature",
      id: `page:${pageUid}`,
      geometry: { type: "Point", coordinates: [57, -20] },
      properties: { [FEATURE_PROPERTIES.pageUid]: pageUid },
    },
  };
}

test("the central compiler merges provenance and resolves distinct pages in one batch", async () => {
  const resolvedBatches = [];
  const compiler = createMapCompiler({
    sourceCompiler: {
      compile: async () => ({
        definition: { raw: "{{map}}" },
        contributions: [
          contribution("a", "source-a"),
          contribution("b", "source-b"),
          contribution("a", "source-a-again"),
        ],
        watchUids: [],
        options: { basemap: "streets" },
        layers: [],
        markerClick: { codeBlockUid: "marker-click-code", language: "jsx" },
        diagnostics: [],
      }),
    },
    placeResolver: {
      resolvePages: async (pageUids) => {
        resolvedBatches.push(pageUids);
        return pageUids.map(placeRecord);
      },
    },
  });

  const result = await compiler.compile("map");

  assert.deepEqual(resolvedBatches, [["a", "b"]]);
  assert.deepEqual(result.sourceItems.map(({ pageUid }) => pageUid), ["a", "b"]);
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
});
