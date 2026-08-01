import { useCallback } from "react";
import { getActorFeeds, type FeedGeneratorView } from "../../api";
import type { FeedSource } from "../../sources";
import { DiscoverFeedCard } from "../feed/DiscoverFeedCard";
import { AutoLoadMoreButton } from "../feed/AutoLoadMoreButton";
import { EmptyState, ErrorState, LoadingState, RateLimitState } from "../common/State";
import { useCursorPaged } from "../common/useCursorPaged";

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
  const loadPage = useCallback(
    (cursor: string | undefined, signal?: AbortSignal) =>
      getActorFeeds(actor, 50, signal, cursor).then((response) => ({ items: response.feeds, cursor: response.cursor })),
    [actor],
  );
  const { state, loadMore } = useCursorPaged<FeedGeneratorView>(loadPage);

  return (
    <section className="discover-feeds" aria-label="Feeds created by this account">
      {state.status === "loading" && <LoadingState label="Loading Feeds by this account" />}
      {state.status === "error" && <ErrorState message={state.error || "Feeds could not be loaded right now."} />}
      {state.status === "rate-limit" && <RateLimitState message={state.error} />}
      {state.status === "ready" && state.items.length === 0 && (
        <EmptyState title="No Feeds" message="This account has not published any Feeds." />
      )}
      {state.status === "ready" && state.items.length > 0 && (
        <>
          <div className="discover-feeds-grid">
            {state.items.map((feed) => (
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
