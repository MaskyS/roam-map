// Pointer geometry is kept outside React so axis thresholds and responsive
// max-width clamping remain small, deterministic, and directly testable.
import {
  MAX_MAP_WIDTH,
  MIN_MAP_WIDTH,
  clampMapHeight,
  clampMapWidth,
} from "../map/options.js";

export const RESIZE_AXIS_THRESHOLD = 5;

export function clampMapWidthToHost(width, availableWidth) {
  const available = Number.isFinite(availableWidth)
    ? Math.min(MAX_MAP_WIDTH, Math.max(MIN_MAP_WIDTH, Math.floor(availableWidth)))
    : MAX_MAP_WIDTH;
  return Math.min(clampMapWidth(width), available);
}

export function resizedMapSize({
  availableWidth,
  baseSize,
  deltaX,
  deltaY,
  startHeight,
  startWidth,
  threshold = RESIZE_AXIS_THRESHOLD,
}) {
  const requestedWidth = clampMapWidthToHost(startWidth + deltaX, availableWidth);
  const requestedHeight = clampMapHeight(startHeight + deltaY);
  const changedMaxWidth =
    Math.abs(deltaX) >= threshold && requestedWidth !== startWidth;
  const changedHeight =
    Math.abs(deltaY) >= threshold && requestedHeight !== startHeight;

  return {
    changedHeight,
    changedMaxWidth,
    size: {
      maxWidth: changedMaxWidth ? requestedWidth : baseSize.maxWidth,
      height: changedHeight ? requestedHeight : baseSize.height,
    },
  };
}
