import { CUSTOM_BASEMAP_KINDS } from "./basemap-registry.js";

const React = window.React;
const {
  Button,
  Callout,
  Card,
  Collapse,
  FormGroup,
  HTMLSelect,
  InputGroup,
  Tag,
  TextArea,
} = window.Blueprint.Core;

function blankCustomBasemap(kind = CUSTOM_BASEMAP_KINDS.style) {
  return {
    name: "",
    kind,
    url: "",
    attribution: "",
    tileSize: 256,
    minZoom: 0,
    maxZoom: 22,
    scheme: "xyz",
    notice: "",
  };
}

function customKindLabel(kind) {
  return kind === CUSTOM_BASEMAP_KINDS.raster
    ? "Raster tiles"
    : "MapLibre style";
}

function statusIntent(kind) {
  if (kind === "error") return "danger";
  if (kind === "success") return "success";
  return "warning";
}

function statusIcon(kind) {
  if (kind === "error") return "error";
  if (kind === "success") return "tick-circle";
  return "warning-sign";
}

function SettingsStatus({ status }) {
  if (!status) return null;
  return (
    <Callout
      className="rrm-settings-message"
      intent={statusIntent(status.kind)}
      icon={statusIcon(status.kind)}
      aria-live="polite"
    >
      {status.message}
    </Callout>
  );
}

function UsageHint({ name }) {
  const settingName = name.trim();
  if (!settingName) return null;
  return (
    <div className="rrm-basemap-usage">
      <span>Use in a map</span>
      <code>map/basemap:: {settingName}</code>
    </div>
  );
}

function CustomBasemapList({ basemaps, disabled, onEdit, onRemove, saving }) {
  if (basemaps.length === 0) {
    return (
      <p className="rrm-settings-muted">
        None configured. The built-in OpenFreeMap and EOX styles remain available.
      </p>
    );
  }

  return (
    <ul className="rrm-custom-basemap-list">
      {basemaps.map((configuration) => (
        <li key={configuration.id}>
          <div className="rrm-custom-basemap-summary">
            <strong>{configuration.name}</strong>
            <Tag minimal>{customKindLabel(configuration.kind)}</Tag>
          </div>
          <div className="rrm-settings-actions">
            <Button
              icon="edit"
              minimal
              small
              disabled={disabled || saving != null}
              onClick={() => onEdit(configuration)}
            >
              Edit
            </Button>
            <Button
              icon="trash"
              intent="danger"
              minimal
              small
              disabled={disabled || saving != null}
              loading={saving === `remove:${configuration.id}`}
              onClick={() => void onRemove(configuration)}
            >
              Remove
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}

function CustomBasemapForm({
  draft,
  disabled,
  editing,
  saving,
  onCancel,
  onChange,
  onSave,
}) {
  function setField(field, value) {
    onChange((current) => ({ ...current, [field]: value }));
  }

  function changeKind(kind) {
    onChange((current) => ({
      ...blankCustomBasemap(kind),
      name: current.name,
      notice: current.notice,
    }));
  }

  function submit(event) {
    event.preventDefault();
    void onSave();
  }

  const raster = draft.kind === CUSTOM_BASEMAP_KINDS.raster;

  return (
    <Card className="rrm-basemap-editor" elevation={0}>
      <form onSubmit={submit}>
        <h4>{editing ? "Edit basemap" : "New basemap"}</h4>

        <div className="rrm-basemap-form-grid">
          <FormGroup label="Name" labelFor="rrm-basemap-name">
            <InputGroup
              id="rrm-basemap-name"
              fill
              value={draft.name}
              placeholder="MapLibre Demo"
              maxLength={80}
              onChange={(event) => setField("name", event.target.value)}
            />
          </FormGroup>

          <FormGroup label="Format" labelFor="rrm-basemap-kind">
            <HTMLSelect
              id="rrm-basemap-kind"
              fill
              value={draft.kind}
              onChange={(event) => changeKind(event.target.value)}
            >
              <option value={CUSTOM_BASEMAP_KINDS.style}>MapLibre style URL</option>
              <option value={CUSTOM_BASEMAP_KINDS.raster}>Raster tile template</option>
            </HTMLSelect>
          </FormGroup>

          <FormGroup
            className="rrm-basemap-field-wide"
            label={raster ? "Tile URL" : "Style URL"}
            labelFor="rrm-basemap-url"
          >
            <InputGroup
              id="rrm-basemap-url"
              fill
              type="url"
              value={draft.url}
              placeholder={
                raster
                  ? "https://tiles.example.com/{z}/{x}/{y}.png"
                  : "https://demotiles.maplibre.org/style.json"
              }
              onChange={(event) => setField("url", event.target.value)}
            />
          </FormGroup>

          {raster ? (
            <>
              <FormGroup
                className="rrm-basemap-field-wide"
                label="Attribution"
                labelFor="rrm-basemap-attribution"
              >
                <TextArea
                  id="rrm-basemap-attribution"
                  fill
                  growVertically
                  rows={2}
                  value={draft.attribution}
                  placeholder="© Provider · © OpenStreetMap contributors"
                  onChange={(event) => setField("attribution", event.target.value)}
                />
              </FormGroup>

              <FormGroup label="Tile size" labelFor="rrm-basemap-tile-size">
                <HTMLSelect
                  id="rrm-basemap-tile-size"
                  fill
                  value={draft.tileSize}
                  onChange={(event) => setField("tileSize", Number(event.target.value))}
                >
                  <option value={256}>256 px</option>
                  <option value={512}>512 px</option>
                </HTMLSelect>
              </FormGroup>

              <FormGroup label="Tile scheme" labelFor="rrm-basemap-scheme">
                <HTMLSelect
                  id="rrm-basemap-scheme"
                  fill
                  value={draft.scheme}
                  onChange={(event) => setField("scheme", event.target.value)}
                >
                  <option value="xyz">XYZ</option>
                  <option value="tms">TMS</option>
                </HTMLSelect>
              </FormGroup>

              <FormGroup label="Minimum zoom" labelFor="rrm-basemap-min-zoom">
                <InputGroup
                  id="rrm-basemap-min-zoom"
                  fill
                  type="number"
                  min={0}
                  max={24}
                  step={1}
                  value={draft.minZoom}
                  onChange={(event) => setField("minZoom", event.target.value)}
                />
              </FormGroup>

              <FormGroup label="Maximum zoom" labelFor="rrm-basemap-max-zoom">
                <InputGroup
                  id="rrm-basemap-max-zoom"
                  fill
                  type="number"
                  min={0}
                  max={24}
                  step={1}
                  value={draft.maxZoom}
                  onChange={(event) => setField("maxZoom", event.target.value)}
                />
              </FormGroup>
            </>
          ) : null}

          <FormGroup
            className="rrm-basemap-field-wide"
            label="Notice (optional)"
            labelFor="rrm-basemap-notice"
          >
            <InputGroup
              id="rrm-basemap-notice"
              fill
              value={draft.notice}
              placeholder="Usage or freshness note shown above the map"
              onChange={(event) => setField("notice", event.target.value)}
            />
          </FormGroup>
        </div>

        <UsageHint name={draft.name} />

        <div className="rrm-settings-actions">
          <Button
            type="submit"
            intent="primary"
            disabled={disabled || saving != null}
            loading={saving === "custom"}
          >
            {editing ? "Save changes" : "Add basemap"}
          </Button>
          <Button
            type="button"
            minimal
            disabled={saving != null}
            onClick={onCancel}
          >
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}

function MapTilerShortcut({
  configuration,
  disabled,
  draft,
  open,
  saving,
  onChange,
  onClear,
  onSave,
  onToggle,
}) {
  return (
    <section className="rrm-basemap-section rrm-basemap-section-secondary">
      <div className="rrm-basemap-section-header">
        <div>
          <div className="rrm-basemap-heading-line">
            <h3>MapTiler shortcut</h3>
            {configuration ? <Tag intent="success">Configured</Tag> : null}
          </div>
          <p>Adds Satellite and Hybrid from one public browser key.</p>
        </div>
        <Button
          minimal
          small
          rightIcon={open ? "chevron-up" : "chevron-down"}
          aria-expanded={open}
          onClick={onToggle}
        >
          {open ? "Hide" : configuration ? "Edit key" : "Configure"}
        </Button>
      </div>

      <Collapse isOpen={open}>
        <Card className="rrm-maptiler-editor" elevation={0}>
          <p>
            The key syncs with this graph and appears in browser requests. Use a
            provider-restricted public key, not a secret. See MapTiler&apos;s{" "}
            <a
              href="https://docs.maptiler.com/cloud/api/authentication-key/"
              target="_blank"
              rel="noreferrer"
            >
              key-protection guide
            </a>
            .
          </p>
          <FormGroup label="Public browser key" labelFor="rrm-maptiler-key">
            <InputGroup
              id="rrm-maptiler-key"
              fill
              type="password"
              value={draft.apiKey}
              placeholder="Paste a protected MapTiler key"
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => onChange({ apiKey: event.target.value })}
            />
          </FormGroup>
          <div className="rrm-settings-actions">
            <Button
              intent="primary"
              disabled={disabled || saving != null || !draft.apiKey.trim()}
              loading={saving === "maptiler"}
              onClick={() => void onSave()}
            >
              {configuration ? "Update key" : "Save key"}
            </Button>
            {configuration ? (
              <Button
                intent="danger"
                minimal
                disabled={disabled || saving != null}
                onClick={() => void onClear()}
              >
                Remove key
              </Button>
            ) : null}
          </div>
        </Card>
      </Collapse>
    </section>
  );
}

export function BasemapSettingsEditor({ registry }) {
  React.useSyncExternalStore(
    registry.subscribe,
    registry.getSnapshot,
    registry.getSnapshot,
  );

  const savedMapTiler = registry.getProviderConfiguration("maptiler");
  const customBasemaps = registry.listCustomBasemaps();
  const [mapTilerDraft, setMapTilerDraft] = React.useState(null);
  const mapTiler = mapTilerDraft ?? savedMapTiler ?? { apiKey: "" };
  const [mapTilerOpen, setMapTilerOpen] = React.useState(() => savedMapTiler != null);
  const [editingId, setEditingId] = React.useState(null);
  const [customEditorOpen, setCustomEditorOpen] = React.useState(
    () => customBasemaps.length === 0,
  );
  const [customDraft, setCustomDraft] = React.useState(() => blankCustomBasemap());
  const [status, setStatus] = React.useState(() => {
    const warnings = registry.getWarnings();
    return warnings.length > 0 ? { kind: "warning", message: warnings.join(" ") } : null;
  });
  const [saving, setSaving] = React.useState(null);
  const readOnly = !registry.canSet;

  function closeCustomEditor() {
    setEditingId(null);
    setCustomDraft(blankCustomBasemap());
    setCustomEditorOpen(false);
  }

  function startCustomBasemap() {
    setEditingId(null);
    setCustomDraft(blankCustomBasemap());
    setCustomEditorOpen(true);
    setStatus(null);
  }

  async function run(key, action, successMessage) {
    setSaving(key);
    setStatus(null);
    try {
      await action();
      setStatus({ kind: "success", message: successMessage });
      return true;
    } catch (error) {
      setStatus({ kind: "error", message: error?.message ?? String(error) });
      return false;
    } finally {
      setSaving(null);
    }
  }

  async function saveCustomBasemap() {
    const saved = await run(
      "custom",
      () => registry.replaceCustomBasemap(editingId, customDraft),
      editingId
        ? `Updated “${customDraft.name.trim() || "custom basemap"}”.`
        : `Added “${customDraft.name.trim() || "custom basemap"}” to this graph.`,
    );
    if (saved) closeCustomEditor();
  }

  function editCustomBasemap(configuration) {
    setEditingId(configuration.id);
    setCustomDraft({ ...blankCustomBasemap(configuration.kind), ...configuration });
    setCustomEditorOpen(true);
    setStatus(null);
  }

  async function removeCustomBasemap(configuration) {
    const confirmed =
      typeof window.confirm === "function" &&
      window.confirm(
        `Remove “${configuration.name}” from the Roam Map basemap catalog? Maps using that name will fall back to OpenFreeMap Liberty.`,
      );
    if (!confirmed) return;
    const removed = await run(
      `remove:${configuration.id}`,
      () => registry.removeCustomBasemap(configuration.id),
      `Removed “${configuration.name}” from this graph.`,
    );
    if (!removed) return;
    if (editingId === configuration.id) closeCustomEditor();
    if (registry.listCustomBasemaps().length === 0) startCustomBasemap();
  }

  async function saveMapTiler() {
    const saved = await run(
      "maptiler",
      () => registry.replaceProviderConfiguration("maptiler", mapTiler),
      "MapTiler Satellite and Hybrid are available in this graph.",
    );
    if (saved) {
      setMapTilerDraft(null);
      setMapTilerOpen(false);
    }
  }

  async function clearMapTiler() {
    const cleared = await run(
      "maptiler",
      () => registry.replaceProviderConfiguration("maptiler", null),
      "Removed the MapTiler shortcut from this graph.",
    );
    if (cleared) {
      setMapTilerDraft(null);
      setMapTilerOpen(false);
    }
  }

  return (
    <div className="rrm-basemap-settings">
      <Callout className="rrm-basemap-intro" icon="info-sign">
        Add a style or tile service once, then select its name with{" "}
        <code>map/basemap:: Name</code>. Catalog settings sync with this graph; URLs and
        browser keys are public client-side configuration.
      </Callout>

      {readOnly ? (
        <Callout intent="warning" icon="lock">
          {registry.writeBlockReason}
        </Callout>
      ) : null}
      <SettingsStatus status={status} />

      <section className="rrm-basemap-section">
        <div className="rrm-basemap-section-header">
          <div>
            <h3>Custom basemaps</h3>
            <p>Add a complete MapLibre style URL or an attributed raster service.</p>
          </div>
          {!customEditorOpen ? (
            <Button
              icon="add"
              intent="primary"
              small
              disabled={readOnly || saving != null}
              onClick={startCustomBasemap}
            >
              Add basemap
            </Button>
          ) : null}
        </div>

        <CustomBasemapList
          basemaps={customBasemaps}
          disabled={readOnly}
          saving={saving}
          onEdit={editCustomBasemap}
          onRemove={removeCustomBasemap}
        />

        {customEditorOpen ? (
          <CustomBasemapForm
            draft={customDraft}
            disabled={readOnly}
            editing={editingId != null}
            saving={saving}
            onCancel={closeCustomEditor}
            onChange={setCustomDraft}
            onSave={saveCustomBasemap}
          />
        ) : null}
      </section>

      <MapTilerShortcut
        configuration={savedMapTiler}
        disabled={readOnly}
        draft={mapTiler}
        open={mapTilerOpen}
        saving={saving}
        onChange={(next) => {
          setMapTilerDraft(next);
          setStatus(null);
        }}
        onClear={clearMapTiler}
        onSave={saveMapTiler}
        onToggle={() => setMapTilerOpen((current) => !current)}
      />
    </div>
  );
}

export function createBasemapSettingsPanel({ extensionAPI, registry }) {
  return extensionAPI.settings.panel.create({
    tabTitle: "Roam Map",
    settings: [
      {
        id: "basemap-catalog-editor",
        name: "Basemap catalog",
        description: "Add reusable map styles and tile services.",
        action: {
          type: "reactComponent",
          component: () => React.createElement(BasemapSettingsEditor, { registry }),
        },
      },
    ],
  });
}

export const __test = { blankCustomBasemap, customKindLabel, statusIntent };
