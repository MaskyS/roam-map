function currentMapTiler(registry) {
  return registry.getProviderConfiguration("maptiler") ?? { apiKey: "" };
}

export function BasemapSettingsEditor({ registry }) {
  const React = window.React;
  const [configuration, setConfiguration] = React.useState(() => currentMapTiler(registry));
  const [configured, setConfigured] = React.useState(
    () => registry.getProviderConfiguration("maptiler") != null,
  );
  const [status, setStatus] = React.useState(() => {
    const warnings = registry.getWarnings();
    return warnings.length > 0 ? { kind: "warning", message: warnings.join(" ") } : null;
  });
  const [saving, setSaving] = React.useState(false);

  React.useEffect(
    () =>
      registry.subscribe(() => {
        const saved = registry.getProviderConfiguration("maptiler");
        setConfiguration(saved ?? { apiKey: "" });
        setConfigured(saved != null);
      }),
    [registry],
  );

  async function save() {
    setSaving(true);
    setStatus(null);
    try {
      const saved = await registry.replaceProviderConfiguration("maptiler", configuration);
      setConfiguration(saved);
      setConfigured(true);
      setStatus({ kind: "success", message: "MapTiler is configured for this graph." });
    } catch (error) {
      setStatus({ kind: "error", message: error?.message ?? String(error) });
    } finally {
      setSaving(false);
    }
  }

  async function clear() {
    setSaving(true);
    setStatus(null);
    try {
      await registry.replaceProviderConfiguration("maptiler", null);
      setConfiguration({ apiKey: "" });
      setConfigured(false);
      setStatus({ kind: "success", message: "The MapTiler key was removed from this graph." });
    } catch (error) {
      setStatus({ kind: "error", message: error?.message ?? String(error) });
    } finally {
      setSaving(false);
    }
  }

  const readOnly = !registry.canSet;
  return (
    <div className="rrm-basemap-settings">
      <p>
        OpenFreeMap's Liberty, Positron, Bright, Dark, and Fiord styles and EOX Satellite
        Context are always available. Configure each keyed provider once for this graph;
        different providers can then contribute their own reusable basemap choices.
      </p>
      <p>
        Select one beneath a map with <code>map/basemap:: Basemap name</code>. Provider keys are
        saved with this graph and sent from the browser, so use protected public keys rather than
        secrets.
      </p>
      {readOnly ? (
        <p className="rrm-settings-warning">{registry.writeBlockReason}</p>
      ) : null}
      <fieldset className="rrm-provider-configuration" disabled={readOnly}>
        <legend>MapTiler</legend>
        <p>
          One MapTiler key enables <code>MapTiler Satellite</code> and{" "}
          <code>MapTiler Hybrid</code> for every map in this graph. See MapTiler's{" "}
          <a
            href="https://docs.maptiler.com/cloud/api/authentication-key/"
            target="_blank"
            rel="noreferrer"
          >
            key-protection guide
          </a>
          .
        </p>
        <label>
          <span>Public browser key</span>
          <input
            type="password"
            value={configuration.apiKey}
            placeholder="Paste a protected MapTiler key"
            autoComplete="off"
            spellCheck="false"
            onChange={(event) => {
              setConfiguration({ apiKey: event.target.value });
              setStatus(null);
            }}
          />
        </label>
        <div className="rrm-configuration-examples">
          <code>map/basemap:: MapTiler Satellite</code>
          <code>map/basemap:: MapTiler Hybrid</code>
        </div>
        <div className="rrm-settings-actions">
          <button
            type="button"
            className="bp3-button bp3-intent-primary"
            disabled={readOnly || saving || !configuration.apiKey.trim()}
            onClick={() => void save()}
          >
            {saving ? "Saving…" : configured ? "Update MapTiler key" : "Save MapTiler key"}
          </button>
          <button
            type="button"
            className="bp3-button bp3-minimal bp3-intent-danger"
            disabled={readOnly || saving || !configured}
            onClick={() => void clear()}
          >
            Remove MapTiler key
          </button>
        </div>
      </fieldset>
      {status ? (
        <p className={`rrm-settings-status rrm-settings-${status.kind}`} aria-live="polite">
          {status.message}
        </p>
      ) : null}
    </div>
  );
}

export function createBasemapSettingsPanel({ extensionAPI, registry }) {
  const React = window.React;
  return extensionAPI.settings.panel.create({
    tabTitle: "Roam Map",
    settings: [
      {
        id: "basemap-provider-editor",
        name: "Basemap providers",
        description:
          "Configure each provider once, then select its basemaps from any map in this graph.",
        action: {
          type: "reactComponent",
          component: () => React.createElement(BasemapSettingsEditor, { registry }),
        },
      },
    ],
  });
}
