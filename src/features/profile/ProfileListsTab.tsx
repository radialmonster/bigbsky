import { List } from "lucide-react";
import { useCallback } from "react";
import { getActorLists, type ListView } from "../../api";
import type { FeedSource } from "../../sources";
import { AutoLoadMoreButton } from "../feed/AutoLoadMoreButton";
import { EmptyState, ErrorState, LoadingState, RateLimitState } from "../common/State";
import { useCursorPaged } from "../common/useCursorPaged";

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
  const loadPage = useCallback(
    (cursor: string | undefined, signal?: AbortSignal) =>
      getActorLists(actor, 50, signal, cursor).then((response) => ({ items: response.lists, cursor: response.cursor })),
    [actor],
  );
  const { state, loadMore } = useCursorPaged<ListView>(loadPage);

  return (
    <section className="discover-feeds" aria-label="Lists created by this account">
      {state.status === "loading" && <LoadingState label="Loading Lists by this account" />}
      {state.status === "error" && <ErrorState message={state.error || "Lists could not be loaded right now."} />}
      {state.status === "rate-limit" && <RateLimitState message={state.error} />}
      {state.status === "ready" && state.items.length === 0 && (
        <EmptyState title="No Lists" message="This account has not published any public Lists." />
      )}
      {state.status === "ready" && state.items.length > 0 && (
        <>
        <div className="discover-feeds-grid">
          {state.items.map((list) => {
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
