import test from "node:test";
import assert from "node:assert/strict";

import { createDirectSourceCompiler } from "../src/direct-source.js";

const pageRef = (uid, title) => ({ ":block/uid": uid, ":node/title": title });
const blockRef = (uid, string = "referenced") => ({ ":block/uid": uid, ":block/string": string });
const block = (uid, order, string, refs = [], children = []) => ({
  ":block/uid": uid,
  ":block/order": order,
  ":block/string": string,
  ":block/refs": refs,
  ":block/children": children,
});

test("compiles nested page refs in outline order, deduplicates, and follows leaf block refs", async () => {
  const referenced = block("ref-def", 0, "[[Curepipe]]", [pageRef("c", "Curepipe")]);
  const root = block("map", 0, "{{map}}", [], [
    block("late", 1, "alias text [Artisan]([[Cafe]]/Artisan Coffee)", [pageRef("a", "[[Cafe]]/Artisan Coffee")]),
    block("group", 0, "South", [], [
      block("port", 0, "[[Port Louis]]", [pageRef("p", "Port Louis")]),
      block("duplicate", 1, "again [[[[Cafe]]/Artisan Coffee]]", [pageRef("a", "[[Cafe]]/Artisan Coffee")]),
      block("include", 2, "((ref-def))", [blockRef("ref-def")]),
    ]),
  ]);
  const calls = [];
  const compiler = createDirectSourceCompiler({
    pull: async (_pattern, uid) => {
      calls.push(uid);
      return uid === "map" ? root : uid === "ref-def" ? referenced : null;
    },
  });
  const result = await compiler.compile("map");

  assert.deepEqual(result.items.map(({ pageUid }) => pageUid), ["p", "a", "c"]);
  assert.equal(result.items[1].provenance.length, 2);
  assert.deepEqual(result.watchUids, ["ref-def"]);
  assert.deepEqual(calls, ["map", "ref-def"]);
  assert.deepEqual(result.diagnostics, []);
});

test("multiple distinct page refs in one source are diagnosed instead of guessed", async () => {
  const root = block("map", 0, "{{map}}", [], [
    block("many", 0, "[[A]] and [[B]]", [pageRef("a", "A"), pageRef("b", "B")]),
  ]);
  const compiler = createDirectSourceCompiler({ pull: async () => root });
  const result = await compiler.compile("map");
  assert.deepEqual(result.items, []);
  assert.equal(result.diagnostics[0].code, "source.ambiguous-page-references");
});

test("nested namespace links select the outer page ref recorded by Roam", async () => {
  const root = block("map", 0, "{{map}}", [], [
    block(
      "port-louis",
      0,
      "[[[[Places]]/Port Louis]]",
      [pageRef("places", "Places"), pageRef("port-louis-page", "[[Places]]/Port Louis")],
    ),
  ]);
  const compiler = createDirectSourceCompiler({ pull: async () => root });
  const result = await compiler.compile("map");

  assert.deepEqual(result.items.map(({ pageUid }) => pageUid), ["port-louis-page"]);
  assert.deepEqual(result.diagnostics, []);
});

test("a separately linked namespace page remains a distinct source", async () => {
  const root = block("map", 0, "{{map}}", [], [
    block(
      "both",
      0,
      "[[Places]] and [[[[Places]]/Port Louis]]",
      [pageRef("places", "Places"), pageRef("port-louis-page", "[[Places]]/Port Louis")],
    ),
  ]);
  const compiler = createDirectSourceCompiler({ pull: async () => root });
  const result = await compiler.compile("map");

  assert.deepEqual(result.items, []);
  assert.equal(result.diagnostics[0].code, "source.ambiguous-page-references");
});

test("empty maps are instructional while inline arguments are retained as diagnostics", async () => {
  const empty = createDirectSourceCompiler({
    pull: async () => block("map", 0, "{{map}}"),
  });
  assert.deepEqual((await empty.compile("map")).diagnostics, []);

  const inline = createDirectSourceCompiler({
    pull: async () => block("map", 0, "{{map: {and: [[Cafe]] [[Mauritius]]}}}"),
  });
  const result = await inline.compile("map");
  assert.equal(result.definition.argument, "{and: [[Cafe]] [[Mauritius]]}");
  assert.equal(result.diagnostics[0].code, "source.inline-not-supported-yet");
});

test("map attributes are configuration while map/marker contributes a styled page source", async () => {
  const basemap = block("basemap", 0, "map/basemap:: satellite");
  const markerColor = block("marker-color", 0, "map/color:: #d9822b");
  const marker = block(
    "marker",
    1,
    "map/marker:: [[Port Louis]]",
    [pageRef("marker-attr", "map/marker"), pageRef("port", "Port Louis")],
    [markerColor],
  );
  const curepipe = block("curepipe", 2, "[[Curepipe]]", [pageRef("curepipe-page", "Curepipe")]);
  const root = block("map", 0, "{{map}}", [], [basemap, marker, curepipe]);
  root[":harc/_e"] = [
    {
      ":harc/a": [{ ":node/title": "map/basemap" }],
      ":harc/v": [{ ":harc/v-string": "satellite" }],
      ":harc/a-source": [{ ":block/uid": "basemap" }],
    },
    {
      ":harc/a": [{ ":node/title": "map/marker" }],
      ":harc/v": [{ ":block/uid": "port", ":node/title": "Port Louis" }],
      ":harc/a-source": [{ ":block/uid": "marker" }],
      ":harc/_e": [
        {
          ":harc/a": [{ ":node/title": "map/color" }],
          ":harc/v": [{ ":harc/v-string": "#d9822b" }],
          ":harc/a-source": [{ ":block/uid": "marker-color" }],
        },
      ],
    },
  ];
  const compiler = createDirectSourceCompiler({
    pull: async () => root,
    pullByTitle: async () => null,
  });

  const result = await compiler.compile("map");

  assert.equal(result.presentation.basemap, "satellite");
  assert.deepEqual(result.items.map(({ pageUid }) => pageUid), ["port", "curepipe-page"]);
  assert.deepEqual(result.items[0].presentation, { color: "#d9822b", radius: 8 });
  assert.deepEqual(result.diagnostics, []);
});
