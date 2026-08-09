import test from "node:test";
import assert from "node:assert/strict";

import { createMarkerClickContext } from "../../src/ui/marker-click-context.js";
import {
  RESULTS_LIST_CONTEXT_VERSION,
  createResultsListContext,
  resultsListInvocation,
} from "../../src/ui/results-list-context.js";

test("the results-list context stays a small serializable identity", () => {
  const context = createResultsListContext({ mapUid: "map-uid", viewId: "rrm-view-3" });
  assert.deepEqual(context, {
    version: RESULTS_LIST_CONTEXT_VERSION,
    mapUid: "map-uid",
    viewId: "rrm-view-3",
  });
  assert.equal(JSON.parse(JSON.stringify(context)).viewId, "rrm-view-3");
});

test("the invocation targets the code block and encodes the context as one argument", () => {
  const context = createResultsListContext({ mapUid: "map-uid", viewId: "rrm-view-3" });
  const invocation = resultsListInvocation("code-uid", context);
  assert.match(invocation, /^\{\{roam\/render: \(\(code-uid\)\) /u);
  const encoded = invocation.match(/\)\) "(.*)"\}\}$/u)[1];
  assert.deepEqual(JSON.parse(decodeURIComponent(encoded)), context);
  assert.throws(() => resultsListInvocation("bad uid", context), /valid Roam code-block UID/u);
});

test("marker-click contexts retain the marker trigger for custom components", () => {
  const context = createMarkerClickContext({
    mapUid: "map-uid",
    clickId: 1,
    entityUids: ["page-uid"],
  });
  assert.equal(context.trigger, "marker");
});
