// This is the extension's one intentional DOM seam: Roam has no documented hook
// for arbitrary inline parsers, so we discover its rendered map controls here.
import { parseMapDefinitions } from "../map/definition.js";

export const MAP_BUTTON_SELECTOR = ".rm-xparser-default-map";

function dataValue(element, name) {
  const value = element?.getAttribute?.(name);
  return typeof value === "string" && value ? value : null;
}

export function identifyMapMount(button) {
  if (!button?.matches?.(MAP_BUTTON_SELECTOR)) return null;
  if (button.textContent?.trim().toLocaleLowerCase() !== "map") return null;
  const hostBlock = button.closest("[data-block-uid]");
  const referencedDefinition = button.closest(".rm-block-ref[data-uid]");
  const hostUid = dataValue(hostBlock, "data-block-uid");
  const definitionUid = dataValue(referencedDefinition, "data-uid") ?? hostUid;
  if (!definitionUid || !hostUid) return null;
  return { definitionUid, hostUid };
}

function createMountId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return `rrm-${globalThis.crypto.randomUUID()}`;
  }
  return `rrm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function createMapMountLifecycle({
  document,
  api,
  ReactDOMClient,
  createView,
  MutationObserver = document.defaultView?.MutationObserver,
}) {
  const mounts = new Map();
  const pending = new WeakSet();
  let observer = null;
  let stopped = false;
  let scanScheduled = false;
  const queuedNodes = new Set();

  function restoreButton(record) {
    if (record.previousAriaHidden == null) record.button.removeAttribute("aria-hidden");
    else record.button.setAttribute("aria-hidden", record.previousAriaHidden);
    record.button.style.display = record.previousDisplay;
    record.button.removeAttribute("data-roam-map-mounted");
  }

  function unmount(button) {
    const record = mounts.get(button);
    if (!record) return;
    mounts.delete(button);
    try {
      record.root.unmount();
    } finally {
      restoreButton(record);
      record.container.remove();
    }
  }

  function sweep() {
    for (const [button, record] of mounts) {
      if (!button.isConnected || !record.container.isConnected) unmount(button);
    }
  }

  async function mount(button) {
    if (stopped || mounts.has(button) || pending.has(button)) return;
    const identity = identifyMapMount(button);
    if (!identity) return;
    pending.add(button);
    let definition = null;
    try {
      definition = await api.pull("[:block/uid :block/string]", identity.definitionUid);
    } catch (error) {
      console.warn("[roam-map] could not verify a map definition", error);
    }
    pending.delete(button);
    if (
      stopped ||
      !button.isConnected ||
      mounts.has(button) ||
      parseMapDefinitions(definition?.[":block/string"]).length === 0
    ) {
      return;
    }

    const id = createMountId();
    const container = document.createElement("span");
    container.className = "rrm-mount";
    container.setAttribute("data-roam-map-mount-id", id);
    container.setAttribute("data-roam-map-definition-uid", identity.definitionUid);
    container.setAttribute("data-roam-map-host-uid", identity.hostUid);
    button.insertAdjacentElement("afterend", container);

    let root;
    try {
      root = ReactDOMClient.createRoot(container);
    } catch (error) {
      container.remove();
      throw error;
    }
    const record = {
      button,
      container,
      root,
      previousDisplay: button.style.display,
      previousAriaHidden: button.getAttribute("aria-hidden"),
    };
    mounts.set(button, record);
    button.style.display = "none";
    button.setAttribute("aria-hidden", "true");
    button.setAttribute("data-roam-map-mounted", "true");
    try {
      root.render(
        createView({
          definitionUid: identity.definitionUid,
          hostUid: identity.hostUid,
        }),
      );
    } catch (error) {
      unmount(button);
      throw error;
    }
  }

  function candidates(node) {
    const found = [];
    if (node?.matches?.(MAP_BUTTON_SELECTOR)) found.push(node);
    if (typeof node?.querySelectorAll === "function") {
      found.push(...node.querySelectorAll(MAP_BUTTON_SELECTOR));
    }
    return found;
  }

  function scanCandidates(node) {
    for (const button of candidates(node)) {
      void mount(button).catch((error) => {
        console.warn("[roam-map] could not mount a map", error);
      });
    }
  }

  function scan(node = document) {
    if (stopped) return;
    sweep();
    scanCandidates(node);
  }

  function scheduleScan(records) {
    for (const record of records) {
      for (const node of record.addedNodes) queuedNodes.add(node);
    }
    if (scanScheduled || stopped) return;
    scanScheduled = true;
    queueMicrotask(() => {
      scanScheduled = false;
      if (stopped) {
        queuedNodes.clear();
        return;
      }
      sweep();
      const nodes = [...queuedNodes];
      queuedNodes.clear();
      for (const node of nodes) scanCandidates(node);
    });
  }

  function start() {
    if (stopped || observer) return;
    if (typeof MutationObserver !== "function") {
      throw new Error("MutationObserver is unavailable; Roam Map cannot discover inline mounts.");
    }
    observer = new MutationObserver(scheduleScan);
    observer.observe(document.body, { childList: true, subtree: true });
    scan(document);
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    observer?.disconnect();
    observer = null;
    for (const button of [...mounts.keys()]) unmount(button);
  }

  return {
    start,
    stop,
    scan,
    get size() {
      return mounts.size;
    },
  };
}
