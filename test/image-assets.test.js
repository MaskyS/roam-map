import test from "node:test";
import assert from "node:assert/strict";

import {
  circularImageId,
  createImageAssetLoader,
  defaultMarkerImage,
} from "../src/image-assets.js";
import { DEFAULT_MARKER_IMAGE_ID } from "../src/map-contract.js";

test("the built-in fallback is a 32 CSS pixel image at icon-size 1", () => {
  const fallback = defaultMarkerImage();
  assert.equal(fallback.id, DEFAULT_MARKER_IMAGE_ID);
  assert.equal(fallback.image.width, 64);
  assert.equal(fallback.image.height, 64);
  assert.equal(fallback.options.pixelRatio, 2);
  assert.ok(fallback.image.data.some((value) => value !== 0));
});

test("Roam-hosted images register square and circular variants at the canonical size", async () => {
  const calls = { file: 0, fetch: 0, draws: [], arc: null, clipped: false, closed: false };
  const squareImage = {
    width: 64,
    height: 64,
    data: new Uint8ClampedArray(64 * 64 * 4),
  };
  const circularImage = {
    width: 64,
    height: 64,
    data: new Uint8ClampedArray(64 * 64 * 4),
  };
  const imageData = [squareImage, circularImage];
  const contexts = [];
  const load = createImageAssetLoader({
    getFile: async () => {
      calls.file += 1;
      return { kind: "file" };
    },
    fetchImpl: async () => {
      calls.fetch += 1;
      throw new Error("fetch should not run");
    },
    createImageBitmapImpl: async () => ({
      width: 100,
      height: 50,
      close() {
        calls.closed = true;
      },
    }),
    documentImpl: {
      createElement: () => {
        const index = contexts.length;
        const context = {
          clearRect() {},
          save() {},
          beginPath() {},
          arc(...args) {
            calls.arc = args;
          },
          clip() {
            calls.clipped = true;
          },
          restore() {},
          drawImage(...args) {
            calls.draws.push(args);
          },
          getImageData() {
            return imageData[index];
          },
        };
        contexts.push(context);
        return { width: 0, height: 0, getContext: () => context };
      },
    },
  });
  const id = "roam-map:image:portrait";
  const result = await load({
    id,
    sourceUrl: "https://firebasestorage.googleapis.com/v0/b/example/o/portrait.png",
    width: 64,
    height: 64,
    pixelRatio: 2,
  });

  assert.equal(calls.file, 1);
  assert.equal(calls.fetch, 0);
  assert.equal(calls.draws.length, 2);
  assert.deepEqual(calls.draws[0].slice(1), [-32, 0, 128, 64]);
  assert.deepEqual(calls.draws[1].slice(1), [-32, 0, 128, 64]);
  assert.deepEqual(calls.arc, [32, 32, 32, 0, Math.PI * 2]);
  assert.equal(calls.clipped, true);
  assert.equal(calls.closed, true);
  assert.equal(result.image, squareImage);
  assert.deepEqual(result.options, { pixelRatio: 2 });
  assert.deepEqual(result.variants, [
    {
      id: circularImageId(id),
      image: circularImage,
      options: { pixelRatio: 2 },
    },
  ]);
});
