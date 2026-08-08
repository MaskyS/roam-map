// MapLibre layer features have no DOM element, so Blueprint's Popover receives
// a synthetic target positioned at the JSON-safe pixel point from the click.
const React = window.React;
const { Popover } = window.Blueprint.Core;

export function MarkerPopover({
  context,
  children,
  defaultIsOpen = true,
  isOpen: controlledIsOpen,
  onInteraction = null,
  targetProps = {},
  ...popoverProps
}) {
  const [localIsOpen, setLocalIsOpen] = React.useState(defaultIsOpen);
  const isControlled = controlledIsOpen !== undefined;
  const isOpen = isControlled ? controlledIsOpen : localIsOpen;
  const point = context?.point;

  function setOpen(nextIsOpen, event) {
    if (!isControlled) setLocalIsOpen(nextIsOpen);
    onInteraction?.(nextIsOpen, event);
  }

  const content =
    typeof children === "function"
      ? children({ close: () => setOpen(false), isOpen })
      : children;

  if (!point) return content ?? null;

  return (
    <Popover
      autoFocus={false}
      canEscapeKeyClose
      enforceFocus={false}
      interactionKind="click"
      minimal
      openOnTargetFocus={false}
      position="top"
      shouldReturnFocusOnClose={false}
      usePortal
      {...popoverProps}
      content={content}
      isOpen={isOpen}
      onInteraction={setOpen}
      popoverClassName={[
        "rrm-marker-popover",
        popoverProps.popoverClassName,
      ]
        .filter(Boolean)
        .join(" ")}
      target={<span aria-hidden="true" />}
      targetProps={{
        ...targetProps,
        style: {
          position: "absolute",
          left: point.x,
          top: point.y,
          width: 1,
          height: 1,
          pointerEvents: "none",
          ...targetProps.style,
        },
      }}
    />
  );
}
