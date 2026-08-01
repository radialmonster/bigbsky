import { useCallback, useEffect, useRef, useState } from "react";
import { isRateLimit, rateLimitMessage } from "../../api";

export type CursorPageStatus = "loading" | "ready" | "error" | "rate-limit";

export interface CursorPageState<T> {
  status: CursorPageStatus;
  items: T[];
  cursor?: string;
  error?: string;
  loadMoreError?: string;
}

export interface CursorPageResult<T> {
  state: CursorPageState<T>;
  loadMore: () => void;
  reset: () => void;
}

// Shared cursor-pagination state machine (dedup of the hand-rolled versions in
// ProfileFeedsTab/ProfileListsTab, issue #26). Loads the first page on mount (and
// whenever `loadPage` identity changes — an actor/query change recreates it via
// useCallback, which re-runs the effect and resets state), aborts in-flight
// loads on teardown, guards load-more against re-entrancy, and retains the
// already-loaded items + cursor when a load-more page fails so the user can
// retry from the load-more control.
export function useCursorPaged<T>(
  loadPage: (cursor: string | undefined, signal?: AbortSignal) => Promise<{ items: T[]; cursor?: string }>,
): CursorPageResult<T> {
  const [state, setState] = useState<CursorPageState<T>>({ status: "loading", items: [] });
  const [resetTick, setResetTick] = useState(0);
  const loadMoreBusyRef = useRef(false);
  const loadMoreControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    loadMoreBusyRef.current = false;
    loadMoreControllerRef.current?.abort();
    loadMoreControllerRef.current = null;
    setState({ status: "loading", items: [] });

    loadPage(undefined, controller.signal)
      .then(({ items, cursor }) => setState({ status: "ready", items, cursor }))
      .catch((error) => {
        if (!controller.signal.aborted) {
          setState({
            status: isRateLimit(error) ? "rate-limit" : "error",
            items: [],
            error: rateLimitMessage(error),
          });
        }
      });
    return () => {
      controller.abort();
      loadMoreControllerRef.current?.abort();
      loadMoreControllerRef.current = null;
    };
  }, [loadPage, resetTick]);

  const loadMore = useCallback(() => {
    if (state.status !== "ready" || !state.cursor || loadMoreBusyRef.current) {
      return;
    }
    loadMoreBusyRef.current = true;
    const controller = new AbortController();
    loadMoreControllerRef.current = controller;
    loadPage(state.cursor, controller.signal)
      .then(({ items, cursor }) => {
        loadMoreBusyRef.current = false;
        if (loadMoreControllerRef.current === controller) {
          loadMoreControllerRef.current = null;
        }
        setState((current) => ({
          ...current,
          items: [...current.items, ...items],
          cursor,
          loadMoreError: undefined,
        }));
      })
      .catch((error) => {
        loadMoreBusyRef.current = false;
        if (loadMoreControllerRef.current === controller) {
          loadMoreControllerRef.current = null;
        }
        // Keep the already-loaded results and the cursor so the user can retry;
        // surface the failure on the load-more control (which also stops the
        // auto-fire so we don't hammer a rate-limited endpoint).
        setState((current) => ({
          ...current,
          loadMoreError: isRateLimit(error) ? rateLimitMessage(error) : "Couldn't load more right now.",
        }));
      });
  }, [loadPage, state.cursor, state.status]);

  const reset = useCallback(() => setResetTick((tick) => tick + 1), []);

  return { state, loadMore, reset };
}
