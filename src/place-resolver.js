import {
  currentAttributeValues,
  displayAttributeValue,
  legacyAttributeValues,
  list,
} from "./attribute-values.js";
import { legacyAttributeUids, projectAttributes } from "./attribute-projection.js";
import { FEATURE_PROPERTIES } from "./map-contract.js";

export const PLACE_FIELDS = Object.freeze({
  latitude: "Latitude",
  longitude: "Longitude",
  geometry: "Geometry",
  address: "Address",
  geocoderId: "Geocoder ID",
});

export const PLACE_ENTITY_PATTERN = `[
  :block/uid :node/title :block/string :entity/attrs
  {:harc/_e [
    :block/uid
    {:harc/a [:block/uid :node/title]}
    {:harc/v [:block/uid :node/title :block/string :harc/v-string :harc.text/string]}
    {:harc/a-source [:block/uid]}
    {:harc/v-source [:block/uid]}
  ]}
  {:block/children [
    :block/uid :block/string :block/order :entity/attrs
    {:harc/_e [
      :block/uid
      {:harc/a [:block/uid :node/title]}
      {:harc/v [:block/uid :node/title :block/string :harc/v-string :harc.text/string]}
      {:harc/a-source [:block/uid]}
      {:harc/v-source [:block/uid]}
    ]}
    {:block/children [:block/uid :block/string :block/order :entity/attrs]}
  ]}
]`;

const GEOJSON_TYPES = new Set([
  "Point",
  "MultiPoint",
  "LineString",
  "MultiLineString",
  "Polygon",
  "MultiPolygon",
  "GeometryCollection",
]);

function exactMetaChildren(entity) {
  return list(entity?.[":block/children"]).filter(
    (child) => child?.[":block/string"] === "roam/meta::",
  );
}

function harcCandidates(entity, attributeTitle) {
  return [entity, ...exactMetaChildren(entity)].flatMap((source) =>
    currentAttributeValues(source, attributeTitle),
  );
}

function legacyCandidates(entity, attributeTitle, attributeUids) {
  const attributeUid = attributeUids.get(attributeTitle);
  if (!attributeUid) return [];
  return [entity, ...exactMetaChildren(entity)].flatMap((source) =>
    legacyAttributeValues(source, attributeUid),
  );
}

function structuralCandidates(entity, attributeTitle) {
  const prefix = `${attributeTitle}::`;
  return exactMetaChildren(entity).flatMap((metadata) =>
    list(metadata?.[":block/children"])
      .map((child) => child?.[":block/string"])
      .filter((string) => typeof string === "string" && string.startsWith(prefix))
      .map((string) => string.slice(prefix.length).trim())
      .filter(Boolean),
  );
}

function comparable(value) {
  return typeof value === "string" ? value.trim() : JSON.stringify(value);
}

function diagnostic({ code, message, pageUid, field = null, severity = "warning", detail = null }) {
  return {
    key: [code, pageUid, field, detail].filter(Boolean).join(":"),
    code,
    severity,
    message,
    pageUid,
    ...(field ? { field } : {}),
    ...(detail ? { detail } : {}),
  };
}

function chooseField(entity, attributeTitle, attributeUids, diagnostics) {
  const pageUid = entity?.[":block/uid"] ?? "unknown";
  const groups = [
    ["current attribute", harcCandidates(entity, attributeTitle)],
    ["legacy attribute", legacyCandidates(entity, attributeTitle, attributeUids)],
    ["roam/meta block", structuralCandidates(entity, attributeTitle)],
  ];
  const populated = groups.filter(([, values]) => values.length > 0);
  if (populated.length === 0) return null;
  const [chosenModel, chosenValues] = populated[0];
  const distinctChosen = [...new Set(chosenValues.map(comparable))];
  if (distinctChosen.length > 1) {
    diagnostics.push(
      diagnostic({
        code: "place.conflicting-field-values",
        pageUid,
        field: attributeTitle,
        message: `${attributeTitle} has more than one ${chosenModel} value; the first value is being used.`,
        detail: distinctChosen.join(" | "),
      }),
    );
  }
  const chosen = chosenValues[0];
  const chosenComparable = comparable(chosen);
  const shadowed = populated
    .slice(1)
    .flatMap(([model, values]) =>
      values
        .map(comparable)
        .filter((value) => value !== chosenComparable)
        .map((value) => `${model}: ${value}`),
    );
  if (shadowed.length > 0) {
    diagnostics.push(
      diagnostic({
        code: "place.conflicting-attribute-models",
        pageUid,
        field: attributeTitle,
        message: `${attributeTitle} differs between attribute representations; the current representation takes precedence.`,
        detail: shadowed.join(" | "),
      }),
    );
  }
  return chosen;
}

function coordinate(raw, { min, max, field, pageUid, diagnostics }) {
  if (raw == null || (typeof raw === "string" && raw.trim() === "")) return null;
  const value = typeof raw === "number" ? raw : Number(String(raw).trim());
  if (!Number.isFinite(value) || value < min || value > max) {
    diagnostics.push(
      diagnostic({
        code: "place.invalid-coordinate",
        pageUid,
        field,
        message: `${field} must be a number from ${min} to ${max}.`,
        detail: String(raw),
      }),
    );
    return null;
  }
  return value;
}

function validGeometry(value) {
  if (!value || typeof value !== "object" || !GEOJSON_TYPES.has(value.type)) return false;
  if (value.type === "GeometryCollection") return Array.isArray(value.geometries);
  return Array.isArray(value.coordinates);
}

function parseGeometry(raw, pageUid, diagnostics) {
  if (raw == null || raw === "") return { geometry: null, reference: null };
  if (typeof raw === "string" && /^\[\[[\s\S]+\]\]$/.test(raw.trim())) {
    diagnostics.push(
      diagnostic({
        code: "place.geometry-reference",
        pageUid,
        field: PLACE_FIELDS.geometry,
        message: "Geometry is a page reference. It is retained for provenance but is not a point until that page is resolved.",
        detail: raw.trim(),
      }),
    );
    return { geometry: null, reference: raw.trim() };
  }
  let parsed = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      diagnostics.push(
        diagnostic({
          code: "place.invalid-geometry",
          pageUid,
          field: PLACE_FIELDS.geometry,
          message: "Geometry must be a GeoJSON geometry object, feature, or page reference.",
          detail: raw,
        }),
      );
      return { geometry: null, reference: null };
    }
  }
  const geometry = parsed?.type === "Feature" ? parsed.geometry : parsed;
  if (!validGeometry(geometry)) {
    diagnostics.push(
      diagnostic({
        code: "place.invalid-geometry",
        pageUid,
        field: PLACE_FIELDS.geometry,
        message: "Geometry is not a valid GeoJSON geometry object.",
      }),
    );
    return { geometry: null, reference: null };
  }
  return { geometry, reference: null };
}

function pageTitleLeaf(title) {
  const value = String(title ?? "").trim();
  const namespaceBoundary = value.lastIndexOf("]]/");
  const leaf = namespaceBoundary >= 0 ? value.slice(namespaceBoundary + 3).trim() : value;
  const wrapped = leaf.match(/^\[\[([\s\S]+)\]\]$/);
  return wrapped ? wrapped[1].trim() : leaf;
}

export function resolvePlaceEntity(
  entity,
  attributeUids,
  { fields = PLACE_FIELDS, attributeTitlesByUid = null } = {},
) {
  const diagnostics = [];
  const pageUid = entity?.[":block/uid"] ?? null;
  const title = entity?.[":node/title"] ?? null;
  if (!pageUid || !title) {
    return {
      pageUid,
      title,
      label: title ?? pageUid ?? "Unknown page",
      feature: null,
      diagnostics: [
        diagnostic({
          code: "place.invalid-page",
          pageUid: pageUid ?? "unknown",
          severity: "error",
          message: "The source UID did not resolve to a Roam page.",
        }),
      ],
    };
  }

  const raw = Object.fromEntries(
    Object.entries(fields).map(([key, attributeTitle]) => [
      key,
      chooseField(entity, attributeTitle, attributeUids, diagnostics),
    ]),
  );
  const titlesByUid =
    attributeTitlesByUid ??
    new Map([...attributeUids].map(([titleValue, uid]) => [uid, titleValue]));
  const projection = projectAttributes(entity, { attributeTitlesByUid: titlesByUid });
  diagnostics.push(...projection.diagnostics);
  const lat = coordinate(raw.latitude, {
    min: -90,
    max: 90,
    field: fields.latitude,
    pageUid,
    diagnostics,
  });
  const lon = coordinate(raw.longitude, {
    min: -180,
    max: 180,
    field: fields.longitude,
    pageUid,
    diagnostics,
  });
  const parsedGeometry = parseGeometry(raw.geometry, pageUid, diagnostics);
  let geometry = parsedGeometry.geometry;

  if ((lat == null) !== (lon == null)) {
    diagnostics.push(
      diagnostic({
        code: "place.incomplete-coordinates",
        pageUid,
        message: "Latitude and Longitude must both be present and valid before the page can be mapped as a point.",
      }),
    );
  }
  if (lat != null && lon != null) {
    if (
      geometry?.type === "Point" &&
      (geometry.coordinates[0] !== lon || geometry.coordinates[1] !== lat)
    ) {
      diagnostics.push(
        diagnostic({
          code: "place.conflicting-location",
          pageUid,
          message: "Latitude/Longitude and Point Geometry disagree; Latitude/Longitude take precedence.",
        }),
      );
    }
    geometry = { type: "Point", coordinates: [lon, lat] };
  }

  if (!geometry) {
    diagnostics.push(
      diagnostic({
        code: "place.no-renderable-location",
        pageUid,
        message: parsedGeometry.reference
          ? "The page has referenced geometry but no directly renderable point."
          : "The page has no valid coordinate pair or GeoJSON geometry.",
      }),
    );
  }

  const label = pageTitleLeaf(title) || title;
  const feature = geometry
    ? {
        type: "Feature",
        id: `page:${pageUid}`,
        geometry,
        properties: {
          ...projection.properties,
          [FEATURE_PROPERTIES.identityKind]: "page",
          [FEATURE_PROPERTIES.pageUid]: pageUid,
          [FEATURE_PROPERTIES.title]: title,
          [FEATURE_PROPERTIES.label]: label,
          [FEATURE_PROPERTIES.address]: raw.address == null ? null : String(raw.address),
          [FEATURE_PROPERTIES.geocoderId]:
            raw.geocoderId == null ? null : String(raw.geocoderId),
        },
      }
    : null;

  return {
    pageUid,
    title,
    label,
    address: raw.address == null ? null : String(raw.address),
    geocoderId: raw.geocoderId == null ? null : String(raw.geocoderId),
    geometryReference: parsedGeometry.reference,
    raw,
    assets: projection.assets,
    attributeUids: projection.attributeUids,
    feature,
    diagnostics,
  };
}

export function createPlaceResolver(api, { fields = PLACE_FIELDS } = {}) {
  let attributeUidsPromise = null;

  async function attributeUids() {
    if (!attributeUidsPromise) {
      attributeUidsPromise = Promise.all(
        Object.values(fields).map(async (title) => {
          const entity = await api.pullByTitle("[:block/uid]", title);
          return [title, entity?.[":block/uid"] ?? null];
        }),
      ).then((entries) => new Map(entries.filter(([, uid]) => uid)));
    }
    return attributeUidsPromise;
  }

  async function resolvePage(pageUid) {
    const [entity, legacyUids] = await Promise.all([
      api.pull(PLACE_ENTITY_PATTERN, pageUid),
      attributeUids(),
    ]);
    if (!entity) {
      return resolvePlaceEntity({ ":block/uid": pageUid }, legacyUids, { fields });
    }
    const attributeTitlesByUid = new Map(
      [...legacyUids].map(([title, uid]) => [uid, title]),
    );
    const unknownAttributeUids = legacyAttributeUids(entity).filter(
      (uid) => !attributeTitlesByUid.has(uid),
    );
    if (unknownAttributeUids.length > 0 && typeof api.pullMany === "function") {
      const attributePages = await api.pullMany(
        "[:block/uid :node/title]",
        unknownAttributeUids,
      );
      for (const attributePage of attributePages) {
        const uid = attributePage?.[":block/uid"];
        const title = attributePage?.[":node/title"];
        if (uid && title) attributeTitlesByUid.set(uid, title);
      }
    }
    return resolvePlaceEntity(entity, legacyUids, { fields, attributeTitlesByUid });
  }

  return { resolvePage };
}

export const __test = {
  chooseField,
  coordinate,
  displayValue: displayAttributeValue,
  exactMetaChildren,
  harcCandidates,
  legacyCandidates,
  parseGeometry,
  structuralCandidates,
};
