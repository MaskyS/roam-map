// roam/render arguments must be serializable. This context keeps the useful
// click data while leaving MapLibre objects and native DOM events behind.
export const MARKER_CLICK_CONTEXT_VERSION = 1;

export function createMarkerClickContext({
  mapUid,
  clickId,
  pageUids = [],
  coincidentPageUids = pageUids,
  features = [],
  point = null,
  lngLat = null,
  clientPoint = null,
  modifiers = {},
}) {
  const orderedPageUids = [...pageUids];
  const orderedFeatures = [...features];
  const knownPageUids = new Set(orderedPageUids);
  const orderedCoincidentPageUids = [
    ...new Set(coincidentPageUids.filter((pageUid) => knownPageUids.has(pageUid))),
  ];
  if (orderedCoincidentPageUids.length === 0 && orderedPageUids[0]) {
    orderedCoincidentPageUids.push(orderedPageUids[0]);
  }
  const primaryPageUid = orderedCoincidentPageUids[0] ?? null;
  const primaryFeatureIndex = orderedPageUids.indexOf(primaryPageUid);
  return {
    version: MARKER_CLICK_CONTEXT_VERSION,
    mapUid,
    clickId,
    pageUid: primaryPageUid,
    pageUids: orderedPageUids,
    coincidentPageUids: orderedCoincidentPageUids,
    feature: orderedFeatures[primaryFeatureIndex] ?? orderedFeatures[0] ?? null,
    features: orderedFeatures,
    point,
    lngLat,
    clientPoint,
    modifiers: {
      altKey: Boolean(modifiers.altKey),
      ctrlKey: Boolean(modifiers.ctrlKey),
      metaKey: Boolean(modifiers.metaKey),
      shiftKey: Boolean(modifiers.shiftKey),
    },
  };
}

export function encodeMarkerClickContext(context) {
  return encodeURIComponent(JSON.stringify(context));
}

export function markerClickInvocation(codeBlockUid, context) {
  const uid = String(codeBlockUid ?? "").trim();
  if (!uid || /[\s(){}]/u.test(uid)) {
    throw new Error("Marker click needs a valid Roam code-block UID.");
  }
  return `{{roam/render: ((${uid})) ${JSON.stringify(encodeMarkerClickContext(context))}}}`;
}
