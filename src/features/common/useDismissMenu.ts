import { useEffect, useRef, type RefObject } from "react";

// Shared dismiss-on-outside-click / Escape close for popover menus and pickers.
// Registers document listeners only while `open`, and calls the latest
// `onClose` when the pointer lands outside `rootRef` or Escape is pressed.
// Optional `onEscape` runs on Escape only (e.g. resetting an expanded
// sub-state). Callbacks are held in refs so the effect stays keyed on `open`
// (matching the original per-picker behavior even with inline lambdas).
// Removes the triplicated listener wiring the composer pickers and the
// home-source picker each hand-rolled, and lets RTL suites assert dismissal
// behavior without reaching into document listeners.
export function useDismissMenu(
  rootRef: RefObject<HTMLElement | null>,
  open: boolean,
  onClose: () => void,
  onEscape?: () => void,
) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;

  useEffect(() => {
    if (!open) {
      return;
    }
    function onDocPointer(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        onCloseRef.current();
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        onEscapeRef.current?.();
      }
    }
    document.addEventListener("mousedown", onDocPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, rootRef]);
}
