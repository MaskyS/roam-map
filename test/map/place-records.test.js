import test from "node:test";
import assert from "node:assert/strict";

import {
  createPlaceResolver,
  PLACE_FIELDS,
  resolveLocatedEntity,
  resolvePlaceEntity,
} from "../../src/map/place-records.js";

const ATTRIBUTE_UIDS = new Map([
  [PLACE_FIELDS.coordinates, "attr-coordinates"],
  [PLACE_FIELDS.geometry, "attr-geometry"],
  [PLACE_FIELDS.address, "attr-address"],
  [PLACE_FIELDS.geocoderId, "attr-geocoder"],
]);

function sv(value, colonKeys = false) {
  return colonKeys ? { ":value": value } : { value };
}

function legacy(uid, field, value, colonKeys = false) {
  return [
    sv([":block/uid", uid], colonKeys),
    sv([":block/uid", ATTRIBUTE_UIDS.get(field)], colonKeys),
    sv(value, colonKeys),
  ];
}

function harc(field, value, key = ":harc/v-string") {
  return {
    ":harc/a": [{ ":node/title": field }],
    ":harc/v": [{ [key]: value }],
  };
}

function page(uid, title, options = {}) {
  return {
    ":block/uid": uid,
    ":node/title": title,
    ":entity/attrs": options.legacy ?? [],
    ":harc/_e": options.modern ?? [],
    ":block/children": options.children ?? [],
  };
}

function block(uid, string, options = {}) {
  return {
    ":block/uid": uid,
    ":block/string": string,
    ":entity/attrs": options.legacy ?? [],
    ":harc/_e": options.modern ?? [],
    ":block/children": options.children ?? [],
  };
}

test("current HARC coordinates produce a page-identified point, including zero", () => {
  const record = resolvePlaceEntity(
    page("zero", "[[Places]]/Null Island", {
      modern: [
        harc(PLACE_FIELDS.coordinates, "geo:0,0;u=4", ":harc.text/string"),
        harc(PLACE_FIELDS.address, "Gulf of Guinea"),
      ],
    }),
    ATTRIBUTE_UIDS,
  );
  assert.deepEqual(record.feature.geometry, { type: "Point", coordinates: [0, 0] });
  assert.equal(record.feature.id, "page:zero");
  assert.equal(record.feature.properties["roam/uncertaintyMeters"], 4);
  assert.equal(record.label, "Null Island");
  assert.equal(record.diagnostics.length, 0);
});

test("legacy attributes under roam/meta resolve through the parent page", () => {
  const metadata = {
    ":block/uid": "meta-port",
    ":block/string": "roam/meta::",
    ":entity/attrs": [
      legacy("meta-port", PLACE_FIELDS.coordinates, "geo:-20.1609,57.5012", true),
      legacy("meta-port", PLACE_FIELDS.geocoderId, "photon:port", true),
    ],
  };
  const record = resolvePlaceEntity(
    page("port", "Port Louis", { children: [metadata] }),
    ATTRIBUTE_UIDS,
  );
  assert.deepEqual(record.feature.geometry.coordinates, [57.5012, -20.1609]);
  assert.equal(record.geocoderId, "photon:port");
});

test("exact roam/meta structural values are a compatibility fallback", () => {
  const metadata = {
    ":block/uid": "meta",
    ":block/string": "roam/meta::",
    ":block/children": [
      { ":block/uid": "coordinates", ":block/string": "Coordinates:: geo:-21,55.5" },
    ],
  };
  const record = resolvePlaceEntity(page("p", "Point", { children: [metadata] }), ATTRIBUTE_UIDS);
  assert.deepEqual(record.feature.geometry.coordinates, [55.5, -21]);
});

test("current values win while malformed geo URIs remain visible", () => {
  const record = resolvePlaceEntity(
    page("mixed", "Mixed", {
      modern: [harc(PLACE_FIELDS.coordinates, "geo:10,bad")],
      legacy: [legacy("mixed", PLACE_FIELDS.coordinates, "geo:20,30")],
    }),
    ATTRIBUTE_UIDS,
  );
  assert.equal(record.feature, null);
  assert.deepEqual(
    new Set(record.diagnostics.map(({ code }) => code)),
    new Set([
      "place.conflicting-attribute-models",
      "place.invalid-coordinates",
      "place.no-renderable-location",
    ]),
  );
});

test("valid GeoJSON remains serializable and coordinates take explicit precedence", () => {
  const polygon = JSON.stringify({
    type: "Polygon",
    coordinates: [[[57, -20], [58, -20], [58, -21], [57, -20]]],
  });
  const geometryOnly = resolvePlaceEntity(
    page("area", "Area", { modern: [harc(PLACE_FIELDS.geometry, polygon)] }),
    ATTRIBUTE_UIDS,
  );
  assert.equal(geometryOnly.feature.geometry.type, "Polygon");

  const conflictingPoint = resolvePlaceEntity(
    page("both", "Both", {
      modern: [
        harc(PLACE_FIELDS.coordinates, "geo:1,2"),
        harc(PLACE_FIELDS.geometry, JSON.stringify({ type: "Point", coordinates: [8, 9] })),
      ],
    }),
    ATTRIBUTE_UIDS,
  );
  assert.deepEqual(conflictingPoint.feature.geometry.coordinates, [2, 1]);
  assert.ok(conflictingPoint.diagnostics.some(({ code }) => code === "place.conflicting-location"));
});

test("malformed GeoJSON coordinates are rejected before reaching MapLibre", () => {
  const geometries = [
    { type: "Point", coordinates: [] },
    { type: "Point", coordinates: ["east", "north"] },
    { type: "Polygon", coordinates: [1, 2, 3] },
    {
      type: "GeometryCollection",
      geometries: [{ type: "Point", coordinates: [200, 95] }],
    },
  ];

  for (const [index, geometry] of geometries.entries()) {
    const record = resolvePlaceEntity(
      page(`invalid-${index}`, `Invalid ${index}`, {
        modern: [harc(PLACE_FIELDS.geometry, JSON.stringify(geometry))],
      }),
      ATTRIBUTE_UIDS,
    );
    assert.equal(record.feature, null);
    assert.ok(record.diagnostics.some(({ code }) => code === "place.invalid-geometry"));
  }
});

test("multiple place pages are read in one pull_many batch", async () => {
  const pages = [
    page("a", "A", {
      modern: [harc(PLACE_FIELDS.coordinates, "geo:-20,57")],
    }),
    page("b", "B", {
      modern: [harc(PLACE_FIELDS.coordinates, "geo:-21,58")],
    }),
  ];
  const batches = [];
  const resolver = createPlaceResolver({
    pullByTitle: async (_pattern, title) => ({ ":block/uid": `attribute:${title}` }),
    pullMany: async (_pattern, uids) => {
      batches.push(uids);
      return pages.filter((item) => uids.includes(item[":block/uid"]));
    },
  });

  const records = await resolver.resolvePages(["a", "b"]);

  assert.deepEqual(batches, [["a", "b"]]);
  assert.deepEqual(records.map(({ entityUid }) => entityUid), ["a", "b"]);
});

test("bare and named block points retain block identity", () => {
  const bare = resolveLocatedEntity(block("bare", "geo:-20.1,57.5;u=8"), ATTRIBUTE_UIDS, {
    expectedIdentityKind: "block",
    allowInlineCoordinates: true,
  });
  assert.equal(bare.identityKind, "block");
  assert.equal(bare.feature.id, "block:bare");
  assert.equal(bare.feature.properties["roam/entityUid"], "bare");
  assert.equal(bare.label, "-20.1, 57.5");

  const named = resolveLocatedEntity(
    block("named", "Paris meeting point", {
      children: [
        {
          ":block/uid": "coordinates",
          ":block/string": "Coordinates:: geo:48.8566,2.3522",
        },
      ],
    }),
    ATTRIBUTE_UIDS,
    { expectedIdentityKind: "block" },
  );
  assert.equal(named.label, "Paris meeting point");
  assert.deepEqual(named.feature.geometry.coordinates, [2.3522, 48.8566]);
});

test("an identity-kind mismatch is diagnosed and never rendered under the wrong identity", () => {
  const record = resolveLocatedEntity(block("actual-block", "geo:1,2"), ATTRIBUTE_UIDS, {
    expectedIdentityKind: "page",
    allowInlineCoordinates: true,
  });

  assert.equal(record.feature, null);
  assert.ok(
    record.diagnostics.some(({ code }) => code === "place.identity-kind-mismatch"),
  );
});
