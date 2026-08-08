import "./extension.css";

import { createMapCompiler } from "./map/compiler.js";
import { createDirectSourceCompiler } from "./map/direct-sources.js";
import { createPlaceResolver } from "./map/place-records.js";
import { createPublicApi, installPublicApi } from "./public-api.js";
import { createRoamApi } from "./roam/api.js";
import { createBasemapRegistry } from "./settings/basemap-registry.js";
import { createBasemapSettingsPanel } from "./settings/basemap-settings.jsx";
import { MapErrorBoundary } from "./ui/map-error-boundary.jsx";
import {
  MarkerCard,
  MarkerCardActions,
  MarkerCardDetails,
} from "./ui/marker-card.jsx";
import { MarkerPopover } from "./ui/marker-popover.jsx";
import { MapView } from "./ui/map-view.jsx";
import { createMapMountLifecycle } from "./ui/mount-maps.js";

const TAG = "[roam-map]";
let extensionRuntime = null;

async function onload({ extensionAPI }) {
  extensionRuntime?.stop();
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

  const api = createRoamApi(alpha);
  const basemaps = createBasemapRegistry({ settings: extensionAPI.settings });
  const sourceCompiler = createDirectSourceCompiler(api);
  const placeResolver = createPlaceResolver(api);
  const compiler = createMapCompiler({ sourceCompiler, placeResolver });
  const lifecycle = createMapMountLifecycle({
    document,
    api,
    ReactDOMClient,
    createView: ({ definitionUid, hostUid }) =>
      React.createElement(
        MapErrorBoundary,
        null,
        React.createElement(MapView, {
          definitionUid,
          hostUid,
          api,
          basemaps,
          compiler,
        }),
      ),
  });
  let stopped = false;
  let uninstallPublicApi = () => {};
  const runtime = {
    stop() {
      if (stopped) return;
      stopped = true;
      if (extensionRuntime === runtime) extensionRuntime = null;

      const errors = [];
      try {
        lifecycle.stop();
      } catch (error) {
        errors.push(error);
      }
      try {
        uninstallPublicApi();
      } catch (error) {
        errors.push(error);
      }
      try {
        basemaps.dispose();
      } catch (error) {
        errors.push(error);
      }
      if (errors.length > 0) {
        console.error(
          `${TAG} cleanup completed with errors`,
          new AggregateError(errors, "One or more Roam Map resources failed to clean up."),
        );
      }
    },
  };
  extensionRuntime = runtime;
  try {
    uninstallPublicApi = installPublicApi({
      target: window,
      publicApi: createPublicApi({
        MarkerCard,
        MarkerCardActions,
        MarkerCardDetails,
        MarkerPopover,
      }),
    });
    await createBasemapSettingsPanel({ extensionAPI, registry: basemaps });
    lifecycle.start();
    await extensionAPI.ui.slashCommand.addCommand({
      label: "Map (Roam Map)",
      callback: () => "{{map}}",
    });
  } catch (error) {
    runtime.stop();
    throw error;
  }
  return () => runtime.stop();
}

function onunload() {
  const runtime = extensionRuntime;
  extensionRuntime = null;
  runtime?.stop();
}

export default { onload, onunload };
