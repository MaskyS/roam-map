import test from "node:test";
import assert from "node:assert/strict";

import { isMapDefinition, parseMapDefinitions } from "../../src/map/definition.js";

test("parses bare and bracketed map components from authoritative block strings", () => {
  const definitions = parseMapDefinitions("before {{map}} and {{[[map]]}} after");
  assert.deepEqual(definitions.map(({ raw, argument }) => ({ raw, argument })), [
    { raw: "{{map}}", argument: null },
    { raw: "{{[[map]]}}", argument: null },
  ]);
  assert.equal(isMapDefinition("{{MAP}}"), true);
  assert.equal(isMapDefinition("map"), false);
});

test("retains a complete inline query argument, including nested braces", () => {
  const [definition] = parseMapDefinitions(
    "{{map: {and: [[Cafe]] {or: [[Mauritius]] [[Réunion]]}}}}",
  );
  assert.equal(
    definition.argument,
    "{and: [[Cafe]] {or: [[Mauritius]] [[Réunion]]}}",
  );
  assert.equal(definition.raw, "{{map: {and: [[Cafe]] {or: [[Mauritius]] [[Réunion]]}}}}");
});

test("does not accept malformed or merely similar components", () => {
  assert.deepEqual(parseMapDefinitions("{{mapbox}} {{map: {and: [[Cafe]]}}"), []);
});
