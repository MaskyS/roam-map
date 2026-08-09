// Each mounted map owns transient drag state. A completed gesture becomes one
// readable map/size edit beneath the shared definition.
import { clearMapSize, persistMapSize } from "../map/size-persistence.js";
import {
  DEFAULT_MAP_MAX_WIDTH,
  DEFAULT_MAP_SIZE,
  MAX_MAP_HEIGHT,
  MAX_MAP_WIDTH,
  MIN_MAP_HEIGHT,
  MIN_MAP_WIDTH,
  clampMapHeight,
} from "../map/options.js";
import {
  clampMapWidthToHost,
  resizedMapSize,
} from "./map-resize-geometry.js";

const React = window.React;
const { Button } = window.Blueprint.Core;
const KEYBOARD_STEP = 20;
const NO_SOURCE_UIDS = Object.freeze([]);

function uniqueSourceUids(sourceUids) {
  return [...new Set((sourceUids ?? []).filter(Boolean))];
}

function sameSize(left, right) {
  return left?.maxWidth === right?.maxWidth && left?.height === right?.height;
}

function hasSavedSize(size) {
  return size?.maxWidth != null || size?.height != null;
}

function frameSize(frame) {
  const bounds = frame?.getBoundingClientRect?.();
  return {
    height: clampMapHeight(bounds?.height ?? MIN_MAP_HEIGHT),
    width: clampMapWidthToHost(bounds?.width ?? MIN_MAP_WIDTH, MAX_MAP_WIDTH),
  };
}

function availableHostWidth(shell, fallback) {
  const measured = shell?.parentElement?.getBoundingClientRect?.().width;
  return Number.isFinite(measured) && measured > 0 ? measured : fallback;
}

export function useMapResize({
  api,
  configuredSize = DEFAULT_MAP_SIZE,
  frameRef,
  mapUid,
  onError,
  shellRef,
  sourceUids = NO_SOURCE_UIDS,
}) {
  const durableSize = configuredSize ?? DEFAULT_MAP_SIZE;
  const sourceUidRef = React.useRef(null);
  const dragRef = React.useRef(null);
  const keyboardRef = React.useRef(null);
  const mountedRef = React.useRef(true);
  const [sizeOverride, setSizeOverride] = React.useState(undefined);
  const [resizing, setResizing] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const size = sizeOverride === undefined ? durableSize : sizeOverride;

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  React.useEffect(() => {
    const current = uniqueSourceUids(sourceUids);
    if (current.length === 1) sourceUidRef.current = current[0];
    else if (
      current.length === 0 &&
      !hasSavedSize(durableSize) &&
      sizeOverride === undefined
    ) {
      sourceUidRef.current = null;
    }
  }, [durableSize, sizeOverride, sourceUids]);

  React.useEffect(() => {
    if (
      dragRef.current == null &&
      keyboardRef.current == null &&
      sizeOverride !== undefined &&
      sameSize(sizeOverride, durableSize)
    ) {
      setSizeOverride(undefined);
    }
  }, [durableSize, sizeOverride]);

  function effectiveSourceUids() {
    const current = uniqueSourceUids(sourceUids);
    if (current.length > 1) return current;
    return sourceUidRef.current ? [sourceUidRef.current] : current;
  }

  async function saveSize(nextSize) {
    setSaving(true);
    onError?.(null);
    try {
      const sourceUid = await persistMapSize({
        api,
        mapUid,
        size: nextSize,
        sourceUids: effectiveSourceUids(),
      });
      sourceUidRef.current = sourceUid;
      if (mountedRef.current) setSizeOverride(nextSize);
      return true;
    } catch (error) {
      if (mountedRef.current) {
        setSizeOverride(undefined);
        onError?.(error);
      }
      return false;
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  }

  function pointerResize(event, drag) {
    return resizedMapSize({
      availableWidth: drag.availableWidth,
      baseSize: drag.baseSize,
      deltaX: event.clientX - drag.startX,
      deltaY: event.clientY - drag.startY,
      startHeight: drag.startHeight,
      startWidth: drag.startWidth,
    });
  }

  function onPointerDown(event) {
    if (saving || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const measured = frameSize(frameRef.current);
    dragRef.current = {
      availableWidth: availableHostWidth(shellRef.current, measured.width),
      baseSize: { ...size },
      pointerId: event.pointerId,
      previousOverride: sizeOverride,
      startHeight: measured.height,
      startWidth: measured.width,
      startX: event.clientX,
      startY: event.clientY,
    };
    setResizing(true);
    onError?.(null);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function onPointerMove(event) {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault();
    const next = pointerResize(event, drag);
    setSizeOverride(
      next.changedHeight || next.changedMaxWidth ? next.size : drag.previousOverride,
    );
  }

  function finishPointerResize(event, { cancel = false } = {}) {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const next = pointerResize(event, drag);
    dragRef.current = null;
    setResizing(false);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (cancel || (!next.changedHeight && !next.changedMaxWidth)) {
      setSizeOverride(drag.previousOverride);
      return;
    }
    setSizeOverride(next.size);
    void saveSize(next.size);
  }

  function onKeyDown(event) {
    const vertical = event.key === "ArrowUp" || event.key === "ArrowDown";
    const horizontal = event.key === "ArrowLeft" || event.key === "ArrowRight";
    if (event.key === "Escape" && keyboardRef.current) {
      const previousOverride = keyboardRef.current.previousOverride;
      keyboardRef.current = null;
      setSizeOverride(previousOverride);
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (saving || (!vertical && !horizontal)) return;

    event.preventDefault();
    event.stopPropagation();
    if (!keyboardRef.current) {
      const measured = frameSize(frameRef.current);
      keyboardRef.current = {
        availableWidth: availableHostWidth(shellRef.current, measured.width),
        baseSize: { ...size },
        changedHeight: false,
        changedMaxWidth: false,
        measured,
        previousOverride: sizeOverride,
        size: { ...size },
      };
    }
    const pending = keyboardRef.current;
    const step = event.shiftKey ? KEYBOARD_STEP * 5 : KEYBOARD_STEP;
    if (vertical) {
      const current = pending.changedHeight
        ? pending.size.height
        : pending.measured.height;
      const direction = event.key === "ArrowUp" ? -1 : 1;
      const height = clampMapHeight(current + direction * step);
      if (height === current) return;
      pending.size = {
        ...pending.size,
        height,
      };
      pending.changedHeight = true;
    } else {
      const current = pending.changedMaxWidth
        ? pending.size.maxWidth
        : pending.measured.width;
      const direction = event.key === "ArrowLeft" ? -1 : 1;
      const maxWidth = clampMapWidthToHost(
        current + direction * step,
        pending.availableWidth,
      );
      if (maxWidth === current) return;
      pending.size = {
        ...pending.size,
        maxWidth,
      };
      pending.changedMaxWidth = true;
    }
    setSizeOverride(pending.size);
    onError?.(null);
  }

  function saveKeyboardSize(event) {
    if (
      event?.key &&
      !["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)
    ) {
      return;
    }
    const pending = keyboardRef.current;
    if (!pending) return;
    keyboardRef.current = null;
    if (
      (!pending.changedHeight && !pending.changedMaxWidth) ||
      sameSize(pending.size, pending.baseSize)
    ) {
      setSizeOverride(pending.previousOverride);
      return;
    }
    void saveSize(pending.size);
  }

  async function resetSize() {
    if (saving) return false;
    setSaving(true);
    setSizeOverride(DEFAULT_MAP_SIZE);
    onError?.(null);
    try {
      const removed = await clearMapSize({ api, sourceUids: effectiveSourceUids() });
      if (!removed && hasSavedSize(durableSize)) {
        throw new Error("The map/size source block could not be found.");
      }
      sourceUidRef.current = null;
      return true;
    } catch (error) {
      if (mountedRef.current) {
        setSizeOverride(undefined);
        onError?.(error);
      }
      return false;
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  }

  const canReset =
    !sameSize(sizeOverride, DEFAULT_MAP_SIZE) &&
    (hasSavedSize(durableSize) || effectiveSourceUids().length > 0);
  const sizeDescription = `${
    size.maxWidth == null ? "responsive maximum width" : `${size.maxWidth} pixel maximum width`
  }, ${size.height == null ? "responsive height" : `${size.height} pixels high`}`;

  return {
    canReset,
    resetSize,
    resizing,
    saving,
    size,
    handleProps: {
      "aria-keyshortcuts": "ArrowUp ArrowDown ArrowLeft ArrowRight",
      "aria-label": `Resize map: ${sizeDescription}`,
      "aria-roledescription": "two-dimensional resize handle",
      onBlur: saveKeyboardSize,
      onKeyDown,
      onKeyUp: saveKeyboardSize,
      onPointerCancel: (event) => finishPointerResize(event, { cancel: true }),
      onPointerDown,
      onPointerMove,
      onPointerUp: finishPointerResize,
      role: "group",
      tabIndex: 0,
      title:
        "Drag to resize. Up/Down adjust height; Left/Right adjust maximum width. Hold Shift for 100 px.",
    },
  };
}

export function MapResizeHandle({ resize }) {
  const anchorMaxWidth = resize.size.maxWidth ?? DEFAULT_MAP_MAX_WIDTH;
  return (
    <div
      {...resize.handleProps}
      className={
        resize.resizing
          ? "rrm-map-resize-handle is-resizing"
          : "rrm-map-resize-handle"
      }
      style={{ left: `calc(min(100%, ${anchorMaxWidth}px) - 10px)` }}
    >
      <span aria-hidden="true" />
    </div>
  );
}

export function ResetMapSizeButton({ resize }) {
  if (!resize.canReset) return null;
  return (
    <Button
      minimal
      small
      icon="reset"
      aria-label="Reset map size"
      title="Reset map maximum width and height"
      disabled={resize.resizing}
      loading={resize.saving}
      onClick={() => void resize.resetSize()}
    />
  );
}

export const __test = {
  availableHostWidth,
  frameSize,
  hasSavedSize,
  sameSize,
  uniqueSourceUids,
};
