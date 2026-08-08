import { DEFAULT_MAP_OPTIONS } from "../map/options.js";
import { FEATURE_PROPERTIES } from "../map/feature-properties.js";
import { createLiveMapSession } from "../map/live-session.js";
import { createImageAssetLoader } from "../maplibre/image-assets.js";
import { createInlineMapRuntime } from "../maplibre/runtime.js";
import { safeBasemapError } from "../settings/basemap-registry.js";

const React = window.React;

function stopRoamMouseDown(event) {
  event.stopPropagation();
}

function readableError(error) {
  return error?.message ?? String(error ?? "Unknown error");
}

function Count({ label, value }) {
  return (
    <span className="rrm-count">
      <strong>{value}</strong> {label}
    </span>
  );
}

function DiagnosticList({ diagnostics, onOpenPage }) {
  if (diagnostics.length === 0) return null;
  return (
    <details className="rrm-diagnostics" onMouseDown={stopRoamMouseDown}>
      <summary>
        {diagnostics.length} {diagnostics.length === 1 ? "note" : "notes"}
      </summary>
      <ul>
        {diagnostics.map((diagnostic) => (
          <li key={diagnostic.key}>
            <span>{diagnostic.message}</span>
            {diagnostic.detail ? <code>{diagnostic.detail}</code> : null}
            {diagnostic.pageUid ? (
              <button
                type="button"
                className="bp3-button bp3-minimal bp3-small"
                onClick={() => onOpenPage(diagnostic.pageUid)}
              >
                Open page
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </details>
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

function useInlineMapRuntime({ api, basemaps, containerRef, onSelect }) {
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
        onSelect,
        onError: setMapError,
        onBasemap: setBasemapStatus,
        onAssetError: ({ asset, error }) => {
          setAssetDiagnostics((current) => [
            ...current.filter(({ key }) => key !== `asset.load-failed:${asset.id}`),
            {
              key: `asset.load-failed:${asset.id}`,
              code: "asset.load-failed",
              severity: "warning",
              pageUid: asset.pageUid,
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
  }, [api.getFile, basemaps, containerRef, onSelect]);

  return {
    runtime,
    mapError,
    basemapStatus,
    assetDiagnostics,
    clearAssetDiagnostics,
    reportMapError,
  };
}

function featuresByPageUid(result) {
  return new Map(
    (result?.featureCollection?.features ?? [])
      .map((feature) => [feature.properties?.[FEATURE_PROPERTIES.pageUid], feature])
      .filter(([pageUid]) => pageUid),
  );
}

export function MapView({ definitionUid, hostUid, api, basemaps, compiler }) {
  const containerRef = React.useRef(null);
  const hasFitRef = React.useRef(false);
  const [preview, setPreview] = React.useState(null);
  const [selection, setSelection] = React.useState(null);
  const [actionError, setActionError] = React.useState(null);
  const basemapRevision = useBasemapRevision(basemaps);
  const { result, phase, error, watchFailures, refresh } = useLiveMap({
    api,
    compiler,
    definitionUid,
  });
  const handleSelect = React.useCallback(
    (pageUids) => setSelection({ pageUids, activeUid: pageUids[0] }),
    [],
  );
  const {
    runtime,
    mapError,
    basemapStatus,
    assetDiagnostics,
    clearAssetDiagnostics,
    reportMapError,
  } = useInlineMapRuntime({ api, basemaps, containerRef, onSelect: handleSelect });

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

  const featureIndex = featuresByPageUid(result);
  const selectedPageUids = (selection?.pageUids ?? []).filter((uid) => featureIndex.has(uid));
  const activePageUid = selectedPageUids.includes(selection?.activeUid)
    ? selection.activeUid
    : selectedPageUids[0] ?? null;
  const selectedFeature = activePageUid ? featureIndex.get(activePageUid) : null;
  const selectedProperties = selectedFeature?.properties ?? null;
  const counts = result?.counts ?? { sources: 0, mapped: 0, unmapped: 0 };
  const diagnostics = [...(result?.diagnostics ?? []), ...assetDiagnostics];
  const emptyMessage =
    counts.sources === 0
      ? "Add child blocks containing page references to map places."
      : counts.mapped === 0
        ? "None of the current sources has a renderable point."
        : null;

  function openPage(pageUid) {
    setActionError(null);
    void api.openPage(pageUid).catch(setActionError);
  }

  return (
    <section
      className="rrm-shell"
      data-map-definition-uid={definitionUid}
      data-map-host-uid={hostUid}
      aria-label="Roam Map"
      onMouseDown={stopRoamMouseDown}
    >
      <header className="rrm-toolbar">
        <div className="rrm-counts" aria-live="polite">
          <Count label="sources" value={counts.sources} />
          <Count label="mapped" value={counts.mapped} />
          <Count label="unmapped" value={counts.unmapped} />
          <label
            className="rrm-basemap"
            title="This changes the visible map only. Use map/basemap beneath the map to save the choice."
          >
            <span className="rrm-visually-hidden">Basemap</span>
            <select
              aria-label="Preview basemap"
              value={basemapStatus.id}
              onChange={(event) =>
                setPreview({ value: event.target.value, basedOn: configuredBasemap })
              }
            >
              {basemapOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
          </label>
          {phase === "refreshing" ? <span className="rrm-refreshing">Refreshing…</span> : null}
        </div>
        <div className="rrm-actions">
          <button
            type="button"
            className="bp3-button bp3-minimal bp3-small"
            aria-label="Refresh map sources"
            onClick={refresh}
          >
            Refresh
          </button>
          <button
            type="button"
            className="bp3-button bp3-minimal bp3-small"
            aria-label="Fit map to current results"
            disabled={counts.mapped === 0}
            onClick={() => runtime?.fit(result?.featureCollection)}
          >
            Fit
          </button>
          {activePreview ? (
            <button
              type="button"
              className="bp3-button bp3-minimal bp3-small"
              aria-label="Use the basemap saved in this map"
              title="Return to the map/basemap value"
              onClick={() => setPreview(null)}
            >
              Reset view
            </button>
          ) : null}
        </div>
      </header>

      {basemapStatus.notice ? (
        <div className="rrm-basemap-notice">{basemapStatus.notice}</div>
      ) : null}

      <div className="rrm-map-frame">
        <div className="rrm-map" ref={containerRef} />
        {phase === "loading" ? <div className="rrm-state">Reading map sources…</div> : null}
        {emptyMessage && phase !== "loading" ? <div className="rrm-state">{emptyMessage}</div> : null}
        {selectedProperties ? (
          <aside className="rrm-selection" aria-live="polite">
            <button
              type="button"
              className="rrm-selection-close"
              aria-label="Close selected place"
              onClick={() => setSelection(null)}
            >
              ×
            </button>
            {selectedPageUids.length > 1 ? (
              <select
                aria-label="Selected place"
                value={activePageUid}
                onChange={(event) =>
                  setSelection((current) => ({ ...current, activeUid: event.target.value }))
                }
              >
                {selectedPageUids.map((pageUid) => {
                  const properties = featureIndex.get(pageUid).properties;
                  return (
                    <option key={pageUid} value={pageUid}>
                      {properties[FEATURE_PROPERTIES.label] ??
                        properties[FEATURE_PROPERTIES.title] ??
                        "Place"}
                    </option>
                  );
                })}
              </select>
            ) : null}
            <strong>
              {selectedProperties[FEATURE_PROPERTIES.label] ??
                selectedProperties[FEATURE_PROPERTIES.title] ??
                "Place"}
            </strong>
            {selectedProperties[FEATURE_PROPERTIES.address] &&
            selectedProperties[FEATURE_PROPERTIES.address] !== "null" ? (
              <span>{selectedProperties[FEATURE_PROPERTIES.address]}</span>
            ) : null}
            <button
              type="button"
              className="bp3-button bp3-small bp3-intent-primary"
              onClick={() => openPage(activePageUid)}
            >
              Open page
            </button>
          </aside>
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
      <DiagnosticList diagnostics={diagnostics} onOpenPage={openPage} />
    </section>
  );
}
