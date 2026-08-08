// This module is the only place that owns MapLibre objects. Style changes replace
// MapLibre's internal graph, so the extension-owned source, images, and layers are restored here.
import maplibregl from "maplibre-gl";
import {
  DEFAULT_MAP_STYLE,
  EOX_SATELLITE_TILE_URL,
  eoxSatelliteStyle,
  resolveBuiltInBasemap,
  safeBasemapError,
} from "../settings/basemap-registry.js";
import { defaultMarkerImage } from "./image-assets.js";
import {
  DEFAULT_MARKER_IMAGE_ID,
  DEFAULT_MARKER_COLOR,
  DEFAULT_MARKER_RADIUS,
  DEFAULT_POINT_LAYER_ID,
  MAP_SOURCE_ID,
} from "./runtime-constants.js";
import { FEATURE_PROPERTIES } from "../map/feature-properties.js";
import { DEFAULT_MAP_OPTIONS } from "../map/options.js";

export { MAP_SOURCE_ID };
export { DEFAULT_MAP_STYLE };
export const MAP_LAYER_ID = DEFAULT_POINT_LAYER_ID;
export const SATELLITE_TILE_URL = EOX_SATELLITE_TILE_URL;

const EMPTY_COLLECTION = Object.freeze({ type: "FeatureCollection", features: [] });
const COINCIDENT_MARKER_TOLERANCE_PX = 1;

export function satelliteMapStyle() {
  return eoxSatelliteStyle();
}

export function styleForBasemap(basemap) {
  return resolveBuiltInBasemap(basemap).style;
}

function normalizedBasemap(reference) {
  return typeof reference === "string" && reference.trim()
    ? reference.trim()
    : DEFAULT_MAP_OPTIONS.basemap;
}

function markerRadiusExpression() {
  return [
    "interpolate",
    ["linear"],
    ["zoom"],
    2,
    DEFAULT_MARKER_RADIUS * 0.65,
    12,
    DEFAULT_MARKER_RADIUS,
  ];
}

function pointCoordinates(collection) {
  return (collection?.features ?? [])
    .filter((feature) => feature?.geometry?.type === "Point")
    .map((feature) => feature.geometry.coordinates)
    .filter(
      (coordinates) =>
        Array.isArray(coordinates) &&
        Number.isFinite(coordinates[0]) &&
        Number.isFinite(coordinates[1]),
    );
}

function copyLayer(layer) {
  return JSON.parse(JSON.stringify(layer));
}

function finitePoint(value, first, second) {
  return Number.isFinite(value?.[first]) && Number.isFinite(value?.[second])
    ? { [first]: value[first], [second]: value[second] }
    : null;
}

function pageUidFromFeature(feature) {
  return feature?.properties?.[FEATURE_PROPERTIES.pageUid] ?? null;
}

function distinctPageUids(features) {
  const pageUids = [];
  const seen = new Set();
  for (const feature of features) {
    const pageUid = pageUidFromFeature(feature);
    if (!pageUid || seen.has(pageUid)) continue;
    seen.add(pageUid);
    pageUids.push(pageUid);
  }
  return pageUids;
}

function distanceSquared(first, second) {
  return (first.x - second.x) ** 2 + (first.y - second.y) ** 2;
}

function markerHitSelection({ renderedFeatures, collection, map, clickPoint }) {
  const renderedPageUids = distinctPageUids(renderedFeatures);
  const fallbackHitSelection = {
    pageUids: renderedPageUids,
    coincidentPageUids: renderedPageUids,
  };
  const point = finitePoint(clickPoint, "x", "y");
  if (!point || typeof map.project !== "function") return fallbackHitSelection;

  const sourceFeatures = new Map(
    (collection?.features ?? [])
      .map((feature) => [pageUidFromFeature(feature), feature])
      .filter(([pageUid]) => pageUid),
  );
  const projectedHits = renderedPageUids.map((pageUid, index) => {
    const geometry = sourceFeatures.get(pageUid)?.geometry;
    const coordinates = geometry?.coordinates;
    if (
      geometry?.type !== "Point" ||
      !Array.isArray(coordinates) ||
      !Number.isFinite(coordinates[0]) ||
      !Number.isFinite(coordinates[1])
    ) {
      return null;
    }
    try {
      const projectedPoint = finitePoint(map.project(coordinates), "x", "y");
      return projectedPoint
        ? {
            pageUid,
            projectedPoint,
            distanceFromClick: distanceSquared(projectedPoint, point),
            renderedOrder: index,
          }
        : null;
    } catch {
      return null;
    }
  });

  // Preserve the old all-hit behavior for mixed or unresolved geometries. The
  // proximity rule is specifically for point markers whose centers we can compare.
  if (projectedHits.some((hit) => hit === null)) return fallbackHitSelection;

  projectedHits.sort(
    (first, second) =>
      first.distanceFromClick - second.distanceFromClick ||
      first.renderedOrder - second.renderedOrder,
  );
  const primaryPoint = projectedHits[0]?.projectedPoint;
  const toleranceSquared = COINCIDENT_MARKER_TOLERANCE_PX ** 2;
  return {
    pageUids: projectedHits.map(({ pageUid }) => pageUid),
    coincidentPageUids: primaryPoint
      ? projectedHits
          .filter(
            ({ projectedPoint }) =>
              distanceSquared(projectedPoint, primaryPoint) <= toleranceSquared,
          )
          .map(({ pageUid }) => pageUid)
      : [],
  };
}

function markerClickEvent(event, map, { pageUids, coincidentPageUids }) {
  const point = finitePoint(event?.point, "x", "y");
  const lngLat = finitePoint(event?.lngLat, "lng", "lat");
  const originalEvent = event?.originalEvent;
  const nativeClientPoint = finitePoint(originalEvent, "clientX", "clientY");
  let clientPoint = nativeClientPoint
    ? { x: nativeClientPoint.clientX, y: nativeClientPoint.clientY }
    : null;
  if (!clientPoint && point) {
    const bounds = map.getCanvas?.()?.getBoundingClientRect?.();
    if (Number.isFinite(bounds?.left) && Number.isFinite(bounds?.top)) {
      clientPoint = { x: bounds.left + point.x, y: bounds.top + point.y };
    }
  }
  return {
    pageUids,
    coincidentPageUids,
    point,
    lngLat,
    clientPoint,
    modifiers: {
      altKey: Boolean(originalEvent?.altKey),
      ctrlKey: Boolean(originalEvent?.ctrlKey),
      metaKey: Boolean(originalEvent?.metaKey),
      shiftKey: Boolean(originalEvent?.shiftKey),
    },
  };
}

export function createInlineMapRuntime({
  container,
  mapLibrary = maplibregl,
  style = DEFAULT_MAP_STYLE,
  basemap = DEFAULT_MAP_OPTIONS.basemap,
  loadAsset = null,
  resolveBasemap = resolveBuiltInBasemap,
  onMarkerClick,
  onError,
  onAssetError,
  onBasemap,
  onLoad,
}) {
  let removed = false;
  let loaded = false;
  let currentData = EMPTY_COLLECTION;
  let currentLayers = [];
  let currentBasemap = resolveBasemap(normalizedBasemap(basemap));
  let fitWhenLoaded = false;
  let assetGeneration = 0;
  let assetAbortController = null;
  const activeAssetIds = new Set();
  const decodedImages = new Map();
  const interactiveLayerIds = new Set();
  const fallback = defaultMarkerImage();

  function notifyBasemap() {
    const { style: _style, fingerprint: _fingerprint, ...status } = currentBasemap;
    onBasemap?.(status);
  }

  const map = new mapLibrary.Map({
    container,
    style: style === DEFAULT_MAP_STYLE ? currentBasemap.style : style,
    center: [0, 20],
    zoom: 1.35,
    attributionControl: true,
    cooperativeGestures: true,
    dragRotate: false,
    pitchWithRotate: false,
  });
  map.dragRotate?.disable?.();
  map.touchZoomRotate?.disableRotation?.();

  function markerLayer() {
    return {
      id: MAP_LAYER_ID,
      type: "circle",
      source: MAP_SOURCE_ID,
      paint: {
        "circle-radius": markerRadiusExpression(),
        "circle-color": DEFAULT_MARKER_COLOR,
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 2,
        "circle-opacity": 0.92,
      },
    };
  }

  function hasImage(id) {
    return typeof map.hasImage === "function" ? map.hasImage(id) : false;
  }

  function registerImage(id, record) {
    if (typeof map.addImage !== "function" || hasImage(id)) return;
    map.addImage(id, record.image, record.options);
  }

  function decodedImageRecords(id, decoded) {
    return [
      { id, image: decoded.image, options: decoded.options },
      ...(decoded.variants ?? []).filter(
        (variant) =>
          variant &&
          typeof variant.id === "string" &&
          variant.id !== id &&
          variant.image,
      ),
    ];
  }

  function registerDecodedImages(id, decoded) {
    for (const record of decodedImageRecords(id, decoded)) registerImage(record.id, record);
  }

  function removeDecodedImages(id) {
    const decoded = decodedImages.get(id);
    const records = decoded ? decodedImageRecords(id, decoded) : [{ id }];
    for (const record of records) {
      if (hasImage(record.id)) map.removeImage?.(record.id);
    }
  }

  function ensureImages() {
    registerImage(DEFAULT_MARKER_IMAGE_ID, fallback);
    for (const id of activeAssetIds) {
      const decoded = decodedImages.get(id);
      if (decoded) registerDecodedImages(id, decoded);
    }
  }

  function handleFeatureClick(event) {
    const features =
      event?.point && typeof map.queryRenderedFeatures === "function"
        ? map.queryRenderedFeatures(event.point, { layers: [...interactiveLayerIds] })
        : event?.features ?? [];
    const markerHits = markerHitSelection({
      renderedFeatures: features,
      collection: currentData,
      map,
      clickPoint: event?.point,
    });
    if (markerHits.pageUids.length > 0) {
      onMarkerClick?.(markerClickEvent(event, map, markerHits));
    }
  }

  function handlePointerEnter() {
    const canvas = map.getCanvas?.();
    if (canvas) canvas.style.cursor = "pointer";
  }

  function handlePointerLeave() {
    const canvas = map.getCanvas?.();
    if (canvas) canvas.style.cursor = "";
  }

  function addLayerInteractions(layerId) {
    if (interactiveLayerIds.has(layerId)) return;
    map.on("mouseenter", layerId, handlePointerEnter);
    map.on("mouseleave", layerId, handlePointerLeave);
    interactiveLayerIds.add(layerId);
  }

  function removeLayerInteractions(layerId) {
    if (!interactiveLayerIds.has(layerId)) return;
    map.off("mouseenter", layerId, handlePointerEnter);
    map.off("mouseleave", layerId, handlePointerLeave);
    interactiveLayerIds.delete(layerId);
  }

  function syncLayerInteractions() {
    const desired = new Set([MAP_LAYER_ID, ...currentLayers.map(({ id }) => id)]);
    for (const layerId of [...interactiveLayerIds]) {
      if (!desired.has(layerId)) removeLayerInteractions(layerId);
    }
    for (const layerId of desired) addLayerInteractions(layerId);
  }

  function ensureOverlay() {
    if (removed) return;
    try {
      if (!map.getSource(MAP_SOURCE_ID)) {
        map.addSource(MAP_SOURCE_ID, { type: "geojson", data: currentData });
      }
      ensureImages();
      if (!map.getLayer(MAP_LAYER_ID)) map.addLayer(markerLayer());
      for (const layer of currentLayers) {
        if (!map.getLayer(layer.id)) map.addLayer(copyLayer(layer));
      }
      syncLayerInteractions();
    } catch (error) {
      onError?.(safeBasemapError(error));
    }
  }

  function fit(collection = currentData, { animate = true } = {}) {
    if (removed) return;
    const coordinates = pointCoordinates(collection);
    if (coordinates.length === 0) return;
    if (!loaded) {
      fitWhenLoaded = true;
      return;
    }
    if (coordinates.length === 1) {
      const camera = { center: coordinates[0], zoom: 13, duration: animate ? 500 : 0 };
      if (typeof map.easeTo === "function") map.easeTo(camera);
      else map.jumpTo?.(camera);
      return;
    }
    const bounds = new mapLibrary.LngLatBounds();
    coordinates.forEach((coordinate) => bounds.extend(coordinate));
    map.fitBounds(bounds, { padding: 48, maxZoom: 14, duration: animate ? 500 : 0 });
  }

  function handleLoad() {
    if (removed) return;
    loaded = true;
    ensureOverlay();
    if (fitWhenLoaded) {
      fitWhenLoaded = false;
      fit(currentData, { animate: false });
    }
    onLoad?.();
  }

  function handleStyleLoad() {
    if (removed) return;
    loaded = true;
    ensureOverlay();
    onLoad?.();
  }

  function handleError(event) {
    onError?.(
      safeBasemapError(
        event?.error ?? new Error("The basemap or one of its resources could not load."),
      ),
    );
  }

  map.on("load", handleLoad);
  map.on("style.load", handleStyleLoad);
  map.on("error", handleError);
  map.on("click", handleFeatureClick);
  notifyBasemap();

  async function setAssets(assets = []) {
    if (removed) return;
    const generation = ++assetGeneration;
    assetAbortController?.abort();
    assetAbortController = new AbortController();
    const signal = assetAbortController.signal;
    const next = new Map();
    for (const asset of assets) {
      if (asset?.id && !next.has(asset.id)) next.set(asset.id, asset);
    }

    for (const id of activeAssetIds) {
      if (next.has(id)) continue;
      activeAssetIds.delete(id);
      removeDecodedImages(id);
      decodedImages.delete(id);
    }
    for (const id of next.keys()) activeAssetIds.add(id);
    if (typeof loadAsset !== "function") return;

    await Promise.all(
      [...next.values()].map(async (asset) => {
        try {
          let decoded = decodedImages.get(asset.id);
          if (!decoded) {
            decoded = await loadAsset(asset, { signal });
            if (removed || signal.aborted || generation !== assetGeneration) return;
            decodedImages.set(asset.id, decoded);
          }
          if (
            !removed &&
            generation === assetGeneration &&
            activeAssetIds.has(asset.id) &&
            loaded
          ) {
            registerDecodedImages(asset.id, decoded);
          }
        } catch (error) {
          if (removed || signal.aborted || generation !== assetGeneration) return;
          onAssetError?.({ asset, error });
        }
      }),
    );
    if (!removed && generation === assetGeneration && loaded) {
      for (const layer of [...currentLayers].reverse()) {
        if (map.getLayer(layer.id)) map.removeLayer?.(layer.id);
      }
      ensureOverlay();
    }
  }

  return {
    setData(collection) {
      if (removed) return;
      currentData = collection ?? EMPTY_COLLECTION;
      map.getSource(MAP_SOURCE_ID)?.setData(currentData);
    },
    setLayers(layers = []) {
      if (removed) return;
      for (const layer of [...currentLayers].reverse()) {
        removeLayerInteractions(layer.id);
        if (map.getLayer(layer.id)) map.removeLayer?.(layer.id);
      }
      currentLayers = layers.map(copyLayer);
      if (loaded) ensureOverlay();
    },
    setAssets,
    setBasemap(reference) {
      if (removed) return;
      let nextBasemap;
      try {
        nextBasemap = resolveBasemap(normalizedBasemap(reference));
      } catch (error) {
        nextBasemap = {
          ...resolveBuiltInBasemap(DEFAULT_MAP_OPTIONS.basemap),
          error: safeBasemapError(error),
          fallback: true,
          requested: reference,
        };
      }
      const basemapChanged = nextBasemap.fingerprint !== currentBasemap.fingerprint;
      currentBasemap = nextBasemap;
      notifyBasemap();
      if (basemapChanged && typeof map.setStyle === "function") {
        loaded = false;
        try {
          map.setStyle(currentBasemap.style);
        } catch (error) {
          loaded = true;
          onError?.(safeBasemapError(error));
        }
      }
    },
    getBasemap() {
      const { style: _style, fingerprint: _fingerprint, ...status } = currentBasemap;
      return status;
    },
    fit,
    resize() {
      if (!removed) map.resize?.();
    },
    remove() {
      if (removed) return;
      removed = true;
      assetGeneration += 1;
      assetAbortController?.abort();
      for (const layerId of [...interactiveLayerIds]) removeLayerInteractions(layerId);
      map.off("load", handleLoad);
      map.off("style.load", handleStyleLoad);
      map.off("error", handleError);
      map.off("click", handleFeatureClick);
      map.remove();
    },
  };
}

export const __test = { markerClickEvent, markerHitSelection, pointCoordinates };
