// roam/render arguments must be serializable. This context keeps the useful
// click data while leaving MapLibre objects and native DOM events behind.
export const MARKER_CLICK_CONTEXT_VERSION = 2;

export function createMarkerClickContext({
  mapUid,
  clickId,
  entityUids = [],
  coincidentEntityUids = entityUids,
  features = [],
  point = null,
  lngLat = null,
  clientPoint = null,
  modifiers = {},
}) {
  const orderedEntityUids = [...entityUids];
  const orderedFeatures = [...features];
  const knownEntityUids = new Set(orderedEntityUids);
  const orderedCoincidentEntityUids = [
    ...new Set(
      coincidentEntityUids.filter((entityUid) => knownEntityUids.has(entityUid)),
    ),
  ];
  if (orderedCoincidentEntityUids.length === 0 && orderedEntityUids[0]) {
    orderedCoincidentEntityUids.push(orderedEntityUids[0]);
  }
  const primaryEntityUid = orderedCoincidentEntityUids[0] ?? null;
  const primaryFeatureIndex = orderedEntityUids.indexOf(primaryEntityUid);
  const primaryFeature = orderedFeatures[primaryFeatureIndex] ?? orderedFeatures[0] ?? null;
  return {
    version: MARKER_CLICK_CONTEXT_VERSION,
    mapUid,
    clickId,
    trigger: "marker",
    entityUid: primaryEntityUid,
    identityKind: primaryFeature?.properties?.["roam/identityKind"] ?? null,
    entityUids: orderedEntityUids,
    coincidentEntityUids: orderedCoincidentEntityUids,
    feature: primaryFeature,
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
