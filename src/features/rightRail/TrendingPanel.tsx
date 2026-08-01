import { useEffect, useState } from "react";
import { getTrendingTopics, type TrendingTopic } from "../../api";

export function TrendingPanel({
  fallback,
  onOpenTopic,
}: {
  fallback: Array<{ tag: string; count: number }>;
  onOpenTopic: (query: string) => void;
}) {
  const [state, setState] = useState<{ status: "loading" | "ready" | "error"; topics: TrendingTopic[] }>({
    status: "loading",
    topics: [],
  });

  // The right rail is mounted once for the session, so this fetches live
  // trending a single time rather than on every route change.
  useEffect(() => {
    const controller = new AbortController();
    getTrendingTopics(10, controller.signal)
      .then((response) => setState({ status: "ready", topics: (response.topics ?? []).slice(0, 10) }))
      .catch(() => {
        if (!controller.signal.aborted) {
          setState({ status: "error", topics: [] });
        }
      });
    return () => controller.abort();
  }, []);

  const live = state.status === "ready" && state.topics.length > 0;

  return (
    <section className="context-panel trending-panel">
      <h2>Trending</h2>
      {state.status === "error" && (
        <p className="trending-note">Live trending is unavailable right now - showing saved defaults.</p>
      )}
      {live ? (
        state.topics.map((topic) => (
          <button key={`${topic.topic}:${topic.link}`} type="button" onClick={() => onOpenTopic(topic.topic)}>
            <span>{topic.topic}</span>
            {topic.description && <small>{topic.description}</small>}
          </button>
        ))
      ) : fallback.length > 0 ? (
        fallback.map((topic) => (
          <button key={topic.tag} type="button" onClick={() => onOpenTopic(topic.tag)}>
            <span>{topic.tag}</span>
            <small>{topic.count.toLocaleString()}</small>
          </button>
        ))
      ) : (
        <>
          <button type="button" onClick={() => onOpenTopic("#atproto")}>
            #atproto
          </button>
          <button type="button" onClick={() => onOpenTopic("#bluesky")}>
            #bluesky
          </button>
          <button type="button" onClick={() => onOpenTopic("#socialweb")}>
            #socialweb
          </button>
        </>
      )}
    </section>
  );
}
