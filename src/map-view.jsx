import { createLiveMapSession } from "./live-map-session.js";
import { createImageAssetLoader } from "./image-assets.js";
import { createBasemapRegistry, safeBasemapError } from "./basemaps.js";
import { FEATURE_PROPERTIES } from "./map-contract.js";
import { createInlineMapRuntime } from "./map-runtime.js";

const React = window.React;
const BUILT_IN_BASEMAPS = createBasemapRegistry();

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

function DiagnosticList({ diagnostics, api }) {
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
                onClick={() => void api.openPage(diagnostic.pageUid)}
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

export function MapView({
  definitionUid,
  hostUid,
  mountId,
  api,
  basemaps = BUILT_IN_BASEMAPS,
  compiler,
}) {
  const containerRef = React.useRef(null);
  const mapRuntimeRef = React.useRef(null);
  const sessionRef = React.useRef(null);
  const hasFitRef = React.useRef(false);
  const [result, setResult] = React.useState(null);
  const [phase, setPhase] = React.useState("loading");
  const [error, setError] = React.useState(null);
  const [mapError, setMapError] = React.useState(null);
  const [basemapStatus, setBasemapStatus] = React.useState(() =>
    basemaps.describe("streets"),
  );
  const [basemapOverride, setBasemapOverride] = React.useState(null);
  const [basemapRevision, setBasemapRevision] = React.useState(basemaps.revision);
  const [assetDiagnostics, setAssetDiagnostics] = React.useState([]);
  const [selected, setSelected] = React.useState(null);
  const [watchWarning, setWatchWarning] = React.useState(null);
  const configuredBasemap = result?.presentation?.basemap ?? "streets";
  const requestedBasemap = basemapOverride ?? configuredBasemap;
  const basemapOptions = React.useMemo(
    () => basemaps.list(),
    [basemaps, basemapRevision],
  );

  React.useEffect(
    () => basemaps.subscribe((revision) => setBasemapRevision(revision)),
    [basemaps],
  );

  const previousConfiguredBasemap = React.useRef(configuredBasemap);
  React.useEffect(() => {
    if (previousConfiguredBasemap.current !== configuredBasemap) {
      previousConfiguredBasemap.current = configuredBasemap;
      setBasemapOverride(null);
    }
  }, [configuredBasemap]);

  React.useEffect(() => {
    if (!containerRef.current) return undefined;
    let resizeObserver = null;
    try {
      const runtime = createInlineMapRuntime({
        container: containerRef.current,
        loadAsset: createImageAssetLoader({ getFile: api.getFile }),
        resolveBasemap: (reference) => basemaps.resolve(reference),
        onFeature: setSelected,
        onError: setMapError,
        onBasemap: setBasemapStatus,
        onAssetError: ({ asset, error: assetError }) => {
          setAssetDiagnostics((current) => [
            ...current.filter(({ key }) => key !== `asset.load-failed:${asset.id}`),
            {
              key: `asset.load-failed:${asset.id}`,
              code: "asset.load-failed",
              severity: "warning",
              pageUid: asset.pageUid,
              field: asset.attributeTitle,
              message: `${asset.attributeTitle} could not be loaded as a map image: ${readableError(assetError)}`,
            },
          ]);
        },
        onLoad: () => setMapError(null),
      });
      mapRuntimeRef.current = runtime;
      if (typeof window.ResizeObserver === "function") {
        resizeObserver = new window.ResizeObserver(() => runtime.resize());
        resizeObserver.observe(containerRef.current);
      }
    } catch (runtimeError) {
      setMapError(safeBasemapError(runtimeError));
    }
    return () => {
      resizeObserver?.disconnect();
      mapRuntimeRef.current?.remove();
      mapRuntimeRef.current = null;
    };
  }, [api.getFile, basemaps, mountId]);

  React.useEffect(() => {
    const session = createLiveMapSession({
      api,
      mapUid: definitionUid,
      compile: (uid) => compiler.compile(uid),
      onState: (event) => {
        if (event.type === "loading") {
          setPhase("loading");
          setError(null);
        } else if (event.type === "refreshing") {
          setPhase("refreshing");
        } else if (event.type === "result") {
          setResult(event.result);
          setPhase("ready");
          setError(null);
        } else if (event.type === "error") {
          setPhase("error");
          setError(event.error);
        } else if (event.type === "watch-error") {
          setWatchWarning(event.error);
        }
      },
    });
    sessionRef.current = session;
    void session.start();
    return () => {
      sessionRef.current = null;
      void session.stop().catch((stopError) => {
        console.warn("[roam-map] session cleanup failed", stopError);
      });
    };
  }, [api, compiler, definitionUid]);

  React.useEffect(() => {
    if (!result) return;
    let cancelled = false;
    const runtime = mapRuntimeRef.current;
    setAssetDiagnostics([]);
    runtime?.setData(result.featureCollection);
    runtime?.setLayers([]);
    void runtime?.setAssets(result.assets).then(() => {
      if (!cancelled && mapRuntimeRef.current === runtime) runtime?.setLayers(result.layers);
    });
    if (!hasFitRef.current && result.featureCollection.features.length > 0) {
      hasFitRef.current = true;
      runtime?.fit(result.featureCollection, { animate: false });
    }
    return () => {
      cancelled = true;
    };
  }, [result]);

  React.useEffect(() => {
    if (!result) return;
    mapRuntimeRef.current?.setPresentation({
      ...result.presentation,
      basemap: requestedBasemap,
    });
  }, [basemapRevision, requestedBasemap, result]);

  React.useEffect(() => {
    if (
      selected?.pageUid &&
      result &&
      !result.featureCollection.features.some(
        (feature) =>
          feature.properties?.[FEATURE_PROPERTIES.pageUid] === selected.pageUid,
      )
    ) {
      setSelected(null);
    }
  }, [result, selected?.pageUid]);

  const counts = result?.counts ?? { sources: 0, mapped: 0, unmapped: 0 };
  const diagnostics = [...(result?.diagnostics ?? []), ...assetDiagnostics];
  const emptyMessage =
    counts.sources === 0
      ? "Add child blocks containing page references to map places."
      : counts.mapped === 0
        ? "None of the current sources has a renderable point."
        : null;

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
              onChange={(event) => setBasemapOverride(event.target.value)}
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
            onClick={() => void sessionRef.current?.refresh("manual")}
          >
            Refresh
          </button>
          <button
            type="button"
            className="bp3-button bp3-minimal bp3-small"
            aria-label="Fit map to current results"
            disabled={counts.mapped === 0}
            onClick={() => mapRuntimeRef.current?.fit(result?.featureCollection)}
          >
            Fit
          </button>
          {basemapOverride ? (
            <button
              type="button"
              className="bp3-button bp3-minimal bp3-small"
              aria-label="Use the basemap saved in this map"
              title="Return to the map/basemap value"
              onClick={() => setBasemapOverride(null)}
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
        {selected ? (
          <aside className="rrm-selection" aria-live="polite">
            <button
              type="button"
              className="rrm-selection-close"
              aria-label="Close selected place"
              onClick={() => setSelected(null)}
            >
              ×
            </button>
            <strong>{selected.label}</strong>
            {selected.address && selected.address !== "null" ? <span>{selected.address}</span> : null}
            <button
              type="button"
              className="bp3-button bp3-small bp3-intent-primary"
              disabled={!selected.pageUid}
              onClick={() => selected.pageUid && void api.openPage(selected.pageUid)}
            >
              Open page
            </button>
          </aside>
        ) : null}
      </div>

      {error ? <div className="rrm-error">Map sources failed: {readableError(error)}</div> : null}
      {mapError ? <div className="rrm-error">Map problem: {readableError(mapError)}</div> : null}
      {basemapStatus.error ? (
        <div className="rrm-warning">Basemap setting: {readableError(basemapStatus.error)}</div>
      ) : null}
      {watchWarning ? (
        <div className="rrm-warning">
          Live refresh could not subscribe; use Refresh. {readableError(watchWarning)}
        </div>
      ) : null}
      <DiagnosticList diagnostics={diagnostics} api={api} />
    </section>
  );
}
