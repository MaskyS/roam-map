// roam/render arguments must be serializable. A results list is continuously
// live, so the context carries only the identity needed to subscribe to the
// matching map view through the external store — never the result set itself.
export const RESULTS_LIST_CONTEXT_VERSION = 2;

export function createResultsListContext({ mapUid, viewId }) {
  return {
    version: RESULTS_LIST_CONTEXT_VERSION,
    mapUid,
    viewId,
  };
}

export function encodeResultsListContext(context) {
  return encodeURIComponent(JSON.stringify(context));
}

export function resultsListInvocation(codeBlockUid, context) {
  const uid = String(codeBlockUid ?? "").trim();
  if (!uid || /[\s(){}]/u.test(uid)) {
    throw new Error("Results list needs a valid Roam code-block UID.");
  }
  return `{{roam/render: ((${uid})) ${JSON.stringify(encodeResultsListContext(context))}}}`;
}
