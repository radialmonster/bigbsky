import { Search, X } from "lucide-react";
import { useEffect, useState } from "react";
import { getPopularFeedGenerators, type FeedGeneratorView } from "../../api";
import type { FeedSource } from "../../sources";
import { DiscoverFeedCard } from "../feed/DiscoverFeedCard";
import { EmptyState, ErrorState, LoadingState } from "../common/State";

export function ExploreDiscoverFeeds({
  onOpenFeed,
  pinnedFeedIds,
  onTogglePinnedFeed,
  canFollowFeeds,
  followedFeedUris,
  followBusyUri,
  onToggleFollowFeed,
}: {
  onOpenFeed: (source: FeedSource) => void;
  pinnedFeedIds: string[];
  onTogglePinnedFeed: (source: FeedSource) => void;
  canFollowFeeds: boolean;
  followedFeedUris: Set<string>;
  followBusyUri: string | null;
  onToggleFollowFeed: (feedUri: string, label?: string) => void;
}) {
  const [state, setState] = useState<{ status: "loading" | "ready" | "error"; feeds: FeedGeneratorView[] }>({
    status: "loading",
    feeds: [],
  });
  const [draftQuery, setDraftQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setState((current) => ({ ...current, status: "loading" }));
    getPopularFeedGenerators(18, controller.signal, activeQuery)
      .then((response) => setState({ status: "ready", feeds: response.feeds }))
      .catch(() => {
        if (!controller.signal.aborted) {
          setState({ status: "error", feeds: [] });
        }
      });
    return () => controller.abort();
  }, [activeQuery]);

  return (
    <section className="discover-feeds" aria-label="Discover new Feeds">
      <header className="discover-feeds-header">
        <h3>Discover New Feeds</h3>
        <p>Popular public Bluesky Feeds, loaded live. Open one to read it in BigBsky without signing in.</p>
      </header>
      <form
        className="discover-feeds-search"
        onSubmit={(event) => {
          event.preventDefault();
          setActiveQuery(draftQuery.trim());
        }}
      >
        <Search size={16} />
        <input
          aria-label="Search public Feeds"
          placeholder="Search public Feeds by topic"
          value={draftQuery}
          onInput={(event) => setDraftQuery(event.currentTarget.value)}
        />
        {activeQuery && (
          <button
            type="button"
            className="discover-feeds-clear"
            onClick={() => {
              setDraftQuery("");
              setActiveQuery("");
            }}
            aria-label="Clear Feed search"
          >
            <X size={15} />
          </button>
        )}
      </form>
      {state.status === "loading" && <LoadingState label="Loading popular Feeds" />}
      {state.status === "error" && <ErrorState message="Popular Feeds could not be loaded right now." />}
      {state.status === "ready" && state.feeds.length === 0 && (
        <EmptyState
          title="No Feeds found"
          message={activeQuery ? `No public Feeds matched "${activeQuery}". Try a broader term.` : "Bluesky returned no popular Feeds for this request."}
        />
      )}
      {state.status === "ready" && state.feeds.length > 0 && (
        <div className="discover-feeds-grid">
          {state.feeds.map((feed) => (
            <DiscoverFeedCard
              key={feed.uri}
              feed={feed}
              isPinned={pinnedFeedIds.includes(feed.uri)}
              onOpenFeed={onOpenFeed}
              onTogglePinnedFeed={onTogglePinnedFeed}
              canFollow={canFollowFeeds}
              isFollowing={followedFeedUris.has(feed.uri)}
              followBusy={followBusyUri === feed.uri}
              onToggleFollow={onToggleFollowFeed}
            />
          ))}
        </div>
      )}
    </section>
  );
}
