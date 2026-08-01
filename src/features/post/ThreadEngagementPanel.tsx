import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { getLikes, getRepostedBy, getQuotes, isRateLimit, rateLimitMessage, type FeedPost, type Profile } from "../../api";
import { EmptyState, ErrorState, LoadingState, RateLimitState } from "../common/State";
import { Avatar } from "../common/Avatar";
import { AutoLoadMoreButton } from "../feed/AutoLoadMoreButton";
import { displayName } from "../../sources";

export function ThreadEngagementPanel({
  uri,
  kind,
  onOpenProfile,
  onOpenPost,
  onClose,
}: {
  uri: string;
  kind: "reposts" | "quotes" | "likes";
  onOpenProfile: (profile: Profile) => void;
  onOpenPost: (post: FeedPost) => void;
  onClose: () => void;
}) {
  const [state, setState] = useState<{
    status: "loading" | "ready" | "error" | "rate-limit";
    actors: Profile[];
    posts: FeedPost[];
    cursor?: string;
    error?: string;
    loadMoreError?: string;
  }>({ status: "loading", actors: [], posts: [] });
  const loadMoreBusyRef = useRef(false);
  const loadMoreControllerRef = useRef<AbortController | null>(null);

  const loadPage = useCallback(
    (cursor: string | undefined, signal?: AbortSignal) => {
      if (kind === "likes") {
        return getLikes(uri, 50, signal, cursor).then((response) => ({
          actors: response.likes.map((like) => like.actor),
          posts: [] as FeedPost[],
          cursor: response.cursor,
        }));
      }
      if (kind === "reposts") {
        return getRepostedBy(uri, 50, signal, cursor).then((response) => ({
          actors: response.repostedBy,
          posts: [] as FeedPost[],
          cursor: response.cursor,
        }));
      }
      return getQuotes(uri, 30, signal, cursor).then((response) => ({
        actors: [] as Profile[],
        posts: response.posts,
        cursor: response.cursor,
      }));
    },
    [kind, uri],
  );

  useEffect(() => {
    const controller = new AbortController();
    loadMoreBusyRef.current = false;
    loadMoreControllerRef.current?.abort();
    loadMoreControllerRef.current = null;
    setState({ status: "loading", actors: [], posts: [] });

    loadPage(undefined, controller.signal)
      .then(({ actors, posts, cursor }) => setState({ status: "ready", actors, posts, cursor }))
      .catch((error) => {
        if (!controller.signal.aborted) {
          setState({
            status: isRateLimit(error) ? "rate-limit" : "error",
            actors: [],
            posts: [],
            error: rateLimitMessage(error),
          });
        }
      });
    return () => {
      controller.abort();
      loadMoreControllerRef.current?.abort();
      loadMoreControllerRef.current = null;
    };
  }, [loadPage]);

  const loadMore = useCallback(() => {
    if (state.status !== "ready" || !state.cursor || loadMoreBusyRef.current) {
      return;
    }
    loadMoreBusyRef.current = true;
    const controller = new AbortController();
    loadMoreControllerRef.current = controller;
    loadPage(state.cursor, controller.signal)
      .then(({ actors, posts, cursor }) => {
        loadMoreBusyRef.current = false;
        if (loadMoreControllerRef.current === controller) {
          loadMoreControllerRef.current = null;
        }
        setState((current) => ({
          ...current,
          actors: [...current.actors, ...actors],
          posts: [...current.posts, ...posts],
          cursor,
          loadMoreError: undefined,
        }));
      })
      .catch((error) => {
        loadMoreBusyRef.current = false;
        if (loadMoreControllerRef.current === controller) {
          loadMoreControllerRef.current = null;
        }
        // Keep the already-loaded results and the cursor so the user can retry;
        // surface the failure on the load-more control (which also stops the
        // auto-fire so we don't hammer a rate-limited endpoint).
        setState((current) => ({
          ...current,
          loadMoreError: isRateLimit(error) ? rateLimitMessage(error) : "Couldn't load more right now.",
        }));
      });
  }, [loadPage, state.cursor, state.status]);

  const heading = kind === "likes" ? "Liked by" : kind === "reposts" ? "Reposted by" : "Quotes";

  return (
    <section className="thread-engagement" aria-label={heading}>
      <header className="thread-engagement-header">
        <h3>{heading}</h3>
        <button type="button" className="thread-engagement-close" onClick={onClose} aria-label="Close">
          <X size={15} />
        </button>
      </header>
      {state.status === "loading" && <LoadingState label={`Loading ${heading.toLowerCase()}`} />}
      {state.status === "error" && <ErrorState message={state.error || "Could not load this list right now."} />}
      {state.status === "rate-limit" && <RateLimitState message={state.error} />}
      {state.status === "ready" && kind !== "quotes" && state.actors.length === 0 && (
        <EmptyState title="Nobody yet" message="No accounts to show for this post." />
      )}
      {state.status === "ready" && kind === "quotes" && state.posts.length === 0 && (
        <EmptyState title="No quotes" message="No quote posts to show for this post." />
      )}
      {state.status === "ready" && kind !== "quotes" && state.actors.length > 0 && (
        <div className="search-results-list">
          {state.actors.map((actor) => (
            <button className="profile-result-card" key={actor.did} type="button" onClick={() => onOpenProfile(actor)}>
              <Avatar profile={actor} />
              <span>
                <strong>{displayName(actor)}</strong>
                <small>@{actor.handle}</small>
                {actor.description && <em>{actor.description}</em>}
              </span>
            </button>
          ))}
        </div>
      )}
      {state.status === "ready" && kind === "quotes" && state.posts.length > 0 && (
        <div className="search-results-list">
          {state.posts.map((post) => (
            <button className="profile-result-card" key={post.uri} type="button" onClick={() => onOpenPost(post)}>
              <Avatar profile={post.author} />
              <span>
                <strong>{displayName(post.author)}</strong>
                <small>@{post.author.handle}</small>
                {post.record.text && <em>{post.record.text}</em>}
              </span>
            </button>
          ))}
        </div>
      )}
      {state.status === "ready" && state.cursor && (
        <AutoLoadMoreButton
          label={`Load more ${heading.toLowerCase()}`}
          onLoadMore={loadMore}
          error={state.loadMoreError}
        />
      )}
    </section>
  );
}
