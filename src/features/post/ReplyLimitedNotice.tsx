import { ShieldAlert } from "lucide-react";

export function ReplyLimitedNotice() {
  return (
    <p className="reply-limited-notice" role="status">
      <ShieldAlert size={14} />
      <span>Replies are limited for this post.</span>
    </p>
  );
}
