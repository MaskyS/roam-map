export function createCleanupScope() {
  const cleanups = [];
  let disposed = false;

  function add(cleanup) {
    if (typeof cleanup !== "function") {
      throw new TypeError("Cleanup must be a function.");
    }
    if (disposed) {
      cleanup();
      return () => {};
    }
    const entry = { cleanup, active: true };
    cleanups.push(entry);
    return () => {
      if (!entry.active) return;
      entry.active = false;
      cleanup();
    };
  }

  async function dispose() {
    if (disposed) return;
    disposed = true;
    const errors = [];
    for (let index = cleanups.length - 1; index >= 0; index -= 1) {
      const entry = cleanups[index];
      if (!entry.active) continue;
      entry.active = false;
      try {
        await entry.cleanup();
      } catch (error) {
        errors.push(error);
      }
    }
    cleanups.length = 0;
    if (errors.length > 0) {
      throw new AggregateError(errors, "One or more Roam Map resources failed to clean up.");
    }
  }

  return {
    add,
    dispose,
    get disposed() {
      return disposed;
    },
  };
}
