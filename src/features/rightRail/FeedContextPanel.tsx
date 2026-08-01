import { useState } from "react";
import { Hash, List } from "lucide-react";
import { isListUri, type FeedGeneratorView, type ListView, type Profile, type FeedPost } from "../../api";
import type { FeedSource } from "../../sources";
import { useResetTimeout } from "../common/useResetTimeout";

export type EntityCache = {
  posts: Record<string, FeedPost>;
  profiles: Record<string, Profile>;
  linkUrls: string[];
};

export function FeedContextPanel({
  source,
  metadata,
  listMetadata,
  entityCache,
  isPinned,
  onTogglePinned,
}: {
  source: FeedSource;
  metadata: FeedGeneratorView | null;
  listMetadata: ListView | null;
  entityCache: EntityCache;
  isPinned: boolean;
  onTogglePinned: (source: FeedSource) => void;
}) {
  const [copied, setCopied] = useState(false);
  const scheduleReset = useResetTimeout();
  const isList = isListUri(source.uri);
  const avatar = isList ? listMetadata?.avatar : metadata?.avatar;
  const title = (isList ? listMetadata?.name : metadata?.displayName) || source.label;
  const description = (isList ? listMetadata?.description : metadata?.description) || source.description;
  const creatorHandle = isList ? listMetadata?.creator?.handle : metadata?.creator?.handle;
  const rkey = source.uri.split("/").pop();
  const bskyUrl = creatorHandle && rkey
    ? `https://bsky.app/profile/${creatorHandle}/${isList ? "lists" : "feed"}/${rkey}`
    : "https://bsky.app";

  return (
    <section className="profile-panel">
      {avatar ? (
        <img className="avatar" src={avatar} alt="" loading="lazy" />
      ) : (
        <span className="feed-glyph">
          {isList ? <List size={22} /> : <Hash size={22} />}
        </span>
      )}
      <h2>{title}</h2>
      <p>{description}</p>
      <dl>
        <div>
          <dt>Type</dt>
          <dd>{isList ? "List" : "Feed"}</dd>
        </div>
        <div>
          <dt>Creator</dt>
          <dd>{creatorHandle ? `@${creatorHandle}` : "Public"}</dd>
        </div>
        <div>
          <dt>{isList ? "Members" : "Likes"}</dt>
          <dd>
            {isList
              ? listMetadata?.listItemCount?.toLocaleString() ?? "-"
              : (metadata?.likeCount ?? metadata?.likedByCount)?.toLocaleString() ?? "-"}
          </dd>
        </div>
        <div>
          <dt>Cached posts</dt>
          <dd>{Object.keys(entityCache.posts).length.toLocaleString()}</dd>
        </div>
      </dl>
      <div className="context-actions" aria-label={isList ? "List options" : "Feed options"}>
        <button type="button" onClick={() => onTogglePinned(source)}>
          {isPinned ? (isList ? "Unpin list" : "Unpin feed") : isList ? "Pin list" : "Pin feed"}
        </button>
        <button
          type="button"
          onClick={() => {
            const write = navigator.clipboard?.writeText(source.uri);
            if (!write) {
              return;
            }
            void write
              .then(() => {
                setCopied(true);
                scheduleReset(() => setCopied(false), 1600);
              })
              .catch(() => {
                // Clipboard blocked - don't falsely report "Copied URI".
              });
          }}
        >
          {copied ? "Copied URI" : "Copy URI"}
        </button>
        <a href={bskyUrl} target="_blank" rel="noreferrer">
          Open on Bluesky
        </a>
      </div>
    </section>
  );
}
