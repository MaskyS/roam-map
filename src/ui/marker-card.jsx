import { FEATURE_PROPERTIES } from "../map/feature-properties.js";

const React = window.React;
const { Button, Card, HTMLSelect } = window.Blueprint.Core;

function readableError(error) {
  return error?.message ?? String(error ?? "Unknown error");
}

function defaultOpenEntityInSidebar(entityUid) {
  const sidebar = window.roamAlphaAPI?.ui?.rightSidebar;
  if (typeof sidebar?.addWindow !== "function") {
    return Promise.reject(new Error("Roam's right-sidebar API is unavailable."));
  }
  return Promise.resolve(
    sidebar.addWindow({ window: { type: "outline", "block-uid": entityUid } }),
  );
}

function featureByEntityUid(context) {
  return new Map(
    (context?.features ?? [])
      .map((feature) => [feature?.properties?.[FEATURE_PROPERTIES.entityUid], feature])
      .filter(([entityUid]) => entityUid),
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
  initialEntityUid = context?.entityUid ?? null,
  onEntityChange = null,
  onClose = null,
  openEntityInSidebar = defaultOpenEntityInSidebar,
  showCloseButton = true,
  showEntitySelector = true,
  ...cardProps
}) {
  const entityUids = context?.entityUids ?? [];
  const coincidentEntityUids = context?.coincidentEntityUids ?? entityUids;
  const features = featureByEntityUid(context);
  const [selectedEntityUid, setSelectedEntityUid] = React.useState(initialEntityUid);
  const [visible, setVisible] = React.useState(true);
  const [actionError, setActionError] = React.useState(null);
  const activeEntityUid = coincidentEntityUids.includes(selectedEntityUid)
    ? selectedEntityUid
    : coincidentEntityUids[0] ?? null;
  const feature = features.get(activeEntityUid) ?? context?.feature ?? null;
  const properties = feature?.properties ?? null;

  if (!visible || !activeEntityUid || !properties) return null;

  function close() {
    if (typeof onClose === "function") onClose();
    else setVisible(false);
  }

  function selectEntity(entityUid) {
    setSelectedEntityUid(entityUid);
    onEntityChange?.({ entityUid, feature: features.get(entityUid) ?? null });
  }

  function openInSidebar() {
    setActionError(null);
    return Promise.resolve()
      .then(() => openEntityInSidebar(activeEntityUid))
      .then(() => true)
      .catch((error) => {
        setActionError(error);
        return false;
      });
  }

  const card = {
    context,
    entityUid: activeEntityUid,
    identityKind: properties[FEATURE_PROPERTIES.identityKind] ?? null,
    entityUids,
    coincidentEntityUids,
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
  const canChooseEntity = showEntitySelector && coincidentEntityUids.length > 1;
  const closeButton = showCloseButton ? (
    <Button
      className={[
        "rrm-selection-close",
        canChooseEntity ? "" : "rrm-selection-close--floating",
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
        showCloseButton && !canChooseEntity ? "rrm-selection--floating-close" : "",
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
      {canChooseEntity ? (
        <div className="rrm-marker-card-controls">
          <HTMLSelect
            className="rrm-marker-entity-select"
            aria-label="Selected place"
            fill
            value={activeEntityUid}
            onChange={(event) => selectEntity(event.target.value)}
          >
            {coincidentEntityUids.map((entityUid) => {
              const option = features.get(entityUid)?.properties ?? {};
              return (
                <option key={entityUid} value={entityUid}>
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

export const __test = { defaultOpenEntityInSidebar, featureByEntityUid };
