import { Bookmark, Hash, Loader2, Plus } from "lucide-react";
import type { FeedGeneratorView } from "../../api";
import type { FeedSource } from "../../sources";

export function DiscoverFeedCard({
  feed,
  isPinned,
  onOpenFeed,
  onTogglePinnedFeed,
  canFollow = false,
  isFollowing = false,
  followBusy = false,
  onToggleFollow,
}: {
  feed: FeedGeneratorView;
  isPinned: boolean;
  onOpenFeed: (source: FeedSource) => void;
  onTogglePinnedFeed: (source: FeedSource) => void;
  canFollow?: boolean;
  isFollowing?: boolean;
  followBusy?: boolean;
  onToggleFollow?: (feedUri: string, label?: string) => void;
}) {
  const feedRkey = feed.uri.split("/").pop();
  const bskyUrl =
    feed.creator?.handle && feedRkey
      ? `https://bsky.app/profile/${feed.creator.handle}/feed/${feedRkey}`
      : "https://bsky.app";
  const likes = feed.likeCount ?? feed.likedByCount;
  const source: FeedSource = {
    id: feed.uri,
    uri: feed.uri,
    label: feed.displayName || "Public Feed",
    group: "Discovered",
    description: feed.description || "Public Bluesky feed opened from discovery.",
  };

  return (
    <article className="discover-feed-card">
      <button type="button" className="discover-feed-open" onClick={() => onOpenFeed(source)}>
        {feed.avatar ? (
          <img className="discover-feed-avatar" src={feed.avatar} alt="" loading="lazy" />
        ) : (
          <span className="discover-feed-glyph">
            <Hash size={20} />
          </span>
        )}
        <span className="discover-feed-body">
          <strong>{feed.displayName || "Public Feed"}</strong>
          <small>by @{feed.creator?.handle ?? "unknown"}</small>
          {feed.description && <span className="discover-feed-desc">{feed.description}</span>}
        </span>
        {typeof likes === "number" && <span className="discover-feed-likes">{likes.toLocaleString()} likes</span>}
      </button>
      <div className="discover-feed-actions">
        {canFollow && onToggleFollow && (
          <button
            type="button"
            className={isFollowing ? "discover-feed-follow following" : "discover-feed-follow"}
            onClick={() => onToggleFollow(feed.uri, feed.displayName || "Feed")}
            disabled={followBusy}
            aria-label={isFollowing ? `Unfollow ${source.label}` : `Follow ${source.label}`}
          >
            {followBusy ? <Loader2 className="spin" size={14} /> : <Plus size={14} />}
            {isFollowing ? "Following" : "Follow"}
          </button>
        )}
        <button
          type="button"
          className={isPinned ? "discover-feed-pin pinned" : "discover-feed-pin"}
          onClick={() => onTogglePinnedFeed(source)}
          aria-label={isPinned ? `Unpin ${source.label}` : `Pin ${source.label}`}
        >
          <Bookmark size={14} />
          {isPinned ? "Pinned" : "Pin locally"}
        </button>
        <a className="discover-feed-external" href={bskyUrl} target="_blank" rel="noreferrer">
          Open on Bluesky
        </a>
      </div>
    </article>
  );
}
