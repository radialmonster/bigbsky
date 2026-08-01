import { List } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { getActorLists, isRateLimit, rateLimitMessage, type ListView } from "../../api";
import type { FeedSource } from "../../sources";
import { AutoLoadMoreButton } from "../feed/AutoLoadMoreButton";
import { EmptyState, ErrorState, LoadingState, RateLimitState } from "../common/State";

export function listPurposeLabel(purpose?: string) {
  if (purpose?.includes("modlist")) {
    return "Moderation list";
  }
  if (purpose?.includes("curatelist")) {
    return "User list";
  }
  return "List";
}

export function ProfileListsTab({ actor, onOpenFeed }: { actor: string; onOpenFeed: (source: FeedSource) => void }) {
  const [state, setState] = useState<{
    status: "loading" | "ready" | "error" | "rate-limit";
    lists: ListView[];
    cursor?: string;
    error?: string;
    loadMoreError?: string;
  }>({ status: "loading", lists: [] });
  const loadMoreBusyRef = useRef(false);
  const loadMoreControllerRef = useRef<AbortController | null>(null);

  const loadPage = useCallback(
    (cursor: string | undefined, signal?: AbortSignal) =>
      getActorLists(actor, 50, signal, cursor).then((response) => ({ lists: response.lists, cursor: response.cursor })),
    [actor],
  );

  useEffect(() => {
    const controller = new AbortController();
    loadMoreBusyRef.current = false;
    loadMoreControllerRef.current?.abort();
    loadMoreControllerRef.current = null;
    setState({ status: "loading", lists: [] });

    loadPage(undefined, controller.signal)
      .then(({ lists, cursor }) => setState({ status: "ready", lists, cursor }))
      .catch((error) => {
        if (!controller.signal.aborted) {
          setState({
            status: isRateLimit(error) ? "rate-limit" : "error",
            lists: [],
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
      .then(({ lists, cursor }) => {
        loadMoreBusyRef.current = false;
        if (loadMoreControllerRef.current === controller) {
          loadMoreControllerRef.current = null;
        }
        setState((current) => ({
          ...current,
          lists: [...current.lists, ...lists],
          cursor,
          loadMoreError: undefined,
        }));
      })
      .catch((error) => {
        loadMoreBusyRef.current = false;
        if (loadMoreControllerRef.current === controller) {
          loadMoreControllerRef.current = null;
        }
        setState((current) => ({
          ...current,
          loadMoreError: isRateLimit(error) ? rateLimitMessage(error) : "Couldn't load more right now.",
        }));
      });
  }, [loadPage, state.cursor, state.status]);

  return (
    <section className="discover-feeds" aria-label="Lists created by this account">
      {state.status === "loading" && <LoadingState label="Loading Lists by this account" />}
      {state.status === "error" && <ErrorState message={state.error || "Lists could not be loaded right now."} />}
      {state.status === "rate-limit" && <RateLimitState message={state.error} />}
      {state.status === "ready" && state.lists.length === 0 && (
        <EmptyState title="No Lists" message="This account has not published any public Lists." />
      )}
      {state.status === "ready" && state.lists.length > 0 && (
        <>
        <div className="discover-feeds-grid">
          {state.lists.map((list) => {
            const listRkey = list.uri.split("/").pop();
            const bskyUrl =
              list.creator?.handle && listRkey
                ? `https://bsky.app/profile/${list.creator.handle}/lists/${listRkey}`
                : "https://bsky.app";
            const isCurateList = list.purpose?.includes("curatelist") ?? false;
            const source: FeedSource = {
              id: list.uri,
              uri: list.uri,
              label: list.name || "List",
              group: "Discovered",
              description: list.description || "Public Bluesky list timeline.",
            };
            const body = (
              <>
                {list.avatar ? (
                  <img className="discover-feed-avatar" src={list.avatar} alt="" loading="lazy" />
                ) : (
                  <span className="discover-feed-glyph">
                    <List size={20} />
                  </span>
                )}
                <span className="discover-feed-body">
                  <strong>{list.name || "List"}</strong>
                  <small>
                    {listPurposeLabel(list.purpose)}
                    {typeof list.listItemCount === "number" ? ` · ${list.listItemCount.toLocaleString()} members` : ""}
                  </small>
                  {list.description && <span className="discover-feed-desc">{list.description}</span>}
                </span>
              </>
            );
            return (
              <article className="discover-feed-card" key={list.uri}>
                {isCurateList ? (
                  <button type="button" className="discover-feed-open" onClick={() => onOpenFeed(source)}>
                    {body}
                  </button>
                ) : (
                  <div className="discover-feed-open">{body}</div>
                )}
                <div className="discover-feed-actions">
                  {isCurateList && (
                    <button type="button" className="discover-feed-pin" onClick={() => onOpenFeed(source)}>
                      Open list
                    </button>
                  )}
                  <a className="discover-feed-external" href={bskyUrl} target="_blank" rel="noreferrer">
                    Open on Bluesky
                  </a>
                </div>
              </article>
            );
          })}
        </div>
        {state.cursor && (
          <AutoLoadMoreButton label="Load more Lists" onLoadMore={loadMore} error={state.loadMoreError} />
        )}
      </>
      )}
    </section>
  );
}
