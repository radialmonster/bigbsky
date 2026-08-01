import { useCallback, useEffect, useRef, useState } from "react";
import { getActorFeeds, isRateLimit, rateLimitMessage, type FeedGeneratorView } from "../../api";
import type { FeedSource } from "../../sources";
import { DiscoverFeedCard } from "../feed/DiscoverFeedCard";
import { AutoLoadMoreButton } from "../feed/AutoLoadMoreButton";
import { EmptyState, ErrorState, LoadingState, RateLimitState } from "../common/State";

export function ProfileFeedsTab({
  actor,
  pinnedFeedIds,
  onOpenFeed,
  onTogglePinnedFeed,
}: {
  actor: string;
  pinnedFeedIds: string[];
  onOpenFeed: (source: FeedSource) => void;
  onTogglePinnedFeed: (source: FeedSource) => void;
}) {
  const [state, setState] = useState<{
    status: "loading" | "ready" | "error" | "rate-limit";
    feeds: FeedGeneratorView[];
    cursor?: string;
    error?: string;
    loadMoreError?: string;
  }>({ status: "loading", feeds: [] });
  const loadMoreBusyRef = useRef(false);
  const loadMoreControllerRef = useRef<AbortController | null>(null);

  const loadPage = useCallback(
    (cursor: string | undefined, signal?: AbortSignal) =>
      getActorFeeds(actor, 50, signal, cursor).then((response) => ({ feeds: response.feeds, cursor: response.cursor })),
    [actor],
  );

  useEffect(() => {
    const controller = new AbortController();
    loadMoreBusyRef.current = false;
    loadMoreControllerRef.current?.abort();
    loadMoreControllerRef.current = null;
    setState({ status: "loading", feeds: [] });

    loadPage(undefined, controller.signal)
      .then(({ feeds, cursor }) => setState({ status: "ready", feeds, cursor }))
      .catch((error) => {
        if (!controller.signal.aborted) {
          setState({
            status: isRateLimit(error) ? "rate-limit" : "error",
            feeds: [],
            error: rateLimitMessage(error),
          });
        }
      });
    return () => {
      controller.abort();
      loadMoreControllerRef.current?.abort();
      loadMoreControllerRef.current = null;
    };
  }, [loadPage]);

  const loadMore = useCallback(() => {
    if (state.status !== "ready" || !state.cursor || loadMoreBusyRef.current) {
      return;
    }
    loadMoreBusyRef.current = true;
    const controller = new AbortController();
    loadMoreControllerRef.current = controller;
    loadPage(state.cursor, controller.signal)
      .then(({ feeds, cursor }) => {
        loadMoreBusyRef.current = false;
        if (loadMoreControllerRef.current === controller) {
          loadMoreControllerRef.current = null;
        }
        setState((current) => ({
          ...current,
          feeds: [...current.feeds, ...feeds],
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

  return (
    <section className="discover-feeds" aria-label="Feeds created by this account">
      {state.status === "loading" && <LoadingState label="Loading Feeds by this account" />}
      {state.status === "error" && <ErrorState message={state.error || "Feeds could not be loaded right now."} />}
      {state.status === "rate-limit" && <RateLimitState message={state.error} />}
      {state.status === "ready" && state.feeds.length === 0 && (
        <EmptyState title="No Feeds" message="This account has not published any Feeds." />
      )}
      {state.status === "ready" && state.feeds.length > 0 && (
        <>
          <div className="discover-feeds-grid">
            {state.feeds.map((feed) => (
              <DiscoverFeedCard
                key={feed.uri}
                feed={feed}
                isPinned={pinnedFeedIds.includes(feed.uri)}
                onOpenFeed={onOpenFeed}
                onTogglePinnedFeed={onTogglePinnedFeed}
              />
            ))}
          </div>
          {state.cursor && (
            <AutoLoadMoreButton label="Load more Feeds" onLoadMore={loadMore} error={state.loadMoreError} />
          )}
        </>
      )}
    </section>
  );
}
