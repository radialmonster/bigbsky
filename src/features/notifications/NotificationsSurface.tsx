import { useCallback, useEffect, useRef, useState } from "react";
import {
  getMissingScopes,
  getNotifications,
  markNotificationsSeen,
  type AuthState,
  type NotificationItem,
} from "../../auth";
import { rateLimitMessage, type Profile } from "../../api";
import { Avatar } from "../common/Avatar";
import { EmptyState, ErrorState, LoadingState } from "../common/State";
import { displayName } from "../../sources";
import { formatPostTime } from "../../lib/time";

const notificationReasonText: Record<string, string> = {
  like: "liked your post",
  repost: "reposted your post",
  follow: "followed you",
  mention: "mentioned you",
  reply: "replied to you",
  quote: "quoted your post",
  "starterpack-joined": "joined via your starter pack",
};

function AuthedNotifications({
  selfHandle,
  onOpenPostByUri,
  onOpenProfile,
  onNotificationsSeen,
  onReauthorize,
}: {
  selfHandle: string;
  onOpenPostByUri: (uri: string, actor: string) => void;
  onOpenProfile: (profile: Profile) => void;
  onNotificationsSeen: () => void;
  onReauthorize: () => void;
}) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | undefined>(undefined);
  const [tab, setTab] = useState<"all" | "mentions">("all");
  // When the read fails, check whether it's because the session is missing the
  // notification scope (added after this user's last consent) so we can offer a
  // contextual re-authorize instead of a dead-end error.
  const [needsReauth, setNeedsReauth] = useState(false);
  // getNotifications takes no abort signal, so guard against the retry race with
  // a generation counter: a Retry click while a prior load is in flight bumps the
  // id, and the stale resolution is ignored instead of overwriting the newer one.
  const loadGenerationRef = useRef(0);

  const load = useCallback(() => {
    const generation = ++loadGenerationRef.current;
    setStatus("loading");
    getNotifications()
      .then((page) => {
        if (loadGenerationRef.current !== generation) return;
        setItems(page.notifications);
        setCursor(page.cursor);
        setStatus("ready");
        // Mark seen so the unread count resets; non-fatal if it fails.
        markNotificationsSeen()
          .then(onNotificationsSeen)
          .catch(() => {});
      })
      .catch(() => {
        if (loadGenerationRef.current !== generation) return;
        setStatus("error");
        // A missing notification scope means re-auth fixes it; a generic gap
        // (network) does not. getMissingScopes tells them apart.
        void getMissingScopes()
          .then((missing) => setNeedsReauth(missing?.some((scope) => scope.includes("notification")) ?? false))
          .catch(() => setNeedsReauth(false));
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function loadMore() {
    if (!cursor || loadingMore) {
      return;
    }
    setLoadingMore(true);
    setLoadMoreError(undefined);
    getNotifications(cursor)
      .then((page) => {
        setItems((current) => [...current, ...page.notifications]);
        setCursor(page.cursor);
      })
      .catch((error) => {
        // Surface the failure instead of swallowing it, so the user sees why the
        // list stopped growing and can retry with the same button.
        setLoadMoreError(rateLimitMessage(error));
      })
      .finally(() => setLoadingMore(false));
  }

  // mentions tab = direct interactions on your posts/handle.
  const mentionReasons = new Set(["mention", "reply", "quote"]);
  const visible = tab === "mentions" ? items.filter((item) => mentionReasons.has(item.reason)) : items;

  function openTarget(item: NotificationItem) {
    if (item.reason === "follow" || item.reason === "starterpack-joined") {
      onOpenProfile(item.author);
      return;
    }
    if ((item.reason === "like" || item.reason === "repost") && item.reasonSubject) {
      // The subject post is the signed-in user's own post.
      onOpenPostByUri(item.reasonSubject, selfHandle);
      return;
    }
    // reply / mention / quote: the notification record itself is the post.
    onOpenPostByUri(item.uri, item.author.handle);
  }

  return (
    <>
      <section className="notification-tabs" aria-label="Notification filters">
        <button className={tab === "all" ? "selected" : ""} type="button" onClick={() => setTab("all")}>
          All
        </button>
        <button className={tab === "mentions" ? "selected" : ""} type="button" onClick={() => setTab("mentions")}>
          Mentions
        </button>
      </section>
      {status === "loading" && <LoadingState label="Loading notifications" />}
      {status === "error" && (
        <div className="surface-retry">
          {needsReauth ? (
            <>
              <ErrorState message="Notifications need updated permissions. BigBsky added notification access since you last signed in — re-authorize to load them." />
              <div className="reauth-banner-actions">
                <button type="button" className="reauth-primary" onClick={onReauthorize}>
                  Update permissions
                </button>
                <button type="button" onClick={load}>
                  Retry
                </button>
              </div>
            </>
          ) : (
            <>
              <ErrorState message="Could not load notifications." />
              <button type="button" onClick={load}>
                Retry
              </button>
            </>
          )}
        </div>
      )}
      {status === "ready" && visible.length === 0 && (
        <EmptyState title="No notifications" message={tab === "mentions" ? "No mentions, replies, or quotes yet." : "You're all caught up."} />
      )}
      {status === "ready" && visible.length > 0 && (
        <section className="notif-feed" aria-label="Notifications">
          {visible.map((item) => (
            <button
              type="button"
              className={item.isRead ? "notif-row" : "notif-row unread"}
              key={`${item.uri}:${item.reason}:${item.indexedAt}`}
              onClick={() => openTarget(item)}
            >
              <Avatar profile={item.author} />
              <div className="notif-body">
                <p>
                  <strong>{displayName(item.author)}</strong>{" "}
                  <span className="notif-handle">@{item.author.handle}</span>{" "}
                  {notificationReasonText[item.reason] || item.reason}
                </p>
                {item.record?.text && <p className="notif-text">{item.record.text}</p>}
                <small>{formatPostTime(item.indexedAt)}</small>
              </div>
            </button>
          ))}
          {loadMoreError ? (
            <div className="load-more-error" role="status">
              <span>{loadMoreError}</span>
              <button type="button" className="load-more" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? "Loading…" : "Retry"}
              </button>
            </div>
          ) : (
            cursor && (
              <button type="button" className="notif-load-more" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? "Loading…" : "Load more"}
              </button>
            )
          )}
        </section>
      )}
    </>
  );
}

export function NotificationsSurface({
  auth,
  pinnedFeedCount,
  pinnedNotificationIds,
  pinnedProfileCount,
  pinnedSearchCount,
  localListCount,
  onOpenSearch,
  onTogglePinnedNotification,
  onOpenPostByUri,
  onOpenProfile,
  onNotificationsSeen,
  onReauthorize,
}: {
  auth: AuthState;
  pinnedFeedCount: number;
  pinnedNotificationIds: string[];
  pinnedProfileCount: number;
  pinnedSearchCount: number;
  localListCount: number;
  onOpenSearch: () => void;
  onTogglePinnedNotification: (id: string) => void;
  onOpenPostByUri: (uri: string, actor: string) => void;
  onOpenProfile: (profile: Profile) => void;
  onNotificationsSeen: () => void;
  onReauthorize: () => void;
}) {
  const events = [
    {
      id: "account",
      title: auth.session ? `Signed in as @${auth.session.handle}` : "Public reader mode",
      detail: auth.session
        ? "Account identity restored from browser OAuth storage."
        : "Sign in from Settings to enable account-backed notification reads later.",
      status: auth.session ? "Account" : "Signed out",
    },
    {
      id: "bookmarks",
      title: "Bookmarks",
      detail: "Posts you bookmark on Bluesky appear in the Bookmarks timeline, synced with your account.",
      status: "Bookmarks",
    },
    {
      id: "feeds",
      title: `${pinnedFeedCount.toLocaleString()} pinned feed${pinnedFeedCount === 1 ? "" : "s"}`,
      detail: "Pinned Feed destinations stay at the top of the desktop selector.",
      status: "Feeds",
    },
    {
      id: "profiles",
      title: `${pinnedProfileCount.toLocaleString()} pinned profile${pinnedProfileCount === 1 ? "" : "s"}`,
      detail: "Pinned profiles are browser-local shortcuts for public profile readers.",
      status: "Profiles",
    },
    {
      id: "searches",
      title: `${pinnedSearchCount.toLocaleString()} pinned search${pinnedSearchCount === 1 ? "" : "es"}`,
      detail: "Pinned searches are kept in the right rail for quick return.",
      status: "Search",
    },
    {
      id: "lists",
      title: `${localListCount.toLocaleString()} browser collection${localListCount === 1 ? "" : "s"}`,
      detail: "Browser-only collections for organizing loaded posts. Your real Bluesky lists load on the Lists route.",
      status: "Lists",
    },
  ];
  const sortedEvents = [
    ...events.filter((event) => pinnedNotificationIds.includes(event.id)),
    ...events.filter((event) => !pinnedNotificationIds.includes(event.id)),
  ];

  return (
    <section className="profile-notifications">
      <section className="surface-placeholder">
        <h2>Notifications</h2>
        <p>
          {auth.session
            ? "Your Bluesky notifications — likes, reposts, follows, replies, mentions, and quotes. Click any item to open the related post or profile."
            : "Sign in to see your Bluesky notifications. The local reader summary below stays available either way."}
        </p>
      </section>

      {auth.session ? (
        <AuthedNotifications
          selfHandle={auth.session.handle}
          onOpenPostByUri={onOpenPostByUri}
          onOpenProfile={onOpenProfile}
          onNotificationsSeen={onNotificationsSeen}
          onReauthorize={onReauthorize}
        />
      ) : (
        <button className="surface-action" type="button" onClick={onOpenSearch}>
          Open mention search
        </button>
      )}

      <details className="notif-local">
        <summary>Browser reader summary</summary>
        <section className="notification-list" aria-label="Local reader summary">
          {sortedEvents.map((event) => {
            const isPinned = pinnedNotificationIds.includes(event.id);
            return (
              <article className={isPinned ? "notification-item pinned" : "notification-item"} key={event.id}>
                <span>{event.status}</span>
                <div>
                  <h3>{event.title}</h3>
                  <p>{event.detail}</p>
                  <button type="button" onClick={() => onTogglePinnedNotification(event.id)}>
                    {isPinned ? "Unpin" : "Pin"}
                  </button>
                </div>
              </article>
            );
          })}
        </section>
      </details>
    </section>
  );
}
