import { PLACE_ENTITY_PATTERN } from "./place-resolver.js";

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
  const entries = new Map();
  const dynamicKeys = new Set();
  const pendingRegistrations = new Set();

  function watchKey(kind, uid) {
    return `${kind}:${uid}`;
  }

  function watchPattern(kind) {
    if (kind === "map") return MAP_WATCH_PATTERN;
    if (kind === "place") return PLACE_ENTITY_PATTERN;
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
      if (stopped || entries.get(key) !== entry) {
        await api.removePullWatch(pattern, uid, callback);
        entry.removed = true;
      }
    } catch (error) {
      if (entries.get(key) === entry) entries.delete(key);
      onState?.({ type: "watch-error", kind, uid, error });
    } finally {
      pendingRegistrations.delete(registration);
    }
  }

  async function removeWatch(key) {
    const entry = entries.get(key);
    if (!entry) return;
    entries.delete(key);
    dynamicKeys.delete(key);
    if (entry.registered && !entry.removed) {
      entry.removed = true;
      await api.removePullWatch(entry.pattern, entry.uid, entry.callback);
    }
  }

  async function syncDynamicWatches(result) {
    const desired = new Map();
    for (const item of result.sourceItems ?? []) {
      desired.set(watchKey("place", item.pageUid), { kind: "place", uid: item.pageUid });
    }
    for (const uid of result.sourceWatchUids ?? []) {
      desired.set(watchKey("source", uid), { kind: "source", uid });
    }
    for (const uid of result.attributeWatchUids ?? []) {
      desired.set(watchKey("attribute", uid), { kind: "attribute", uid });
    }

    const removals = [...dynamicKeys]
      .filter((key) => !desired.has(key))
      .map((key) => removeWatch(key));
    await Promise.allSettled(removals);
    if (stopped) return;

    const additions = [];
    for (const [key, target] of desired) {
      dynamicKeys.add(key);
      if (!entries.has(key)) additions.push(addWatch(target.kind, target.uid));
    }
    await Promise.allSettled(additions);
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
      await syncDynamicWatches(result);
      if (stopped || currentGeneration !== generation) return null;
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
    const registrations = [...pendingRegistrations];
    const removals = [...entries.keys()].map((key) => removeWatch(key));
    await Promise.allSettled(removals);
    await Promise.allSettled(registrations);
    dynamicKeys.clear();
  }

  return { start, refresh, stop };
}
