// Marker clicks are user-owned roam/render components. They may render a card,
// run an effect, or return nothing; this compiler only identifies their code.
const MARKER_CLICK_CONTAINER = /^marker click$/iu;
const CODE_FENCE = /^```(javascript|jsx|clojure)\s*\n([\s\S]*?)\n?```$/iu;
const BLOCK_REFERENCE = /^\(\(([^()\s]+)\)\)$/u;

function list(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function orderedChildren(block) {
  return [...list(block?.[":block/children"])].sort(
    (left, right) => (left?.[":block/order"] ?? 0) - (right?.[":block/order"] ?? 0),
  );
}

function descendantUids(block) {
  const uids = [];
  function visit(current) {
    const uid = current?.[":block/uid"];
    if (uid) uids.push(uid);
    for (const child of orderedChildren(current)) visit(child);
  }
  visit(block);
  return uids;
}

function diagnostic(code, sourceBlockUid, message, detail = null) {
  return {
    key: [code, sourceBlockUid, detail].filter(Boolean).join(":"),
    code,
    severity: "warning",
    sourceBlockUid,
    message,
    ...(detail ? { detail } : {}),
  };
}

function referencedCodeUid(block) {
  const source = String(block?.[":block/string"] ?? "").trim();
  const match = source.match(BLOCK_REFERENCE);
  if (!match) return null;
  const referencedUids = list(block?.[":block/refs"])
    .filter((ref) => typeof ref?.[":node/title"] !== "string")
    .map((ref) => ref?.[":block/uid"])
    .filter(Boolean);
  return referencedUids.includes(match[1]) ? match[1] : null;
}

function parseComponent(container) {
  const sourceBlockUid = container?.[":block/uid"] ?? "unknown";
  const children = orderedChildren(container);
  if (children.length !== 1) {
    return {
      component: null,
      diagnostic: diagnostic(
        "marker-click.invalid-container",
        sourceBlockUid,
        "A Marker click block needs exactly one JavaScript, JSX, or Clojure code-block child, or one block reference to reusable roam/render code.",
      ),
    };
  }

  const child = children[0];
  const childString = String(child?.[":block/string"] ?? "").trim();
  const codeMatch = childString.match(CODE_FENCE);
  if (codeMatch) {
    if (!codeMatch[2].trim()) {
      return {
        component: null,
        diagnostic: diagnostic(
          "marker-click.empty-code",
          sourceBlockUid,
          "The Marker click code block is empty.",
        ),
      };
    }
    return {
      component: {
        codeBlockUid: child?.[":block/uid"] ?? null,
        language: codeMatch[1].toLocaleLowerCase(),
      },
      watchUid: null,
      diagnostic: null,
    };
  }

  const codeBlockUid = referencedCodeUid(child);
  if (codeBlockUid) {
    return {
      component: { codeBlockUid, language: null },
      watchUid: codeBlockUid,
      diagnostic: null,
    };
  }

  return {
    component: null,
    diagnostic: diagnostic(
      "marker-click.invalid-component",
      sourceBlockUid,
      "The Marker click child must be JavaScript, JSX, Clojure, or an exact block reference to reusable roam/render code.",
      childString || null,
    ),
  };
}

export function compileMarkerClick(root) {
  const containers = orderedChildren(root).filter((block) =>
    MARKER_CLICK_CONTAINER.test(String(block?.[":block/string"] ?? "").trim()),
  );
  const recognizedBlockUids = new Set(containers.flatMap(descendantUids));
  if (containers.length === 0) {
    return { markerClick: null, diagnostics: [], recognizedBlockUids, watchUids: [] };
  }

  const diagnostics = [];
  if (containers.length > 1) {
    for (const duplicate of containers.slice(1)) {
      diagnostics.push(
        diagnostic(
          "marker-click.multiple-components",
          duplicate?.[":block/uid"] ?? "unknown",
          "A map can have one Marker click component; the first block in outline order is being used.",
        ),
      );
    }
  }

  const parsed = parseComponent(containers[0]);
  if (parsed.diagnostic) diagnostics.push(parsed.diagnostic);
  if (parsed.component && !parsed.component.codeBlockUid) {
    diagnostics.push(
      diagnostic(
        "marker-click.missing-code-uid",
        containers[0]?.[":block/uid"] ?? "unknown",
        "The Marker click code block has no stable UID.",
      ),
    );
  }

  return {
    markerClick: parsed.component?.codeBlockUid ? parsed.component : null,
    diagnostics,
    recognizedBlockUids,
    watchUids: parsed.watchUid ? [parsed.watchUid] : [],
  };
}

export const __test = { descendantUids, parseComponent, referencedCodeUid };
