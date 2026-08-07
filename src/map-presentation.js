import {
  attributeSourceUid,
  currentAttributeRelations,
  currentAttributeValues,
  firstRef,
  legacyAttributeRelations,
  legacyAttributeValues,
  list,
  refUid,
  svPart,
} from "./attribute-values.js";

export const MAP_FIELDS = Object.freeze({
  basemap: "map/basemap",
  marker: "map/marker",
  color: "map/color",
  radius: "map/radius",
});

export const DEFAULT_PRESENTATION = Object.freeze({
  basemap: "streets",
  marker: Object.freeze({ color: "#137cbd", radius: 8 }),
});

const BASEMAP_ALIASES = new Map([
  ["classic", "streets"],
  ["liberty", "streets"],
  ["street", "streets"],
  ["streets", "streets"],
  ["satellite", "satellite"],
]);

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

function preferredValues(entity, title, attributeUids) {
  const current = currentAttributeValues(entity, title);
  if (current.length > 0) return current;
  return legacyAttributeValues(entity, attributeUids.get(title));
}

function firstConfiguredValue(entity, title, attributeUids, diagnostics, sourceBlockUid) {
  const values = preferredValues(entity, title, attributeUids);
  if (values.length === 0) return null;
  const distinct = [...new Set(values.map((value) => String(value).trim()))];
  if (distinct.length > 1) {
    diagnostics.push(
      diagnostic(
        "presentation.conflicting-values",
        sourceBlockUid,
        `${title} has more than one value; the first value is being used.`,
        distinct.join(" | "),
      ),
    );
  }
  return values[0];
}

function parseBasemap(raw, diagnostics, sourceBlockUid) {
  if (raw == null) return DEFAULT_PRESENTATION.basemap;
  const value = String(raw).trim();
  const key = value.toLocaleLowerCase();
  const basemap = BASEMAP_ALIASES.get(key);
  if (basemap) return basemap;
  if (value && value.length <= 120 && !/[\r\n]/u.test(value)) return value;
  diagnostics.push(
    diagnostic(
      "presentation.invalid-basemap",
      sourceBlockUid,
      "map/basemap must be a configured basemap name of 120 characters or fewer; streets is being used.",
      value,
    ),
  );
  return DEFAULT_PRESENTATION.basemap;
}

function parseColor(raw, fallback, diagnostics, sourceBlockUid) {
  if (raw == null) return fallback;
  const value = String(raw).trim();
  const looksLikeCssColor =
    /^#[0-9a-f]{3,8}$/iu.test(value) ||
    /^(?:rgb|rgba|hsl|hsla)\([^\n]+\)$/iu.test(value) ||
    /^[a-z]+$/iu.test(value);
  if (looksLikeCssColor) return value;
  diagnostics.push(
    diagnostic(
      "presentation.invalid-color",
      sourceBlockUid,
      "map/color must be a CSS color; the inherited marker color is being used.",
      value,
    ),
  );
  return fallback;
}

function parseRadius(raw, fallback, diagnostics, sourceBlockUid) {
  if (raw == null) return fallback;
  const value = Number(String(raw).trim());
  if (Number.isFinite(value) && value >= 3 && value <= 30) return value;
  diagnostics.push(
    diagnostic(
      "presentation.invalid-radius",
      sourceBlockUid,
      "map/radius must be a number from 3 to 30; the inherited radius is being used.",
      String(raw),
    ),
  );
  return fallback;
}

function markerStyle(entity, attributeUids, inherited, diagnostics, sourceBlockUid) {
  const rawColor = firstConfiguredValue(
    entity,
    MAP_FIELDS.color,
    attributeUids,
    diagnostics,
    sourceBlockUid,
  );
  const rawRadius = firstConfiguredValue(
    entity,
    MAP_FIELDS.radius,
    attributeUids,
    diagnostics,
    sourceBlockUid,
  );
  return {
    color: parseColor(rawColor, inherited.color, diagnostics, sourceBlockUid),
    radius: parseRadius(rawRadius, inherited.radius, diagnostics, sourceBlockUid),
  };
}

function currentMarkerSources(root, blocksByUid, attributeUids, inherited, diagnostics) {
  return currentAttributeRelations(root, MAP_FIELDS.marker).flatMap((relation) => {
    const sourceBlockUid = attributeSourceUid(relation) ?? root?.[":block/uid"] ?? "unknown";
    const legacyEntity = blocksByUid.get(sourceBlockUid);
    const currentStyleValues = [
      ...currentAttributeValues(relation, MAP_FIELDS.color),
      ...currentAttributeValues(relation, MAP_FIELDS.radius),
    ];
    const styleEntity = currentStyleValues.length > 0 ? relation : legacyEntity ?? relation;
    const presentation = markerStyle(
      styleEntity,
      attributeUids,
      inherited,
      diagnostics,
      sourceBlockUid,
    );
    const pages = list(relation?.[":harc/v"]).filter(
      (value) => value?.[":block/uid"] && typeof value?.[":node/title"] === "string",
    );
    if (pages.length === 0) {
      diagnostics.push(
        diagnostic(
          "presentation.marker-without-page",
          sourceBlockUid,
          "map/marker must name at least one page value.",
        ),
      );
    }
    return pages.map((page) => ({
      kind: "page",
      pageUid: page[":block/uid"],
      title: page[":node/title"],
      presentation,
      provenance: [{ sourceBlockUid, originBlockUid: sourceBlockUid, viaBlockRefUid: null }],
    }));
  });
}

function legacyMarkerSources(root, blocksByUid, attributeUids, inherited, diagnostics) {
  return legacyAttributeRelations(root, attributeUids.get(MAP_FIELDS.marker)).flatMap((triple) => {
    const sourceBlockUid = refUid(svPart(triple[1], "source")) ?? root?.[":block/uid"] ?? "unknown";
    const pageUid = refUid(svPart(triple[2], "value"));
    const sourceBlock = blocksByUid.get(sourceBlockUid);
    const page = list(sourceBlock?.[":block/refs"]).find(
      (ref) => ref?.[":block/uid"] === pageUid && typeof ref?.[":node/title"] === "string",
    );
    if (!pageUid || !page) {
      diagnostics.push(
        diagnostic(
          "presentation.marker-without-page",
          sourceBlockUid,
          "map/marker must name a page value.",
        ),
      );
      return [];
    }
    return [
      {
        kind: "page",
        pageUid,
        title: page[":node/title"],
        presentation: markerStyle(
          sourceBlock,
          attributeUids,
          inherited,
          diagnostics,
          sourceBlockUid,
        ),
        provenance: [{ sourceBlockUid, originBlockUid: sourceBlockUid, viaBlockRefUid: null }],
      },
    ];
  });
}

function collectCurrentAttributeSourceUids(entity, output = new Set()) {
  for (const relation of list(entity?.[":harc/_e"])) {
    const title = firstRef(relation?.[":harc/a"])?.[":node/title"];
    if (Object.values(MAP_FIELDS).includes(title)) {
      const sourceUid = attributeSourceUid(relation);
      if (sourceUid) output.add(sourceUid);
    }
    collectCurrentAttributeSourceUids(relation, output);
  }
  return output;
}

function collectLegacyAttributeSourceUids(entities, attributeUids, output) {
  const wanted = new Set([...attributeUids.values()].filter(Boolean));
  for (const entity of entities) {
    for (const triple of entity?.[":entity/attrs"] ?? []) {
      const attributeUid = refUid(svPart(triple?.[1], "value"));
      if (!wanted.has(attributeUid)) continue;
      const sourceUid = refUid(svPart(triple?.[1], "source"));
      if (sourceUid) output.add(sourceUid);
    }
  }
}

export function compileMapPresentation({ root, descendants, attributeUids = new Map() }) {
  const diagnostics = [];
  const blocksByUid = new Map(
    [root, ...descendants]
      .filter((block) => block?.[":block/uid"])
      .map((block) => [block[":block/uid"], block]),
  );
  const mapUid = root?.[":block/uid"] ?? "unknown";
  const basemapRaw = firstConfiguredValue(
    root,
    MAP_FIELDS.basemap,
    attributeUids,
    diagnostics,
    mapUid,
  );
  const marker = markerStyle(
    root,
    attributeUids,
    DEFAULT_PRESENTATION.marker,
    diagnostics,
    mapUid,
  );
  const currentMarkers = currentMarkerSources(
    root,
    blocksByUid,
    attributeUids,
    marker,
    diagnostics,
  );
  const sources =
    currentMarkers.length > 0
      ? currentMarkers
      : legacyMarkerSources(root, blocksByUid, attributeUids, marker, diagnostics);
  const recognizedAttributeBlockUids = collectCurrentAttributeSourceUids(root);
  collectLegacyAttributeSourceUids([root, ...descendants], attributeUids, recognizedAttributeBlockUids);

  return {
    presentation: {
      basemap: parseBasemap(basemapRaw, diagnostics, mapUid),
      marker,
    },
    sources,
    diagnostics,
    recognizedAttributeBlockUids,
  };
}

export const __test = { parseBasemap, parseColor, parseRadius };
