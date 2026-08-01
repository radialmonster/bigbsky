import { Hash } from "lucide-react";
import { useEffect, useState } from "react";
import { getTrendingTopics, type TrendingTopic } from "../../api";
import { ErrorState, LoadingState } from "../common/State";

export function ExploreTrendingTopics({ onOpenSearchQuery }: { onOpenSearchQuery: (query: string) => void }) {
  const [state, setState] = useState<{ status: "loading" | "ready" | "error"; topics: TrendingTopic[] }>({
    status: "loading",
    topics: [],
  });

  useEffect(() => {
    const controller = new AbortController();
    getTrendingTopics(14, controller.signal)
      .then((response) => {
        const topics = [...(response.topics ?? []), ...(response.suggested ?? [])];
        setState({ status: "ready", topics });
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setState({ status: "error", topics: [] });
        }
      });
    return () => controller.abort();
  }, []);

  if (state.status === "ready" && state.topics.length === 0) {
    return null;
  }

  return (
    <section className="trending-topics" aria-label="Trending topics">
      <header className="trending-topics-header">
        <h3>Trending Topics</h3>
        <p>Live from Bluesky. Open one to search posts about it in BigBsky.</p>
      </header>
      {state.status === "loading" && <LoadingState label="Loading trending topics" />}
      {state.status === "error" && <ErrorState message="Trending topics could not be loaded right now." />}
      {state.status === "ready" && state.topics.length > 0 && (
        <div className="trending-topics-list">
          {state.topics.map((topic) => (
            <button
              key={`${topic.topic}:${topic.link}`}
              type="button"
              className="trending-topic-chip"
              onClick={() => onOpenSearchQuery(topic.topic)}
              title={topic.description || `Search posts about ${topic.topic}`}
            >
              <Hash size={13} />
              <span>{topic.topic}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
