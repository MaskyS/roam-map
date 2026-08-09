// Selected-entity highlighting and marker UI are separate values, but user
// actions change them together. Keeping those transitions here makes stale
// popup callbacks and source refreshes deterministic.

export const EMPTY_MAP_SELECTION = Object.freeze({
  selectedEntityUid: null,
  markerSelection: null,
});

export function reduceMapSelection(state, action) {
  switch (action.type) {
    case "marker-clicked":
      return {
        selectedEntityUid: action.markerSelection.context.entityUid,
        markerSelection: action.markerSelection,
      };
    case "list-item-selected":
      return {
        selectedEntityUid: action.entityUid,
        markerSelection: null,
      };
    case "marker-ui-closed":
      return state.markerSelection?.context.clickId === action.clickId
        ? EMPTY_MAP_SELECTION
        : state;
    case "features-refreshed":
      return state.selectedEntityUid && !action.entityUids.has(state.selectedEntityUid)
        ? EMPTY_MAP_SELECTION
        : state;
    default:
      return state;
  }
}
