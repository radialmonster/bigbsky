import type { FeedPost } from "../../api";
import { postBskyUrl } from "../../lib/url";

// Generic fallback for embed shapes BigBsky does not render locally (e.g. a new
// `app.bsky.embed.*` view, or a third-party embed type). Keeps the post readable
// and points the user to Bluesky for the full content instead of silently
// hiding it.
export function UnsupportedEmbedNotice({ embedType, post }: { embedType: string; post: FeedPost }) {
  const label = formatUnsupportedEmbedType(embedType);
  return (
    <div className="unsupported-embed" role="note">
      <span>This post includes {label} that BigBsky can't display yet.</span>
      <a href={postBskyUrl(post)} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>
        Open on Bluesky
      </a>
    </div>
  );
}

// Turn an embed `$type` NSID into a short human label. Strips the trailing
// `#view`, drops the `app.bsky.embed.` prefix for the common case, and falls
// back to a generic phrase for unfamiliar namespaces.
export function formatUnsupportedEmbedType(embedType: string): string {
  const withoutView = embedType.replace(/#.*$/, "");
  const known = withoutView.replace(/^app\.bsky\.embed\./, "");
  if (known !== withoutView && known.length > 0) {
    return `embedded ${known} content`;
  }
  return "embedded content";
}
