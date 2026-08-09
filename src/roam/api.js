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
    roamQuery: (args) => {
      if (typeof data?.roamQuery !== "function") {
        return Promise.reject(new Error("Roam's documented native-query API is unavailable."));
      }
      return Promise.resolve(data.roamQuery(args));
    },
    datalogQuery: (query, ...args) => {
      if (typeof asyncData?.q !== "function") {
        return Promise.reject(new Error("Roam's documented asynchronous Datalog API is unavailable."));
      }
      return Promise.resolve(asyncData.q(query, ...args));
    },
    addPullWatch: (pattern, uid, callback) =>
      Promise.resolve(data.addPullWatch(pattern, uidLookup(uid), callback)),
    removePullWatch: (pattern, uid, callback) =>
      Promise.resolve(data.removePullWatch(pattern, uidLookup(uid), callback)),
    createChildBlock: ({ parentUid, string, order = "last" }) => {
      if (
        typeof data?.block?.create !== "function" ||
        typeof alpha?.util?.generateUID !== "function"
      ) {
        return Promise.reject(new Error("Roam's documented block-create API is unavailable."));
      }
      const uid = alpha.util.generateUID();
      return Promise.resolve(
        data.block.create({
          location: { "parent-uid": parentUid, order },
          block: { uid, string },
        }),
      ).then(() => uid);
    },
    updateBlockString: (uid, string) => {
      if (typeof data?.block?.update !== "function") {
        return Promise.reject(new Error("Roam's documented block-update API is unavailable."));
      }
      return Promise.resolve(data.block.update({ block: { uid, string } }));
    },
    deleteBlock: (uid) => {
      if (typeof data?.block?.delete !== "function") {
        return Promise.reject(new Error("Roam's documented block-delete API is unavailable."));
      }
      return Promise.resolve(data.block.delete({ block: { uid } }));
    },
    openEntityInSidebar: (uid) =>
      Promise.resolve(
        alpha.ui.rightSidebar.addWindow({
          window: { type: "outline", "block-uid": uid },
        }),
      ),
    renderRoamString: ({ element, string }) => {
      if (typeof alpha?.ui?.components?.renderString !== "function") {
        return Promise.reject(new Error("Roam's renderString component API is unavailable."));
      }
      return Promise.resolve(alpha.ui.components.renderString({ el: element, string }));
    },
    unmountRoamNode: (element) => {
      if (typeof alpha?.ui?.components?.unmountNode !== "function") {
        return Promise.reject(new Error("Roam's component unmount API is unavailable."));
      }
      return Promise.resolve(alpha.ui.components.unmountNode({ el: element }));
    },
    getFile: (url) => {
      if (typeof alpha?.file?.get !== "function") {
        return Promise.reject(new Error("Roam's file API is unavailable."));
      }
      return Promise.resolve(alpha.file.get({ url }));
    },
  };
}
