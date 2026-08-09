import test from "node:test";
import assert from "node:assert/strict";

import { createDirectSourceCompiler } from "../../src/map/direct-sources.js";

const pageRef = (uid, title) => ({ ":block/uid": uid, ":node/title": title });
const blockRef = (uid, string = "referenced") => ({ ":block/uid": uid, ":block/string": string });
const block = (uid, order, string, refs = [], children = []) => ({
  ":block/uid": uid,
  ":block/order": order,
  ":block/string": string,
  ":block/refs": refs,
  ":block/children": children,
});

test("compiles direct contributions in outline order and bulk-resolves leaf block refs", async () => {
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
      return uid === "map" ? root : null;
    },
    pullMany: async (_pattern, uids) => {
      calls.push(uids);
      return [referenced];
    },
  });
  const result = await compiler.compile("map");

  assert.deepEqual(result.contributions.map(({ entityUid }) => entityUid), ["p", "a", "c", "a"]);
  assert.deepEqual(result.watchUids, ["ref-def"]);
  assert.deepEqual(calls, ["map", ["ref-def"]]);
  assert.deepEqual(result.diagnostics, []);
});

test("multiple distinct page refs in one source are diagnosed instead of guessed", async () => {
  const root = block("map", 0, "{{map}}", [], [
    block("many", 0, "[[A]] and [[B]]", [pageRef("a", "A"), pageRef("b", "B")]),
  ]);
  const compiler = createDirectSourceCompiler({ pull: async () => root });
  const result = await compiler.compile("map");
  assert.deepEqual(result.contributions, []);
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

  assert.deepEqual(result.contributions.map(({ entityUid }) => entityUid), ["port-louis-page"]);
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

  assert.deepEqual(result.contributions, []);
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

test("map presentation attributes are configuration rather than source contributions", async () => {
  const basemap = block("basemap", 0, "map/basemap:: satellite");
  const size = block("size", 1, "map/size:: 900 × 480");
  const curepipe = block("curepipe", 2, "[[Curepipe]]", [pageRef("curepipe-page", "Curepipe")]);
  const root = block("map", 0, "{{map}}", [], [basemap, size, curepipe]);
  root[":harc/_e"] = [
    {
      ":harc/a": [{ ":node/title": "map/basemap" }],
      ":harc/v": [{ ":harc/v-string": "satellite" }],
      ":harc/a-source": [{ ":block/uid": "basemap" }],
    },
    {
      ":harc/a": [{ ":node/title": "map/size" }],
      ":harc/v": [{ ":harc/v-string": "900 × 480" }],
      ":harc/a-source": [{ ":block/uid": "size" }],
    },
  ];
  const compiler = createDirectSourceCompiler({
    pull: async () => root,
    pullByTitle: async () => null,
  });

  const result = await compiler.compile("map");

  assert.equal(result.options.basemap, "satellite");
  assert.deepEqual(result.options.size, { maxWidth: 900, height: 480 });
  assert.deepEqual(result.optionSourceUids.size, ["size"]);
  assert.deepEqual(result.contributions.map(({ entityUid }) => entityUid), ["curepipe-page"]);
  assert.deepEqual(result.diagnostics, []);
});

test("Marker click code is configuration rather than a source contribution", async () => {
  const markerClickCode = block(
    "marker-click-code",
    0,
    "```javascript\nfunction markerClick() { return null; }\n```",
  );
  const markerClick = block("marker-click", 0, "Marker click", [], [markerClickCode]);
  const place = block("place", 1, "[[Port Louis]]", [pageRef("port", "Port Louis")]);
  const compiler = createDirectSourceCompiler({
    pull: async () => block("map", 0, "{{map}}", [], [markerClick, place]),
  });

  const result = await compiler.compile("map");

  assert.deepEqual(result.markerClick, {
    codeBlockUid: "marker-click-code",
    language: "javascript",
  });
  assert.deepEqual(result.contributions.map(({ entityUid }) => entityUid), ["port"]);
  assert.deepEqual(result.diagnostics, []);
});

test("bare geo URIs and named attributed blocks are first-class block sources", async () => {
  const bare = block("bare", 0, "geo:-20.1609,57.5012;u=12");
  const coordinates = block("coordinates", 0, "Coordinates:: geo:48.8566,2.3522");
  const category = block("category", 1, "Category:: Meeting point");
  const named = block("named", 1, "Paris meeting point", [], [coordinates, category]);
  const root = block("map", 0, "{{map}}", [], [bare, named]);
  const compiler = createDirectSourceCompiler({ pull: async () => root });

  const result = await compiler.compile("map");

  assert.deepEqual(result.contributions, [
    {
      identityKind: "block",
      entityUid: "bare",
      title: "geo:-20.1609,57.5012;u=12",
      allowInlineCoordinates: true,
      provenance: {
        sourceBlockUid: "bare",
        originBlockUid: "bare",
        viaBlockRefUid: null,
      },
    },
    {
      identityKind: "block",
      entityUid: "named",
      title: "Paris meeting point",
      allowInlineCoordinates: false,
      provenance: {
        sourceBlockUid: "named",
        originBlockUid: "named",
        viaBlockRefUid: null,
      },
    },
  ]);
  assert.deepEqual(result.diagnostics, []);
});

test("a current Coordinates relation identifies a named block source without DOM text parsing", async () => {
  const named = block("named", 0, "Current-model point");
  named[":harc/_e"] = [
    {
      ":harc/a": [{ ":node/title": "Coordinates" }],
      ":harc/v": [{ ":harc/v-string": "geo:51.5072,-0.1276" }],
    },
  ];
  const compiler = createDirectSourceCompiler({
    pull: async () => block("map", 0, "{{map}}", [], [named]),
  });

  const result = await compiler.compile("map");

  assert.equal(result.contributions.length, 1);
  assert.equal(result.contributions[0].identityKind, "block");
  assert.equal(result.contributions[0].entityUid, "named");
  assert.deepEqual(result.diagnostics, []);
});

test("a direct native query contributes result pages and containing pages", async () => {
  const query = block(
    "query",
    0,
    '{{[[query]]: "People map points" {and: [[People]]}}}',
    [pageRef("people", "People")],
  );
  const direct = block("direct", 1, "[[Port Louis]]", [pageRef("port", "Port Louis")]);
  const calls = [];
  const compiler = createDirectSourceCompiler({
    pull: async () => block("map", 0, "{{map}}", [], [query, direct]),
    roamQuery: async (args) => {
      calls.push(args);
      return {
        total: 2,
        results: [
          { ":block/uid": "person-page", ":node/title": "[[People]]/Person" },
          {
            ":block/uid": "point-block",
            ":block/string": "geo:-20,57",
            ":block/page": {
              ":block/uid": "point-owner",
              ":node/title": "[[Places]]/Point owner",
            },
          },
        ],
      };
    },
  });

  const result = await compiler.compile("map");

  assert.equal(calls[0].uid, "query");
  assert.deepEqual(
    result.contributions.map(({ identityKind, entityUid }) => ({ identityKind, entityUid })),
    [
      { identityKind: "page", entityUid: "person-page" },
      { identityKind: "page", entityUid: "point-owner" },
      { identityKind: "page", entityUid: "port" },
    ],
  );
  assert.equal(result.contributions.some(({ entityUid }) => entityUid === "people"), false);
  assert.deepEqual(result.watchUids, ["query"]);
  assert.deepEqual(result.diagnostics, []);
});

test("a fenced Datalog child accepts a flat UID collection and preserves outline order", async () => {
  const code = "[:find [?uid ...] :where [?page :block/uid ?uid]]";
  const datalog = block("datalog", 0, `\`\`\`clojure\n${code}\n\`\`\``);
  const direct = block("direct", 1, "[[Curepipe]]", [pageRef("curepipe", "Curepipe")]);
  const compiler = createDirectSourceCompiler({
    pull: async () => block("map", 0, "{{map}}", [], [datalog, direct]),
    datalogQuery: async (query) => {
      assert.equal(query, code);
      return ["effort"];
    },
    pullMany: async (_pattern, uids) => {
      assert.deepEqual(uids, ["effort"]);
      return [{ ":block/uid": "effort", ":node/title": "[[Efforts]]/Example" }];
    },
  });

  const result = await compiler.compile("map");

  assert.deepEqual(result.contributions.map(({ entityUid }) => entityUid), [
    "effort",
    "curepipe",
  ]);
  assert.deepEqual(result.watchUids, ["datalog"]);
  assert.deepEqual(result.diagnostics, []);
});

test("a direct-child block reference can reuse a fenced Datalog definition", async () => {
  const code = "[:find [?uid ...] :where [?page :block/uid ?uid]]";
  const definition = block("datalog-definition", 0, `\`\`\`datalog\n${code}\n\`\`\``);
  const source = block("source-ref", 0, "((datalog-definition))", [
    blockRef("datalog-definition", definition[":block/string"]),
  ]);
  const pullManyCalls = [];
  const compiler = createDirectSourceCompiler({
    pull: async () => block("map", 0, "{{map}}", [], [source]),
    datalogQuery: async () => [["person"]],
    pullMany: async (_pattern, uids) => {
      pullManyCalls.push(uids);
      if (uids[0] === "datalog-definition") return [definition];
      return [{ ":block/uid": "person", ":node/title": "[[People]]/Person" }];
    },
  });

  const result = await compiler.compile("map");

  assert.deepEqual(pullManyCalls, [["datalog-definition"], ["person"]]);
  assert.deepEqual(result.contributions.map(({ entityUid }) => entityUid), ["person"]);
  assert.deepEqual(result.watchUids, ["datalog-definition"]);
  assert.equal(result.contributions[0].provenance.sourceBlockUid, "source-ref");
  assert.equal(result.contributions[0].provenance.viaBlockRefUid, "datalog-definition");
  assert.deepEqual(result.diagnostics, []);
});
