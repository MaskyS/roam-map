import maplibregl from "maplibre-gl";
import {
  DEFAULT_MAP_STYLE,
  EOX_SATELLITE_TILE_URL,
  eoxSatelliteStyle,
  resolveBuiltInBasemap,
  safeBasemapError,
} from "./basemaps.js";
import { defaultMarkerImage } from "./image-assets.js";
import {
  DEFAULT_MARKER_IMAGE_ID,
  DEFAULT_POINT_LAYER_ID,
  FEATURE_PROPERTIES,
  MAP_SOURCE_ID,
} from "./map-contract.js";
import { DEFAULT_PRESENTATION } from "./map-presentation.js";

export { MAP_SOURCE_ID };
export { DEFAULT_MAP_STYLE };
export const MAP_LAYER_ID = DEFAULT_POINT_LAYER_ID;
export const SATELLITE_TILE_URL = EOX_SATELLITE_TILE_URL;

const EMPTY_COLLECTION = Object.freeze({ type: "FeatureCollection", features: [] });

export function satelliteMapStyle() {
  return eoxSatelliteStyle();
}

export function styleForBasemap(basemap) {
  return resolveBuiltInBasemap(basemap).style;
}

function normalizedPresentation(presentation) {
  const marker = presentation?.marker ?? {};
  return {
    basemap:
      typeof presentation?.basemap === "string" && presentation.basemap.trim()
        ? presentation.basemap.trim()
        : DEFAULT_PRESENTATION.basemap,
    marker: {
      color: marker.color ?? DEFAULT_PRESENTATION.marker.color,
      radius: Number.isFinite(marker.radius)
        ? marker.radius
        : DEFAULT_PRESENTATION.marker.radius,
    },
  };
}

function markerRadiusExpression(radius) {
  const value = ["coalesce", ["get", "markerRadius"], radius];
  return ["interpolate", ["linear"], ["zoom"], 2, ["*", value, 0.65], 12, value];
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

export function createInlineMapRuntime({
  container,
  mapLibrary = maplibregl,
  style = DEFAULT_MAP_STYLE,
  presentation = DEFAULT_PRESENTATION,
  loadAsset = null,
  resolveBasemap = resolveBuiltInBasemap,
  onFeature,
  onError,
  onAssetError,
  onBasemap,
  onLoad,
}) {
  let removed = false;
  let loaded = false;
  let currentData = EMPTY_COLLECTION;
  let currentLayers = [];
  let currentPresentation = normalizedPresentation(presentation);
  let currentBasemap = resolveBasemap(currentPresentation.basemap);
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
        "circle-radius": markerRadiusExpression(currentPresentation.marker.radius),
        "circle-color": [
          "coalesce",
          ["get", "markerColor"],
          currentPresentation.marker.color,
        ],
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 2,
        "circle-opacity": 0.92,
      },
    };
  }

  function applyMarkerPaint() {
    if (!map.getLayer(MAP_LAYER_ID)) return;
    map.setPaintProperty?.(
      MAP_LAYER_ID,
      "circle-color",
      ["coalesce", ["get", "markerColor"], currentPresentation.marker.color],
    );
    map.setPaintProperty?.(
      MAP_LAYER_ID,
      "circle-radius",
      markerRadiusExpression(currentPresentation.marker.radius),
    );
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
    const feature = event?.features?.[0];
    if (!feature) return;
    onFeature?.({
      pageUid: feature.properties?.[FEATURE_PROPERTIES.pageUid] ?? null,
      label:
        feature.properties?.[FEATURE_PROPERTIES.label] ??
        feature.properties?.[FEATURE_PROPERTIES.title] ??
        "Place",
      title: feature.properties?.[FEATURE_PROPERTIES.title] ?? null,
      address: feature.properties?.[FEATURE_PROPERTIES.address] ?? null,
      coordinates: feature.geometry?.coordinates ?? event.lngLat?.toArray?.() ?? null,
    });
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
    map.on("click", layerId, handleFeatureClick);
    map.on("mouseenter", layerId, handlePointerEnter);
    map.on("mouseleave", layerId, handlePointerLeave);
    interactiveLayerIds.add(layerId);
  }

  function removeLayerInteractions(layerId) {
    if (!interactiveLayerIds.has(layerId)) return;
    map.off("click", layerId, handleFeatureClick);
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
      applyMarkerPaint();
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
    setPresentation(presentationValue) {
      if (removed) return;
      const next = normalizedPresentation(presentationValue);
      let nextBasemap;
      try {
        nextBasemap = resolveBasemap(next.basemap);
      } catch (error) {
        nextBasemap = {
          ...resolveBuiltInBasemap(DEFAULT_PRESENTATION.basemap),
          error: safeBasemapError(error),
          fallback: true,
          requested: next.basemap,
        };
      }
      const basemapChanged = nextBasemap.fingerprint !== currentBasemap.fingerprint;
      currentPresentation = next;
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
      } else {
        applyMarkerPaint();
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
      map.remove();
    },
  };
}

export const __test = { pointCoordinates };
