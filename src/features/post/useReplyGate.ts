import { useEffect, useState } from "react";
import type { FeedPost } from "../../api";

// Gates the reply affordance on a post's viewer-relative reply permission. When
// replies are disabled for a post, the click surfaces a "limited replies" notice
// instead of opening the composer.
export function useReplyGate(post: FeedPost, onReply?: (post: FeedPost) => void) {
  const [showReplyLimited, setShowReplyLimited] = useState(false);

  useEffect(() => {
    setShowReplyLimited(false);
  }, [post.uri]);

  const handleReplyClick = () => {
    if (post.viewer?.replyDisabled) {
      setShowReplyLimited(true);
      return;
    }
    onReply?.(post);
  };

  return { showReplyLimited, handleReplyClick };
}
