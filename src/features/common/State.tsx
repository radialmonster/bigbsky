import { Loader2 } from "lucide-react";

export function LoadingState({ label }: { label: string }) {
  return (
    <div className="state">
      <Loader2 className="spin" size={24} />
      <span>{label}</span>
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="state error">
      <strong>Unable to load</strong>
      <span>{message}</span>
    </div>
  );
}

export function RateLimitState({ message }: { message?: string }) {
  return (
    <div className="state error">
      <strong>Rate limit reached</strong>
      <span>{message || "Bluesky is throttling this public API request. Wait a bit, then try again."}</span>
    </div>
  );
}

export function EmptyState({ title, message }: { title: string; message: string }) {
  return (
    <div className="state empty">
      <strong>{title}</strong>
      <span>{message}</span>
    </div>
  );
}

export function EndOfFeedCard({ kind = "posts" }: { kind?: "posts" | "media" }) {
  return (
    <div className="end-of-feed" role="status">
      <strong>End of Feed</strong>
      <span>
        {kind === "media"
          ? "No more media posts can be returned for this feed right now."
          : "No more posts can be returned for this feed right now."}
      </span>
    </div>
  );
}
