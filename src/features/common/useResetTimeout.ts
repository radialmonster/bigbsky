import { useCallback, useEffect, useRef } from "react";

// Schedule a one-shot timeout that auto-clears on unmount (and supersedes any
// still-pending one). Used for transient "Copied"/"Shared" feedback timers so
// they can't fire setState against a card that unmounted mid-countdown.
export function useResetTimeout(): (callback: () => void, delayMs: number) => void {
  const timeoutRef = useRef<number | undefined>(undefined);
  useEffect(
    () => () => {
      if (timeoutRef.current !== undefined) {
        window.clearTimeout(timeoutRef.current);
      }
    },
    [],
  );
  return useCallback((callback: () => void, delayMs: number) => {
    if (timeoutRef.current !== undefined) {
      window.clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = window.setTimeout(callback, delayMs);
  }, []);
}
