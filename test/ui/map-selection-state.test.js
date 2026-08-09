import test from "node:test";
import assert from "node:assert/strict";

import {
  EMPTY_MAP_SELECTION,
  reduceMapSelection,
} from "../../src/ui/map-selection-state.js";

function markerSelection(entityUid, clickId) {
  return { context: { entityUid, clickId }, component: null };
}

test("list selection highlights an entity and removes marker UI", () => {
  const fromMarker = reduceMapSelection(EMPTY_MAP_SELECTION, {
    type: "marker-clicked",
    markerSelection: markerSelection("marker-page", 1),
  });
  const fromList = reduceMapSelection(fromMarker, {
    type: "list-item-selected",
    entityUid: "list-page",
  });

  assert.deepEqual(fromList, {
    selectedEntityUid: "list-page",
    markerSelection: null,
  });
});

test("only the current marker UI can clear marker-origin selection", () => {
  const current = reduceMapSelection(EMPTY_MAP_SELECTION, {
    type: "marker-clicked",
    markerSelection: markerSelection("same-page", 2),
  });

  assert.equal(
    reduceMapSelection(current, { type: "marker-ui-closed", clickId: 1 }),
    current,
  );
  assert.equal(
    reduceMapSelection(current, { type: "marker-ui-closed", clickId: 2 }),
    EMPTY_MAP_SELECTION,
  );
});

test("refresh keeps available selection and clears a removed feature", () => {
  const selected = {
    selectedEntityUid: "selected-page",
    markerSelection: markerSelection("selected-page", 3),
  };
  assert.equal(
    reduceMapSelection(selected, {
      type: "features-refreshed",
      entityUids: new Set(["selected-page"]),
    }),
    selected,
  );
  assert.equal(
    reduceMapSelection(selected, {
      type: "features-refreshed",
      entityUids: new Set(["another-page"]),
    }),
    EMPTY_MAP_SELECTION,
  );
});
