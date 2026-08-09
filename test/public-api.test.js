import test from "node:test";
import assert from "node:assert/strict";

import {
  createPublicApi,
  installPublicApi,
  PUBLIC_API_NAMESPACE,
  PUBLIC_API_VERSION,
} from "../src/public-api.js";

test("the public component namespace is versioned and restored on unload", () => {
  function MarkerCard() {}
  function MarkerCardActions() {}
  function MarkerCardDetails() {}
  function MarkerPopover() {}
  function MapResultsPanel() {}
  function MapResultItem() {}
  const previous = { from: "another script" };
  const target = { [PUBLIC_API_NAMESPACE]: previous };
  const publicApi = createPublicApi({
    MarkerCard,
    MarkerCardActions,
    MarkerCardDetails,
    MarkerPopover,
    MapResultsPanel,
    MapResultItem,
  });
  const uninstall = installPublicApi({ target, publicApi });

  assert.equal(target.RoamMap.version, PUBLIC_API_VERSION);
  assert.equal(target.RoamMap.components.MarkerCard, MarkerCard);
  assert.equal(target.RoamMap.components.MarkerPopover, MarkerPopover);
  assert.equal(target.RoamMap.components.MapResultsPanel, MapResultsPanel);
  assert.equal(target.RoamMap.components.MapResultItem, MapResultItem);
  assert.equal(Object.isFrozen(target.RoamMap), true);
  assert.equal(Object.isFrozen(target.RoamMap.components), true);

  uninstall();
  uninstall();
  assert.equal(target.RoamMap, previous);
});

test("unload does not remove a namespace that another owner replaced", () => {
  function MarkerCard() {}
  function MarkerCardActions() {}
  function MarkerCardDetails() {}
  function MarkerPopover() {}
  function MapResultsPanel() {}
  function MapResultItem() {}
  const target = {};
  const publicApi = createPublicApi({
    MarkerCard,
    MarkerCardActions,
    MarkerCardDetails,
    MarkerPopover,
    MapResultsPanel,
    MapResultItem,
  });
  const uninstall = installPublicApi({ target, publicApi });
  const replacement = { version: 2 };
  target.RoamMap = replacement;

  uninstall();

  assert.equal(target.RoamMap, replacement);
});
