function escapeEdn(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function uidLookup(uid) {
  return `[:block/uid "${escapeEdn(uid)}"]`;
}

export function createRoamApi(alpha) {
  const asyncData = alpha?.data?.async;
  const data = alpha?.data;
  if (!asyncData?.pull || !asyncData?.pull_many) {
    throw new Error("Roam's asynchronous pull API is unavailable.");
  }

  return {
    pull: (pattern, uid) => Promise.resolve(asyncData.pull(pattern, uidLookup(uid))),
    pullByTitle: (pattern, title) =>
      Promise.resolve(asyncData.pull(pattern, `[:node/title "${escapeEdn(title)}"]`)),
    pullMany: (pattern, uids) =>
      uids.length === 0
        ? Promise.resolve([])
        : Promise.resolve(asyncData.pull_many(pattern, uids.map(uidLookup))),
    addPullWatch: (pattern, uid, callback) =>
      Promise.resolve(data.addPullWatch(pattern, uidLookup(uid), callback)),
    removePullWatch: (pattern, uid, callback) =>
      Promise.resolve(data.removePullWatch(pattern, uidLookup(uid), callback)),
    openPage: (uid) =>
      Promise.resolve(alpha.ui.mainWindow.openPage({ page: { uid } })),
    getFile: (url) => {
      if (typeof alpha?.file?.get !== "function") {
        return Promise.reject(new Error("Roam's file API is unavailable."));
      }
      return Promise.resolve(alpha.file.get({ url }));
    },
  };
}
