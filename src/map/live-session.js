// Owns Roam pull watches for one mounted map. Watch callbacks must be removed
// with the exact same function object, and only the latest refresh may change the watch set.
import { LOCATION_ENTITY_PATTERN } from "./place-records.js";

export const MAP_WATCH_PATTERN = `[
  :block/string :block/order
  {:block/refs [:block/uid :node/title :block/string]}
  {:block/children ...}
]`;

export const SOURCE_DEPENDENCY_WATCH_PATTERN = `[
  :block/string
  {:block/refs [:block/uid :node/title :block/string]}
]`;

export const ATTRIBUTE_WATCH_PATTERN = `[:block/uid :node/title]`;

export function createLiveMapSession({
  api,
  mapUid,
  compile,
  onState,
  debounceMs = 140,
  timers = globalThis,
}) {
  let stopped = false;
  let generation = 0;
  let debounceHandle = null;
  let reconciliation = Promise.resolve(true);
  const entries = new Map();
  const dynamicKeys = new Set();
  const pendingRegistrations = new Set();
  const watchFailures = new Map();

  function watchKey(kind, uid) {
    return `${kind}:${uid}`;
  }

  function watchPattern(kind) {
    if (kind === "map") return MAP_WATCH_PATTERN;
    if (kind === "entity") return LOCATION_ENTITY_PATTERN;
    if (kind === "attribute") return ATTRIBUTE_WATCH_PATTERN;
    return SOURCE_DEPENDENCY_WATCH_PATTERN;
  }

  function schedule(reason = "watch") {
    if (stopped) return;
    if (debounceHandle != null) timers.clearTimeout(debounceHandle);
    debounceHandle = timers.setTimeout(() => {
      debounceHandle = null;
      void refresh(reason);
    }, debounceMs);
  }

  function reportWatchStatus() {
    if (stopped) return;
    const failures = [...watchFailures.values()];
    onState?.({
      type: "watch-status",
      failures,
      error: failures[0]?.error ?? null,
    });
  }

  async function addWatch(kind, uid) {
    const key = watchKey(kind, uid);
    if (entries.has(key) || stopped) return;
    const pattern = watchPattern(kind);
    const callback = () => schedule(kind);
    const entry = { key, kind, uid, pattern, callback, registered: false, removed: false };
    entries.set(key, entry);
    const registration = Promise.resolve().then(() => api.addPullWatch(pattern, uid, callback));
    pendingRegistrations.add(registration);
    try {
      await registration;
      entry.registered = true;
      if (watchFailures.delete(key)) reportWatchStatus();
      if (stopped || entries.get(key) !== entry) {
        await api.removePullWatch(pattern, uid, callback);
        entry.removed = true;
      }
      return true;
    } catch (error) {
      if (entries.get(key) === entry) entries.delete(key);
      dynamicKeys.delete(key);
      watchFailures.set(key, { key, kind, uid, error });
      reportWatchStatus();
      return false;
    } finally {
      pendingRegistrations.delete(registration);
    }
  }

  async function removeWatch(key) {
    const entry = entries.get(key);
    dynamicKeys.delete(key);
    if (watchFailures.delete(key)) reportWatchStatus();
    if (!entry) return;
    entries.delete(key);
    if (entry.registered && !entry.removed) {
      entry.removed = true;
      await api.removePullWatch(entry.pattern, entry.uid, entry.callback);
    }
  }

  function isCurrent(expectedGeneration) {
    return !stopped && generation === expectedGeneration;
  }

  async function reconcileDynamicWatches(result, expectedGeneration) {
    if (!isCurrent(expectedGeneration)) return false;
    const desired = new Map();
    for (const item of result.sourceItems ?? []) {
      desired.set(watchKey("entity", item.entityUid), {
        kind: "entity",
        uid: item.entityUid,
      });
    }
    for (const uid of result.sourceWatchUids ?? []) {
      desired.set(watchKey("source", uid), { kind: "source", uid });
    }
    for (const uid of result.attributeWatchUids ?? []) {
      desired.set(watchKey("attribute", uid), { kind: "attribute", uid });
    }

    let removedFailure = false;
    for (const [key, failure] of watchFailures) {
      if (failure.kind === "map" || desired.has(key)) continue;
      watchFailures.delete(key);
      removedFailure = true;
    }
    if (removedFailure) reportWatchStatus();

    for (const key of [...dynamicKeys]) {
      if (desired.has(key)) continue;
      if (!isCurrent(expectedGeneration)) return false;
      await removeWatch(key);
    }

    for (const [key, target] of desired) {
      if (!isCurrent(expectedGeneration)) return false;
      dynamicKeys.add(key);
      if (!entries.has(key)) await addWatch(target.kind, target.uid);
      if (!isCurrent(expectedGeneration)) {
        await removeWatch(key);
        return false;
      }
    }
    return true;
  }

  function syncDynamicWatches(result, expectedGeneration) {
    const next = reconciliation
      .catch(() => false)
      .then(() => reconcileDynamicWatches(result, expectedGeneration));
    reconciliation = next;
    return next;
  }

  async function refresh(reason = "manual") {
    if (stopped) return null;
    if (debounceHandle != null) {
      timers.clearTimeout(debounceHandle);
      debounceHandle = null;
    }
    const currentGeneration = ++generation;
    onState?.({
      type: currentGeneration === 1 ? "loading" : "refreshing",
      generation: currentGeneration,
      reason,
    });
    try {
      const result = await compile(mapUid);
      if (stopped || currentGeneration !== generation) return null;
      const watchesAreCurrent = await syncDynamicWatches(result, currentGeneration);
      if (!watchesAreCurrent || stopped || currentGeneration !== generation) return null;
      onState?.({ type: "result", generation: currentGeneration, reason, result });
      return result;
    } catch (error) {
      if (stopped || currentGeneration !== generation) return null;
      onState?.({ type: "error", generation: currentGeneration, reason, error });
      return null;
    }
  }

  async function start() {
    if (stopped) return null;
    await addWatch("map", mapUid);
    return refresh("start");
  }

  async function stop() {
    if (stopped) return;
    stopped = true;
    generation += 1;
    if (debounceHandle != null) {
      timers.clearTimeout(debounceHandle);
      debounceHandle = null;
    }
    await Promise.allSettled([reconciliation, ...pendingRegistrations]);
    const removals = [...entries.keys()].map((key) => removeWatch(key));
    await Promise.allSettled(removals);
    dynamicKeys.clear();
    watchFailures.clear();
  }

  return { start, refresh, stop };
}
