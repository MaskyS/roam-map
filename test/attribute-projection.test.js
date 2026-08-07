import test from "node:test";
import assert from "node:assert/strict";

import {
  imageAssetId,
  imageUrlFromMarkdown,
  projectAttributes,
} from "../src/attribute-projection.js";
import { FEATURE_PROPERTIES } from "../src/map-contract.js";
import { PLACE_FIELDS, resolvePlaceEntity } from "../src/place-resolver.js";

const FIELD_UIDS = new Map([
  [PLACE_FIELDS.latitude, "attr-lat"],
  [PLACE_FIELDS.longitude, "attr-lon"],
  [PLACE_FIELDS.geometry, "attr-geometry"],
  [PLACE_FIELDS.address, "attr-address"],
  [PLACE_FIELDS.geocoderId, "attr-geocoder"],
]);

function relation(uid, title, values) {
  return {
    ":harc/a": [{ ":block/uid": uid, ":node/title": title }],
    ":harc/v": values,
  };
}

test("title-keyed attributes, image assets, and compiler properties share one feature", () => {
  const sourceUrl = "https://example.com/portrait.jpg";
  const entity = {
    ":block/uid": "person",
    ":node/title": "[[People]]/Ada Lovelace",
    ":harc/_e": [
      relation("attr-lat", PLACE_FIELDS.latitude, [{ ":harc/v-string": "51.5072" }]),
      relation("attr-lon", PLACE_FIELDS.longitude, [{ ":harc/v-string": "-0.1276" }]),
      relation("attr-picture", "Profile Picture", [{ ":harc/v-string": `![](${sourceUrl})` }]),
      relation("attr-tags", "Tags", [
        { ":node/title": "Mathematician" },
        { ":node/title": "Programmer" },
      ]),
      relation("attr-active", "Active", [true]),
    ],
  };
  const record = resolvePlaceEntity(entity, FIELD_UIDS);

  assert.equal(record.feature.properties["Profile Picture"], imageAssetId(sourceUrl));
  assert.deepEqual(record.feature.properties.Tags, ["Mathematician", "Programmer"]);
  assert.equal(record.feature.properties.Active, true);
  assert.equal(record.feature.properties[FEATURE_PROPERTIES.pageUid], "person");
  assert.equal(record.feature.properties[FEATURE_PROPERTIES.title], "[[People]]/Ada Lovelace");
  assert.equal("pageUid" in record.feature.properties, false);
  assert.deepEqual(record.assets, [
    {
      id: imageAssetId(sourceUrl),
      sourceUrl,
      attributeTitle: "Profile Picture",
      attributeUid: "attr-picture",
      pageUid: "person",
      width: 64,
      height: 64,
      pixelRatio: 2,
    },
  ]);
  assert.ok(record.attributeUids.includes("attr-picture"));
});

test("legacy attributes use their page titles and preserve multiple values", () => {
  const sv = (value) => ({ value });
  const entity = {
    ":block/uid": "person",
    ":entity/attrs": [
      [sv([":block/uid", "person"]), sv([":block/uid", "attr-circle"]), sv("Friends")],
      [sv([":block/uid", "person"]), sv([":block/uid", "attr-circle"]), sv("Authors")],
    ],
  };
  const result = projectAttributes(entity, {
    attributeTitlesByUid: new Map([["attr-circle", "Circle"]]),
  });

  assert.deepEqual(result.properties, { Circle: ["Friends", "Authors"] });
  assert.deepEqual(result.attributeUids, ["attr-circle"]);
});

test("reserved attribute titles are diagnosed instead of silently renamed", () => {
  const result = projectAttributes({
    ":block/uid": "page",
    ":harc/_e": [relation("reserved", "roam/title", [{ ":harc/v-string": "Mine" }])],
  });

  assert.deepEqual(result.properties, {});
  assert.equal(result.diagnostics[0].code, "attribute.reserved-title");
});

test("Roam's structural roam/meta relationship is omitted without a warning", () => {
  const result = projectAttributes({
    ":block/uid": "page",
    ":harc/_e": [relation("meta", "roam/meta", [])],
  });

  assert.deepEqual(result.properties, {});
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.attributeUids, ["meta"]);
});

test("only complete HTTP image Markdown becomes an opaque asset token", () => {
  assert.equal(imageUrlFromMarkdown("![](https://example.com/a.png)"), "https://example.com/a.png");
  assert.equal(imageUrlFromMarkdown("portrait ![](https://example.com/a.png)"), null);
  assert.equal(imageUrlFromMarkdown("![](file:///tmp/a.png)"), null);
  assert.equal(imageAssetId("https://example.com/a.png"), imageAssetId("https://example.com/a.png"));
  assert.notEqual(imageAssetId("https://example.com/a.png"), imageAssetId("https://example.com/b.png"));
});
