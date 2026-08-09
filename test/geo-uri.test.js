import test from "node:test";
import assert from "node:assert/strict";

import { formatGeoUri, isGeoUri, parseGeoUri } from "../src/geo-uri.js";

test("geo URIs preserve coordinate zero and optional WGS84 uncertainty", () => {
  assert.deepEqual(parseGeoUri("geo:0,0"), { lat: 0, lon: 0, uncertainty: null });
  assert.deepEqual(parseGeoUri("GEO:-20.1609,57.5012;crs=WGS84;u=14.4"), {
    lat: -20.1609,
    lon: 57.5012,
    uncertainty: 14.4,
  });
});

test("the serializer emits one canonical decimal WGS84 URI", () => {
  assert.equal(formatGeoUri({ lat: -0, lon: 57.5 }), "geo:0,57.5");
  assert.equal(
    formatGeoUri({ lat: 1e-7, lon: -2e-7, uncertainty: 3.5 }),
    "geo:0.0000001,-0.0000002;u=3.5",
  );
});

test("unsupported, ambiguous, and out-of-range geo values are rejected", () => {
  for (const value of [
    "20,57",
    "geo:20",
    "geo:20,57,4",
    "geo:91,57",
    "geo:20,181",
    "geo:20,57 trailing",
    "geo:20,57;crs=moon",
    "geo:20,57;u=-1",
    "geo:20,57;u=1;u=2",
    "geo:20,57;foo=bar",
    "[point](geo:20,57)",
  ]) {
    assert.throws(() => parseGeoUri(value), Error, value);
  }
  assert.throws(() => formatGeoUri({ lat: NaN, lon: 0 }), /finite/u);
  assert.throws(() => formatGeoUri({ lat: 0, lon: 0, uncertainty: -1 }), /negative/u);
  assert.equal(isGeoUri(" geo:20,57 "), true);
  assert.equal(isGeoUri("Coordinates:: geo:20,57"), false);
});
