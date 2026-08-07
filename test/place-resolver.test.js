import test from "node:test";
import assert from "node:assert/strict";

import { PLACE_FIELDS, resolvePlaceEntity } from "../src/place-resolver.js";

const ATTRIBUTE_UIDS = new Map([
  [PLACE_FIELDS.latitude, "attr-lat"],
  [PLACE_FIELDS.longitude, "attr-lon"],
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

test("current HARC coordinates produce a page-identified point, including zero", () => {
  const record = resolvePlaceEntity(
    page("zero", "[[Places]]/Null Island", {
      modern: [
        harc(PLACE_FIELDS.latitude, "0"),
        harc(PLACE_FIELDS.longitude, "0", ":harc.text/string"),
        harc(PLACE_FIELDS.address, "Gulf of Guinea"),
      ],
    }),
    ATTRIBUTE_UIDS,
  );
  assert.deepEqual(record.feature.geometry, { type: "Point", coordinates: [0, 0] });
  assert.equal(record.feature.id, "page:zero");
  assert.equal(record.label, "Null Island");
  assert.equal(record.diagnostics.length, 0);
});

test("legacy attributes under roam/meta resolve through the parent page", () => {
  const metadata = {
    ":block/uid": "meta-port",
    ":block/string": "roam/meta::",
    ":entity/attrs": [
      legacy("meta-port", PLACE_FIELDS.latitude, "-20.1609", true),
      legacy("meta-port", PLACE_FIELDS.longitude, "57.5012", true),
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
      { ":block/uid": "lat", ":block/string": "Latitude:: -21" },
      { ":block/uid": "lon", ":block/string": "Longitude:: 55.5" },
    ],
  };
  const record = resolvePlaceEntity(page("p", "Point", { children: [metadata] }), ATTRIBUTE_UIDS);
  assert.deepEqual(record.feature.geometry.coordinates, [55.5, -21]);
});

test("current values win while conflicts and invalid coordinate pairs remain visible", () => {
  const record = resolvePlaceEntity(
    page("mixed", "Mixed", {
      modern: [harc(PLACE_FIELDS.latitude, "10"), harc(PLACE_FIELDS.longitude, "bad")],
      legacy: [legacy("mixed", PLACE_FIELDS.latitude, "20")],
    }),
    ATTRIBUTE_UIDS,
  );
  assert.equal(record.feature, null);
  assert.deepEqual(
    new Set(record.diagnostics.map(({ code }) => code)),
    new Set([
      "place.conflicting-attribute-models",
      "place.invalid-coordinate",
      "place.incomplete-coordinates",
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
        harc(PLACE_FIELDS.latitude, "1"),
        harc(PLACE_FIELDS.longitude, "2"),
        harc(PLACE_FIELDS.geometry, JSON.stringify({ type: "Point", coordinates: [8, 9] })),
      ],
    }),
    ATTRIBUTE_UIDS,
  );
  assert.deepEqual(conflictingPoint.feature.geometry.coordinates, [2, 1]);
  assert.ok(conflictingPoint.diagnostics.some(({ code }) => code === "place.conflicting-location"));
});
