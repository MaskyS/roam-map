import test from "node:test";
import assert from "node:assert/strict";

import {
  DYNAMIC_SOURCE_LIMIT,
  QUERY_RESULT_PULL,
  compileDynamicSources,
  normalizeUidCollection,
  parseDatalogCodeBlock,
  parseDynamicSourceDefinition,
} from "../../src/map/dynamic-sources.js";

const block = (uid, string) => ({ ":block/uid": uid, ":block/string": string });

test("recognizes saved native queries and fenced Datalog without claiming other code", () => {
  assert.deepEqual(
    parseDynamicSourceDefinition(
      block("native", '{{[[query]]: "People" {and: [[People]]}}}'),
    ),
    {
      kind: "roam-query",
      sourceBlockUid: "native",
      definitionBlockUid: "native",
      viaBlockRefUid: null,
    },
  );
  assert.deepEqual(
    parseDatalogCodeBlock(
      "```commonlisp\n[:find [?uid ...] :where [?page :block/uid ?uid]]\n```",
    ),
    {
      language: "commonlisp",
      query: "[:find [?uid ...] :where [?page :block/uid ?uid]]",
    },
  );
  assert.equal(
    parseDynamicSourceDefinition(
      block("javascript", "```javascript\nreturn ['not-a-source'];\n```"),
    ),
    null,
  );
});

test("normalizes flat and one-column UID results while rejecting ambiguous tables", () => {
  assert.deepEqual(normalizeUidCollection(["a", "b", "a"]), ["a", "b"]);
  assert.deepEqual(normalizeUidCollection([["a"], ["b"]]), ["a", "b"]);
  assert.throws(
    () => normalizeUidCollection([["a", "title"]]),
    /flat UID collection or a one-column UID relation/,
  );
  assert.throws(() => normalizeUidCollection([""]), /empty UID/);
});

test("native query pages stay pages and block results become containing-page contributions", async () => {
  const calls = [];
  const definition = parseDynamicSourceDefinition(
    block("query", "{{query: {and: [[Map point]]}}}"),
  );
  const [result] = await compileDynamicSources(
    {
      roamQuery: async (args) => {
        calls.push(args);
        return {
          total: 3,
          results: [
            { ":block/uid": "page", ":node/title": "Place page" },
            {
              ":block/uid": "point",
              ":block/string": "geo:-20,57",
              ":block/page": {
                ":block/uid": "owner-page",
                ":node/title": "Owner page",
              },
            },
          ],
        };
      },
    },
    [definition],
  );

  assert.deepEqual(calls, [
    {
      uid: "query",
      offset: 0,
      limit: DYNAMIC_SOURCE_LIMIT,
      pull: QUERY_RESULT_PULL,
    },
  ]);
  assert.deepEqual(
    result.contributions.map(
      ({ identityKind, entityUid, allowInlineCoordinates, provenance }) => ({
        identityKind,
        entityUid,
        allowInlineCoordinates,
        sourceKind: provenance.sourceKind,
        queryResultUid: provenance.queryResultUid,
      }),
    ),
    [
      {
        identityKind: "page",
        entityUid: "page",
        allowInlineCoordinates: false,
        sourceKind: "roam-query",
        queryResultUid: "page",
      },
      {
        identityKind: "page",
        entityUid: "owner-page",
        allowInlineCoordinates: false,
        sourceKind: "roam-query",
        queryResultUid: "point",
      },
    ],
  );
  assert.equal(result.diagnostics[0].code, "source.dynamic-results-truncated");
  assert.deepEqual(result.watchUids, ["query"]);
});

test("Datalog resolves returned UIDs to exact page and block identities", async () => {
  const code = "[:find [?uid ...] :where [?entity :block/uid ?uid]]";
  const definition = parseDynamicSourceDefinition(
    block("datalog", `\`\`\`datalog\n${code}\n\`\`\``),
  );
  const calls = [];
  const [result] = await compileDynamicSources(
    {
      datalogQuery: async (query) => {
        calls.push(["q", query]);
        return [["page"], ["point"], ["missing"]];
      },
      pullMany: async (_pattern, uids) => {
        calls.push(["pull", uids]);
        return [
          { ":block/uid": "page", ":node/title": "Page" },
          { ":block/uid": "point", ":block/string": "geo:0,0" },
        ];
      },
    },
    [definition],
  );

  assert.deepEqual(calls, [
    ["q", code],
    ["pull", ["page", "point", "missing"]],
  ]);
  assert.deepEqual(
    result.contributions.map(({ identityKind, entityUid }) => ({ identityKind, entityUid })),
    [
      { identityKind: "page", entityUid: "page" },
      { identityKind: "block", entityUid: "point" },
    ],
  );
  assert.equal(result.diagnostics[0].code, "source.dynamic-uid-missing");
  assert.equal(result.report.total, 3);
});

test("Datalog deduplicates in result order and caps pulled UIDs at 250", async () => {
  const definition = parseDynamicSourceDefinition(
    block(
      "datalog",
      "```clojure\n[:find [?uid ...] :where [?entity :block/uid ?uid]]\n```",
    ),
  );
  const uniqueUids = Array.from(
    { length: DYNAMIC_SOURCE_LIMIT + 1 },
    (_, index) => `uid-${index}`,
  );
  let pulledUids = [];
  const [result] = await compileDynamicSources(
    {
      datalogQuery: async () => [uniqueUids[0], ...uniqueUids],
      pullMany: async (_pattern, uids) => {
        pulledUids = uids;
        return uids.map((uid) => ({ ":block/uid": uid, ":node/title": uid }));
      },
    },
    [definition],
  );

  assert.equal(pulledUids.length, DYNAMIC_SOURCE_LIMIT);
  assert.deepEqual(pulledUids.slice(0, 2), ["uid-0", "uid-1"]);
  assert.equal(result.contributions.length, DYNAMIC_SOURCE_LIMIT);
  assert.deepEqual(result.report, {
    kind: "datalog",
    definitionBlockUid: "datalog",
    total: DYNAMIC_SOURCE_LIMIT + 1,
    returned: DYNAMIC_SOURCE_LIMIT,
    truncated: true,
  });
  assert.equal(result.diagnostics[0].code, "source.dynamic-results-truncated");
});

test("dynamic source failures are isolated per definition", async () => {
  const native = parseDynamicSourceDefinition(block("native", "{{query: [[People]]}}"));
  const datalog = parseDynamicSourceDefinition(
    block("datalog", "```clojure\n[:find ?uid :where [?e :block/uid ?uid]]\n```"),
  );
  const results = await compileDynamicSources(
    {
      roamQuery: async () => {
        throw new Error("native unavailable");
      },
      datalogQuery: async () => [["uid", "unexpected second column"]],
    },
    [native, datalog],
  );

  assert.deepEqual(results.map(({ contributions }) => contributions), [[], []]);
  assert.deepEqual(results.map(({ diagnostics }) => diagnostics[0].code), [
    "source.roam-query-failed",
    "source.datalog-query-failed",
  ]);
});
