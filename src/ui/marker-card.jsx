import { FEATURE_PROPERTIES } from "../map/feature-properties.js";

const React = window.React;
const { Button, Card, HTMLSelect } = window.Blueprint.Core;

function readableError(error) {
  return error?.message ?? String(error ?? "Unknown error");
}

function defaultOpenPageInSidebar(pageUid) {
  const sidebar = window.roamAlphaAPI?.ui?.rightSidebar;
  if (typeof sidebar?.addWindow !== "function") {
    return Promise.reject(new Error("Roam's right-sidebar API is unavailable."));
  }
  return Promise.resolve(
    sidebar.addWindow({ window: { type: "outline", "block-uid": pageUid } }),
  );
}

function featureByPageUid(context) {
  return new Map(
    (context?.features ?? [])
      .map((feature) => [feature?.properties?.[FEATURE_PROPERTIES.pageUid], feature])
      .filter(([pageUid]) => pageUid),
  );
}

export function MarkerCardDetails({ feature }) {
  const properties = feature?.properties ?? {};
  return (
    <div className="rrm-marker-card-details">
      <strong>
        {properties[FEATURE_PROPERTIES.label] ??
          properties[FEATURE_PROPERTIES.title] ??
          "Place"}
      </strong>
      {properties[FEATURE_PROPERTIES.address] &&
      properties[FEATURE_PROPERTIES.address] !== "null" ? (
        <span>{properties[FEATURE_PROPERTIES.address]}</span>
      ) : null}
    </div>
  );
}

export function MarkerCardActions({ openInSidebar, actionError }) {
  return (
    <>
      <Button
        intent="primary"
        small
        onClick={openInSidebar}
      >
        Open in sidebar
      </Button>
      {actionError ? (
        <div className="rrm-marker-card-error">
          Roam action failed: {readableError(actionError)}
        </div>
      ) : null}
    </>
  );
}

export function MarkerCard({
  context,
  children = null,
  className = "",
  style = null,
  initialPageUid = context?.pageUid ?? null,
  onPageChange = null,
  onClose = null,
  openPageInSidebar = defaultOpenPageInSidebar,
  showCloseButton = true,
  showPageSelector = true,
  ...cardProps
}) {
  const pageUids = context?.pageUids ?? [];
  const coincidentPageUids = context?.coincidentPageUids ?? pageUids;
  const features = featureByPageUid(context);
  const [selectedPageUid, setSelectedPageUid] = React.useState(initialPageUid);
  const [visible, setVisible] = React.useState(true);
  const [actionError, setActionError] = React.useState(null);
  const activePageUid = coincidentPageUids.includes(selectedPageUid)
    ? selectedPageUid
    : coincidentPageUids[0] ?? null;
  const feature = features.get(activePageUid) ?? context?.feature ?? null;
  const properties = feature?.properties ?? null;

  if (!visible || !activePageUid || !properties) return null;

  function close() {
    if (typeof onClose === "function") onClose();
    else setVisible(false);
  }

  function selectPage(pageUid) {
    setSelectedPageUid(pageUid);
    onPageChange?.({ pageUid, feature: features.get(pageUid) ?? null });
  }

  function openInSidebar() {
    setActionError(null);
    return Promise.resolve()
      .then(() => openPageInSidebar(activePageUid))
      .then(() => true)
      .catch((error) => {
        setActionError(error);
        return false;
      });
  }

  const card = {
    context,
    pageUid: activePageUid,
    pageUids,
    coincidentPageUids,
    feature,
    features: context?.features ?? [],
    close,
    openInSidebar,
    actionError,
  };
  const label =
    properties[FEATURE_PROPERTIES.label] ??
    properties[FEATURE_PROPERTIES.title] ??
    "Place";
  const content =
    typeof children === "function" ? (
      children(card)
    ) : children == null ? (
      <>
        <MarkerCardDetails {...card} />
        <MarkerCardActions {...card} />
      </>
    ) : (
      children
    );
  const canChoosePage = showPageSelector && coincidentPageUids.length > 1;
  const closeButton = showCloseButton ? (
    <Button
      className={[
        "rrm-selection-close",
        canChoosePage ? "" : "rrm-selection-close--floating",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label="Close selected place"
      icon="cross"
      minimal
      small
      onClick={close}
    />
  ) : null;

  return (
    <Card
      {...cardProps}
      className={[
        "rrm-selection",
        showCloseButton && !canChoosePage ? "rrm-selection--floating-close" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      elevation={cardProps.elevation ?? 2}
      style={style ?? undefined}
      role={cardProps.role ?? "dialog"}
      aria-label={cardProps["aria-label"] ?? `${label} map marker`}
      aria-live={cardProps["aria-live"] ?? "polite"}
    >
      {canChoosePage ? (
        <div className="rrm-marker-card-controls">
          <HTMLSelect
            className="rrm-marker-page-select"
            aria-label="Selected place"
            fill
            value={activePageUid}
            onChange={(event) => selectPage(event.target.value)}
          >
            {coincidentPageUids.map((pageUid) => {
              const option = features.get(pageUid)?.properties ?? {};
              return (
                <option key={pageUid} value={pageUid}>
                  {option[FEATURE_PROPERTIES.label] ??
                    option[FEATURE_PROPERTIES.title] ??
                    "Place"}
                </option>
              );
            })}
          </HTMLSelect>
          {closeButton}
        </div>
      ) : (
        closeButton
      )}
      {content}
    </Card>
  );
}

export const __test = { defaultOpenPageInSidebar, featureByPageUid };
