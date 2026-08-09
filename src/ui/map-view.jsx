import { DEFAULT_MAP_OPTIONS } from "../map/options.js";
import { FEATURE_PROPERTIES } from "../map/feature-properties.js";
import { createLiveMapSession } from "../map/live-session.js";
import { createImageAssetLoader } from "../maplibre/image-assets.js";
import { createInlineMapRuntime } from "../maplibre/runtime.js";
import { safeBasemapError } from "../settings/basemap-registry.js";
import { MarkerCard } from "./marker-card.jsx";
import { mapSelectionOffset } from "./map-camera-geometry.js";
import {
  EMPTY_MAP_SELECTION,
  reduceMapSelection,
} from "./map-selection-state.js";
import { createMarkerClickContext } from "./marker-click-context.js";
import { MarkerPopover } from "./marker-popover.jsx";
import {
  MapResizeHandle,
  ResetMapSizeButton,
  useMapResize,
} from "./map-resize.jsx";
import { registerMapView } from "./map-view-store.js";
import {
  RESULTS_LIST_CONTEXT_VERSION,
  createResultsListContext,
} from "./results-list-context.js";
import { MapResultsPanel } from "./results-list.jsx";
import { RoamMarkerClick } from "./roam-marker-click.jsx";
import { RoamResultsList } from "./roam-results-list.jsx";

const React = window.React;
const { Button } = window.Blueprint.Core;

let viewCounter = 0;

function resultRowsFrom(result, featureIndex) {
  return (result?.resolved ?? []).map(({ item, record }) => {
    const feature = featureIndex.get(item.entityUid) ?? null;
    const description = feature?.properties?.Description;
    return {
      entityUid: item.entityUid,
      identityKind: item.identityKind,
      title: record?.title ?? item.title ?? null,
      label: record?.label ?? item.title ?? "Untitled place",
      address: record?.address ?? null,
      description: typeof description === "string" ? description : null,
      mapped: Boolean(feature),
    };
  });
}

function stopRoamMouseDown(event) {
  event.stopPropagation();
}

function readableError(error) {
  return error?.message ?? String(error ?? "Unknown error");
}

function groupedDiagnostics(diagnostics) {
  const groups = new Map();
  for (const diagnostic of diagnostics) {
    const key = `${diagnostic.code ?? ""}:${diagnostic.message}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        message: diagnostic.message,
        severity: diagnostic.severity ?? "warning",
        entities: [],
        details: new Set(),
      };
      groups.set(key, group);
    }
    if (diagnostic.severity === "error") group.severity = "error";
    if (diagnostic.detail) group.details.add(diagnostic.detail);
    if (
      diagnostic.entityUid &&
      !group.entities.some((entity) => entity.entityUid === diagnostic.entityUid)
    ) {
      group.entities.push({
        entityUid: diagnostic.entityUid,
        entityTitle: diagnostic.entityTitle ?? null,
        identityKind: diagnostic.identityKind ?? null,
      });
    }
  }
  return [...groups.values()];
}

function DiagnosticList({ groups, onOpenEntity }) {
  if (groups.length === 0) return null;
  return (
    <div className="rrm-diagnostics" role="region" aria-label="Map notes">
      <ul>
        {groups.map((group) => (
          <li
            key={group.key}
            className={group.severity === "error" ? "rrm-diagnostic--error" : undefined}
          >
            <span className="rrm-diagnostic-message">{group.message}</span>
            {group.entities.map((entity) => (
              <button
                key={entity.entityUid}
                type="button"
                className="rrm-diagnostic-page"
                title="Open this source in the right sidebar"
                onClick={() => onOpenEntity(entity.entityUid)}
              >
                {entity.entityTitle ?? "Open source"}
              </button>
            ))}
            {[...group.details].map((detail) => (
              <code key={detail}>{detail}</code>
            ))}
          </li>
        ))}
      </ul>
    </div>
  );
}

function useBasemapRevision(registry) {
  return React.useSyncExternalStore(
    registry.subscribe,
    registry.getSnapshot,
    registry.getSnapshot,
  );
}

function useLiveMap({ api, compiler, definitionUid }) {
  const sessionRef = React.useRef(null);
  const [state, setState] = React.useState({
    result: null,
    phase: "loading",
    error: null,
    watchFailures: [],
  });

  React.useEffect(() => {
    let active = true;
    const session = createLiveMapSession({
      api,
      mapUid: definitionUid,
      compile: (uid) => compiler.compile(uid),
      onState: (event) => {
        if (!active) return;
        if (event.type === "loading") {
          setState((current) => ({ ...current, phase: "loading", error: null }));
        } else if (event.type === "refreshing") {
          setState((current) => ({ ...current, phase: "refreshing" }));
        } else if (event.type === "result") {
          setState((current) => ({
            ...current,
            result: event.result,
            phase: "ready",
            error: null,
          }));
        } else if (event.type === "error") {
          setState((current) => ({ ...current, phase: "error", error: event.error }));
        } else if (event.type === "watch-status") {
          setState((current) => ({ ...current, watchFailures: event.failures }));
        }
      },
    });
    sessionRef.current = session;
    void session.start().catch((error) => {
      if (active) setState((current) => ({ ...current, phase: "error", error }));
    });
    return () => {
      active = false;
      sessionRef.current = null;
      void session.stop().catch((error) => {
        console.warn("[roam-map] session cleanup failed", error);
      });
    };
  }, [api, compiler, definitionUid]);

  function refresh() {
    void sessionRef.current?.refresh("manual").catch((error) => {
      setState((current) => ({ ...current, phase: "error", error }));
    });
  }

  return { ...state, refresh };
}

function useInlineMapRuntime({ api, basemaps, containerRef, onMarkerClick }) {
  const [runtime, setRuntime] = React.useState(null);
  const [mapError, setMapError] = React.useState(null);
  const [basemapStatus, setBasemapStatus] = React.useState(() =>
    basemaps.describe(DEFAULT_MAP_OPTIONS.basemap),
  );
  const [assetDiagnostics, setAssetDiagnostics] = React.useState([]);
  const clearAssetDiagnostics = React.useCallback(() => setAssetDiagnostics([]), []);
  const reportMapError = React.useCallback(
    (error) => setMapError(safeBasemapError(error)),
    [],
  );

  React.useEffect(() => {
    if (!containerRef.current) return undefined;
    let resizeObserver = null;
    let nextRuntime = null;
    setRuntime(null);
    try {
      nextRuntime = createInlineMapRuntime({
        container: containerRef.current,
        loadAsset: createImageAssetLoader({ getFile: api.getFile }),
        resolveBasemap: (reference) => basemaps.resolve(reference),
        onMarkerClick,
        onError: setMapError,
        onBasemap: setBasemapStatus,
        onAssetError: ({ asset, error }) => {
          setAssetDiagnostics((current) => [
            ...current.filter(({ key }) => key !== `asset.load-failed:${asset.id}`),
            {
              key: `asset.load-failed:${asset.id}`,
              code: "asset.load-failed",
              severity: "warning",
              entityUid: asset.entityUid,
              identityKind: asset.identityKind,
              field: asset.attributeTitle,
              message: `${asset.attributeTitle} could not be loaded as a map image: ${readableError(error)}`,
            },
          ]);
        },
        onLoad: () => setMapError(null),
      });
      setRuntime(nextRuntime);
      if (typeof window.ResizeObserver === "function") {
        resizeObserver = new window.ResizeObserver(() => nextRuntime.resize());
        resizeObserver.observe(containerRef.current);
      }
    } catch (error) {
      setMapError(safeBasemapError(error));
    }
    return () => {
      resizeObserver?.disconnect();
      nextRuntime?.remove();
    };
  }, [api.getFile, basemaps, containerRef, onMarkerClick]);

  return {
    runtime,
    mapError,
    basemapStatus,
    assetDiagnostics,
    clearAssetDiagnostics,
    reportMapError,
  };
}

function featuresByEntityUid(result) {
  return new Map(
    (result?.featureCollection?.features ?? [])
      .map((feature) => [feature.properties?.[FEATURE_PROPERTIES.entityUid], feature])
      .filter(([entityUid]) => entityUid),
  );
}

export function MapView({ definitionUid, hostUid, api, basemaps, compiler }) {
  const containerRef = React.useRef(null);
  const frameRef = React.useRef(null);
  const shellRef = React.useRef(null);
  const hasFitRef = React.useRef(false);
  const clickIdRef = React.useRef(0);
  const resultRef = React.useRef(null);
  const runtimeRef = React.useRef(null);
  const viewIdRef = React.useRef(null);
  if (viewIdRef.current == null) {
    viewCounter += 1;
    viewIdRef.current = `rrm-view-${viewCounter}`;
  }
  const viewId = viewIdRef.current;
  const [preview, setPreview] = React.useState(null);
  const [{ selectedEntityUid, markerSelection }, updateSelection] = React.useReducer(
    reduceMapSelection,
    EMPTY_MAP_SELECTION,
  );
  const [actionError, setActionError] = React.useState(null);
  const [openPanel, setOpenPanel] = React.useState(null);
  const basemapRevision = useBasemapRevision(basemaps);
  const { result, phase, error, watchFailures, refresh } = useLiveMap({
    api,
    compiler,
    definitionUid,
  });
  React.useLayoutEffect(() => {
    resultRef.current = result;
  }, [result]);

  const resize = useMapResize({
    api,
    configuredSize: result?.options?.size,
    frameRef,
    mapUid: definitionUid,
    onError: setActionError,
    shellRef,
    sourceUids: result?.optionSourceUids?.size,
  });

  const handleMarkerClick = React.useCallback(
    (event) => {
      const currentResult = resultRef.current;
      const featureIndex = featuresByEntityUid(currentResult);
      const entityUids = event.entityUids.filter((entityUid) => featureIndex.has(entityUid));
      const coincidentEntityUids = (event.coincidentEntityUids ?? entityUids).filter(
        (entityUid) => featureIndex.has(entityUid),
      );
      const features = entityUids.map((entityUid) => featureIndex.get(entityUid));
      if (features.length === 0) return;
      clickIdRef.current += 1;
      const context = createMarkerClickContext({
        mapUid: definitionUid,
        clickId: clickIdRef.current,
        entityUids,
        coincidentEntityUids,
        features,
        point: event.point,
        lngLat: event.lngLat,
        clientPoint: event.clientPoint,
        modifiers: event.modifiers,
      });
      const nextMarkerSelection = {
        context,
        component: currentResult?.markerClick ?? null,
      };
      updateSelection({ type: "marker-clicked", markerSelection: nextMarkerSelection });
    },
    [definitionUid],
  );
  const handleListSelect = React.useCallback(
    (entityUid) => {
      const currentResult = resultRef.current;
      const feature = featuresByEntityUid(currentResult).get(entityUid);
      const coordinates = feature?.geometry?.coordinates;
      if (
        !feature ||
        !Array.isArray(coordinates) ||
        !Number.isFinite(coordinates[0]) ||
        !Number.isFinite(coordinates[1])
      ) {
        return;
      }

      const frame = frameRef.current;
      const offset = mapSelectionOffset({
        frameRect: frame?.getBoundingClientRect?.(),
        toolbarRect: frame?.querySelector?.(".rrm-toolbar")?.getBoundingClientRect?.(),
        resultsPanelRect: frame
          ?.querySelector?.(".rrm-results-slot, .rrm-results--overlay")
          ?.getBoundingClientRect?.(),
      });
      updateSelection({ type: "list-item-selected", entityUid });
      runtimeRef.current?.focus?.(coordinates, { offset });
    },
    [],
  );
  const {
    runtime,
    mapError,
    basemapStatus,
    assetDiagnostics,
    clearAssetDiagnostics,
    reportMapError,
  } = useInlineMapRuntime({
    api,
    basemaps,
    containerRef,
    onMarkerClick: handleMarkerClick,
  });
  React.useLayoutEffect(() => {
    runtimeRef.current = runtime;
  }, [runtime]);

  const closeMarkerSelection = React.useCallback((clickId) => {
    updateSelection({ type: "marker-ui-closed", clickId });
  }, []);

  const storeHandleRef = React.useRef(null);
  React.useEffect(() => {
    const handle = registerMapView(viewId, {
      actions: {
        select: handleListSelect,
        openInSidebar: (entityUid) => {
          setActionError(null);
          void api.openEntityInSidebar(entityUid).catch(setActionError);
        },
      },
    });
    storeHandleRef.current = handle;
    return () => {
      storeHandleRef.current = null;
      handle.dispose();
    };
  }, [api, handleListSelect, viewId]);

  const configuredBasemap = result?.options?.basemap ?? DEFAULT_MAP_OPTIONS.basemap;
  const activePreview = preview?.basedOn === configuredBasemap ? preview : null;
  const requestedBasemap = activePreview?.value ?? configuredBasemap;
  const basemapOptions = basemaps.list();

  React.useEffect(() => {
    if (!runtime || !result) return undefined;
    let cancelled = false;
    clearAssetDiagnostics();
    runtime.setData(result.featureCollection);
    runtime.setLayers([]);
    void runtime
      .setAssets(result.assets)
      .then(() => {
        if (!cancelled) runtime.setLayers(result.layers);
      })
      .catch((assetError) => {
        if (!cancelled) reportMapError(assetError);
      });
    if (!hasFitRef.current && result.featureCollection.features.length > 0) {
      hasFitRef.current = true;
      runtime.fit(result.featureCollection, { animate: false });
    }
    return () => {
      cancelled = true;
    };
  }, [clearAssetDiagnostics, reportMapError, result, runtime]);

  React.useEffect(() => {
    runtime?.setBasemap(requestedBasemap);
  }, [basemapRevision, requestedBasemap, runtime]);

  React.useEffect(() => {
    runtime?.setSelectedEntityUid(selectedEntityUid);
  }, [runtime, selectedEntityUid]);

  React.useEffect(() => {
    if (!result) return;
    updateSelection({
      type: "features-refreshed",
      entityUids: new Set(featuresByEntityUid(result).keys()),
    });
  }, [result]);

  const counts = React.useMemo(
    () => result?.counts ?? { sources: 0, mapped: 0, unmapped: 0 },
    [result],
  );
  const resultsRows = React.useMemo(
    () => resultRowsFrom(result, featuresByEntityUid(result)),
    [result],
  );
  React.useEffect(() => {
    storeHandleRef.current?.publish({
      version: RESULTS_LIST_CONTEXT_VERSION,
      mapUid: definitionUid,
      viewId,
      results: resultsRows,
      counts,
      selectedEntityUid,
    });
  }, [counts, definitionUid, resultsRows, selectedEntityUid, viewId]);
  const diagnostics = [...(result?.diagnostics ?? []), ...assetDiagnostics];
  const noteGroups = groupedDiagnostics(diagnostics);
  const togglePanel = (panel) =>
    setOpenPanel((current) => (current === panel ? null : panel));
  const emptyMessage =
    counts.sources === 0
      ? "Add page references, geo URIs, or attributed point blocks beneath this map."
      : counts.mapped === 0
        ? "None of the current sources has a renderable point."
        : null;

  function openEntityInSidebar(entityUid) {
    setActionError(null);
    void api.openEntityInSidebar(entityUid).catch(setActionError);
  }

  const mapShell = (
    <section
      className="rrm-shell"
      data-map-definition-uid={definitionUid}
      data-map-host-uid={hostUid}
      aria-label="Roam Map"
      ref={shellRef}
      style={
        resize.size.maxWidth == null
          ? undefined
          : { maxWidth: `${resize.size.maxWidth}px` }
      }
      onMouseDown={stopRoamMouseDown}
    >
      {basemapStatus.notice ? (
        <div className="rrm-basemap-notice">{basemapStatus.notice}</div>
      ) : null}

      <div
        className="rrm-map-frame"
        ref={frameRef}
        style={
          resize.size.height == null
            ? undefined
            : { height: `${resize.size.height}px` }
        }
      >
        <div className="rrm-map" ref={containerRef} />
        <header className="rrm-toolbar">
          <div
            className="rrm-counts"
            aria-live="polite"
            title={`${counts.sources} sources · ${counts.mapped} mapped · ${counts.unmapped} unmapped`}
          >
            {result ? (
              <>
                <button
                  type="button"
                  className="rrm-count rrm-bar-toggle"
                  aria-expanded={openPanel === "results"}
                  title="Show the list of places on this map"
                  onClick={() => togglePanel("results")}
                >
                  <strong>{counts.mapped}</strong> {counts.mapped === 1 ? "place" : "places"}
                </button>
                {counts.unmapped > 0 ? (
                  <button
                    type="button"
                    className="rrm-count rrm-count--unmapped rrm-bar-toggle"
                    aria-expanded={openPanel === "results"}
                    title="Show the list of places on this map"
                    onClick={() => togglePanel("results")}
                  >
                    <strong>{counts.unmapped}</strong> unmapped
                  </button>
                ) : null}
              </>
            ) : (
              <span className="rrm-count rrm-count--muted">Loading…</span>
            )}
            {noteGroups.length > 0 ? (
              <button
                type="button"
                className="rrm-bar-toggle"
                aria-expanded={openPanel === "notes"}
                onClick={() => togglePanel("notes")}
              >
                {noteGroups.length} {noteGroups.length === 1 ? "note" : "notes"}
              </button>
            ) : null}
          </div>
          <div className="rrm-actions">
            <label
              className={activePreview ? "rrm-basemap rrm-basemap--preview" : "rrm-basemap"}
              title={
                activePreview
                  ? `Previewing ${basemapStatus.name}. This changes the visible map only; use map/basemap beneath the map to save the choice.`
                  : "Basemap. Changing it here previews only; use map/basemap beneath the map to save the choice."
              }
            >
              <span className="rrm-visually-hidden">Basemap</span>
              <select
                aria-label="Preview basemap"
                value={basemapStatus.id}
                onChange={(event) => {
                  const value = event.target.value;
                  setPreview(
                    value === basemaps.describe(configuredBasemap).id
                      ? null
                      : { value, basedOn: configuredBasemap },
                  );
                }}
              >
                {basemapOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
            </label>
            <Button
              minimal
              small
              icon="refresh"
              className={
                phase === "refreshing"
                  ? "rrm-action-refresh rrm-action-refresh--busy"
                  : "rrm-action-refresh"
              }
              aria-label="Refresh map sources"
              title="Refresh map sources"
              disabled={phase === "refreshing"}
              onClick={refresh}
            />
            <Button
              minimal
              small
              icon="zoom-to-fit"
              aria-label="Fit map to current places"
              title="Fit map to current places"
              disabled={counts.mapped === 0}
              onClick={() => runtime?.fit(result?.featureCollection)}
            />
            <ResetMapSizeButton resize={resize} />
          </div>
        </header>
        {openPanel === "results" ? (
          result?.resultsList ? (
            <div className="rrm-results-slot">
              <RoamResultsList
                api={api}
                codeBlockUid={result.resultsList.codeBlockUid}
                context={createResultsListContext({ mapUid: definitionUid, viewId })}
              />
            </div>
          ) : (
            <MapResultsPanel viewId={viewId} className="rrm-results--overlay" />
          )
        ) : null}
        {openPanel === "notes" ? (
          <DiagnosticList groups={noteGroups} onOpenEntity={openEntityInSidebar} />
        ) : null}
        {phase === "loading" ? <div className="rrm-state">Reading map sources…</div> : null}
        {emptyMessage && phase !== "loading" ? <div className="rrm-state">{emptyMessage}</div> : null}
        {markerSelection ? (
          <div className="rrm-marker-click-slot">
            {markerSelection.component ? (
              <RoamMarkerClick
                api={api}
                codeBlockUid={markerSelection.component.codeBlockUid}
                context={markerSelection.context}
              />
            ) : (
              <MarkerPopover
                key={markerSelection.context.clickId}
                context={markerSelection.context}
                onInteraction={(isOpen) => {
                  if (!isOpen) closeMarkerSelection(markerSelection.context.clickId);
                }}
              >
                {({ close }) => (
                  <MarkerCard
                    context={markerSelection.context}
                    onClose={close}
                    openEntityInSidebar={api.openEntityInSidebar}
                  />
                )}
              </MarkerPopover>
            )}
          </div>
        ) : null}
      </div>

      {error ? <div className="rrm-error">Map sources failed: {readableError(error)}</div> : null}
      {mapError ? <div className="rrm-error">Map problem: {readableError(mapError)}</div> : null}
      {actionError ? <div className="rrm-error">Roam action failed: {readableError(actionError)}</div> : null}
      {basemapStatus.error ? (
        <div className="rrm-warning">Basemap setting: {readableError(basemapStatus.error)}</div>
      ) : null}
      {watchFailures.length > 0 ? (
        <div className="rrm-warning">
          Live refresh could not subscribe; use Refresh. {readableError(watchFailures[0].error)}
        </div>
      ) : null}
    </section>
  );

  return (
    <>
      {mapShell}
      <MapResizeHandle resize={resize} />
    </>
  );
}
