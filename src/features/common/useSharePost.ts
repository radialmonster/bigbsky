import { useState } from "react";
import type { FeedPost } from "../../api";
import { postBskyUrl } from "../../lib/url";
import { displayName } from "../../sources";
import { useResetTimeout } from "./useResetTimeout";

export type ShareState = "idle" | "copied" | "shared" | "error";

// Shared "Share post" behavior: Web Share API when available, else copy the
// canonical bsky.app URL to the clipboard. Transient "Copied"/"Shared"/"Copy
// failed" feedback resets to idle via useResetTimeout. Extracted from the three
// identical copy-pasted handleShare implementations in App.tsx (ThreadedPostCard,
// PostActionBar, CombinedThreadViewCard).
export function useSharePost(rootPost: FeedPost, posts: FeedPost[]) {
  const [shareState, setShareState] = useState<ShareState>("idle");
  const scheduleReset = useResetTimeout();

  const handleShare = async () => {
    const url = postBskyUrl(rootPost);
    const title = `${displayName(rootPost.author)} on Bluesky`;
    const text = posts
      .map((post) => post.record.text?.trim())
      .filter(Boolean)
      .join("\n\n");

    try {
      if (navigator.share) {
        await navigator.share({ title, text: text || title, url });
        setShareState("shared");
      } else {
        await navigator.clipboard?.writeText(url);
        setShareState("copied");
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      try {
        await navigator.clipboard?.writeText(url);
        setShareState("copied");
      } catch {
        setShareState("error");
      }
    }

    scheduleReset(() => setShareState("idle"), 1800);
  };

  return { shareState, handleShare };
}
