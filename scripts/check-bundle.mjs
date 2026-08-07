import { readFile, stat } from "node:fs/promises";

const MAX_BUNDLE_BYTES = 2_500_000;
const source = await readFile("extension.js", "utf8");
const { size } = await stat("extension.js");

if (size > MAX_BUNDLE_BYTES) {
  throw new Error(
    `extension.js is ${(size / 1_000_000).toFixed(2)} MB; the current guard is ${(MAX_BUNDLE_BYTES / 1_000_000).toFixed(2)} MB.`,
  );
}

for (const signature of [
  "react.production.min.js",
  "react-dom.production.min.js",
  "__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED",
]) {
  if (source.includes(signature)) {
    throw new Error(`extension.js appears to bundle Roam-provided React code (${signature}).`);
  }
}

const mapLibreLicenses = source.match(/MapLibre GL JS/g) ?? [];
if (mapLibreLicenses.length !== 1) {
  throw new Error(
    `Expected one bundled MapLibre runtime/license marker, found ${mapLibreLicenses.length}.`,
  );
}

console.log(`[roam-map] bundle guard passed (${(size / 1_000_000).toFixed(2)} MB)`);
