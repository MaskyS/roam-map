// Selection should land in the part of the map the user can actually see.
// These calculations use live element rectangles, so custom and responsive
// results panels do not have to match dimensions duplicated in JavaScript.

function normalizedRectangle(rectangle) {
  if (!rectangle) return null;
  const left = Number.isFinite(rectangle.left) ? rectangle.left : rectangle.x;
  const top = Number.isFinite(rectangle.top) ? rectangle.top : rectangle.y;
  const right = Number.isFinite(rectangle.right)
    ? rectangle.right
    : left + rectangle.width;
  const bottom = Number.isFinite(rectangle.bottom)
    ? rectangle.bottom
    : top + rectangle.height;
  if (![left, top, right, bottom].every(Number.isFinite)) return null;
  if (right <= left || bottom <= top) return null;
  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
  };
}

function intersection(first, second) {
  const left = Math.max(first.left, second.left);
  const top = Math.max(first.top, second.top);
  const right = Math.min(first.right, second.right);
  const bottom = Math.min(first.bottom, second.bottom);
  if (right <= left || bottom <= top) return null;
  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
  };
}

function trimVisibleRectangle(visible, frame, overlayRectangle) {
  const overlay = normalizedRectangle(overlayRectangle);
  const covered = overlay ? intersection(frame, overlay) : null;
  if (!covered) return visible;

  const widthCoverage = covered.width / frame.width;
  const heightCoverage = covered.height / frame.height;
  const next = { ...visible };

  if (widthCoverage >= heightCoverage) {
    const coversBottom = covered.top + covered.height / 2 >= frame.top + frame.height / 2;
    if (coversBottom) next.bottom = Math.min(next.bottom, covered.top);
    else next.top = Math.max(next.top, covered.bottom);
  } else {
    const coversRight = covered.left + covered.width / 2 >= frame.left + frame.width / 2;
    if (coversRight) next.right = Math.min(next.right, covered.left);
    else next.left = Math.max(next.left, covered.right);
  }

  return next.right > next.left && next.bottom > next.top ? next : visible;
}

export function mapSelectionOffset({
  frameRect,
  toolbarRect = null,
  resultsPanelRect = null,
} = {}) {
  const frame = normalizedRectangle(frameRect);
  if (!frame) return [0, 0];

  let visible = { ...frame };
  visible = trimVisibleRectangle(visible, frame, toolbarRect);
  visible = trimVisibleRectangle(visible, frame, resultsPanelRect);

  const frameCenter = {
    x: frame.left + frame.width / 2,
    y: frame.top + frame.height / 2,
  };
  const visibleCenter = {
    x: visible.left + (visible.right - visible.left) / 2,
    y: visible.top + (visible.bottom - visible.top) / 2,
  };
  return [visibleCenter.x - frameCenter.x, visibleCenter.y - frameCenter.y];
}
