// Roam owns the nested roam/render mount inside this neutral host. User list
// code may reuse the exported panel components, render its own UI, or return null.
import { resultsListInvocation } from "./results-list-context.js";

const React = window.React;

function readableError(error) {
  return error?.message ?? String(error ?? "Unknown error");
}

function RoamResultsListMount({ api, invocation }) {
  const hostRef = React.useRef(null);
  const [failure, setFailure] = React.useState(null);

  React.useEffect(() => {
    const element = hostRef.current;
    if (!element) return undefined;
    let active = true;
    const rendering = Promise.resolve().then(() =>
      api.renderRoamString({ element, string: invocation }),
    );
    void rendering.catch((error) => {
      if (active) setFailure(error);
    });
    return () => {
      active = false;
      void rendering
        .catch(() => null)
        .then(() => api.unmountRoamNode(element))
        .catch((error) => {
          console.warn("[roam-map] Results list cleanup failed", error);
        });
    };
  }, [api, invocation]);

  return (
    <>
      <div className="rrm-results-component" ref={hostRef} />
      {failure ? (
        <div className="rrm-results-error">
          Results list failed: {readableError(failure)}
        </div>
      ) : null}
    </>
  );
}

export function RoamResultsList({ api, codeBlockUid, context }) {
  let invocation;
  try {
    invocation = resultsListInvocation(codeBlockUid, context);
  } catch (error) {
    return (
      <div className="rrm-results-error">
        Results list failed: {readableError(error)}
      </div>
    );
  }
  return <RoamResultsListMount key={invocation} api={api} invocation={invocation} />;
}
