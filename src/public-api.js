export const PUBLIC_API_VERSION = 2;
export const PUBLIC_API_NAMESPACE = "RoamMap";

export function createPublicApi({
  MarkerCard,
  MarkerCardActions,
  MarkerCardDetails,
  MarkerPopover,
  MapResultsPanel,
  MapResultItem,
}) {
  const components = {
    MarkerCard,
    MarkerCardActions,
    MarkerCardDetails,
    MarkerPopover,
    MapResultsPanel,
    MapResultItem,
  };
  if (Object.values(components).some((component) => typeof component !== "function")) {
    throw new Error("Roam Map's public component API is incomplete.");
  }
  return Object.freeze({
    version: PUBLIC_API_VERSION,
    components: Object.freeze(components),
  });
}

export function installPublicApi({ target, publicApi }) {
  const previous = target[PUBLIC_API_NAMESPACE];
  target[PUBLIC_API_NAMESPACE] = publicApi;
  let installed = true;
  return () => {
    if (!installed) return;
    installed = false;
    if (target[PUBLIC_API_NAMESPACE] !== publicApi) return;
    if (previous === undefined) delete target[PUBLIC_API_NAMESPACE];
    else target[PUBLIC_API_NAMESPACE] = previous;
  };
}
