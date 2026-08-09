// The stock results list is built from the same exported components that
// graph-authored JSX receives, so custom code can reuse the panel, replace
// individual rows through renderItem, or compose MapResultItem directly.
import {
  getMapViewActions,
  getMapViewSnapshot,
  subscribeMapView,
} from "./map-view-store.js";

const React = window.React;
const { Button } = window.Blueprint.Core;

const noSubscription = () => () => {};

export function MapResultItem({
  result,
  active = false,
  onSelect = null,
  onOpen = null,
  children = null,
}) {
  return (
    <li
      className={active ? "rrm-result rrm-result--active" : "rrm-result"}
      data-rrm-active={active ? "true" : undefined}
    >
      <button
        type="button"
        className="rrm-result-main"
        aria-current={active ? "true" : undefined}
        disabled={!onSelect}
        onClick={onSelect ?? undefined}
      >
        {children ?? (
          <>
            <span className="rrm-result-label">{result?.label ?? "Place"}</span>
            {result?.address ? (
              <span className="rrm-result-meta">{result.address}</span>
            ) : null}
            {result?.description ? (
              <span className="rrm-result-meta rrm-result-description">
                {result.description}
              </span>
            ) : null}
            {result?.mapped ? null : (
              <span className="rrm-result-unmapped">unmapped</span>
            )}
          </>
        )}
      </button>
      {onOpen ? (
        <Button
          minimal
          small
          icon="menu-open"
          className="rrm-result-open"
          aria-label={`Open ${result?.label ?? "this place"} in the right sidebar`}
          title="Open in sidebar"
          onClick={onOpen}
        />
      ) : null}
    </li>
  );
}

export function MapResultsPanel({
  viewId = null,
  context = null,
  className = "",
  header = null,
  renderItem = null,
}) {
  const id = viewId ?? context?.viewId ?? null;
  const subscribe = React.useCallback(
    (listener) => (id ? subscribeMapView(id, listener) : noSubscription()),
    [id],
  );
  const getSnapshot = React.useCallback(
    () => (id ? getMapViewSnapshot(id) : null),
    [id],
  );
  const snapshot = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const actions = id ? getMapViewActions(id) : null;
  const listRef = React.useRef(null);
  const results = snapshot?.results ?? [];
  const selectedEntityUid = snapshot?.selectedEntityUid ?? null;

  React.useEffect(() => {
    const activeRow = listRef.current?.querySelector?.('[data-rrm-active="true"]');
    activeRow?.scrollIntoView?.({ block: "nearest" });
  }, [selectedEntityUid]);

  return (
    <div
      className={["rrm-results", className].filter(Boolean).join(" ")}
      role="region"
      aria-label="Map results"
    >
      {header}
      {!id || results.length === 0 ? (
        <div className="rrm-results-empty">
          {id ? "No places yet." : "This results list is not connected to a map."}
        </div>
      ) : (
        <ol className="rrm-results-list" ref={listRef}>
          {results.map((result) => {
            const active = result.entityUid === selectedEntityUid;
            const select =
              result.mapped && typeof actions?.select === "function"
                ? () => actions.select(result.entityUid)
                : null;
            const open =
              typeof actions?.openInSidebar === "function"
                ? () => actions.openInSidebar(result.entityUid)
                : null;
            return (
              <React.Fragment key={result.entityUid}>
                {renderItem ? (
                  renderItem({ result, active, select, open, MapResultItem })
                ) : (
                  <MapResultItem
                    result={result}
                    active={active}
                    onSelect={select}
                    onOpen={open}
                  />
                )}
              </React.Fragment>
            );
          })}
        </ol>
      )}
    </div>
  );
}
