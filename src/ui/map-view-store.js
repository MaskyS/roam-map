// Per-mounted-map bridge between a live MapView and results-list components.
// Custom roam/render code receives only a serializable { version, mapUid, viewId }
// context; the current results, selection, and actions stay in this external
// store so components subscribe to live data instead of one-shot snapshots.
const views = new Map();

function entry(viewId) {
  let record = views.get(viewId);
  if (!record) {
    record = { snapshot: null, actions: null, listeners: new Set() };
    views.set(viewId, record);
  }
  return record;
}

function notify(record) {
  for (const listener of [...record.listeners]) listener();
}

function prune(viewId, record) {
  if (record.listeners.size === 0 && record.snapshot == null && record.actions == null) {
    views.delete(viewId);
  }
}

export function registerMapView(viewId, { actions = null } = {}) {
  const record = entry(viewId);
  record.actions = actions;
  notify(record);
  let registered = true;
  return {
    publish(snapshot) {
      if (!registered) return;
      record.snapshot = snapshot ?? null;
      notify(record);
    },
    dispose() {
      if (!registered) return;
      registered = false;
      record.snapshot = null;
      record.actions = null;
      notify(record);
      prune(viewId, record);
    },
  };
}

export function subscribeMapView(viewId, listener) {
  const record = entry(viewId);
  record.listeners.add(listener);
  return () => {
    record.listeners.delete(listener);
    prune(viewId, record);
  };
}

export function getMapViewSnapshot(viewId) {
  return views.get(viewId)?.snapshot ?? null;
}

export function getMapViewActions(viewId) {
  return views.get(viewId)?.actions ?? null;
}

export const __test = { views };
