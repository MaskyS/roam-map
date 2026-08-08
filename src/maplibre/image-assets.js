import { DEFAULT_MARKER_IMAGE_ID } from "./runtime-constants.js";

export const CIRCULAR_IMAGE_SUFFIX = "#circle";

export function circularImageId(imageId) {
  return `${imageId}${CIRCULAR_IMAGE_SUFFIX}`;
}

function isRoamHostedUrl(sourceUrl) {
  try {
    const { hostname } = new URL(sourceUrl);
    return hostname === "firebasestorage.googleapis.com" || hostname.endsWith(".firebasestorage.app");
  } catch {
    return false;
  }
}

async function sourceBlob(asset, { getFile, fetchImpl, signal }) {
  if (typeof getFile === "function" && isRoamHostedUrl(asset.sourceUrl)) {
    return getFile(asset.sourceUrl);
  }
  const response = await fetchImpl(asset.sourceUrl, { credentials: "omit", signal });
  if (!response.ok) throw new Error(`Image request failed with HTTP ${response.status}.`);
  return response.blob();
}

function imageDimensions(image) {
  return {
    width: image?.naturalWidth ?? image?.videoWidth ?? image?.width ?? 0,
    height: image?.naturalHeight ?? image?.videoHeight ?? image?.height ?? 0,
  };
}

function canvasContext(documentImpl, width, height) {
  const canvas = documentImpl?.createElement?.("canvas");
  if (!canvas) throw new Error("This Roam runtime cannot create an image canvas.");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("This Roam runtime cannot prepare image pixels.");
  return context;
}

function drawCover(context, image, { width, height, sourceWidth, sourceHeight }) {
  const scale = Math.max(width / sourceWidth, height / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  context.clearRect(0, 0, width, height);
  context.drawImage(
    image,
    (width - drawWidth) / 2,
    (height - drawHeight) / 2,
    drawWidth,
    drawHeight,
  );
}

export function createImageAssetLoader({
  getFile,
  fetchImpl = globalThis.fetch,
  createImageBitmapImpl = globalThis.createImageBitmap,
  documentImpl = globalThis.document,
} = {}) {
  return async function loadImageAsset(asset, { signal } = {}) {
    if (typeof createImageBitmapImpl !== "function") {
      throw new Error("This Roam runtime cannot decode images with createImageBitmap.");
    }
    if (typeof fetchImpl !== "function" && !isRoamHostedUrl(asset.sourceUrl)) {
      throw new Error("This Roam runtime cannot fetch external images.");
    }
    const blob = await sourceBlob(asset, { getFile, fetchImpl, signal });
    if (signal?.aborted) throw new DOMException("Image load stopped.", "AbortError");
    const image = await createImageBitmapImpl(blob);
    try {
      const { width: sourceWidth, height: sourceHeight } = imageDimensions(image);
      if (sourceWidth <= 0 || sourceHeight <= 0) {
        throw new Error("The decoded image has no usable dimensions.");
      }
      const width = asset.width ?? 64;
      const height = asset.height ?? 64;
      const dimensions = { width, height, sourceWidth, sourceHeight };
      const squareContext = canvasContext(documentImpl, width, height);
      drawCover(squareContext, image, dimensions);
      const squareImage = squareContext.getImageData(0, 0, width, height);

      const circularContext = canvasContext(documentImpl, width, height);
      circularContext.save();
      circularContext.beginPath();
      circularContext.arc(width / 2, height / 2, Math.min(width, height) / 2, 0, Math.PI * 2);
      circularContext.clip();
      drawCover(circularContext, image, dimensions);
      circularContext.restore();
      const circularImage = circularContext.getImageData(0, 0, width, height);
      const options = { pixelRatio: asset.pixelRatio ?? 2 };
      return {
        image: squareImage,
        options,
        variants: [
          {
            id: circularImageId(asset.id),
            image: circularImage,
            options,
          },
        ],
      };
    } finally {
      image.close?.();
    }
  };
}

export function defaultMarkerImage({ size = 64 } = {}) {
  const data = new Uint8ClampedArray(size * size * 4);
  const center = (size - 1) / 2;
  const outerRadius = size * 0.48;
  const innerRadius = size * 0.39;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const distance = Math.hypot(x - center, y - center);
      if (distance > outerRadius) continue;
      const offset = (y * size + x) * 4;
      const color = distance > innerRadius ? [255, 255, 255] : [111, 66, 193];
      data[offset] = color[0];
      data[offset + 1] = color[1];
      data[offset + 2] = color[2];
      data[offset + 3] = 255;
    }
  }
  return {
    id: DEFAULT_MARKER_IMAGE_ID,
    image: { width: size, height: size, data },
    options: { pixelRatio: 2 },
  };
}

export const __test = { canvasContext, drawCover, imageDimensions, isRoamHostedUrl, sourceBlob };
