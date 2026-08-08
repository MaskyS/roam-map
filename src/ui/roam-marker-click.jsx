// Roam owns the nested roam/render mount inside this neutral host. User code
// may render UI, create a portal, run an effect and return null, or combine them.
import { markerClickInvocation } from "./marker-click-context.js";

const React = window.React;

function readableError(error) {
  return error?.message ?? String(error ?? "Unknown error");
}

function RoamMarkerClickMount({ api, invocation }) {
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
          console.warn("[roam-map] Marker click cleanup failed", error);
        });
    };
  }, [api, invocation]);

  return (
    <>
      <div className="rrm-marker-click-component" ref={hostRef} />
      {failure ? (
        <div className="rrm-marker-click-error">
          Marker click failed: {readableError(failure)}
        </div>
      ) : null}
    </>
  );
}

export function RoamMarkerClick({ api, codeBlockUid, context }) {
  let invocation;
  try {
    invocation = markerClickInvocation(codeBlockUid, context);
  } catch (error) {
    return (
      <div className="rrm-marker-click-error">
        Marker click failed: {readableError(error)}
      </div>
    );
  }
  return <RoamMarkerClickMount key={invocation} api={api} invocation={invocation} />;
}
