// Roam exposes current HARC attributes and compatibility triples. This boundary
// normalizes either representation into plain records before MapLibre sees it.
import {
  currentAttributeValues,
  displayAttributeValue,
  legacyAttributeValues,
  list,
} from "../roam/attribute-values.js";
import { legacyAttributeUids, projectAttributes } from "../roam/project-attributes.js";
import { isGeoUri, parseGeoUri } from "../geo-uri.js";
import { FEATURE_PROPERTIES } from "./feature-properties.js";

export const PLACE_FIELDS = Object.freeze({
  coordinates: "Coordinates",
  geometry: "Geometry",
  address: "Address",
  geocoderId: "Geocoder ID",
});

export const LOCATION_ENTITY_PATTERN = `[
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
  const bracketedPrefix = `[[${attributeTitle}]]::`;
  return [entity, ...exactMetaChildren(entity)].flatMap((source) =>
    list(source?.[":block/children"])
      .map((child) => child?.[":block/string"])
      .filter(
        (string) =>
          typeof string === "string" &&
          (string.startsWith(prefix) || string.startsWith(bracketedPrefix)),
      )
      .map((string) =>
        string.slice(string.startsWith(prefix) ? prefix.length : bracketedPrefix.length).trim(),
      )
      .filter(Boolean),
  );
}

function comparable(value) {
  return typeof value === "string" ? value.trim() : JSON.stringify(value);
}

function diagnostic({
  code,
  message,
  entityUid,
  identityKind = null,
  field = null,
  severity = "warning",
  detail = null,
}) {
  return {
    key: [code, identityKind, entityUid, field, detail].filter(Boolean).join(":"),
    code,
    severity,
    message,
    entityUid,
    ...(identityKind ? { identityKind } : {}),
    ...(field ? { field } : {}),
    ...(detail ? { detail } : {}),
  };
}

function chooseField(entity, attributeTitle, attributeUids, diagnostics) {
  const entityUid = entity?.[":block/uid"] ?? "unknown";
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
        entityUid,
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
        entityUid,
        field: attributeTitle,
        message: `${attributeTitle} differs between attribute representations; the current representation takes precedence.`,
        detail: shadowed.join(" | "),
      }),
    );
  }
  return chosen;
}

function parseCoordinates(raw, { entityUid, identityKind, field, diagnostics }) {
  if (raw == null || (typeof raw === "string" && raw.trim() === "")) return null;
  try {
    return parseGeoUri(raw);
  } catch (error) {
    diagnostics.push(
      diagnostic({
        code: "place.invalid-coordinates",
        entityUid,
        identityKind,
        field,
        message: `${field} must be a two-dimensional WGS84 geo URI: ${error.message}`,
        detail: String(raw),
      }),
    );
    return null;
  }
}

function validPosition(value) {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    value.every(Number.isFinite) &&
    value[0] >= -180 &&
    value[0] <= 180 &&
    value[1] >= -90 &&
    value[1] <= 90
  );
}

function validLine(coordinates) {
  return Array.isArray(coordinates) && coordinates.length >= 2 && coordinates.every(validPosition);
}

function samePosition(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function validRing(coordinates) {
  return (
    Array.isArray(coordinates) &&
    coordinates.length >= 4 &&
    coordinates.every(validPosition) &&
    samePosition(coordinates[0], coordinates.at(-1))
  );
}

function validGeometry(value) {
  if (!value || typeof value !== "object") return false;
  switch (value.type) {
    case "Point":
      return validPosition(value.coordinates);
    case "MultiPoint":
      return Array.isArray(value.coordinates) && value.coordinates.length > 0 && value.coordinates.every(validPosition);
    case "LineString":
      return validLine(value.coordinates);
    case "MultiLineString":
      return Array.isArray(value.coordinates) && value.coordinates.length > 0 && value.coordinates.every(validLine);
    case "Polygon":
      return Array.isArray(value.coordinates) && value.coordinates.length > 0 && value.coordinates.every(validRing);
    case "MultiPolygon":
      return (
        Array.isArray(value.coordinates) &&
        value.coordinates.length > 0 &&
        value.coordinates.every(
          (polygon) => Array.isArray(polygon) && polygon.length > 0 && polygon.every(validRing),
        )
      );
    case "GeometryCollection":
      return Array.isArray(value.geometries) && value.geometries.every(validGeometry);
    default:
      return false;
  }
}

function parseGeometry(raw, entityUid, identityKind, diagnostics) {
  if (raw == null || raw === "") return { geometry: null, reference: null };
  if (typeof raw === "string" && /^\[\[[\s\S]+\]\]$/.test(raw.trim())) {
    diagnostics.push(
      diagnostic({
        code: "place.geometry-reference",
        entityUid,
        identityKind,
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
          entityUid,
          identityKind,
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
        entityUid,
        identityKind,
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

export function resolveLocatedEntity(
  entity,
  attributeUids,
  {
    fields = PLACE_FIELDS,
    attributeTitlesByUid = null,
    expectedIdentityKind = null,
    allowInlineCoordinates = false,
  } = {},
) {
  const diagnostics = [];
  const entityUid = entity?.[":block/uid"] ?? null;
  const pageTitle = entity?.[":node/title"] ?? null;
  const blockString = entity?.[":block/string"] ?? null;
  const identityKind = pageTitle ? "page" : typeof blockString === "string" ? "block" : expectedIdentityKind;
  const title = identityKind === "page" ? pageTitle : blockString;
  if (!entityUid || !identityKind || typeof title !== "string") {
    return {
      entityUid,
      identityKind,
      title,
      label: title ?? entityUid ?? "Unknown source",
      feature: null,
      diagnostics: [
        diagnostic({
          code: "place.invalid-entity",
          entityUid: entityUid ?? "unknown",
          identityKind,
          severity: "error",
          message: "The source UID did not resolve to the expected Roam page or block.",
        }),
      ],
    };
  }
  const identityKindMismatch = Boolean(
    expectedIdentityKind && expectedIdentityKind !== identityKind,
  );
  if (identityKindMismatch) {
    diagnostics.push(
      diagnostic({
        code: "place.identity-kind-mismatch",
        entityUid,
        identityKind,
        severity: "error",
        message: `The source was expected to resolve to a ${expectedIdentityKind}, but Roam returned a ${identityKind}.`,
      }),
    );
  }

  const raw = Object.fromEntries(
    Object.entries(fields).map(([key, attributeTitle]) => [
      key,
      chooseField(entity, attributeTitle, attributeUids, diagnostics),
    ]),
  );
  if (allowInlineCoordinates && identityKind === "block" && isGeoUri(blockString)) {
    if (raw.coordinates != null) {
      diagnostics.push(
        diagnostic({
          code: "place.conflicting-location",
          entityUid,
          identityKind,
          field: fields.coordinates,
          message: "This block contains both a bare geo URI and a Coordinates attribute; the attribute takes precedence.",
        }),
      );
    } else {
      raw.coordinates = blockString.trim();
    }
  }
  const titlesByUid =
    attributeTitlesByUid ??
    new Map([...attributeUids].map(([titleValue, uid]) => [uid, titleValue]));
  const projection = projectAttributes(entity, {
    attributeTitlesByUid: titlesByUid,
    identityKind,
  });
  diagnostics.push(...projection.diagnostics);
  const coordinateValuesConflict = diagnostics.some(
    (item) =>
      item.code === "place.conflicting-field-values" && item.field === fields.coordinates,
  );
  const coordinates = coordinateValuesConflict
    ? null
    : parseCoordinates(raw.coordinates, {
        entityUid,
        identityKind,
        field: fields.coordinates,
        diagnostics,
      });
  const parsedGeometry = parseGeometry(raw.geometry, entityUid, identityKind, diagnostics);
  let geometry = parsedGeometry.geometry;

  if (coordinates) {
    if (geometry) {
      diagnostics.push(
        diagnostic({
          code: "place.conflicting-location",
          entityUid,
          identityKind,
          message: "Coordinates and Geometry are both present; Coordinates take precedence.",
        }),
      );
    }
    geometry = { type: "Point", coordinates: [coordinates.lon, coordinates.lat] };
  }

  if (!geometry) {
    diagnostics.push(
      diagnostic({
        code: "place.no-renderable-location",
        entityUid,
        identityKind,
        message: parsedGeometry.reference
          ? "The source has referenced geometry but no directly renderable point."
          : "The source has no valid Coordinates geo URI or GeoJSON geometry.",
      }),
    );
  }

  const label = identityKind === "page"
    ? pageTitleLeaf(title) || title
    : coordinates && isGeoUri(title)
      ? `${coordinates.lat}, ${coordinates.lon}`
      : title.trim() || "Untitled point";
  const feature = geometry && !identityKindMismatch
    ? {
        type: "Feature",
        id: `${identityKind}:${entityUid}`,
        geometry,
        properties: {
          ...projection.properties,
          [FEATURE_PROPERTIES.identityKind]: identityKind,
          [FEATURE_PROPERTIES.entityUid]: entityUid,
          [FEATURE_PROPERTIES.title]: title,
          [FEATURE_PROPERTIES.label]: label,
          [FEATURE_PROPERTIES.address]: raw.address == null ? null : String(raw.address),
          [FEATURE_PROPERTIES.geocoderId]:
            raw.geocoderId == null ? null : String(raw.geocoderId),
          [FEATURE_PROPERTIES.uncertaintyMeters]: coordinates?.uncertainty ?? null,
        },
      }
    : null;

  return {
    entityUid,
    identityKind,
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

export function resolvePlaceEntity(entity, attributeUids, options = {}) {
  return resolveLocatedEntity(entity, attributeUids, {
    ...options,
    expectedIdentityKind: "page",
  });
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

  async function resolveEntities(requests) {
    const normalized = requests.map((request) =>
      typeof request === "string"
        ? { entityUid: request, identityKind: "page", allowInlineCoordinates: false }
        : request,
    );
    const uniqueEntityUids = [
      ...new Set(normalized.map(({ entityUid }) => entityUid).filter(Boolean)),
    ];
    const [entities, legacyUids] = await Promise.all([
      typeof api.pullMany === "function"
        ? api.pullMany(LOCATION_ENTITY_PATTERN, uniqueEntityUids)
        : Promise.all(
            uniqueEntityUids.map((uid) => api.pull(LOCATION_ENTITY_PATTERN, uid)),
          ),
      attributeUids(),
    ]);
    const entitiesByUid = new Map(
      entities
        .filter((entity) => entity?.[":block/uid"])
        .map((entity) => [entity[":block/uid"], entity]),
    );
    const attributeTitlesByUid = new Map(
      [...legacyUids].map(([title, uid]) => [uid, title]),
    );
    const unknownAttributeUids = new Set();
    for (const entity of entitiesByUid.values()) {
      for (const uid of legacyAttributeUids(entity)) {
        if (!attributeTitlesByUid.has(uid)) unknownAttributeUids.add(uid);
      }
    }
    if (unknownAttributeUids.size > 0 && typeof api.pullMany === "function") {
      const attributePages = await api.pullMany(
        "[:block/uid :node/title]",
        [...unknownAttributeUids],
      );
      for (const attributePage of attributePages) {
        const uid = attributePage?.[":block/uid"];
        const title = attributePage?.[":node/title"];
        if (uid && title) attributeTitlesByUid.set(uid, title);
      }
    }
    return normalized.map(({ entityUid, identityKind, allowInlineCoordinates = false }) =>
      resolveLocatedEntity(
        entitiesByUid.get(entityUid) ?? { ":block/uid": entityUid },
        legacyUids,
        {
          fields,
          attributeTitlesByUid,
          expectedIdentityKind: identityKind,
          allowInlineCoordinates,
        },
      ),
    );
  }

  async function resolvePages(pageUids) {
    return resolveEntities(
      pageUids.map((entityUid) => ({ entityUid, identityKind: "page" })),
    );
  }

  async function resolvePage(pageUid) {
    return (await resolvePages([pageUid]))[0];
  }

  return { resolveEntities, resolvePage, resolvePages };
}

export const __test = {
  chooseField,
  displayValue: displayAttributeValue,
  exactMetaChildren,
  harcCandidates,
  legacyCandidates,
  parseCoordinates,
  parseGeometry,
  structuralCandidates,
  validGeometry,
};
