import "./extension.css";

import { createBasemapSettingsPanel } from "./basemap-settings.jsx";
import { createBasemapRegistry } from "./basemaps.js";
import { createCleanupScope } from "./cleanup.js";
import { createMapCompiler } from "./compile-map.js";
import { createDirectSourceCompiler } from "./direct-source.js";
import { MapView } from "./map-view.jsx";
import { createMapMountLifecycle } from "./mount-lifecycle.js";
import { createPlaceResolver } from "./place-resolver.js";
import { createRoamApi } from "./roam-api.js";

const TAG = "[roam-map]";
let extensionRuntime = null;

async function onload({ extensionAPI }) {
  if (extensionRuntime) await extensionRuntime.stop();
  const alpha = window.roamAlphaAPI;
  const React = window.React;
  const ReactDOMClient = window.ReactDOMClient;
  if (!alpha) {
    console.warn(`${TAG} window.roamAlphaAPI is unavailable; the extension did not start.`);
    return undefined;
  }
  if (
    typeof React?.createElement !== "function" ||
    typeof ReactDOMClient?.createRoot !== "function"
  ) {
    console.error(
      `${TAG} Roam's documented React 18 and ReactDOMClient globals are unavailable; the extension did not start.`,
    );
    return undefined;
  }

  const scope = createCleanupScope();
  const api = createRoamApi(alpha);
  const basemaps = createBasemapRegistry({ settings: extensionAPI.settings });
  scope.add(() => basemaps.dispose());
  const sourceCompiler = createDirectSourceCompiler(api);
  const placeResolver = createPlaceResolver(api);
  const compiler = createMapCompiler({ sourceCompiler, placeResolver });
  const lifecycle = createMapMountLifecycle({
    document,
    api,
    ReactDOMClient,
    createView: (identity) =>
      React.createElement(MapView, {
        ...identity,
        api,
        basemaps,
        compiler,
      }),
  });
  const runtime = {
    async stop() {
      if (extensionRuntime === runtime) extensionRuntime = null;
      try {
        await scope.dispose();
      } catch (error) {
        console.error(`${TAG} cleanup completed with errors`, error);
      }
    },
  };
  extensionRuntime = runtime;
  try {
    await createBasemapSettingsPanel({ extensionAPI, registry: basemaps });
    lifecycle.start();
    scope.add(() => lifecycle.stop());
    await extensionAPI.ui.slashCommand.addCommand({
      label: "Map (Roam Map)",
      callback: () => "{{map}}",
    });
  } catch (error) {
    await runtime.stop();
    throw error;
  }
  return () => runtime.stop();
}

async function onunload() {
  const runtime = extensionRuntime;
  extensionRuntime = null;
  if (runtime) await runtime.stop();
}

export default { onload, onunload };
