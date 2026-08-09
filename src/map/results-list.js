// Results lists are user-owned roam/render components, parallel to Marker click.
// They may reuse the stock panel, replace it, or return nothing; this compiler
// only identifies their code.
const RESULTS_LIST_CONTAINER = /^results list$/iu;
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
        "results-list.invalid-container",
        sourceBlockUid,
        "A Results list block needs exactly one JavaScript, JSX, or Clojure code-block child, or one block reference to reusable roam/render code.",
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
          "results-list.empty-code",
          sourceBlockUid,
          "The Results list code block is empty.",
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
      "results-list.invalid-component",
      sourceBlockUid,
      "The Results list child must be JavaScript, JSX, Clojure, or an exact block reference to reusable roam/render code.",
      childString || null,
    ),
  };
}

export function compileResultsList(root) {
  const containers = orderedChildren(root).filter((block) =>
    RESULTS_LIST_CONTAINER.test(String(block?.[":block/string"] ?? "").trim()),
  );
  const recognizedBlockUids = new Set(containers.flatMap(descendantUids));
  if (containers.length === 0) {
    return { resultsList: null, diagnostics: [], recognizedBlockUids, watchUids: [] };
  }

  const diagnostics = [];
  if (containers.length > 1) {
    for (const duplicate of containers.slice(1)) {
      diagnostics.push(
        diagnostic(
          "results-list.multiple-components",
          duplicate?.[":block/uid"] ?? "unknown",
          "A map can have one Results list component; the first block in outline order is being used.",
        ),
      );
    }
  }

  const parsed = parseComponent(containers[0]);
  if (parsed.diagnostic) diagnostics.push(parsed.diagnostic);
  if (parsed.component && !parsed.component.codeBlockUid) {
    diagnostics.push(
      diagnostic(
        "results-list.missing-code-uid",
        containers[0]?.[":block/uid"] ?? "unknown",
        "The Results list code block has no stable UID.",
      ),
    );
  }

  return {
    resultsList: parsed.component?.codeBlockUid ? parsed.component : null,
    diagnostics,
    recognizedBlockUids,
    watchUids: parsed.watchUid ? [parsed.watchUid] : [],
  };
}

export const __test = { descendantUids, parseComponent, referencedCodeUid };
