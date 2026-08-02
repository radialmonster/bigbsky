import {
  Bookmark,
  Compass,
  Film,
  Hash,
  Heart,
  Home,
  Info,
  Link as LinkIcon,
  List,
  Loader2,
  LogOut,
  Menu,
  Plus,
  X,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  GripVertical,
  MessageCircle,
  MoreHorizontal,
  Repeat2,
  Search,
  Settings,
  Share2,
  ShieldAlert,
  User,
  Users,
  Quote,
} from "lucide-react";
import { createContext, lazy, Suspense, type CSSProperties, type MouseEvent as ReactMouseEvent, type RefObject, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  type FeedItem,
  type FeedGeneratorView,
  type FeedPost,
  type ListView,
  type Profile,
  type RecordEmbedView,
  type RichTextFacet,
  type ThreadNode,
  isListUri,
  isFeedGeneratorUri,
  getEmbedImages,
  getExternalEmbed,
  getRecordEmbed,
  getUnknownEmbedType,
  getVideoEmbed,
  rateLimitMessage,
} from "./api";
import { formatPostTime, postSortAt } from "./lib/time";
import { orderBySavedOrder } from "./lib/feed-order";
import { pinnedFeedsStorageKey, readPinnedFeedIds, readPinnedFeedMeta, writePinnedFeedMeta } from "./lib/feed-meta";
import {
  safeLocalStorageGet,
  safeLocalStorageRemove,
  safeLocalStorageSet,
  safeSessionStorageRemove,
} from "./lib/storage";
import {
  parseBooleanRecord,
  parseColumnVisibility,
  parseComposerDraft,
  parseNonEmptyStringArray,
  parseObjectArray,
  parseObjectMap,
  parseStringArray,
} from "./lib/preferences";
import { postBskyUrl, safeHttpUrl } from "./lib/url";
import { createCache, useCache } from "./lib/cache";
import { detectPostLanguage, filterFeedByLanguages, postsNeedingDetection } from "./lib/content-language";
import {
  MOBILE_SCROLL_QUERY,
  armScrollRestore,
  clampScrollTarget,
  readScrollOffset,
  readTimelineAnchorCache,
  readTimelineScrollCache,
  readTopVisibleAnchor,
  releaseScrollRestoreGuard,
  restoreOrResetScroll,
  restoreScrollOffset,
  scrollOffsetTo,
  shouldSuppressScrollSave,
  writeTimelineAnchorCache,
  writeTimelineScrollCache,
  type ScrollAnchor,
} from "./lib/scroll";
import {
  createFeedLoader,
  createProfileFeedLoader,
  createSearchLoader,
  createActorSearchLoader,
  createFeedSearchLoader,
  createThreadLoader,
  createThreadBranchLoader,
  createFeedMetadataLoader,
  createListMetadataLoader,
  type FeedState,
  type SearchState,
  type ActorSearchState,
  type FeedSearchState,
  type DevMetrics,
  type BranchLoadResult,
  type ProfileFeedFilter,
  emptyFeedState,
  emptySearchState,
  emptyActorSearchState,
  emptyFeedSearchState,
  initialDevMetrics,
  hydrateProfileSelfThreads,
  postHasVisualMedia,
} from "./lib/loaders";
import {
  buildAnchoredThreadParts,
  buildThreadedFeedRows,
  canHideCombinedThreadMarkers,
  combinedThreadSegment,
  countThreadRows,
  feedRowKey,
  feedRowPost,
  getContinuationReply,
  isSelfThreadReply,
  isThreadedFeedItem,
  postReplyRootUri,
  threadMarkerMatch,
} from "./lib/threads";
import type { ThreadPart, ThreadedFeedItem } from "./lib/threads";
import { EmptyState, EndOfFeedCard, RateLimitState } from "./features/common/State";
import { ToastContext, ToastHost, type ToastKind, type ToastMessage } from "./features/common/ToastHost";
import { BackToTopButton } from "./features/feed/BackToTopButton";
import { ProfileContextPanel } from "./features/rightRail/ProfileContextPanel";
import {
  type AuthSnapshot,
  type AuthState,
  type SubscribedFeed,
  blockAccount,
  bookmarkPost,
  followAccount,
  followFeed,
  getAccountManagementUrl,
  getBookmarks,
  createModList,
  deleteModList,
  getMissingScopes,
  getMyLists,
  getUnreadNotificationCount,
  getSubscribedFeeds,
  clearOAuthLocalSession,
  initAuthSession,
  setSessionInvalidatedListener,
  likePost,
  deletePost,
  syncSavedFeedsOrder,
  unblockAccount,
  unbookmarkPost,
  unfollowAccount,
  unfollowFeed,
  unlikePost,
  looksLikeOAuthCallback,
  signOut,
  startSignIn,
} from "./auth";
import { getRouteState, type RouteState } from "./router";
import { displayName, feedSources, navigationItems, type FeedSource } from "./sources";
import { ErrorBoundary } from "./ErrorBoundary";
import { AutoLoadMoreButton, PostRowFallback } from "./features/feed/AutoLoadMoreButton";
import { Avatar } from "./features/common/Avatar";
import { ErrorState, LoadingState } from "./features/common/State";
import { MediaHiddenButton, SensitiveMediaGate } from "./features/common/MediaGate";
import { ReplyLimitedNotice } from "./features/post/ReplyLimitedNotice";
import { ExternalLinkCard } from "./features/post/ExternalLinkCard";
import { renderRichText } from "./features/post/RichText";
import { UnsupportedEmbedNotice } from "./features/post/UnsupportedEmbedNotice";
import { useReplyGate } from "./features/post/useReplyGate";
import { ThreadEngagementPanel } from "./features/post/ThreadEngagementPanel";
import { ImageViewer, type ImageViewerImage, type ImageViewerState } from "./features/post/ImageViewer";
import { useSharePost, shareButtonLabel } from "./features/common/useSharePost";
import { useDismissMenu } from "./features/common/useDismissMenu";
import { isSensitiveLabel, moderationLabelText, sensitiveMediaValues } from "./lib/moderation";
import { RecentPanel, type RecentItem } from "./features/rightRail/RecentPanel";
import { FeedContextPanel, type EntityCache } from "./features/rightRail/FeedContextPanel";
import { TrendingPanel } from "./features/rightRail/TrendingPanel";
import { DevInspector } from "./features/rightRail/DevInspector";
import { PinnedSearchesPanel } from "./features/rightRail/PinnedSearchesPanel";
import { PinnedProfilesPanel } from "./features/rightRail/PinnedProfilesPanel";
import { HomeSourcePicker, type HomeOption } from "./features/feed/HomeSourcePicker";
import { ProfileDetailHeader, type ProfileTab } from "./features/profile/ProfileDetailHeader";
import { ProfileFeedsTab } from "./features/profile/ProfileFeedsTab";
import { ProfileListsTab } from "./features/profile/ProfileListsTab";
import { ListsSurface, type LocalList } from "./features/lists/ListsSurface";
import { ExploreTrendingTopics } from "./features/explore/ExploreTrendingTopics";
import { ExploreDiscoverFeeds } from "./features/explore/ExploreDiscoverFeeds";
import { NotificationsSurface } from "./features/notifications/NotificationsSurface";
import {
  FeedDensityOverrideControl,
  FeedShowMediaOverrideControl,
  densityModes,
  feedDensityOverride,
  feedPreferenceKey,
  feedPreferenceKeys,
  feedShowMediaOverride,
  type DensityMode,
} from "./features/feed/FeedDensityControls";
import { AccountPanel, SignInForm } from "./features/auth/AccountPanel";
import { SearchBox } from "./features/search/SearchBox";
import {
  POST_LANGUAGE_OPTIONS,
  PostComposer,
  composerDraftStorageKey,
  languageDisplayName,
  type PostRefValue,
} from "./features/composer/PostComposer";

const navIcons: Record<string, typeof Home> = {
  Home,
  Feeds: Hash,
  Lists: List,
  Bookmarks: Bookmark,
  Search,
  Explore: Compass,
  Profile: User,
  Settings,
  Info,
};
const InfoPage = lazy(() => import("./InfoPage"));

// Lets deeply-nested post cards open an in-app hashtag search without threading
// a callback through every PostCard/VirtualPostList call site.
const TagSearchContext = createContext<((tag: string) => void) | null>(null);

// Browser-local NSFW preference; false (hide/warn) by default for everyone.
// Read by post cards to decide whether adult/graphic media is gated.
const ShowNsfwContext = createContext<boolean>(false);

// Read by post cards to decide whether to render images/video at all. When
// off, media is replaced by a click-to-reveal affordance (text still shows).
const ShowMediaContext = createContext<boolean>(true);

const DensityContext = createContext<string>("comfortable");

// Like state + toggle, provided once and consumed directly by post cards so we
// don't thread like props through the virtualized list and every call site.
// Override state lives in the parent (App) so it survives row virtualization.
type LikeView = { liked: boolean; count: number };
type LikeContextValue = {
  canLike: boolean;
  getState: (post: FeedPost) => LikeView;
  toggle: (post: FeedPost) => void;
};
const LikeContext = createContext<LikeContextValue | null>(null);

// Native Bluesky bookmark state + toggle, provided once and consumed by the
// post card so we don't thread bookmark props through the virtualized list and
// every call site. Override state lives in the parent (App) so it survives row
// virtualization. Only available when signed in (bookmarks are an authenticated
// AppView feature). Mirrors LikeContext.
type BookmarkView = { bookmarked: boolean; error?: string };
type BookmarkContextValue = {
  canBookmark: boolean;
  getState: (post: FeedPost) => BookmarkView;
  toggle: (post: FeedPost) => void;
};
const BookmarkContext = createContext<BookmarkContextValue | null>(null);

// Block state + toggle for a post's author, provided once and consumed by the
// post card's options menu. Keyed by author DID (not post URI) so blocking from
// one post reflects on every post by that author. Mirrors LikeContext.
type BlockView = { blocked: boolean; uri?: string };
type BlockContextValue = {
  canBlock: boolean;
  selfDid?: string;
  getState: (author: Profile) => BlockView;
  toggle: (author: Profile) => void;
};
const BlockContext = createContext<BlockContextValue | null>(null);

type DeletePostContextValue = {
  canDelete: boolean;
  deletePost: (post: FeedPost) => void;
};
const DeletePostContext = createContext<DeletePostContextValue | null>(null);

function readShowNsfw() {
  try {
    // Off by default: only an explicit opt-in shows adult/graphic media.
    return localStorage.getItem(showNsfwStorageKey) === "true";
  } catch {
    return false;
  }
}

function readShowMedia() {
  try {
    // On by default: only an explicit "false" disables media.
    return localStorage.getItem(showMediaStorageKey) !== "false";
  } catch {
    return true;
  }
}

// Selected content languages (base 639-1 codes) for the "Show posts from
// language" filter. An empty list means "Any" (no filtering) — the default.
// Browser-local only, like showMedia/showNsfw; never synced to the account.
function readContentLanguages() {
  return parseNonEmptyStringArray(safeLocalStorageGet(contentLanguagesStorageKey));
}
// Bluesky's newer gallery embed allows up to 10 authored images per post.
const maxPostImages = 10;

// Authenticated reverse-chronological home timeline. Only shown/loaded when
// signed in; its sentinel uri "following" routes the loader to getTimeline.
const followingSource: FeedSource = {
  id: "following",
  uri: "following",
  label: "Following",
  group: "Core",
  description: "Your timeline of accounts you follow, newest first.",
};

// The user's chosen Home feed (what the house icon / root "/" shows). Stored
// locally; defaults to "following". "following" and any custom subscribed feed
// need a signed-in session — when signed out we fall back to the public Discover
// feed so Home never breaks if auth is lost.
const homeSourceStorageKey = "bigbsky:home-source";
const publicHomeFallback = feedSources.find((source) => source.id === "discover") ?? feedSources[0];

function readHomeSourceId(): string {
  try {
    return localStorage.getItem(homeSourceStorageKey) || "following";
  } catch {
    return "following";
  }
}

function resolveHomeSource(homeId: string, signedIn: boolean, subscribed: FeedSource[]): FeedSource {
  if (homeId === "following") {
    return signedIn ? followingSource : publicHomeFallback;
  }
  const known =
    feedSources.find((source) => source.id === homeId) ??
    subscribed.find((source) => source.id === homeId || source.uri === homeId);
  if (known) {
    return known;
  }
  // A saved feed or list chosen as Home is identified by its at:// URI but may
  // not be in `subscribed` (lists never are; a custom feed isn't while signed
  // out). When signed in, open it as a synthetic source the feed loader
  // understands — getListFeed for list URIs, the public feed path otherwise.
  // Signed out, fall back to public Discover so Home never breaks.
  if (signedIn && homeId.startsWith("at://")) {
    const list = isListUri(homeId);
    return {
      id: homeId,
      uri: homeId,
      label: list ? "List" : "Feed",
      group: "Discovered",
      description: list ? "Your Bluesky list timeline." : "Your saved feed.",
    };
  }
  return publicHomeFallback;
}

const searchTabs = ["posts", "people", "feeds"] as const;
const searchLanguages = [
  { label: "Any language", value: "" },
  { label: "English", value: "en" },
  { label: "Spanish", value: "es" },
  { label: "Japanese", value: "ja" },
  { label: "German", value: "de" },
  { label: "French", value: "fr" },
];
function feedSourceMatches(source: FeedSource, query: string) {
  return `${source.label} ${source.description} ${source.group}`.toLowerCase().includes(query.trim().toLowerCase());
}

const recentStorageKey = "bigbsky:recent";
const localListsStorageKey = "bigbsky:local-lists";
const workspaceWidthStorageKey = "bigbsky:workspace-width";
const widthByContextStorageKey = "bigbsky:width-by-context";
const densityByContextStorageKey = "bigbsky:density-by-context";
const columnsStorageKey = "bigbsky:columns";
const showNsfwStorageKey = "bigbsky:show-nsfw";
const showMediaStorageKey = "bigbsky:show-media";
const showMediaByFeedStorageKey = "bigbsky:show-media-by-feed";
const contentLanguagesStorageKey = "bigbsky:content-languages";
const feedOrderStorageKey = "bigbsky:feed-order";
const pinnedSearchesStorageKey = "bigbsky:pinned-searches";
const pinnedProfilesStorageKey = "bigbsky:pinned-profiles";
const pinnedNotificationsStorageKey = "bigbsky:pinned-notifications";
const collapsedFeedGroupsStorageKey = "bigbsky:collapsed-feed-groups";
// Frame budgets for the content-anchored restore loop in VirtualPostList. Like
// the pixel restore (restoreScrollOffset), the loop re-asserts the target across
// a few frames; the difference is the target is recomputed each frame from the
// live measured row layout and clamped against the live totalHeight, so it
// converges instead of fighting the measurement shrink (issue #8).
const SCROLL_ANCHOR_MAX_FRAMES = 60;
const SCROLL_ANCHOR_STABLE_FRAMES = 3;
const reauthDismissKey = "bigbsky:reauth-dismissed";
const initialAuthState: AuthState = {
  status: looksLikeOAuthCallback() ? "callback" : "checking",
  session: null,
};

function countBigBskyLocalKeys() {
  try {
    return Object.keys(localStorage).filter((key) => key.startsWith("bigbsky:")).length;
  } catch {
    return 0;
  }
}

function readDensityPreferences() {
  return parseObjectMap<DensityMode>(safeLocalStorageGet(densityByContextStorageKey));
}

function readShowMediaPreferences() {
  return parseBooleanRecord(safeLocalStorageGet(showMediaByFeedStorageKey));
}

function readRecentItems() {
  // No per-entry shape validation historically — only Array-check + cap of 8.
  return parseObjectArray<RecentItem>(safeLocalStorageGet(recentStorageKey), (_item): _item is RecentItem => true, 8);
}

function readLocalLists() {
  return parseObjectArray<LocalList>(
    safeLocalStorageGet(localListsStorageKey),
    (list): list is LocalList =>
      Boolean(list) &&
      typeof (list as LocalList).id === "string" &&
      typeof (list as LocalList).name === "string",
  )
    .map((list) => ({
      ...list,
      posts: Array.isArray(list.posts)
        ? list.posts.filter((post) => post && typeof post.uri === "string").slice(0, 100)
        : [],
    }))
    .slice(0, 20);
}

function readComposerDraft() {
  return parseComposerDraft(safeLocalStorageGet(composerDraftStorageKey));
}

// Side-column visibility. The far-left icon rail is always present; the feeds
// column and the right context column are each optional and toggled globally
// (not per-feed — a sidebar toggle is expected to be a window-wide preference).
// Migrates the previous balanced/wide/focus width preference: only "focus" hid
// a column (the right rail), so legacy focus users keep their right column off.
type ColumnVisibility = { feeds: boolean; right: boolean };

function readColumnPreferences(): ColumnVisibility {
  const stored = parseColumnVisibility(safeLocalStorageGet(columnsStorageKey));
  if (stored) {
    return stored;
  }
  try {
    // Migrate the legacy width preference (per-context map first, then the
    // older single-value key). "focus" was the only mode that hid a column.
    const legacyMap = JSON.parse(localStorage.getItem(widthByContextStorageKey) || "{}") as Record<string, string>;
    const legacy = (legacyMap && typeof legacyMap === "object" && legacyMap.default) || localStorage.getItem(workspaceWidthStorageKey);
    if (legacy === "focus") {
      return { feeds: true, right: false };
    }
    return { feeds: true, right: true };
  } catch {
    return { feeds: true, right: true };
  }
}

// Browser-local manual ordering of the signed-in user's saved feeds, stored as
// a list of feed URIs. It is applied to subscribedFeeds for both the /feeds
// "Your feeds" grid and the desktop feed-selector "My Feeds" group; feeds not
// present here fall back to their account (Bluesky preference) order.
function readFeedOrder() {
  return parseStringArray(safeLocalStorageGet(feedOrderStorageKey));
}

function readPinnedSearches() {
  return parseNonEmptyStringArray(safeLocalStorageGet(pinnedSearchesStorageKey), 12);
}

function readPinnedProfiles() {
  return parseObjectArray<Profile>(
    safeLocalStorageGet(pinnedProfilesStorageKey),
    (profile): profile is Profile =>
      Boolean(profile) &&
      typeof (profile as Profile).did === "string" &&
      typeof (profile as Profile).handle === "string",
    16,
  );
}

function readPinnedNotifications() {
  return parseNonEmptyStringArray(safeLocalStorageGet(pinnedNotificationsStorageKey), 20);
}

function readCollapsedFeedGroups() {
  return parseObjectMap<boolean>(safeLocalStorageGet(collapsedFeedGroupsStorageKey));
}

function profileFeedFilterForTab(tab: ProfileTab): ProfileFeedFilter {
  if (tab === "posts") {
    return "posts_no_replies";
  }
  if (tab === "media") {
    return "posts_with_media";
  }
  if (tab === "videos") {
    return "posts_with_video";
  }
  return "posts_with_replies";
}

function postPath(post: FeedPost) {
  const rkey = post.uri.split("/").pop();
  return rkey ? `/profile/${encodeURIComponent(post.author.handle)}/post/${encodeURIComponent(rkey)}` : null;
}

function profilePath(profile: Profile) {
  const actor = profile.handle || profile.did;
  return `/profile/${encodeURIComponent(actor)}`;
}

function handleInternalLinkClick(event: ReactMouseEvent<HTMLAnchorElement>, navigate: () => void) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return;
  }
  event.preventDefault();
  navigate();
}

function parsePostUrl(value: string) {
  const trimmed = value.trim();
  const fallbackBase = window.location.origin;

  try {
    const url = new URL(trimmed, fallbackBase);
    const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    if (parts[0] === "profile" && parts[1] && parts[2] === "post" && parts[3]) {
      return {
        actor: parts[1],
        rkey: parts[3],
        path: `/profile/${encodeURIComponent(parts[1])}/post/${encodeURIComponent(parts[3])}`,
      };
    }
  } catch {
    return null;
  }

  return null;
}

function replyRootRefForPost(post: FeedPost): PostRefValue {
  const rootRef = post.record.reply?.root;
  return rootRef?.uri && rootRef?.cid ? { uri: rootRef.uri, cid: rootRef.cid } : { uri: post.uri, cid: post.cid };
}

function safeEmbedImages(images: ReturnType<typeof getEmbedImages>) {
  return images
    .map((image) => ({
      ...image,
      thumb: safeHttpUrl(image.thumb),
      fullsize: safeHttpUrl(image.fullsize),
    }))
    .filter((image) => image.thumb || image.fullsize);
}

function normalizeLinkHref(value?: string | null) {
  const href = safeHttpUrl(value);
  if (!href) {
    return undefined;
  }
  try {
    const url = new URL(href);
    url.hash = "";
    return url.href;
  } catch {
    return href;
  }
}

function extractFacetLinks(facets: RichTextFacet[] | undefined): string[] {
  if (!facets?.length) {
    return [];
  }

  const links: string[] = [];
  const seen = new Set<string>();

  for (const facet of facets) {
    const feature = facet.features?.find((item) => item.$type === "app.bsky.richtext.facet#link" && item.uri);
    const href = normalizeLinkHref(feature?.uri);
    if (!href || seen.has(href)) {
      continue;
    }

    links.push(href);
    seen.add(href);
  }

  return links;
}

function hasPostImages(post: FeedPost) {
  return safeEmbedImages(getEmbedImages(post.embed)).length > 0;
}

function hasPostVideo(post: FeedPost) {
  return !!getVideoEmbed(post.embed);
}

function postTextClass(text: string) {
  return text.includes("\n") ? "post-text has-line-breaks" : "post-text";
}

function postHasEmbeds(post: FeedPost): boolean {
  return (
    getEmbedImages(post.embed).length > 0 ||
    !!getVideoEmbed(post.embed) ||
    !!getExternalEmbed(post.embed) ||
    !!getRecordEmbed(post.embed) ||
    extractFacetLinks(post.record.facets).length > 0
  );
}

function combinedThreadStats(posts: FeedPost[], rootPost: FeedPost, likeView?: LikeView) {
  // Each continuation part is itself a reply to the previous part, so it is
  // counted in that part's replyCount. Subtract the n-1 linear continuation hops
  // so the chip approximates external replies to the thread, not its own
  // continuations. Caveat (todo Bug 4): this only removes the *linear* chain hops.
  // If the author forked their self-thread (replied to one part more than once),
  // the extra fork(s) stay counted, so the number can read slightly high. A
  // precise count isn't computable here: a ThreadedFeedItem carries only each
  // post's aggregate replyCount integer, not the reply trees needed to tell a
  // fork from an external reply. The error is bounded by the fork count (rare)
  // and always in the safe direction - we never over-subtract and hide real
  // replies, since every hop we subtract is a continuation that genuinely exists.
  const replyCount = Math.max(0, posts.reduce((total, post) => total + (post.replyCount ?? 0), 0) - (posts.length - 1));
  const repostCount = posts.reduce((total, post) => total + (post.repostCount ?? 0), 0);
  const quoteCount = posts.reduce((total, post) => total + (post.quoteCount ?? 0), 0);
  const likeCount = posts.reduce((total, post) => total + (post.likeCount ?? 0), 0);
  // Only the first (root) post can be liked here, so swap its static server count
  // for the optimistic live count; otherwise the heart fills on like but the
  // number never moves, reading as "the like didn't register".
  const liveLikeCount = likeCount - (rootPost.likeCount ?? 0) + (likeView ? likeView.count : rootPost.likeCount ?? 0);
  const hideThreadMarkers = canHideCombinedThreadMarkers(posts);
  return { replyCount, repostCount, quoteCount, likeCount, liveLikeCount, hideThreadMarkers };
}

function extractHashtags(text?: string) {
  if (!text) {
    return [];
  }

  return Array.from(text.matchAll(/(^|[\s([{])#([\p{L}\p{N}_-]{2,64})/gu), (match) => `#${match[2]}`);
}

// Whether a post should be hidden entirely when the NSFW preference is set to
// hidden: it (or its author) carries an adult/graphic media label. Mirrors the
// media-gate label set (spam excluded) so "hidden" removes exactly the posts
// whose media would otherwise be gated.
function isAdultPost(post: FeedPost): boolean {
  const labels = [
    ...((post.labels ?? []) as Array<{ val?: string }>),
    ...((post.author?.labels ?? []) as Array<{ val?: string }>),
  ];
  return sensitiveMediaValues(labels).length > 0;
}

function videoKindLabel(type?: string) {
  if (type?.toLowerCase().includes("gif")) {
    return "GIF";
  }

  return "Video";
}

type VideoEmbedView = NonNullable<ReturnType<typeof getVideoEmbed>>;

function VideoEmbedCard({ video, compact = false }: { video: VideoEmbedView; compact?: boolean }) {
  const kind = videoKindLabel(video.type);
  const playlist = safeHttpUrl(video.playlist);
  const thumbnail = safeHttpUrl(video.thumbnail);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [unsupported, setUnsupported] = useState(false);
  const aspectRatio =
    video.aspectRatio?.width && video.aspectRatio?.height
      ? `${video.aspectRatio.width} / ${video.aspectRatio.height}`
      : undefined;
  const videoFrameStyle = aspectRatio
    ? ({ "--video-aspect": aspectRatio } as CSSProperties)
    : undefined;

  useEffect(() => {
    const element = videoRef.current;
    if (!playlist || !element) {
      return undefined;
    }

    setUnsupported(false);
    let active = true;
    let destroy: (() => void) | undefined;
    import("hls.js")
      .then(({ default: Hls }) => {
        if (!active || !videoRef.current) {
          return;
        }
        if (!Hls.isSupported()) {
          if (videoRef.current.canPlayType("application/vnd.apple.mpegurl")) {
            videoRef.current.src = playlist;
          } else {
            setUnsupported(true);
          }
          return;
        }
        const hls = new Hls();
        destroy = () => hls.destroy();
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data?.fatal) {
            setUnsupported(true);
          }
        });
        hls.loadSource(playlist);
        hls.attachMedia(videoRef.current);
      })
      .catch(() => {
        if (active) {
          setUnsupported(true);
        }
      });

    return () => {
      active = false;
      destroy?.();
      element.removeAttribute("src");
      element.load();
    };
  }, [playlist]);

  return (
    <div className={compact ? "video-card quote-video-card" : "video-card"} style={videoFrameStyle}>
      {playlist && !unsupported ? (
        <video
          ref={videoRef}
          controls
          playsInline
          preload="metadata"
          poster={thumbnail}
          aria-label={video.alt ? `${kind}: ${video.alt}` : kind}
        />
      ) : thumbnail ? (
        <a className="video-fallback-link" href={thumbnail} target="_blank" rel="noreferrer">
          <img alt={video.alt || ""} src={thumbnail} loading="lazy" decoding="async" />
        </a>
      ) : (
        <span className="video-placeholder" />
      )}
      <span className="video-label">
        <Film size={16} /> {kind}
      </span>
      {video.alt && <span className="video-alt-text">{video.alt}</span>}
      {playlist && (
        <a className="video-open-link" href={playlist} target="_blank" rel="noreferrer">
          Open media
        </a>
      )}
    </div>
  );
}

function threadUnavailableState(node: Exclude<ThreadNode, { post: FeedPost }>) {
  const type = node.$type?.toLowerCase() || "";
  const message = node.message?.trim();

  if (type.includes("blocked")) {
    return {
      tone: "blocked",
      title: "Blocked reply",
      detail: message || "Bluesky did not return this branch because one of the accounts is blocked.",
    };
  }

  if (type.includes("notfound") || type.includes("not-found")) {
    return {
      tone: "missing",
      title: "Reply not found",
      detail: message || "This reply is no longer available from Bluesky.",
    };
  }

  if (type.includes("tombstone") || type.includes("deleted")) {
    return {
      tone: "deleted",
      title: "Deleted reply",
      detail: message || "This reply was deleted, but the surrounding conversation is still shown.",
    };
  }

  if (type.includes("rate") || message?.toLowerCase().includes("rate")) {
    return {
      tone: "rate-limit",
      title: "Reply temporarily unavailable",
      detail: message || "Bluesky rate-limited this branch. Try opening it again later.",
    };
  }

  return {
    tone: "unavailable",
    title: "Unavailable reply",
    detail: message || "Bluesky did not return this thread item.",
  };
}

export function App() {
  const [route, setRoute] = useState<RouteState>(() => getRouteState());
  const [activeSourceId, setActiveSourceId] = useState(feedSources[0].id);
  // The user's chosen Home feed id (house icon / root). Persisted locally.
  const [homeSourceId, setHomeSourceIdState] = useState<string>(() => readHomeSourceId());
  const setHomeSource = useCallback((id: string) => {
    safeLocalStorageSet(homeSourceStorageKey, id);
    setHomeSourceIdState(id);
  }, []);
  const [feedSearch, setFeedSearch] = useState("");
  const [globalSearchText, setGlobalSearchText] = useState(() => {
    const initialRoute = getRouteState();
    return initialRoute.kind === "search" ? initialRoute.query || "" : "";
  });
  const [searchSort, setSearchSort] = useState<"top" | "latest">("top");
  const [searchTab, setSearchTab] = useState<(typeof searchTabs)[number]>("posts");
  const [searchLanguage, setSearchLanguage] = useState("");
  const [profileTab, setProfileTab] = useState<ProfileTab>("posts");
  const [feedState, setFeedState] = useState<FeedState>(emptyFeedState);
  const [searchState, setSearchState] = useState<SearchState>(emptySearchState);
  const [actorSearchState, setActorSearchState] = useState<ActorSearchState>(emptyActorSearchState);
  const [feedSearchState, setFeedSearchState] = useState<FeedSearchState>(emptyFeedSearchState);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [feedMetadata, setFeedMetadata] = useState<FeedGeneratorView | null>(null);
  const [listMetadata, setListMetadata] = useState<ListView | null>(null);
  const [composerDraft, setComposerDraft] = useState(() => readComposerDraft());
  // Native bookmark overrides keyed by post URI: true = bookmarked, false = not
  // bookmarked. Seeded per-post from post.viewer.bookmarked when no override is
  // present. Lives here (not in the card) so optimistic state survives row
  // virtualization. in-flight set guards against double-taps.
  const [bookmarkOverrides, setBookmarkOverrides] = useState<Record<string, boolean>>({});
  const [bookmarkErrors, setBookmarkErrors] = useState<Record<string, string>>({});
  const bookmarkInFlight = useRef<Set<string>>(new Set());
  const [localLists, setLocalLists] = useState<LocalList[]>(() => readLocalLists());
  // The signed-in user's real Bluesky lists (owned + subscribed), loaded on the
  // /lists route. Status drives loading/empty/error rendering.
  const [myLists, setMyLists] = useState<{ owned: ListView[]; subscribed: ListView[] }>({ owned: [], subscribed: [] });
  const [myListsStatus, setMyListsStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [imageViewer, setImageViewer] = useState<ImageViewerState>(null);
  const imageViewerHistoryRef = useRef(false);
  // The primary nav icon bar is hidden by default and revealed with the
  // hamburger control in the feed-title header.
  const [navOpen, setNavOpen] = useState<boolean>(false);
  const [mobileHeaderVisible, setMobileHeaderVisible] = useState<boolean>(true);
  const [densityByContext, setDensityByContext] = useState<Record<string, DensityMode>>(() => readDensityPreferences());
  const [columns, setColumns] = useState<ColumnVisibility>(() => readColumnPreferences());
  const [showNsfw, setShowNsfw] = useState<boolean>(() => readShowNsfw());
  const [showMedia, setShowMedia] = useState<boolean>(() => readShowMedia());
  const [showMediaByFeed, setShowMediaByFeed] = useState<Record<string, boolean>>(() => readShowMediaPreferences());
  const [contentLanguages, setContentLanguages] = useState<string[]>(() => readContentLanguages());
  // Cache of client-side language detections for untagged-but-has-text posts,
  // keyed by post URI (see src/lib/content-language.ts). Populated lazily by the
  // detection effect so scrolling stays smooth and lande loads only on demand.
  const [detectedLangByUri, setDetectedLangByUri] = useState<Map<string, string>>(() => new Map());
  const [pinnedFeedMeta, setPinnedFeedMeta] = useState<FeedSource[]>(() => readPinnedFeedMeta());
  const [pinnedFeedIds, setPinnedFeedIds] = useState<string[]>(() => readPinnedFeedIds(pinnedFeedMeta));
  const [pinnedSearches, setPinnedSearches] = useState<string[]>(() => readPinnedSearches());
  const [pinnedProfiles, setPinnedProfiles] = useState<Profile[]>(() => readPinnedProfiles());
  const [pinnedNotificationIds, setPinnedNotificationIds] = useState<string[]>(() => readPinnedNotifications());
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0);
  const [collapsedFeedGroups, setCollapsedFeedGroups] = useState<Record<string, boolean>>(() => readCollapsedFeedGroups());
  const [recentItems, setRecentItems] = useState<RecentItem[]>(() => readRecentItems());
  const [devMetrics, setDevMetrics] = useState<DevMetrics>(initialDevMetrics);
  const [authState, setAuthState] = useState<AuthState>(initialAuthState);
  const [subscribedFeeds, setSubscribedFeeds] = useState<FeedSource[]>([]);
  const [feedOrder, setFeedOrder] = useState<string[]>(() => readFeedOrder());
  const [followBusyUri, setFollowBusyUri] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const toastIdRef = useRef(0);
  const [virtualRenderedRows, setVirtualRenderedRows] = useState(0);
  const [thread, setThread] = useState<{ status: "idle" | "loading" | "ready" | "error"; node?: ThreadNode; error?: string }>({
    status: "idle",
  });
  const [loadingThreadBranches, setLoadingThreadBranches] = useState<Record<string, boolean>>({});
  const [threadBranchResults, setThreadBranchResults] = useState<Record<string, BranchLoadResult>>({});
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const feedCache = useCache<FeedState>();
  const feedMetadataCache = useCache<FeedGeneratorView>();
  const listMetadataCache = useCache<ListView>();
  const profileCache = useCache<{ feed: FeedState; profile: Profile | null }>();
  const searchCache = useCache<SearchState>();
  const actorSearchCache = useCache<ActorSearchState>();
  const feedSearchCache = useCache<FeedSearchState>();
  const threadCache = useCache<ThreadNode>();
  const threadBranchCache = useCache<ThreadNode>();
  // Tracks the in-flight full-thread load (initial fetch or post-reply reload) so
  // a stale response can't overwrite the thread after navigating to another post.
  const threadLoadControllerRef = useRef<AbortController | null>(null);
  const scrollCache = useCache(() => createCache<number>(readTimelineScrollCache()));
  const scrollAnchorCache = useCache(() => createCache<ScrollAnchor>(readTimelineAnchorCache()));
  // The content-anchored restore target for the *current* surface, consumed by
  // the mounted VirtualPostList. Kept as state so the anchored-restore effect
  // re-runs when it changes; cleared (onAnchorRestored) once the anchor row has
  // been scrolled into view and measured. Distinct from scrollAnchorCache,
  // which is the persistent cache of the last-saved anchor for a key.
  const [pendingScrollAnchor, setPendingScrollAnchor] = useState<{ key: string; anchor: ScrollAnchor } | null>(null);
  const clearPendingAnchor = useCallback(() => setPendingScrollAnchor(null), []);

  // Restore a saved scroll position for a key, preferring the content anchor
  // (saved top-visible post URI + intra offset) over the raw pixel offset. The
  // pixel path (restoreOrResetScroll) re-asserts a fixed offset that fights the
  // virtualization measurement shrink (issue #8) — see the anchored-restore
  // effect in VirtualPostList. When an anchor exists, hand it to the mounted
  // VirtualPostList instead, which derives the target from the measured row
  // layout and clamps against the live totalHeight, so it converges.
  const restoreScrollFor = useCallback((key: string) => {
    const target = scrollCache.get(key) || 0;
    const anchor = scrollAnchorCache.get(key);
    if (anchor && target > 0) {
      armScrollRestore(target);
      setPendingScrollAnchor((current) => (current?.key === key && current.anchor.uri === anchor.uri ? current : { key, anchor }));
    } else {
      restoreOrResetScroll(timelineRef, target);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    // Captured before initAuthSession runs: the OAuth client's init() strips the
    // code/state params from the URL as it processes them, so we can't rely on
    // looksLikeOAuthCallback() being true afterwards to know we came from a callback.
    const hadCallback = looksLikeOAuthCallback();

    initAuthSession().then((result) => {
      if (cancelled) {
        return;
      }

      setAuthState({
        status: result.session ? "signed-in" : result.status === "error" ? "error" : "signed-out",
        session: result.session,
        message: result.message,
      });

      if (result.status === "callback") {
        // Successful sign-in via the callback → drop the user straight into
        // posts (the signed-in Following timeline) rather than Settings.
        window.history.replaceState(null, "", "/feed/following");
        setRoute({ kind: "feed", uri: "following" });
      } else if (hadCallback && !result.session) {
        // The callback came back but produced no session — a transient token
        // exchange failure, or the pre-redirect OAuth state was missing (sign-in
        // started in a different browser/profile, or site data was cleared). Strip
        // the spent code/state so a reload doesn't re-run init() on a consumed
        // code, and stay on the oauth-callback route, which renders an actionable
        // error + retry (see SurfaceView) instead of a dead "Pending" placeholder.
        window.history.replaceState(null, "", "/oauth/callback");
      }

      // Restore path only: merge background-hydrated display fields (display
      // name / avatar / counts) into the session once the profile read lands.
      // Guarded by the DID so a sign-out / account switch in the interim can't
      // graft a stale profile onto a different session. signedInDid is unchanged
      // by this merge, so it never reloads or swaps the feed — only identity
      // fields update.
      const restoredDid = result.session?.did;
      result.profilePromise?.then((profile) => {
        if (cancelled || !profile) {
          return;
        }
        setAuthState((current) =>
          current.session && current.session.did === restoredDid
            ? { ...current, session: { ...current.session, ...profile } }
            : current,
        );
      });
    });

    return () => {
      cancelled = true;
    };
  }, []);

  // Centralized revoked/deleted-session handling. auth.ts wires the OAuth
  // client's onDelete hook to this listener, so a session that ends server-side
  // (token revoked from Bluesky's account UI, refresh failure, or a sign-out in
  // another tab) drops the signed-in UI back to signed-out with an actionable
  // message, instead of authed reads silently failing against a stale session.
  useEffect(() => {
    setSessionInvalidatedListener(() => {
      setAuthState((current) => {
        // An intentional local sign-out already handles its own state; don't
        // clobber it (or an already signed-out state) with an error banner.
        if (current.status === "signed-out" || current.status === "signing-out") {
          return current;
        }
        return {
          status: "error",
          session: null,
          message: "Your Bluesky session ended (it expired or was signed out elsewhere). Sign in again to continue.",
        };
      });
    });
    return () => setSessionInvalidatedListener(null);
  }, []);

  // When signed in, load the user's subscribed/pinned feeds from their AT
  // Protocol preferences and surface them in the feed selector. Cleared on
  // sign-out. Failures are non-fatal: the selector keeps its public feeds.
  const signedInDid = authState.status === "signed-in" ? authState.session?.did : undefined;
  const authCheckPending = authState.status === "checking" || authState.status === "callback";
  const feedWaitingForAuth = route.kind === "feed" && authCheckPending;

  // "Permissions updated" detection: when the desired OAUTH_SCOPE has grown
  // beyond what this session's (long-lived) grant carries, surface a one-click
  // re-authorize. Dismissal is remembered per missing-scope signature so the
  // same gap doesn't nag, but a newly-added scope re-prompts.
  const [missingScopes, setMissingScopes] = useState<string[]>([]);
  useEffect(() => {
    if (!signedInDid) {
      setMissingScopes([]);
      return;
    }
    let cancelled = false;
    getMissingScopes()
      .then((missing) => {
        if (cancelled || !missing) {
          // null = indeterminate (token read failed); don't prompt on a guess.
          return;
        }
        const signature = missing.slice().sort().join(" ");
        const dismissed = localStorage.getItem(reauthDismissKey) === signature;
        setMissingScopes(missing.length > 0 && !dismissed ? missing : []);
      })
      .catch(() => {
        /* non-fatal: no prompt */
      });
    return () => {
      cancelled = true;
    };
  }, [signedInDid]);

  const dismissReauth = useCallback(() => {
    const signature = missingScopes.slice().sort().join(" ");
    safeLocalStorageSet(reauthDismissKey, signature);
    setMissingScopes([]);
  }, [missingScopes]);

  const handleReauthorize = useCallback(() => {
    const handle = authState.session?.handle;
    if (handle) {
      void startSignIn(handle);
    }
  }, [authState.session?.handle]);

  // Like overrides keyed by post URI: { uri } is the like-record URI ("" / falsy
  // = not liked), count is the displayed like count. Lives here (not in the
  // card) so optimistic state survives row virtualization. in-flight set guards
  // against double-taps.
  const [likeOverrides, setLikeOverrides] = useState<Record<string, { uri?: string; count: number }>>({});
  const likeInFlight = useRef<Set<string>>(new Set());

  const getLikeState = useCallback(
    (post: FeedPost): LikeView => {
      const ov = likeOverrides[post.uri];
      if (ov) {
        return { liked: !!ov.uri, count: ov.count };
      }
      return { liked: !!post.viewer?.like, count: post.likeCount ?? 0 };
    },
    [likeOverrides],
  );

  const toggleLike = useCallback(
    (post: FeedPost) => {
      if (!signedInDid || likeInFlight.current.has(post.uri)) {
        return;
      }
      const ov = likeOverrides[post.uri];
      const liked = ov ? !!ov.uri : !!post.viewer?.like;
      const likeUri = ov ? ov.uri : post.viewer?.like;
      const baseCount = ov ? ov.count : post.likeCount ?? 0;
      likeInFlight.current.add(post.uri);
      // Optimistic update.
      setLikeOverrides((current) => ({
        ...current,
        [post.uri]: liked ? { uri: undefined, count: Math.max(0, baseCount - 1) } : { uri: "pending", count: baseCount + 1 },
      }));
      void (async () => {
        try {
          if (liked) {
            if (likeUri && likeUri !== "pending") {
              await unlikePost(likeUri);
            }
            setLikeOverrides((current) => ({ ...current, [post.uri]: { uri: undefined, count: Math.max(0, baseCount - 1) } }));
          } else {
            const newUri = await likePost(post.uri, post.cid);
            setLikeOverrides((current) => ({ ...current, [post.uri]: { uri: newUri, count: baseCount + 1 } }));
          }
        } catch {
          // Revert to pre-click state.
          setLikeOverrides((current) => ({ ...current, [post.uri]: { uri: liked ? likeUri : undefined, count: baseCount } }));
        } finally {
          likeInFlight.current.delete(post.uri);
        }
      })();
    },
    [signedInDid, likeOverrides],
  );

  const likeContextValue = useMemo<LikeContextValue>(
    () => ({ canLike: !!signedInDid, getState: getLikeState, toggle: toggleLike }),
    [signedInDid, getLikeState, toggleLike],
  );

  // Block overrides keyed by author DID: { uri } is the block-record URI ("" /
  // falsy = not blocked). Lives here so optimistic state survives virtualization
  // and is shared across every post by the same author.
  const [blockOverrides, setBlockOverrides] = useState<Record<string, { uri?: string }>>({});
  const blockInFlight = useRef<Set<string>>(new Set());

  // Transient toast messages. Kept capped so a burst of failures can't pile up
  // the overlay; each auto-dismisses after a few seconds. Declared before
  // toggleBlock so the silent block catch can surface an actionable toast.
  const pushToast = useCallback((message: string, kind: ToastKind = "info") => {
    const id = ++toastIdRef.current;
    setToasts((current) => [...current.slice(-3), { id, kind, message }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 6000);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const getBlockState = useCallback(
    (author: Profile): BlockView => {
      const ov = blockOverrides[author.did];
      if (ov) {
        return { blocked: !!ov.uri, uri: ov.uri };
      }
      return { blocked: !!author.viewer?.blocking, uri: author.viewer?.blocking };
    },
    [blockOverrides],
  );

  const toggleBlock = useCallback(
    (author: Profile) => {
      if (!signedInDid || author.did === signedInDid || blockInFlight.current.has(author.did)) {
        return;
      }
      const ov = blockOverrides[author.did];
      const blocked = ov ? !!ov.uri : !!author.viewer?.blocking;
      const blockUri = ov ? ov.uri : author.viewer?.blocking;
      if (
        !blocked &&
        !window.confirm(`Block @${author.handle}? They won't be able to see or reply to your posts, and this also undoes any follow.`)
      ) {
        return;
      }
      blockInFlight.current.add(author.did);
      // Optimistic update.
      setBlockOverrides((current) => ({
        ...current,
        [author.did]: blocked ? { uri: undefined } : { uri: "pending" },
      }));
      void (async () => {
        try {
          if (blocked) {
            if (blockUri && blockUri !== "pending") {
              await unblockAccount(blockUri);
            }
            setBlockOverrides((current) => ({ ...current, [author.did]: { uri: undefined } }));
          } else {
            const newUri = await blockAccount(author.did);
            setBlockOverrides((current) => ({ ...current, [author.did]: { uri: newUri } }));
          }
        } catch {
          // Revert to pre-click state.
          setBlockOverrides((current) => ({ ...current, [author.did]: { uri: blocked ? blockUri : undefined } }));
          pushToast(
            blocked ? "Couldn't unblock this account. Please try again." : "Couldn't block this account. Please try again.",
            "error",
          );
        } finally {
          blockInFlight.current.delete(author.did);
        }
      })();
    },
    [signedInDid, blockOverrides, pushToast],
  );

  const blockContextValue = useMemo<BlockContextValue>(
    () => ({ canBlock: !!signedInDid, selfDid: signedInDid, getState: getBlockState, toggle: toggleBlock }),
    [signedInDid, getBlockState, toggleBlock],
  );

  // Viewer-relative state (like / bookmark / follow / block records) only comes
  // back on authenticated reads, so anything fetched under one identity is stale
  // under another. When the signed-in identity changes (sign-in, sign-out, or an
  // account switch) drop the in-memory caches and optimistic overrides so the
  // next render refetches with the correct viewer state. Skipped on first mount
  // (nothing is cached yet); the feed loader's AbortController tears down any
  // public fetch still in flight when auth resolves, so it can't repopulate.
  //
  // ORDERING CONTRACT (load-bearing): the cache keys deliberately do NOT include
  // the viewer DID (they're plain `feed:<id>`, `profile:<actor>`, `search:<q>`,
  // …), so correctness on an identity change relies on this wipe running BEFORE
  // any loader effect reads or repopulates a cache. React runs effects in
  // declaration order, so this effect MUST stay declared above the feed/profile/
  // search loader effects below (which re-run on identity change because their
  // loadFeed/loadProfileFeed/loadSearch callbacks close over signedInDid). If
  // you move this effect below a loader — or key a loader off signedInDid on its
  // own — a stale-identity cache entry can be read before the wipe. Prefer
  // adding a `<did>:` prefix to the cache keys over reordering if that ever
  // becomes hard to guarantee.
  // All nine loader caches, cleared together. The cache instances are stable
  // (useCache keeps them in a ref), so this can be called from any effect or
  // callback. Kept declared ABOVE the loader effects so the wipe ordering
  // contract above (run before any loader refetches on identity change) holds
  // at every call site.
  const clearAllDataCaches = useCallback(() => {
    feedCache.clear();
    feedMetadataCache.clear();
    listMetadataCache.clear();
    profileCache.clear();
    searchCache.clear();
    actorSearchCache.clear();
    feedSearchCache.clear();
    threadCache.clear();
    threadBranchCache.clear();
  }, []);
  const authCacheMountRef = useRef(false);
  useEffect(() => {
    if (!authCacheMountRef.current) {
      authCacheMountRef.current = true;
      return;
    }
    clearAllDataCaches();
    setLikeOverrides({});
    setBookmarkOverrides({});
    setBlockOverrides({});
  }, [signedInDid]);

  useEffect(() => {
    if (!signedInDid) {
      setSubscribedFeeds([]);
      return;
    }
    let cancelled = false;
    getSubscribedFeeds()
      .then((feeds) => {
        if (cancelled) {
          return;
        }
        setSubscribedFeeds(
          feeds.map((feed: SubscribedFeed) => ({
            id: feed.uri,
            uri: feed.uri,
            label: feed.displayName,
            group: "My Feeds" as const,
            description: feed.creatorHandle
              ? `By @${feed.creatorHandle}${feed.pinned ? " · Pinned" : ""}`
              : feed.description || "Your subscribed feed.",
          })),
        );
      })
      .catch(() => {
        if (!cancelled) {
          setSubscribedFeeds([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [signedInDid]);

  useEffect(() => {
    if (!signedInDid) {
      setUnreadNotificationCount(0);
      return;
    }

    let cancelled = false;
    const refreshUnreadNotifications = () => {
      getUnreadNotificationCount()
        .then((count) => {
          if (!cancelled) {
            setUnreadNotificationCount(count);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setUnreadNotificationCount(0);
          }
        });
    };

    refreshUnreadNotifications();
    const interval = window.setInterval(refreshUnreadNotifications, 5 * 60 * 1000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [signedInDid]);

  // Load the user's real Bluesky lists when they visit /lists while signed in.
  const onListsRoute = route.kind === "surface" && route.name === "lists";
  // The Settings Home-page picker also offers the user's lists, so load them
  // when Settings opens — not just on the Lists page.
  const onSettingsRoute = route.kind === "surface" && route.name === "settings";
  const reloadMyLists = useCallback(() => {
    if (!signedInDid) {
      setMyLists({ owned: [], subscribed: [] });
      setMyListsStatus("idle");
      return;
    }
    setMyListsStatus("loading");
    getMyLists()
      .then((lists) => {
        setMyLists(lists);
        setMyListsStatus("ready");
      })
      .catch(() => setMyListsStatus("error"));
  }, [signedInDid]);
  useEffect(() => {
    if ((onListsRoute || onSettingsRoute) && signedInDid && myListsStatus === "idle") {
      reloadMyLists();
    }
    if (!signedInDid) {
      setMyLists({ owned: [], subscribed: [] });
      setMyListsStatus("idle");
    }
  }, [onListsRoute, onSettingsRoute, signedInDid, myListsStatus, reloadMyLists]);

  // Create a moderation/block list, then refresh so it appears under "Your lists".
  const handleCreateModList = useCallback(
    async (name: string, description: string) => {
      await createModList(name, description);
      reloadMyLists();
    },
    [reloadMyLists],
  );
  // Delete an owned list, then refresh.
  const handleDeleteModList = useCallback(
    async (listUri: string) => {
      await deleteModList(listUri);
      reloadMyLists();
    },
    [reloadMyLists],
  );

  const followedFeedUris = useMemo(() => new Set(subscribedFeeds.map((source) => source.uri)), [subscribedFeeds]);

  // Follow/unfollow a feed generator against the signed-in account (real
  // AT Protocol write to the user's saved feeds). Optimistically updates the
  // local subscribed list so the button and "My Feeds" group reflect it; a
  // failure reverts. No-op when signed out.
  async function toggleFollowFeed(feedUri: string, label?: string) {
    if (!signedInDid || followBusyUri) {
      return;
    }
    const wasFollowing = followedFeedUris.has(feedUri);
    setFollowBusyUri(feedUri);
    try {
      if (wasFollowing) {
        await unfollowFeed(feedUri);
        setSubscribedFeeds((prev) => prev.filter((source) => source.uri !== feedUri));
      } else {
        await followFeed(feedUri);
        setSubscribedFeeds((prev) =>
          prev.some((source) => source.uri === feedUri)
            ? prev
            : [...prev, { id: feedUri, uri: feedUri, label: label || "Feed", group: "My Feeds" as const, description: "Your subscribed feed." }],
        );
      }
    } catch (error) {
      console.error("Failed to update feed subscription", error);
      pushToast(
        wasFollowing
          ? "Couldn't unfollow this Feed. Please try again."
          : "Couldn't follow this Feed. Please try again.",
        "error",
      );
    } finally {
      setFollowBusyUri(null);
    }
  }

  const activeSource = useMemo<FeedSource>(() => {
    if (route.kind === "feed" && route.uri) {
      if (route.uri === "following") {
        return followingSource;
      }
      const known =
        feedSources.find((source) => source.id === route.uri || source.uri === route.uri) ??
        subscribedFeeds.find((source) => source.id === route.uri || source.uri === route.uri);
      if (known) {
        return known;
      }
      if (route.uri.startsWith("at://")) {
        const list = isListUri(route.uri);
        return {
          id: route.uri,
          uri: route.uri,
          label: list ? "List" : "Public Feed",
          group: "Discovered",
          description: list ? "Public Bluesky list timeline." : "Public Bluesky feed opened from discovery.",
        };
      }
    }
    // Root "/" (feed route with no uri) shows the user's chosen Home feed, with a
    // public fallback when signed out so Home never breaks.
    if (route.kind === "feed" && !route.uri) {
      return resolveHomeSource(homeSourceId, !!signedInDid || feedWaitingForAuth, subscribedFeeds);
    }
    return feedSources.find((source) => source.id === activeSourceId) ?? feedSources[0];
  }, [route, activeSourceId, subscribedFeeds, homeSourceId, signedInDid, feedWaitingForAuth]);
  // The signed-in user's saved feeds, reordered by the browser-local feedOrder
  // (URIs). Feeds with a saved position sort by it; the rest keep their account
  // order after them (stable sort). Drives both the /feeds grid and the selector.
  const orderedSubscribedFeeds = useMemo(
    () => orderBySavedOrder(subscribedFeeds, feedOrder),
    [subscribedFeeds, feedOrder],
  );
  // Static public feeds plus the signed-in user's subscribed feeds (deduped by
  // URI so a saved copy of a built-in feed does not appear twice).
  const allSources = useMemo(() => {
    const staticUris = new Set(feedSources.map((source) => source.uri));
    const extras = orderedSubscribedFeeds.filter((source) => !staticUris.has(source.uri));
    // The Following home timeline is only available when signed in.
    const base = signedInDid ? [followingSource, ...feedSources] : feedSources;
    return [...base, ...extras];
  }, [orderedSubscribedFeeds, signedInDid]);
  // Home-page options for Settings: Following + the static public feeds, plus
  // the user's subscribed feeds when signed in. Following is always offered (it
  // falls back to Discover when signed out).
  const homeOptions = useMemo(() => {
    const options: HomeOption[] = [{ id: "following", label: "Following", needsAuth: true, group: "Following" }];
    // Track both ids and uris so a subscribed copy of a built-in feed (same uri,
    // different id) doesn't appear twice.
    const seen = new Set<string>(["following"]);
    for (const source of feedSources) {
      options.push({ id: source.id, label: source.label, needsAuth: false, group: "Feeds" });
      seen.add(source.id);
      seen.add(source.uri);
    }
    for (const source of subscribedFeeds) {
      if (seen.has(source.id) || seen.has(source.uri)) {
        continue;
      }
      options.push({ id: source.id, label: source.label, needsAuth: true, group: "Feeds" });
      seen.add(source.id);
      seen.add(source.uri);
    }
    // Curation lists (owned + subscribed) open as a Home timeline via
    // getListFeed; moderation lists can't be read that way, so they're skipped.
    // Lists need sign-in. Dedupe by URI so an owned list that's also surfaced as
    // subscribed isn't listed twice.
    for (const list of [...myLists.owned, ...myLists.subscribed]) {
      if (!list.purpose?.includes("curatelist") || seen.has(list.uri)) {
        continue;
      }
      options.push({ id: list.uri, label: list.name || "List", needsAuth: true, group: "Lists" });
      seen.add(list.uri);
    }
    return options;
  }, [subscribedFeeds, myLists]);
  const feedRoutePath = (source: FeedSource) => `/feed/${encodeURIComponent(source.id)}`;
  const densityKey = route.kind === "feed" ? feedPreferenceKey(activeSource) : route.kind;
  const defaultDensity = densityModes.includes(densityByContext.default) ? densityByContext.default : "comfortable";
  const routeDensity = route.kind === "feed"
    ? feedDensityOverride(activeSource, densityByContext)
    : densityModes.includes(densityByContext[densityKey])
      ? densityByContext[densityKey]
      : undefined;
  const storedDensity = routeDensity || defaultDensity;
  // A feed can override Show Media on/off; otherwise it inherits the global
  // Settings preference. Media density needs media visible, so it falls back to
  // comfortable when the effective preference is off.
  const routeShowMediaOverride =
    route.kind === "feed" ? feedShowMediaOverride(activeSource, showMediaByFeed) : undefined;
  const effectiveShowMedia = routeShowMediaOverride ?? showMedia;
  const density = storedDensity === "media" && !effectiveShowMedia ? "comfortable" : storedDensity;
  const visibleSources = useMemo(() => {
    const query = feedSearch.trim().toLowerCase();
    if (!query) {
      return allSources;
    }

    return allSources.filter((source) => feedSourceMatches(source, feedSearch));
  }, [feedSearch, allSources]);
  const pinnedSources = useMemo(() => {
    const lookup = new Map<string, FeedSource>();
    for (const source of feedSources) {
      lookup.set(source.id, source);
    }
    for (const source of pinnedFeedMeta) {
      if (!lookup.has(source.id)) {
        lookup.set(source.id, source);
      }
    }
    return pinnedFeedIds
      .map((id) => lookup.get(id))
      .filter((source): source is FeedSource => !!source);
  }, [pinnedFeedIds, pinnedFeedMeta]);
  const groupedSources = useMemo(() => {
    const groups = visibleSources.reduce<Record<string, FeedSource[]>>((nextGroups, source) => {
      nextGroups[source.group] = [...(nextGroups[source.group] ?? []), source];
      return nextGroups;
    }, {});

    if (pinnedSources.length > 0) {
      const query = feedSearch.trim().toLowerCase();
      const pinnedMatches = query ? pinnedSources.filter((source) => feedSourceMatches(source, query)) : pinnedSources;
      if (pinnedMatches.length > 0) {
        groups.Pinned = pinnedMatches;
      }
    }

    const groupRank = (group: string) => {
      if (group === "Pinned") {
        return 0;
      }
      if (group === "Core") {
        return 1;
      }
      if (group === "My Feeds") {
        return 2;
      }
      return 3;
    };
    return Object.fromEntries(
      Object.entries(groups).sort(([groupA], [groupB]) => {
        const rankDelta = groupRank(groupA) - groupRank(groupB);
        return rankDelta !== 0 ? rankDelta : groupA.localeCompare(groupB);
      }),
    ) as Record<string, FeedSource[]>;
  }, [feedSearch, pinnedSources, visibleSources]);
  const entityCache = useMemo<EntityCache>(() => {
    const posts: Record<string, FeedPost> = {};
    const profiles: Record<string, Profile> = {};
    const linkUrls: string[] = [];

    for (const post of [...feedState.items.map((item) => item.post), ...searchState.posts]) {
      posts[post.uri] = post;
      profiles[post.author.did] = post.author;
      profiles[post.author.handle] = post.author;

      const external = getExternalEmbed(post.embed);
      if (external?.uri) {
        linkUrls.push(external.uri);
      }
      for (const link of extractFacetLinks(post.record.facets)) {
        linkUrls.push(link);
      }
    }

    return { posts, profiles, linkUrls };
  }, [feedState.items, searchState.posts]);
  const trendingTopics = useMemo(() => {
    const counts = new Map<string, number>();
    const posts = [
      ...feedState.items.map((item) => item.post),
      ...searchState.posts,
    ];

    posts.forEach((post) => {
      extractHashtags(post.record.text).forEach((tag) => {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      });
    });

    return Array.from(counts.entries())
      .sort((first, second) => second[1] - first[1] || first[0].localeCompare(second[0]))
      .slice(0, 8)
      .map(([tag, count]) => ({ tag, count }));
  }, [feedState.items, searchState.posts]);
  const visibleProfileItems = useMemo(() => {
    if (route.kind !== "profile") {
      return feedState.items;
    }

    if (profileTab === "replies") {
      return feedState.items.filter((item) => !!item.post.record.reply || !!item.reply?.parent);
    }

    if (profileTab === "media") {
      return feedState.items.filter((item) => hasPostImages(item.post) || hasPostVideo(item.post));
    }

    if (profileTab === "videos") {
      return feedState.items.filter((item) => hasPostVideo(item.post));
    }

    if (profileTab === "posts") {
      return feedState.items;
    }

    const byUri = new Map(feedState.items.map((item) => [item.post.uri, item]));
    return feedState.items.filter((item) => {
      if (!item.post.record.reply && !item.reply?.parent) {
        return true;
      }

      const rootUri = postReplyRootUri(item.post);
      const rootItem = rootUri ? byUri.get(rootUri) : undefined;
      // Keep the author's own self-thread replies (structural, no time gate —
      // matching bsky); drop replies into someone else's thread.
      return !!rootItem && isSelfThreadReply(item, rootItem.post);
    });
  }, [feedState.items, profileTab, route.kind]);

  // The "Show posts from language" filter runs only on custom (feedgen) feeds —
  // mirroring bsky, which leaves Following and Lists unfiltered. Discover counts
  // as a feedgen, so it is filtered too.
  const contentLanguageFilterActive =
    route.kind === "feed" && contentLanguages.length > 0 && isFeedGeneratorUri(activeSource.uri);

  const visibleFeedItems = useMemo(() => {
    if (!contentLanguageFilterActive) {
      return feedState.items;
    }
    return filterFeedByLanguages(feedState.items, contentLanguages, detectedLangByUri);
  }, [contentLanguageFilterActive, feedState.items, contentLanguages, detectedLangByUri]);

  // Lazily detect the language of untagged-but-has-text posts so the filter can
  // judge them (most posts on real feeds declare no language). Runs only while
  // the filter is active; results (including a "" sentinel for indeterminate
  // posts, which are kept) are cached per URI so lande runs once per post.
  useEffect(() => {
    if (!contentLanguageFilterActive) {
      return;
    }
    const pending = postsNeedingDetection(feedState.items, contentLanguages, detectedLangByUri);
    if (pending.length === 0) {
      return;
    }
    let cancelled = false;
    void (async () => {
      let batch: Array<[string, string]> = [];
      const flush = () => {
        if (batch.length === 0 || cancelled) {
          return;
        }
        const entries = batch;
        batch = [];
        setDetectedLangByUri((current) => {
          const next = new Map(current);
          for (const [uri, code] of entries) {
            next.set(uri, code);
          }
          return next;
        });
      };
      for (let i = 0; i < pending.length; i += 1) {
        if (cancelled) {
          return;
        }
        const post = pending[i];
        const text = typeof post.record?.text === "string" ? post.record.text : "";
        let detected: string | undefined;
        try {
          detected = await detectPostLanguage(text);
        } catch {
          // Detector transiently unavailable (e.g. lande chunk load failed).
          // getLande() clears its cached promise so a later attempt retries the
          // load — so do NOT cache a sentinel here. Caching "" would mark the URI
          // "done" in detectedLangByUri, permanently excluding it from
          // postsNeedingDetection and defeating that retry. Skip it instead; it
          // re-queues on the next detection pass (new page, filter change, etc.).
          continue;
        }
        batch.push([post.uri, detected ?? ""]);
        // Publish in small batches so the feed refilters progressively and the
        // event loop stays responsive on large pages.
        if (batch.length >= 25) {
          flush();
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }
      flush();
    })();
    return () => {
      cancelled = true;
    };
  }, [contentLanguageFilterActive, feedState.items, contentLanguages, detectedLangByUri]);

  const loadFeed = useCallback(
    createFeedLoader({
      feedCache,
      setFeedState,
      setDevMetrics,
      restoreScrollFor,
      restoreOrResetScroll,
      timelineRef,
      scrollCache,
      density,
      signedInDid,
    }),
    [density, signedInDid],
  );

  const loadProfileFeed = useCallback(
    createProfileFeedLoader({
      profileCache,
      setProfile,
      setFeedState,
      setDevMetrics,
      restoreScrollFor,
    }),
    [],
  );

  const loadSearch = useCallback(
    createSearchLoader({
      searchCache,
      setSearchState,
      setDevMetrics,
    }),
    [],
  );

  const loadActorSearch = useCallback(
    createActorSearchLoader({
      actorSearchCache,
      setActorSearchState,
      setDevMetrics,
    }),
    [],
  );

  const loadFeedSearch = useCallback(
    createFeedSearchLoader({
      feedSearchCache,
      setFeedSearchState,
      setDevMetrics,
    }),
    [],
  );

  useEffect(() => {
    if (route.kind === "post" || route.kind === "search" || route.kind === "surface") {
      return undefined;
    }

    if (feedWaitingForAuth) {
      setProfile(null);
      setFeedState({ items: [], status: "loading" });
      return undefined;
    }

    const controller = new AbortController();
    if (route.kind === "profile") {
      setProfile(null);
      void loadProfileFeed(route.actor, undefined, controller.signal, profileFeedFilterForTab(profileTab));
      return () => controller.abort();
    }

    setProfile(null);
    void loadFeed(activeSource, undefined, controller.signal);
    return () => controller.abort();
  }, [activeSource, feedWaitingForAuth, loadFeed, loadProfileFeed, profileTab, route]);

  useEffect(() => {
    if (route.kind !== "search") {
      setSearchState(emptySearchState);
      setActorSearchState(emptyActorSearchState);
      // Clear the right-rail SearchBox query too; otherwise it keeps showing the
      // old search text while the user is reading a feed.
      setGlobalSearchText("");
      return undefined;
    }

    setGlobalSearchText(route.query || "");
    if (!route.query) {
      setSearchState(emptySearchState);
      setActorSearchState(emptyActorSearchState);
      setFeedSearchState(emptyFeedSearchState);
      return undefined;
    }

    const controller = new AbortController();
    if (searchTab === "posts") {
      setActorSearchState(emptyActorSearchState);
      setFeedSearchState(emptyFeedSearchState);
      void loadSearch(route.query, searchSort, searchLanguage, undefined, controller.signal);
    } else if (searchTab === "people") {
      setSearchState(emptySearchState);
      setFeedSearchState(emptyFeedSearchState);
      void loadActorSearch(route.query, undefined, controller.signal);
    } else if (searchTab === "feeds") {
      setSearchState(emptySearchState);
      setActorSearchState(emptyActorSearchState);
      void loadFeedSearch(route.query, controller.signal);
    } else {
      setSearchState(emptySearchState);
      setActorSearchState(emptyActorSearchState);
      setFeedSearchState(emptyFeedSearchState);
    }
    return () => controller.abort();
  }, [loadActorSearch, loadFeedSearch, loadSearch, route, searchLanguage, searchSort, searchTab]);

  // Feed/list metadata loads delegate to the extracted metadata loaders (their
  // fetch/cache/set logic is tested in src/lib/loaders tests).
  const loadFeedMetadata = useCallback(createFeedMetadataLoader({ feedMetadataCache, setFeedMetadata, setDevMetrics }), []);
  const loadListMetadata = useCallback(createListMetadataLoader({ listMetadataCache, setListMetadata, setDevMetrics }), []);

  useEffect(() => {
    if (route.kind === "post" || route.kind === "search" || route.kind === "surface" || route.kind === "profile") {
      setFeedMetadata(null);
      setListMetadata(null);
      return undefined;
    }

    if (feedWaitingForAuth) {
      setFeedMetadata(null);
      setListMetadata(null);
      return undefined;
    }

    if (activeSource.uri === "following") {
      setFeedMetadata(null);
      setListMetadata(null);
      return undefined;
    }

    const controller = new AbortController();

    if (isListUri(activeSource.uri)) {
      setFeedMetadata(null);
      void loadListMetadata(activeSource.uri, controller.signal);
    } else {
      setListMetadata(null);
      void loadFeedMetadata(activeSource.uri, controller.signal);
    }
    return () => controller.abort();
  }, [activeSource, feedWaitingForAuth, loadFeedMetadata, loadListMetadata, route.kind]);

  useEffect(() => {
    const onPopState = () => {
      if (imageViewerHistoryRef.current) {
        imageViewerHistoryRef.current = false;
        setImageViewer(null);
      }
      setRoute(getRouteState());
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const openImageViewer = useCallback((image: ImageViewerState) => {
    if (!imageViewerHistoryRef.current) {
      history.pushState({ imageViewer: true }, "", window.location.href);
      imageViewerHistoryRef.current = true;
    }
    setImageViewer(image);
  }, []);

  const closeImageViewer = useCallback(() => {
    if (imageViewerHistoryRef.current) {
      history.back();
      return;
    }
    setImageViewer(null);
  }, []);

  useEffect(() => {
    if (!import.meta.env.DEV) {
      return undefined;
    }

    const updateServiceWorkerState = () => {
      const controllerState = navigator.serviceWorker?.controller?.state;
      setDevMetrics((current) => ({
        ...current,
        serviceWorkerState: controllerState || ("serviceWorker" in navigator ? "registered when served over http(s)" : "unsupported"),
      }));
    };
    const onApiRequest = () => setDevMetrics((current) => ({ ...current, apiRequests: current.apiRequests + 1 }));
    const recordSameOriginEntries = (entries: PerformanceEntry[]) => {
      const sameOriginEntries = entries.filter((entry) => {
        try {
          return new URL(entry.name).origin === window.location.origin;
        } catch {
          return false;
        }
      });
      if (sameOriginEntries.length === 0) {
        return;
      }

      const warnings = sameOriginEntries
        .map((entry) => new URL(entry.name).pathname)
        .filter((path) => path.startsWith("/api/") || path.startsWith("/functions/") || path.includes("_worker"));
      setDevMetrics((current) => ({
        ...current,
        sameOriginRequests: current.sameOriginRequests + sameOriginEntries.length,
        runtimeWarnings: [...new Set([...current.runtimeWarnings, ...warnings])],
      }));
    };
    window.addEventListener("bigbsky:api-request", onApiRequest);
    updateServiceWorkerState();
    recordSameOriginEntries(performance.getEntriesByType("resource"));

    const observer =
      "PerformanceObserver" in window
        ? new PerformanceObserver((list) => {
            recordSameOriginEntries(list.getEntries());
          })
        : null;

    observer?.observe({ entryTypes: ["resource"] });
    navigator.serviceWorker?.addEventListener("controllerchange", updateServiceWorkerState);

    return () => {
      window.removeEventListener("bigbsky:api-request", onApiRequest);
      navigator.serviceWorker?.removeEventListener("controllerchange", updateServiceWorkerState);
      observer?.disconnect();
    };
  }, []);

  const startThreadLoad = useCallback(
    createThreadLoader({
      threadCache,
      setThread,
      setThreadBranchResults,
      threadLoadControllerRef,
    }),
    [],
  );

  useEffect(() => {
    if (route.kind !== "post") {
      setThread({ status: "idle" });
      setLoadingThreadBranches({});
      setThreadBranchResults({});
      return;
    }

    const cached = threadCache.get(`${route.actor}:${route.rkey}`);
    if (cached) {
      setDevMetrics((current) => ({ ...current, cacheHits: current.cacheHits + 1 }));
      // Mirror startThreadLoad's controller bookkeeping even on a cache hit: a
      // prior navigation aborted the previous controller, and loadThreadBranch
      // reads threadLoadControllerRef.current?.signal — so without a fresh,
      // un-aborted controller here, "load more replies" fetches a pre-aborted
      // signal and silently fails on any back-navigation to a cached thread.
      const controller = new AbortController();
      threadLoadControllerRef.current?.abort();
      threadLoadControllerRef.current = controller;
      setThread({ status: "ready", node: cached });
      return () => controller.abort();
    }

    const controller = startThreadLoad(route.actor, route.rkey);
    return () => controller.abort();
  }, [route, startThreadLoad]);

  // Re-fetch the open thread (bypassing the cache) after publishing a reply so
  // the new reply appears in the conversation.
  const reloadThread = useCallback(() => {
    if (route.kind !== "post") {
      return;
    }
    threadCache.delete(`${route.actor}:${route.rkey}`);
    startThreadLoad(route.actor, route.rkey);
  }, [route, startThreadLoad]);

  const loadThreadBranch = useCallback(
    createThreadBranchLoader({
      threadBranchCache,
      threadCache,
      threadLoadControllerRef,
      setThread,
      setThreadBranchResults,
      setLoadingThreadBranches,
      setDevMetrics,
      getThread: () => thread,
      getLoadingThreadBranches: () => loadingThreadBranches,
      getRoute: () => route,
    }),
    [thread, loadingThreadBranches, route],
  );

  function updateDensity(nextDensity: DensityMode) {
    if (nextDensity === "media") {
      setShowMedia(true);
      safeLocalStorageSet(showMediaStorageKey, "true");
    }
    const nextPreferences = {
      ...densityByContext,
      default: nextDensity,
    };
    setDensityByContext(nextPreferences);
    safeLocalStorageSet(densityByContextStorageKey, JSON.stringify(nextPreferences));
  }

  function updateFeedDensityOverride(source: FeedSource, nextDensity: DensityMode | null) {
    if (nextDensity === "media") {
      setShowMedia(true);
      safeLocalStorageSet(showMediaStorageKey, "true");
    }
    const key = feedPreferenceKey(source);
    const keysToClear = feedPreferenceKeys(source);
    const nextPreferences = { ...densityByContext };
    if (nextDensity) {
      for (const staleKey of keysToClear) {
        if (staleKey !== key) {
          delete nextPreferences[staleKey];
        }
      }
      nextPreferences[key] = nextDensity;
    } else {
      for (const staleKey of keysToClear) {
        delete nextPreferences[staleKey];
      }
    }
    setDensityByContext(nextPreferences);
    safeLocalStorageSet(densityByContextStorageKey, JSON.stringify(nextPreferences));
  }

  function updateFeedShowMediaOverride(source: FeedSource, nextValue: boolean | null) {
    const key = feedPreferenceKey(source);
    const keysToClear = feedPreferenceKeys(source);
    const nextPreferences = { ...showMediaByFeed };
    // Drop any preference stored under a stale alias key (e.g. legacy id key)
    // so the canonical uri key wins, mirroring updateFeedDensityOverride.
    for (const staleKey of keysToClear) {
      if (staleKey !== key) {
        delete nextPreferences[staleKey];
      }
    }
    if (nextValue === null) {
      delete nextPreferences[key];
    } else {
      nextPreferences[key] = nextValue;
    }
    setShowMediaByFeed(nextPreferences);
    safeLocalStorageSet(showMediaByFeedStorageKey, JSON.stringify(nextPreferences));
  }

  function setColumnVisible(which: keyof ColumnVisibility, visible: boolean) {
    setColumns((current) => {
      const next = { ...current, [which]: visible };
      safeLocalStorageSet(columnsStorageKey, JSON.stringify(next));
      return next;
    });
  }

  function toggleShowNsfw() {
    const next = !showNsfw;
    if (next) {
      const confirmed = window.confirm(
        "Show NSFW media in BigBSky on this browser? Confirm that you are allowed to view adult content where you live. BigBSky will not ask for or store your birthday. For Bluesky account-wide moderation settings, use https://bsky.app/moderation.",
      );
      if (!confirmed) {
        return;
      }
    }
    setShowNsfw(next);
    safeLocalStorageSet(showNsfwStorageKey, next ? "true" : "false");
  }

  function toggleShowMedia() {
    const next = !showMedia;
    setShowMedia(next);
    safeLocalStorageSet(showMediaStorageKey, next ? "true" : "false");
  }

  // "Show posts from language" selection. Passing an empty array selects Any
  // (no filter). Selecting a specific language while on Any starts a fresh set;
  // toggling the last language off returns to Any.
  function setContentLanguageSelection(next: string[]) {
    const cleaned = Array.from(new Set(next.filter((code) => typeof code === "string" && code)));
    setContentLanguages(cleaned);
    safeLocalStorageSet(contentLanguagesStorageKey, JSON.stringify(cleaned));
  }

  function selectAnyContentLanguage() {
    setContentLanguageSelection([]);
  }

  function toggleContentLanguage(code: string) {
    const next = contentLanguages.includes(code)
      ? contentLanguages.filter((entry) => entry !== code)
      : [...contentLanguages, code];
    // Route through setContentLanguageSelection so both selection paths dedupe
    // and drop empties identically (a corrupted stored list could otherwise
    // accumulate duplicates via this toggle path).
    setContentLanguageSelection(next);
  }

  async function clearLocalReaderData() {
    Object.keys(localStorage)
      .filter((key) => key.startsWith("bigbsky:"))
      .forEach((key) => safeLocalStorageRemove(key));
    Object.keys(sessionStorage)
      .filter((key) => key.startsWith("bigbsky:"))
      .forEach((key) => safeSessionStorageRemove(key));
    await clearOAuthLocalSession();
    setDensityByContext({});
    setShowMediaByFeed({});
    // Reset the in-memory prefs whose bigbsky: keys were just wiped, so memory
    // and storage don't diverge until a reload (defaults match the read* helpers).
    setShowMedia(true);
    setShowNsfw(false);
    setContentLanguages([]);
    setDetectedLangByUri(new Map());
    setHomeSourceIdState("following");
    setPinnedFeedMeta([]);
    setColumns({ feeds: true, right: true });
    setRecentItems([]);
    setComposerDraft({ posts: [""] });
    setLocalLists([]);
    setPinnedFeedIds([]);
    setFeedOrder([]);
    setPinnedSearches([]);
    setPinnedProfiles([]);
    setPinnedNotificationIds([]);
    setCollapsedFeedGroups({});
    clearAllDataCaches();
    scrollCache.clear();
    scrollAnchorCache.clear();
    setPendingScrollAnchor(null);
    setDevMetrics((current) => ({ ...current, cacheHits: 0 }));
    setAuthState({ status: "signed-out", session: null });
  }

  async function handleSignIn(handle: string) {
    const trimmed = handle.trim().replace(/^@+/, "");
    if (!trimmed) {
      setAuthState({ status: "error", session: null, message: "Enter a Bluesky handle, DID, or PDS URL." });
      return;
    }

    if (!trimmed.startsWith("did:") && !trimmed.startsWith("http") && !trimmed.includes(".")) {
      setAuthState({
        status: "error",
        session: null,
        message: "Use your full Bluesky handle, DID, or PDS URL, not an email address.",
      });
      return;
    }

    setAuthState((current) => ({ ...current, status: "signing-in", message: `Starting Bluesky OAuth for ${trimmed}.` }));
    try {
      await startSignIn(trimmed);
    } catch (error) {
      setAuthState({
        status: "error",
        session: null,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function handleSignOut() {
    const did = authState.session?.did;
    setAuthState((current) => ({ ...current, status: "signing-out", message: "Signing out locally." }));
    const warning = await signOut(did);
    setAuthState({
      status: warning ? "error" : "signed-out",
      session: null,
      message: warning ? `Signed out locally. Remote revocation was not confirmed: ${warning}` : undefined,
    });
  }

  function remember(item: RecentItem) {
    setRecentItems((current) => {
      const next = [item, ...current.filter((existing) => existing.path !== item.path)].slice(0, 8);
      safeLocalStorageSet(recentStorageKey, JSON.stringify(next));
      return next;
    });
  }

  function clearRecentItems() {
    setRecentItems([]);
    safeLocalStorageRemove(recentStorageKey);
  }

  const getBookmarkState = useCallback(
    (post: FeedPost): BookmarkView => {
      const ov = bookmarkOverrides[post.uri];
      if (ov !== undefined) {
        return { bookmarked: ov, error: bookmarkErrors[post.uri] };
      }
      return { bookmarked: !!post.viewer?.bookmarked, error: bookmarkErrors[post.uri] };
    },
    [bookmarkOverrides, bookmarkErrors],
  );

  const toggleBookmark = useCallback(
    (post: FeedPost) => {
      if (!signedInDid || bookmarkInFlight.current.has(post.uri)) {
        return;
      }
      const ov = bookmarkOverrides[post.uri];
      const bookmarked = ov !== undefined ? ov : !!post.viewer?.bookmarked;
      bookmarkInFlight.current.add(post.uri);
      setBookmarkErrors((current) => {
        const { [post.uri]: _removed, ...rest } = current;
        return rest;
      });
      // Optimistic update.
      setBookmarkOverrides((current) => ({ ...current, [post.uri]: !bookmarked }));
      void (async () => {
        try {
          if (bookmarked) {
            await unbookmarkPost(post.uri);
          } else {
            await bookmarkPost(post.uri, post.cid);
          }
        } catch {
          // Revert to pre-click state.
          setBookmarkOverrides((current) => ({ ...current, [post.uri]: bookmarked }));
          setBookmarkErrors((current) => ({ ...current, [post.uri]: "Bookmark update failed" }));
        } finally {
          bookmarkInFlight.current.delete(post.uri);
        }
      })();
    },
    [signedInDid, bookmarkOverrides],
  );

  const bookmarkContextValue = useMemo<BookmarkContextValue>(
    () => ({ canBookmark: !!signedInDid, getState: getBookmarkState, toggle: toggleBookmark }),
    [signedInDid, getBookmarkState, toggleBookmark],
  );

  const removePostFromState = useCallback((uri: string) => {
    const withoutPost = (items: FeedItem[]) => items.filter((item) => item.post.uri !== uri);
    setFeedState((current) => ({ ...current, items: withoutPost(current.items) }));
    setSearchState((current) => ({ ...current, posts: current.posts.filter((post) => post.uri !== uri) }));
    clearAllDataCaches();
    // The post is gone from every surface, so drop any bookmark override for it
    // rather than leaving a stale `false` shadowing the real viewer state
    // indefinitely (a latent wrong-state/leak if the same URI reappears).
    setBookmarkOverrides((current) => {
      if (!(uri in current)) {
        return current;
      }
      const next = { ...current };
      delete next[uri];
      return next;
    });
  }, []);

  // Stable across renders (only closes over the stable setRoute setter) so that
  // consumers listing it in dependency arrays — e.g. handleDeletePost below and
  // the DeletePostContext memo — don't invalidate on every render, which would
  // re-render every PostCard.
  const navigate = useCallback((nextRoute: RouteState, path = "/") => {
    window.history.pushState(null, "", path);
    setRoute(nextRoute);
  }, []);

  const handleDeletePost = useCallback(
    (post: FeedPost) => {
      if (!signedInDid || post.author.did !== signedInDid) {
        return;
      }
      const confirmed = window.confirm("Delete this post from your Bluesky account?");
      if (!confirmed) {
        return;
      }
      void deletePost(post.uri)
        .then(() => {
          removePostFromState(post.uri);
          if (route.kind === "post" && postPath(post) === window.location.pathname) {
            navigate({ kind: "feed" }, "/");
          }
        })
        .catch((error: unknown) => {
          window.alert(error instanceof Error ? error.message : "Unable to delete post.");
        });
    },
    [navigate, removePostFromState, route.kind, signedInDid],
  );

  const deletePostContextValue = useMemo<DeletePostContextValue>(
    () => ({ canDelete: !!signedInDid, deletePost: handleDeletePost }),
    [signedInDid, handleDeletePost],
  );

  function createLocalList(name: string, description: string) {
    const trimmedName = name.trim();
    if (!trimmedName) {
      return;
    }

    setLocalLists((current) => {
      const next = [
        {
          id: crypto.randomUUID(),
          name: trimmedName.slice(0, 80),
          description: description.trim().slice(0, 180),
          createdAt: new Date().toISOString(),
        },
        ...current,
      ].slice(0, 20);
      safeLocalStorageSet(localListsStorageKey, JSON.stringify(next));
      return next;
    });
  }

  function deleteLocalList(id: string) {
    setLocalLists((current) => {
      const next = current.filter((list) => list.id !== id);
      safeLocalStorageSet(localListsStorageKey, JSON.stringify(next));
      return next;
    });
  }

  function togglePostInLocalList(listId: string, post: FeedPost) {
    setLocalLists((current) => {
      const next = current.map((list) => {
        if (list.id !== listId) {
          return list;
        }

        const posts = list.posts ?? [];
        const exists = posts.some((listPost) => listPost.uri === post.uri);
        return {
          ...list,
          posts: exists ? posts.filter((listPost) => listPost.uri !== post.uri) : [post, ...posts].slice(0, 100),
        };
      });
      safeLocalStorageSet(localListsStorageKey, JSON.stringify(next));
      return next;
    });
  }

  function togglePinnedFeed(source: FeedSource) {
    const willPin = !pinnedFeedIds.includes(source.id);
    setPinnedFeedIds((current) => {
      const next = willPin
        ? [source.id, ...current.filter((id) => id !== source.id)].slice(0, 12)
        : current.filter((id) => id !== source.id);
      safeLocalStorageSet(pinnedFeedsStorageKey, JSON.stringify(next));
      return next;
    });
    // Discovered Feeds aren't in the static feedSources list, so persist their
    // metadata separately; otherwise the pinned id can't be resolved on reload.
    if (!feedSources.some((item) => item.id === source.id)) {
      setPinnedFeedMeta((current) => {
        const withoutSource = current.filter((item) => item.id !== source.id);
        const next = willPin ? [{ ...source }, ...withoutSource].slice(0, 12) : withoutSource;
        writePinnedFeedMeta(next);
        return next;
      });
    }
  }

  // Local-only manual reordering of pinned feeds. The Pinned group renders in
  // pinnedFeedIds order, so swapping ids here reorders the selector and the
  // change persists in browser storage (no account-backed ordering yet).
  function movePinnedFeed(id: string, direction: -1 | 1) {
    setPinnedFeedIds((current) => {
      const index = current.indexOf(id);
      if (index < 0) {
        return current;
      }
      const target = index + direction;
      if (target < 0 || target >= current.length) {
        return current;
      }
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      safeLocalStorageSet(pinnedFeedsStorageKey, JSON.stringify(next));
      return next;
    });
  }

  // Persist a new saved-feed order (browser-local). The list is the full set of
  // subscribed feed URIs in display order; orderedSubscribedFeeds then applies it
  // to both the /feeds grid and the selector's "My Feeds" group.
  function persistFeedOrder(uris: string[]) {
    setFeedOrder(uris);
    safeLocalStorageSet(feedOrderStorageKey, JSON.stringify(uris));
    // Best-effort sync the new order back to the account's saved-feeds
    // preference so it follows the user across devices/clients. The local order
    // remains the immediate source of truth; this only reorders feed-generator
    // items in the account preference and no-ops when the order is unchanged.
    if (signedInDid) {
      void syncSavedFeedsOrder(uris).catch((error) => {
        console.error("Failed to sync feed order to account", error);
        pushToast("Couldn't sync your feed order to your account. It's saved on this browser.", "error");
      });
    }
  }

  // Accessible up/down reorder for a saved feed.
  function moveSubscribedFeed(uri: string, direction: -1 | 1) {
    const current = orderedSubscribedFeeds.map((source) => source.uri);
    const index = current.indexOf(uri);
    if (index < 0) {
      return;
    }
    const target = index + direction;
    if (target < 0 || target >= current.length) {
      return;
    }
    const next = [...current];
    [next[index], next[target]] = [next[target], next[index]];
    persistFeedOrder(next);
  }

  // Drag-and-drop reorder: move fromUri to occupy toUri's position.
  function reorderSubscribedFeed(fromUri: string, toUri: string) {
    if (fromUri === toUri) {
      return;
    }
    const current = orderedSubscribedFeeds.map((source) => source.uri);
    const from = current.indexOf(fromUri);
    const to = current.indexOf(toUri);
    if (from < 0 || to < 0) {
      return;
    }
    const next = [...current];
    next.splice(from, 1);
    next.splice(to, 0, fromUri);
    persistFeedOrder(next);
  }

  function togglePinnedSearch(query: string) {
    const trimmed = query.trim();
    if (!trimmed) {
      return;
    }

    setPinnedSearches((current) => {
      const exists = current.some((item) => item.toLowerCase() === trimmed.toLowerCase());
      const next = exists ? current.filter((item) => item.toLowerCase() !== trimmed.toLowerCase()) : [trimmed, ...current].slice(0, 12);
      safeLocalStorageSet(pinnedSearchesStorageKey, JSON.stringify(next));
      return next;
    });
  }

  function togglePinnedProfile(profileToPin: Profile | null | undefined) {
    if (!profileToPin?.did || !profileToPin.handle) {
      return;
    }

    setPinnedProfiles((current) => {
      const exists = current.some((item) => item.did === profileToPin.did || item.handle === profileToPin.handle);
      const next = exists
        ? current.filter((item) => item.did !== profileToPin.did && item.handle !== profileToPin.handle)
        : [profileToPin, ...current].slice(0, 16);
      safeLocalStorageSet(pinnedProfilesStorageKey, JSON.stringify(next));
      return next;
    });
  }

  function togglePinnedNotification(id: string) {
    setPinnedNotificationIds((current) => {
      const next = current.includes(id) ? current.filter((item) => item !== id) : [id, ...current].slice(0, 20);
      safeLocalStorageSet(pinnedNotificationsStorageKey, JSON.stringify(next));
      return next;
    });
  }

  function toggleCollapsedFeedGroup(group: string) {
    setCollapsedFeedGroups((current) => {
      const next = { ...current, [group]: !current[group] };
      safeLocalStorageSet(collapsedFeedGroupsStorageKey, JSON.stringify(next));
      return next;
    });
  }

  function openNavigation(item: string) {
    if (item === "Chat") {
      // BigBsky does not handle DMs; the Chat nav opens Bluesky messages
      // directly rather than routing to an in-app surface.
      window.open("https://bsky.app/messages", "_blank", "noopener,noreferrer");
      return;
    }

    if (item === "Home") {
      // Resolve at click time so the signed-in state (and thus the Following /
      // custom-feed vs Discover fallback) is current. Mirror the active-source
      // memo's pending-auth flag so clicking Home during an auth check stays on
      // the user's chosen Home feed instead of bouncing to the Discover fallback.
      const source = resolveHomeSource(homeSourceId, !!signedInDid || feedWaitingForAuth, subscribedFeeds);
      setActiveSourceId(source.id);
      navigate({ kind: "feed", uri: source.id }, feedRoutePath(source));
      return;
    }

    if (item === "Explore") {
      const routeState = { kind: "surface", name: "explore" } as const;
      remember({
        label: "Explore",
        detail: "Search, trending, and feed discovery",
        path: "/explore",
        route: routeState,
      });
      navigate(routeState, "/explore");
      return;
    }

    if (item === "Search") {
      navigate({ kind: "search" }, "/search");
      return;
    }

    if (item === "Feeds") {
      const routeState = { kind: "surface", name: "feeds" } as const;
      remember({
        label: "Feeds",
        detail: "Saved and discoverable Feed destinations",
        path: "/feeds",
        route: routeState,
      });
      navigate(routeState, "/feeds");
      requestAnimationFrame(() => document.querySelector<HTMLInputElement>(".feed-search")?.focus());
      return;
    }

    if (item === "Profile") {
      // The single account hub: signed in shows the account page (identity,
      // sign out, shortcuts); signed out shows the sign-in form.
      navigate({ kind: "surface", name: "profile" }, "/profile");
      return;
    }

    const path = `/${item.toLowerCase()}`;
    const routeState = { kind: "surface", name: item.toLowerCase() } as const;
    remember({
      label: item,
      detail: "Signed-in surface placeholder",
      path,
      route: routeState,
    });
    navigate(routeState, path);
  }

  const isProfileRoute = route.kind === "profile";
  const workspaceTitle =
    route.kind === "post"
      ? "Post Conversation"
      : route.kind === "search"
        ? route.query
          ? `Search: ${route.query}`
          : "Search Bluesky"
        : route.kind === "surface"
          ? route.name.charAt(0).toUpperCase() + route.name.slice(1)
        : isProfileRoute
          ? displayName(profile ?? undefined)
          : feedMetadata?.displayName || activeSource.label;
  // Show a Follow button beside the feed title when a signed-in user is viewing
  // a custom feed generator they have not yet subscribed to. Lists and the
  // Following timeline are not followable feeds, and signed-out viewers cannot
  // subscribe, so the button is hidden in those cases.
  const canFollowActiveFeed =
    route.kind === "feed" &&
    !!signedInDid &&
    isFeedGeneratorUri(activeSource.uri) &&
    !followedFeedUris.has(activeSource.uri);
  const activeScrollKey =
    route.kind === "profile" && profileTab !== "feeds" && profileTab !== "lists" && profileTab !== "new-post"
      ? `profile:${route.actor}:${profileFeedFilterForTab(profileTab)}`
      : route.kind === "feed"
        ? `feed:${activeSource.id}`
        : route.kind === "surface" && (route.name === "bookmarks" || route.name === "lists")
          ? `surface:${route.name}`
          : "";
  // The content anchor pending for the current surface, if any (set by
  // restoreScrollFor). VirtualPostList consumes it and clears it via
  // onAnchorRestored once the anchored row has rendered + measured.
  const activeScrollAnchor =
    pendingScrollAnchor && pendingScrollAnchor.key === activeScrollKey ? pendingScrollAnchor.anchor : null;
  const activeScrollFallback = activeScrollKey ? scrollCache.get(activeScrollKey) || 0 : 0;
  const renderedRows =
    route.kind === "post"
      ? countThreadRows(thread.node)
      : route.kind === "search"
        ? searchTab === "people"
          ? actorSearchState.actors.length
          : searchState.posts.length
        : route.kind === "surface"
          ? 0
          : virtualRenderedRows;
  const loadedPages =
    route.kind === "post"
      ? thread.node
        ? 1
        : 0
      : Math.ceil((route.kind === "search" ? searchState.posts.length + actorSearchState.actors.length : feedState.items.length) / 30);

  useEffect(() => {
    const mediaQuery = window.matchMedia(MOBILE_SCROLL_QUERY);
    const timeline = timelineRef.current;
    let lastScrollY = readScrollOffset(timeline);
    let frame = 0;

    const updateHeader = () => {
      frame = 0;
      const currentScrollY = readScrollOffset(timeline);
      const delta = currentScrollY - lastScrollY;

      if (!mediaQuery.matches || navOpen || currentScrollY < 24) {
        setMobileHeaderVisible(true);
      } else if (delta > 6 && currentScrollY > 80) {
        setMobileHeaderVisible(false);
      } else if (delta < -4) {
        setMobileHeaderVisible(true);
      }

      lastScrollY = currentScrollY;
    };

    const onScroll = () => {
      if (!frame) {
        frame = requestAnimationFrame(updateHeader);
      }
    };

    setMobileHeaderVisible(true);
    updateHeader();
    window.addEventListener("scroll", onScroll, { passive: true });
    timeline?.addEventListener("scroll", onScroll, { passive: true });
    mediaQuery.addEventListener("change", updateHeader);

    return () => {
      if (frame) {
        cancelAnimationFrame(frame);
      }
      window.removeEventListener("scroll", onScroll);
      timeline?.removeEventListener("scroll", onScroll);
      mediaQuery.removeEventListener("change", updateHeader);
    };
  }, [activeSource.id, navOpen, profileTab, route.kind]);

  useEffect(() => {
    const timeline = timelineRef.current;
    if (!timeline || !activeScrollKey) {
      return undefined;
    }

    // Arm the restore guard from the persisted offset as soon as this key
    // becomes active, before the feed finishes loading. Otherwise a transient
    // near-top scroll event during load saves ~0 over the persisted value, and
    // the later restore reads 0 and no-ops.
    armScrollRestore(scrollCache.get(activeScrollKey) || 0);

    const rememberScroll = () => {
      const offset = readScrollOffset(timeline);
      if (shouldSuppressScrollSave(offset)) {
        return;
      }
      scrollCache.set(activeScrollKey, offset);
      // Capture the content anchor (top-visible post URI + intra-row offset) so
      // a later restore can scroll *content into view* instead of re-asserting a
      // raw pixel offset. Raw pixels fight the virtualization measurement shrink
      // (issue #8): re-asserting the stale offset re-mounts rows at the too-tall
      // default estimate, they measure shorter, totalHeight shrinks, and scrollTop
      // clamps back — so the restore never converges. The anchor is only captured
      // once the timeline has rendered post rows (readTopVisibleAnchor scans
      // [data-post-uri]); before that it returns null and the pixel cache stays
      // the fallback.
      const anchor = readTopVisibleAnchor(timeline);
      if (anchor) {
        scrollAnchorCache.set(activeScrollKey, anchor);
      } else {
        scrollAnchorCache.delete(activeScrollKey);
      }
    };
    const persistScroll = () => {
      rememberScroll();
      writeTimelineScrollCache(Object.fromEntries(scrollCache.entries()));
      writeTimelineAnchorCache(Object.fromEntries(scrollAnchorCache.entries()));
    };
    // On mobile the document scrolls (timeline stays at 0), so also listen on
    // window; on desktop the timeline element is the scroller.
    timeline.addEventListener("scroll", rememberScroll, { passive: true });
    window.addEventListener("scroll", rememberScroll, { passive: true });
    window.addEventListener("pagehide", persistScroll);
    return () => {
      timeline.removeEventListener("scroll", rememberScroll);
      window.removeEventListener("scroll", rememberScroll);
      window.removeEventListener("pagehide", persistScroll);
      // Flush the last live offset captured by the scroll handlers. Do NOT
      // re-read scroll here: on navigation this cleanup runs after the timeline
      // element has detached, and a detached element reports scrollTop 0, which
      // would clobber the saved offset and break restoration on return.
      writeTimelineScrollCache(Object.fromEntries(scrollCache.entries()));
      writeTimelineAnchorCache(Object.fromEntries(scrollAnchorCache.entries()));
    };
  }, [activeScrollKey]);

  useEffect(() => {
    if (!activeScrollKey.startsWith("surface:")) {
      return undefined;
    }

    // Prefer the content-anchored restore (issue #8): the pixel restore re-asserts
    // a fixed offset that fights the virtualization measurement shrink on async
    // surfaces. When a saved anchor exists, hand it to VirtualPostList, whose
    // anchored-restore effect re-runs as rows mount/measure and converges. Skip
    // the pixel restore + MutationObserver entirely in that case.
    const savedAnchor = scrollAnchorCache.get(activeScrollKey);
    if (savedAnchor && (scrollCache.get(activeScrollKey) || 0) > 0) {
      restoreScrollFor(activeScrollKey);
      return undefined;
    }

    const target = scrollCache.get(activeScrollKey) || 0;
    restoreOrResetScroll(timelineRef, target);
    // Surfaces (Bookmarks, Lists) load their content asynchronously, so the
    // restore above (and its ~30-frame rAF budget) can run entirely against a
    // still-empty container and clamp to 0. Watch for content growth and
    // re-apply the saved offset once the surface is tall enough to reach it,
    // then stop. Bounded by a timeout so the observer can't run indefinitely.
    const timeline = timelineRef.current;
    if (target <= 0 || !timeline || typeof MutationObserver === "undefined") {
      return undefined;
    }
    let settled = false;
    let timeoutId = 0;
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      observer.disconnect();
      window.clearTimeout(timeoutId);
    };
    const tryRestore = () => {
      if (settled) {
        return;
      }
      // Already at (or past) the saved offset — the restore succeeded, stop.
      if (readScrollOffset(timelineRef.current) >= target - 1) {
        finish();
        return;
      }
      restoreScrollOffset(timelineRef, target);
    };
    const observer = new MutationObserver(tryRestore);
    observer.observe(timeline, { childList: true, subtree: true });
    timeoutId = window.setTimeout(finish, 5000);
    return finish;
  }, [activeScrollKey]);

  const loadMoreInFlightRef = useRef(false);
  const loadMoreControllerRef = useRef<AbortController | null>(null);
  const reloadProfileControllerRef = useRef<AbortController | null>(null);
  // The initial loads above are scoped by their effect's AbortController, but
  // pagination and the post-publish profile refetch are fired from callbacks. A
  // page that resolves after the user has moved on would append rows to (or
  // overwrite) whatever surface is now mounted, so both get a controller that is
  // aborted whenever the surface they were reading changes.
  useEffect(
    () => () => {
      loadMoreControllerRef.current?.abort();
      loadMoreControllerRef.current = null;
      loadMoreInFlightRef.current = false;
      reloadProfileControllerRef.current?.abort();
      reloadProfileControllerRef.current = null;
    },
    [activeSource, profileTab, route, searchLanguage, searchSort, searchTab],
  );
  const loadMore = () => {
    // Single in-flight gate across feed/profile/search: the cursor isn't updated
    // until the fetch resolves, so two rapid fires (un-disabled manual button, or
    // beating the observer cooldown) would otherwise fetch the same cursor and
    // append duplicate rows.
    if (loadMoreInFlightRef.current) {
      return;
    }

    const controller = new AbortController();
    const { signal } = controller;
    let promise: Promise<unknown> | undefined;
    if (route.kind === "search") {
      if (route.query && searchTab === "posts" && searchState.cursor) {
        promise = loadSearch(route.query, searchSort, searchLanguage, searchState.cursor, signal);
      } else if (route.query && searchTab === "people" && actorSearchState.cursor) {
        promise = loadActorSearch(route.query, actorSearchState.cursor, signal);
      }
    } else if (feedState.cursor) {
      promise =
        route.kind === "profile"
          ? loadProfileFeed(route.actor, feedState.cursor, signal, profileFeedFilterForTab(profileTab))
          : loadFeed(activeSource, feedState.cursor, signal);
    }

    if (!promise) {
      return;
    }

    loadMoreControllerRef.current = controller;
    loadMoreInFlightRef.current = true;
    void promise.finally(() => {
      // An aborted page can still settle after a newer load-more started; only
      // the current controller may release the in-flight gate.
      if (loadMoreControllerRef.current === controller) {
        loadMoreControllerRef.current = null;
        loadMoreInFlightRef.current = false;
      }
    });
  };
  const reloadCurrentProfile = useCallback(() => {
    if (route.kind !== "profile") {
      return;
    }
    const filter = profileFeedFilterForTab(profileTab);
    profileCache.delete(`profile:${route.actor}:${filter}`);
    reloadProfileControllerRef.current?.abort();
    const controller = new AbortController();
    reloadProfileControllerRef.current = controller;
    void loadProfileFeed(route.actor, undefined, controller.signal, filter);
  }, [loadProfileFeed, profileTab, route]);
  // After the signed-in user creates a post or reply, drop the SPA caches that
  // would otherwise serve a stale list omitting the new record: the Following
  // timeline (which includes the user's own posts) and every cached self-profile
  // tab. The refreshed reads are authenticated (PDS-proxied), so they benefit
  // from atproto read-after-write smoothing even before the AppView is fully
  // consistent. Other users' feeds aren't touched — read-after-write only
  // applies to the requesting user's own records.
  const invalidateOwnContentCaches = useCallback(() => {
    feedCache.delete("feed:following");
    const selfIds = [signedInDid, authState.session?.handle].filter(Boolean) as string[];
    if (selfIds.length > 0) {
      for (const key of profileCache.keys()) {
        if (selfIds.some((id) => key.startsWith(`profile:${id}:`))) {
          profileCache.delete(key);
        }
      }
    }
  }, [signedInDid, authState.session?.handle]);
  const handleOwnReplyPublished = useCallback(() => {
    invalidateOwnContentCaches();
    reloadThread();
  }, [invalidateOwnContentCaches, reloadThread]);
  const handleOwnPostPublished = useCallback(() => {
    invalidateOwnContentCaches();
    reloadCurrentProfile();
  }, [invalidateOwnContentCaches, reloadCurrentProfile]);
  const openPost = (post: FeedPost) => {
    const path = postPath(post);
    if (!path) {
      return;
    }

    const routeState = { kind: "post", actor: post.author.handle, rkey: path.split("/").pop() || "" } as const;
    remember({
      label: post.record.text?.slice(0, 72) || "Post conversation",
      detail: `@${post.author.handle}`,
      path,
      route: routeState,
    });
    navigate(routeState, path);
  };
  // Open a post by its AT-URI given the post author's handle/DID (used by
  // notifications, which carry uris rather than full post objects).
  const openPostByUri = (uri: string, actor: string) => {
    const rkey = uri.split("/").pop();
    if (!rkey || !actor) {
      return;
    }
    const path = `/profile/${encodeURIComponent(actor)}/post/${encodeURIComponent(rkey)}`;
    const routeState = { kind: "post", actor, rkey } as const;
    remember({ label: "Post conversation", detail: `@${actor}`, path, route: routeState });
    navigate(routeState, path);
  };
  const openProfile = (author: Profile) => {
    const path = `/profile/${encodeURIComponent(author.handle)}`;
    const routeState = { kind: "profile", actor: author.handle } as const;
    remember({
      label: displayName(author),
      detail: `@${author.handle}`,
      path,
      route: routeState,
    });
    navigate(routeState, path);
  };
  // Open the signed-in user's own profile on a specific tab (used by the
  // self-profile shortcuts). profileTab isn't reset on navigation, so setting it
  // before opening lands the reader on the right tab.
  const openSelfTab = (tab: ProfileTab) => {
    if (!authState.session) {
      return;
    }
    setProfileTab(tab);
    openProfile(authState.session as Profile);
  };
  const openFeedSource = (source: FeedSource) => {
    setActiveSourceId(source.id);
    remember({
      label: source.label,
      detail: source.description,
      path: feedRoutePath(source),
      route: { kind: "feed", uri: source.id },
      sourceId: source.id,
    });
    navigate({ kind: "feed", uri: source.id }, feedRoutePath(source));
  };
  const openTag = (tag: string) => {
    const trimmed = tag.trim();
    if (!trimmed) {
      return;
    }
    submitSearch(trimmed.startsWith("#") ? trimmed : `#${trimmed}`);
  };
  const submitSearch = (query: string) => {
    const trimmed = query.trim();
    if (!trimmed) {
      navigate({ kind: "search" }, "/search");
      return;
    }

    const postUrl = parsePostUrl(trimmed);
    if (postUrl) {
      const routeState = { kind: "post", actor: postUrl.actor, rkey: postUrl.rkey } as const;
      remember({
        label: "Post conversation",
        detail: `@${postUrl.actor}`,
        path: postUrl.path,
        route: routeState,
      });
      navigate(routeState, postUrl.path);
      return;
    }

    const path = `/search?q=${encodeURIComponent(trimmed)}`;
    const routeState = { kind: "search", query: trimmed } as const;
    remember({
      label: trimmed,
      detail: "Search",
      path,
      route: routeState,
    });
    navigate(routeState, path);
  };
  const clearSearch = () => {
    setGlobalSearchText("");
    setSearchState(emptySearchState);
    setActorSearchState(emptyActorSearchState);
    setFeedSearchState(emptyFeedSearchState);
    navigate({ kind: "search" }, "/search");
  };

  const isViewingSelfProfile =
    route.kind === "profile" &&
    !!authState.session &&
    !!signedInDid &&
    (profile?.did === signedInDid || route.actor === authState.session.handle || route.actor === signedInDid);

  return (
    <ToastContext.Provider value={pushToast}>
    <TagSearchContext.Provider value={openTag}>
      <ShowNsfwContext.Provider value={showNsfw}>
      <ShowMediaContext.Provider value={effectiveShowMedia}>
      <DensityContext.Provider value={density}>
      <LikeContext.Provider value={likeContextValue}>
      <BookmarkContext.Provider value={bookmarkContextValue}>
      <BlockContext.Provider value={blockContextValue}>
      <DeletePostContext.Provider value={deletePostContextValue}>
      <div className={`app-shell ${navOpen ? "nav-open" : "nav-hidden"}${columns.feeds ? "" : " feeds-hidden"}${columns.right ? "" : " right-hidden"}`}>
      <aside className="left-rail" aria-label="Primary">
        <nav className="rail-nav">
          {authState.session && (
            <button
              className="rail-button rail-compose"
              type="button"
              title="New post"
              onClick={() => openSelfTab("new-post")}
            >
              <Plus size={20} />
              <span>New post</span>
            </button>
          )}
          {navigationItems.map((item) => {
            const Icon = navIcons[item];
            // The Profile entry opens the account hub. It uses the same line icon
            // as the rest of the rail so it matches; when signed in the tooltip
            // carries the account handle.
            const signedInProfile = item === "Profile" && !!authState.session;
            const hasUnreadProfileNotifications = item === "Profile" && unreadNotificationCount > 0;
            return (
              <button
                key={item}
                className={hasUnreadProfileNotifications ? "rail-button has-notifications" : "rail-button"}
                type="button"
                title={
                  hasUnreadProfileNotifications
                    ? `Profile · ${unreadNotificationCount.toLocaleString()} unread notification${unreadNotificationCount === 1 ? "" : "s"}`
                    : signedInProfile
                      ? `Profile · @${authState.session!.handle}`
                      : item
                }
                onClick={() => openNavigation(item)}
              >
                {Icon && <Icon size={20} />}
                <span>{item}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      <aside className="feed-map" aria-label="Feeds">
        <div className="feed-map-header">
          <strong>Feeds</strong>
          <div className="feed-map-actions">
            <button type="button" title="Clear feed filter" aria-label="Clear feed filter" onClick={() => setFeedSearch("")}>
              <Search size={16} />
            </button>
            <button
              type="button"
              className="column-close"
              title="Hide feeds column (re-enable in Settings)"
              aria-label="Hide feeds column"
              onClick={() => setColumnVisible("feeds", false)}
            >
              <X size={16} />
            </button>
          </div>
        </div>
        <input
          className="feed-search"
          aria-label="Filter feeds"
          placeholder="Filter feeds"
          value={feedSearch}
          onInput={(event) => setFeedSearch(event.currentTarget.value)}
        />
        {Object.entries(groupedSources).map(([group, sources]) => (
          <section className="feed-group" key={group}>
            <h2>
              <button type="button" onClick={() => toggleCollapsedFeedGroup(group)} aria-expanded={!collapsedFeedGroups[group]}>
                {group}
              </button>
              <span>{sources.length}</span>
            </h2>
            {!collapsedFeedGroups[group] &&
              sources?.map((source, index) => {
                const reorderable = group === "Pinned" && feedSearch.trim() === "" && sources.length > 1;
                return (
                <div className="feed-source-row" key={`${group}:${source.id}`}>
                  {reorderable && (
                    <div className="feed-reorder">
                      <button
                        className="feed-move"
                        type="button"
                        disabled={index === 0}
                        onClick={() => movePinnedFeed(source.id, -1)}
                        aria-label={`Move ${source.label} up`}
                        title="Move up"
                      >
                        <ChevronUp size={14} />
                      </button>
                      <button
                        className="feed-move"
                        type="button"
                        disabled={index === sources.length - 1}
                        onClick={() => movePinnedFeed(source.id, 1)}
                        aria-label={`Move ${source.label} down`}
                        title="Move down"
                      >
                        <ChevronDown size={14} />
                      </button>
                    </div>
                  )}
                  <button
                    className={source.id === activeSource.id ? "feed-source active" : "feed-source"}
                    type="button"
                    onClick={() => openFeedSource(source)}
                  >
                    <span>{source.label}</span>
                    <small>{source.description}</small>
                  </button>
                  <button
                    className={pinnedFeedIds.includes(source.id) ? "feed-pin pinned" : "feed-pin"}
                    type="button"
                    onClick={() => togglePinnedFeed(source)}
                    aria-label={pinnedFeedIds.includes(source.id) ? `Unpin ${source.label}` : `Pin ${source.label}`}
                    title={pinnedFeedIds.includes(source.id) ? "Unpin feed" : "Pin feed locally"}
                  >
                    <Bookmark size={15} />
                  </button>
                </div>
                );
              })}
          </section>
        ))}
      </aside>

      <main className="workspace">
        <header className={mobileHeaderVisible ? "workspace-header" : "workspace-header mobile-hidden"}>
          <h1>{workspaceTitle}</h1>
          {canFollowActiveFeed && (
            <button
              type="button"
              className="discover-feed-follow workspace-header-follow"
              onClick={() => toggleFollowFeed(activeSource.uri, feedMetadata?.displayName || activeSource.label)}
              disabled={followBusyUri === activeSource.uri}
              aria-label={`Follow ${feedMetadata?.displayName || activeSource.label}`}
            >
              {followBusyUri === activeSource.uri ? <Loader2 className="spin" size={14} /> : <Plus size={14} />}
              Follow
            </button>
          )}
          <button
            className="nav-toggle"
            type="button"
            aria-label={navOpen ? "Hide navigation" : "Show navigation"}
            aria-expanded={navOpen}
            onClick={() => setNavOpen((open) => !open)}
          >
            <Menu size={20} />
          </button>
        </header>

        {missingScopes.length > 0 && (
          <div className="reauth-banner" role="status">
            <div>
              <strong>Permissions updated</strong>
              <span>BigBsky added new capabilities since you signed in. Re-authorize to keep everything working.</span>
            </div>
            <div className="reauth-banner-actions">
              <button type="button" className="reauth-primary" onClick={handleReauthorize}>
                Update permissions
              </button>
              <button type="button" onClick={dismissReauth}>
                Not now
              </button>
            </div>
          </div>
        )}

        {route.kind === "post" ? (
          <ThreadView
            key={`${route.actor}/${route.rkey}`}
            currentDid={authState.session?.did}
            thread={thread}
            loadingBranches={loadingThreadBranches}
            branchResults={threadBranchResults}
            onOpenImage={openImageViewer}
            onOpenPost={openPost}
            onOpenProfile={openProfile}
            onLoadBranch={loadThreadBranch}
            localLists={localLists}
            onToggleListPost={togglePostInLocalList}
            canReply={!!authState.session}
            onReplied={handleOwnReplyPublished}
          />
        ) : route.kind === "surface" && route.name === "bookmarks" ? (
          <BookmarksView
            containerRef={timelineRef}
            signedIn={!!authState.session}
            currentDid={authState.session?.did}
            onOpenImage={openImageViewer}
            onOpenPost={openPost}
            onOpenProfile={openProfile}
            localLists={localLists}
            onToggleListPost={togglePostInLocalList}
            scrollAnchor={activeScrollAnchor}
            scrollFallbackTarget={activeScrollFallback}
            onAnchorRestored={clearPendingAnchor}
          />
        ) : route.kind === "surface" ? (
          <SurfaceView
            containerRef={timelineRef}
            auth={authState}
            name={route.name}
            defaultDensity={defaultDensity}
            densityByContext={densityByContext}
            recentCount={recentItems.length}
            savedPreferenceCount={Object.keys(densityByContext).length}
            localDataKeyCount={countBigBskyLocalKeys()}
            localLists={localLists}
            myLists={myLists}
            myListsStatus={myListsStatus}
            onReloadMyLists={reloadMyLists}
            onCreateModList={handleCreateModList}
            onDeleteModList={handleDeleteModList}
            signedInDid={signedInDid}
            pinnedFeedCount={pinnedFeedIds.length}
            pinnedFeedIds={pinnedFeedIds}
            pinnedNotificationCount={pinnedNotificationIds.length}
            pinnedNotificationIds={pinnedNotificationIds}
            pinnedProfileCount={pinnedProfiles.length}
            pinnedSearchCount={pinnedSearches.length}
            columns={columns}
            onClearLocalData={clearLocalReaderData}
            onCreateLocalList={createLocalList}
            onDensityChange={updateDensity}
            onFeedDensityOverrideChange={updateFeedDensityOverride}
            showMediaByFeed={showMediaByFeed}
            onFeedShowMediaOverrideChange={updateFeedShowMediaOverride}
            onDeleteLocalList={deleteLocalList}
            onOpenFeed={openFeedSource}
            onOpenProfile={openProfile}
            onOpenPostByUri={openPostByUri}
            onNotificationsSeen={() => setUnreadNotificationCount(0)}
            onReauthorize={handleReauthorize}
            homeSourceId={homeSourceId}
            homeOptions={homeOptions}
            onHomeSourceChange={setHomeSource}
            onOpenSearch={() => navigate({ kind: "search" }, "/search")}
            onOpenSearchQuery={submitSearch}
            onSignIn={handleSignIn}
            onSignOut={handleSignOut}
            onTogglePinnedFeed={togglePinnedFeed}
            onSetColumnVisible={setColumnVisible}
            showNsfw={showNsfw}
            onToggleNsfw={toggleShowNsfw}
            showMedia={showMedia}
            onToggleShowMedia={toggleShowMedia}
            contentLanguages={contentLanguages}
            onSelectAnyContentLanguage={selectAnyContentLanguage}
            onToggleContentLanguage={toggleContentLanguage}
            canFollowFeeds={!!signedInDid}
            subscribedFeeds={orderedSubscribedFeeds}
            onMoveFeed={moveSubscribedFeed}
            onReorderFeed={reorderSubscribedFeed}
            followedFeedUris={followedFeedUris}
            followBusyUri={followBusyUri}
            onToggleFollowFeed={toggleFollowFeed}
            onTogglePinnedNotification={togglePinnedNotification}
            onOpenSelfTab={openSelfTab}
            onOpenSurfaceNav={openNavigation}
          />
        ) : route.kind === "search" ? (
          <SearchView
            actorSearchState={actorSearchState}
            feedSearchState={feedSearchState}
            currentDid={authState.session?.did}
            feedSources={feedSources}
            language={searchLanguage}
            query={globalSearchText}
            searchState={searchState}
            sort={searchSort}
            tab={searchTab}
            isPinnedSearch={route.query ? pinnedSearches.some((query) => query.toLowerCase() === route.query?.toLowerCase()) : false}
            onLoadMore={loadMore}
            onOpenImage={openImageViewer}
            onOpenPost={openPost}
            onOpenProfile={openProfile}
            localLists={localLists}
            onToggleListPost={togglePostInLocalList}
            onQueryChange={setGlobalSearchText}
            onSearch={submitSearch}
            onClearSearch={clearSearch}
            onLanguageChange={setSearchLanguage}
            onSortChange={setSearchSort}
            onTabChange={setSearchTab}
            onTogglePinnedSearch={togglePinnedSearch}
            onOpenFeed={openFeedSource}
          />
        ) : route.kind === "profile" ? (
          <div className={`timeline ${density}`} ref={timelineRef}>
            <ProfileDetailHeader
              actor={route.actor}
              profile={profile}
              isPinned={!!profile && pinnedProfiles.some((item) => item.did === profile.did || item.handle === profile.handle)}
              canFollow={!!signedInDid && !!profile && profile.did !== signedInDid}
              onFollow={followAccount}
              onUnfollow={unfollowAccount}
              onBlock={blockAccount}
              onUnblock={unblockAccount}
              canPost={isViewingSelfProfile}
              selectedTab={profileTab}
              onSelectTab={setProfileTab}
              onTogglePinned={togglePinnedProfile}
            />
            {profileTab === "new-post" && isViewingSelfProfile ? (
              <PostComposer
                draft={composerDraft}
                onDraftChange={setComposerDraft}
                onPosted={handleOwnPostPublished}
                defaultExpanded
              />
            ) : profileTab === "feeds" ? (
              <ProfileFeedsTab
                actor={route.actor}
                pinnedFeedIds={pinnedFeedIds}
                onOpenFeed={openFeedSource}
                onTogglePinnedFeed={togglePinnedFeed}
              />
            ) : profileTab === "lists" ? (
              <ProfileListsTab actor={route.actor} onOpenFeed={openFeedSource} />
            ) : profile?.viewer?.blocking ? (
              // You've blocked this account: the AppView returns an empty author
              // feed, so the generic "No posts" empty-state would be misleading.
              // Say plainly why there's nothing here and point at the Unblock
              // control in the header above.
              <EmptyState
                title="You've blocked this account"
                message={`You blocked @${profile.handle}. Their posts are hidden here — use “Blocking” in the header above to unblock.`}
              />
            ) : (
              <>
                {feedState.status === "loading" && <LoadingState label="Loading public profile posts" />}
                {feedState.status === "error" && <ErrorState message={feedState.error || "Profile feed failed to load."} />}
                {feedState.status === "rate-limit" && <RateLimitState message={feedState.error} />}
                {feedState.status === "ready" && visibleProfileItems.length === 0 && (
                  <EmptyState title="No posts in this tab" message="This public profile has no loaded posts matching the selected view." />
                )}
                {feedState.status === "ready" && visibleProfileItems.length > 0 && (
                  <VirtualPostList
                    containerRef={timelineRef}
                    density={density}
                    items={visibleProfileItems}
                    onOpenImage={openImageViewer}
                    onOpenPost={openPost}
                    onOpenProfile={openProfile}
                    currentDid={authState.session?.did}
                    localLists={localLists}
                    onToggleListPost={togglePostInLocalList}
                    onRenderedRowsChange={setVirtualRenderedRows}
                    scrollAnchor={activeScrollAnchor}
                    scrollFallbackTarget={activeScrollFallback}
                    onAnchorRestored={clearPendingAnchor}
                  >
                    {feedState.cursor && (
                      <AutoLoadMoreButton label="Load more profile posts" onLoadMore={loadMore} error={feedState.loadMoreError} />
                    )}
                    {!feedState.cursor && !feedState.loadMoreError && <EndOfFeedCard />}
                  </VirtualPostList>
                )}
              </>
            )}
          </div>
        ) : (
          <div
            className={`timeline ${density}`}
            ref={timelineRef}
          >
            {feedState.status === "loading" && <LoadingState label={feedWaitingForAuth ? "Checking browser session" : "Loading Bluesky posts"} />}
            {feedState.status === "error" && <ErrorState message={feedState.error || "Feed failed to load."} />}
            {feedState.status === "rate-limit" && <RateLimitState message={feedState.error} />}
            {feedState.status === "ready" && (
              <VirtualPostList
                containerRef={timelineRef}
                density={density}
                items={visibleFeedItems}
                mediaOnly={density === "media"}
                onOpenImage={openImageViewer}
                onOpenPost={openPost}
                onOpenProfile={openProfile}
                currentDid={authState.session?.did}
                localLists={localLists}
                onToggleListPost={togglePostInLocalList}
                onRenderedRowsChange={setVirtualRenderedRows}
                scrollAnchor={activeScrollAnchor}
                scrollFallbackTarget={activeScrollFallback}
                onAnchorRestored={clearPendingAnchor}
              >
                {feedState.cursor && (
                  <AutoLoadMoreButton label="Load more feed posts" onLoadMore={loadMore} error={feedState.loadMoreError} />
                )}
                {feedState.items.length > 0 && !feedState.cursor && !feedState.loadMoreError && (
                  <EndOfFeedCard kind={density === "media" ? "media" : "posts"} />
                )}
              </VirtualPostList>
            )}
          </div>
        )}
        <BackToTopButton containerRef={timelineRef} watchKey={`${route.kind}:${activeSource.id}`} />
      </main>

      <aside className="right-rail" aria-label="Context">
        <button
          type="button"
          className="column-close right-rail-close"
          title="Hide right column (re-enable in Settings)"
          aria-label="Hide right column"
          onClick={() => setColumnVisible("right", false)}
        >
          <X size={16} />
        </button>
        <SearchBox value={globalSearchText} onChange={setGlobalSearchText} onSearch={submitSearch} />
        <AccountPanel auth={authState} onSignIn={handleSignIn} onSignOut={handleSignOut} />
        {route.kind === "profile" ? (
          <ProfileContextPanel actor={route.actor} profile={profile ?? entityCache.profiles[route.actor] ?? null} />
        ) : (
          <FeedContextPanel
            source={activeSource}
            metadata={feedMetadata}
            listMetadata={listMetadata}
            entityCache={entityCache}
            isPinned={pinnedFeedIds.includes(activeSource.id)}
            onTogglePinned={togglePinnedFeed}
          />
        )}
        <PinnedSearchesPanel searches={pinnedSearches} onOpen={submitSearch} onToggle={togglePinnedSearch} />
        <PinnedProfilesPanel profiles={pinnedProfiles} onOpen={openProfile} onToggle={togglePinnedProfile} />
        <RecentPanel
          items={recentItems}
          onClear={clearRecentItems}
          onOpen={(item) => {
            if (item.sourceId) {
              setActiveSourceId(item.sourceId);
            }
            navigate(item.route, item.path);
          }}
        />
        {import.meta.env.DEV && (
          <DevInspector
            activeSource={activeSource}
            apiRequests={devMetrics.apiRequests}
            cacheHits={devMetrics.cacheHits}
            loadedPages={loadedPages}
            renderedRows={renderedRows}
            route={route}
            runtimeWarnings={devMetrics.runtimeWarnings}
            sameOriginRequests={devMetrics.sameOriginRequests}
            serviceWorkerState={devMetrics.serviceWorkerState}
          />
        )}
        <TrendingPanel fallback={trendingTopics} onOpenTopic={submitSearch} />
      </aside>

      {imageViewer && <ImageViewer image={imageViewer} onChange={setImageViewer} onClose={closeImageViewer} />}
      <ToastHost toasts={toasts} onDismiss={dismissToast} />
      </div>
      </DeletePostContext.Provider>
      </BlockContext.Provider>
      </BookmarkContext.Provider>
      </LikeContext.Provider>
      </DensityContext.Provider>
      </ShowMediaContext.Provider>
      </ShowNsfwContext.Provider>
    </TagSearchContext.Provider>
    </ToastContext.Provider>
  );
}

function useComposerTargets() {
  const [activeReplyParentUri, setActiveReplyParentUri] = useState<string | null>(null);
  const [activeQuoteUri, setActiveQuoteUri] = useState<string | null>(null);
  const toggleReplyFor = useCallback((uri: string) => {
    setActiveReplyParentUri((current) => (current === uri ? null : uri));
    setActiveQuoteUri(null);
  }, []);
  const toggleQuoteFor = useCallback((uri: string) => {
    setActiveQuoteUri((current) => (current === uri ? null : uri));
    setActiveReplyParentUri(null);
  }, []);
  const closeReply = useCallback(() => setActiveReplyParentUri(null), []);
  const closeQuote = useCallback(() => setActiveQuoteUri(null), []);
  return { activeReplyParentUri, activeQuoteUri, toggleReplyFor, toggleQuoteFor, closeReply, closeQuote };
}

function VirtualPostList({
  children,
  containerRef,
  currentDid,
  density,
  items: incomingItems,
  localLists,
  mediaOnly = false,
  onOpenImage,
  onOpenPost,
  onOpenProfile,
  onToggleListPost,
  onRenderedRowsChange,
  scrollAnchor,
  scrollFallbackTarget = 0,
  onAnchorRestored,
}: {
  children?: React.ReactNode;
  containerRef: RefObject<HTMLDivElement | null>;
  currentDid?: string;
  density: DensityMode;
  items: FeedItem[];
  localLists: LocalList[];
  mediaOnly?: boolean;
  onOpenImage: (image: ImageViewerState) => void;
  onOpenPost: (post: FeedPost) => void;
  onOpenProfile: (profile: Profile) => void;
  onToggleListPost: (listId: string, post: FeedPost) => void;
  onRenderedRowsChange: (count: number) => void;
  scrollAnchor?: ScrollAnchor | null;
  scrollFallbackTarget?: number;
  onAnchorRestored?: () => void;
}) {
  // When the NSFW preference is hidden, drop adult/graphic-labeled posts from
  // the feed entirely (not just gate their media), so they never appear.
  const showNsfw = useContext(ShowNsfwContext);
  const items = useMemo(
    () =>
      incomingItems.filter((item) => {
        if (!showNsfw && isAdultPost(item.post)) {
          return false;
        }
        return !mediaOnly || postHasVisualMedia(item.post);
      }),
    [incomingItems, mediaOnly, showNsfw],
  );
  const rows = useMemo(() => buildThreadedFeedRows(items), [items]);
  const defaultRowHeight = density === "compact" ? 112 : density === "media" ? 360 : 260;
  const overscanPixels = defaultRowHeight * 3;
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(720);
  const [rowHeights, setRowHeights] = useState<Record<string, number>>({});
  // Mirror the committed heights so onMeasured can read the previous height and
  // apply the scroll compensation *outside* the state updater (updaters must be
  // pure — running the scrollTop side effect inside one double-applies it under
  // StrictMode / concurrent retries). The ref is forward-synced synchronously so
  // back-to-back measurements in one batch still diff against the latest height.
  const rowHeightsRef = useRef(rowHeights);
  rowHeightsRef.current = rowHeights;
  const { activeReplyParentUri, activeQuoteUri, toggleReplyFor, toggleQuoteFor, closeReply, closeQuote } = useComposerTargets();
  const canReply = !!currentDid;
  const rowOffsets = useMemo(() => {
    let offset = 0;
    return rows.map((row) => {
      const top = offset;
      offset += rowHeights[feedRowKey(row)] ?? defaultRowHeight;
      return top;
    });
  }, [defaultRowHeight, rowHeights, rows]);
  const totalHeight = useMemo(
    () => rows.reduce((total, row) => total + (rowHeights[feedRowKey(row)] ?? defaultRowHeight), 0),
    [defaultRowHeight, rowHeights, rows],
  );
  const findRowIndex = useCallback(
    (targetOffset: number) => {
      let low = 0;
      let high = rows.length - 1;
      let match = 0;

      while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        if ((rowOffsets[middle] ?? 0) <= targetOffset) {
          match = middle;
          low = middle + 1;
        } else {
          high = middle - 1;
        }
      }

      return match;
    },
    [rowOffsets, rows.length],
  );
  const startIndex = rows.length > 0 ? findRowIndex(Math.max(0, scrollTop - overscanPixels)) : 0;
  const endIndex =
    rows.length > 0 ? Math.min(rows.length - 1, findRowIndex(scrollTop + viewportHeight + overscanPixels) + 1) : -1;
  const visibleItems = endIndex >= startIndex ? rows.slice(startIndex, endIndex + 1) : [];
  const topSpacerHeight = rowOffsets[startIndex] ?? 0;
  const renderedHeight = visibleItems.reduce((total, row) => total + (rowHeights[feedRowKey(row)] ?? defaultRowHeight), 0);
  const bottomSpacerHeight = Math.max(0, totalHeight - topSpacerHeight - renderedHeight);

  useEffect(() => {
    setRowHeights((current) => {
      const next = Object.fromEntries(rows.map((row) => [feedRowKey(row), current[feedRowKey(row)]]).filter(([, height]) => !!height));
      return Object.keys(next).length === Object.keys(current).length ? current : (next as Record<string, number>);
    });
  }, [rows]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return undefined;
    }

    const updateViewport = () => {
      setScrollTop(container.scrollTop);
      setViewportHeight(container.clientHeight || 720);
    };

    updateViewport();
    container.addEventListener("scroll", updateViewport, { passive: true });
    const observer = "ResizeObserver" in window ? new ResizeObserver(updateViewport) : null;
    observer?.observe(container);

    return () => {
      container.removeEventListener("scroll", updateViewport);
      observer?.disconnect();
    };
  }, [containerRef]);

  useEffect(() => {
    onRenderedRowsChange(visibleItems.length);
  }, [onRenderedRowsChange, visibleItems.length]);

  // Content-anchored scroll restore (issue #8). The raw-pixel restore re-asserts
  // a fixed offset that fights the virtualization measurement shrink: each
  // re-assertion re-mounts rows near the target at the too-tall default estimate,
  // they measure shorter, totalHeight shrinks, and scrollTop clamps back — so it
  // never converges. Instead, anchor to the saved top-visible post URI: once that
  // row is present and measured, target = its live row offset + intra-row offset,
  // clamped against the live totalHeight. The target is recomputed from the live
  // measured layout every frame (via refs, so the loop always sees the latest
  // measurements), so the restore converges to the real content position rather
  // than fighting it. Once the offset holds at the (recomputed) target for a few
  // frames, or the frame budget runs out, clear the pending anchor.
  const anchoredRowsRef = useRef(rows);
  anchoredRowsRef.current = rows;
  const anchoredRowOffsetsRef = useRef(rowOffsets);
  anchoredRowOffsetsRef.current = rowOffsets;
  const anchoredTotalHeightRef = useRef(totalHeight);
  anchoredTotalHeightRef.current = totalHeight;
  const anchoredViewportHeightRef = useRef(viewportHeight);
  anchoredViewportHeightRef.current = viewportHeight;
  const anchoredRestoreTokenRef = useRef(0);

  useEffect(() => {
    if (!scrollAnchor) {
      return undefined;
    }
    const container = containerRef.current;
    if (!container) {
      return undefined;
    }
    const token = ++anchoredRestoreTokenRef.current;
    let frames = 0;
    let stable = 0;
    let cancelled = false;
    const apply = () => {
      if (cancelled || token !== anchoredRestoreTokenRef.current) {
        return;
      }
      const liveRows = anchoredRowsRef.current;
      const liveOffsets = anchoredRowOffsetsRef.current;
      const liveTotal = anchoredTotalHeightRef.current;
      const liveViewport = anchoredViewportHeightRef.current;
      const anchorIndex = liveRows.findIndex((row) => feedRowPost(row).uri === scrollAnchor.uri);
      frames += 1;
      if (anchorIndex < 0) {
        // Anchor post not in the loaded rows yet (async surface load). Wait for
        // rows to include it — the effect restarts with a fresh budget whenever
        // rows change (rows is a dep), so a slow load resumes automatically. If
        // rows exist but the anchor is genuinely gone (content changed), fall
        // back to the saved pixel offset so the restore still happens.
        if (liveRows.length > 0 && frames > 4) {
          const fallback = clampScrollTarget(scrollFallbackTarget, liveTotal, liveViewport);
          if (Math.abs(readScrollOffset(container) - fallback) > 1) {
            scrollOffsetTo(container, fallback);
            stable = 0;
          } else {
            stable += 1;
          }
          if (stable >= SCROLL_ANCHOR_STABLE_FRAMES || frames >= SCROLL_ANCHOR_MAX_FRAMES) {
            releaseScrollRestoreGuard();
            onAnchorRestored?.();
            return;
          }
        }
        // Rows still empty: keep waiting within a generous cap, but do NOT clear
        // the anchor on cap exhaustion — the rows-change restart (or unmount)
        // owns that. The cap only bounds the rAF loop itself.
        if (frames < 300) {
          requestAnimationFrame(apply);
        }
        return;
      }
      const target = clampScrollTarget((liveOffsets[anchorIndex] ?? 0) + scrollAnchor.intra, liveTotal, liveViewport);
      armScrollRestore(target);
      if (Math.abs(readScrollOffset(container) - target) > 1) {
        scrollOffsetTo(container, target);
        stable = 0;
      } else {
        stable += 1;
      }
      if (frames >= SCROLL_ANCHOR_MAX_FRAMES || stable >= SCROLL_ANCHOR_STABLE_FRAMES) {
        releaseScrollRestoreGuard();
        onAnchorRestored?.();
        return;
      }
      requestAnimationFrame(apply);
    };
    requestAnimationFrame(apply);
    return () => {
      cancelled = true;
    };
  }, [scrollAnchor, scrollFallbackTarget, onAnchorRestored, rows]);

  // Stable across scroll frames (only rows/offsets/height changes recreate it),
  // so MeasuredPostRow's effect (deps: [rowKey, onMeasured]) does not tear
  // down and re-create a ResizeObserver for every visible row on every scroll.
  const handleRowMeasured = useCallback(
    (rowKey: string, height: number) => {
      const previousHeight = rowHeightsRef.current[rowKey] ?? defaultRowHeight;
      if (previousHeight === height) {
        return;
      }

      // Keep the offset stable when a row above the viewport changes size:
      // grow/shrink the scroll position by the same delta so the content
      // under the user's eyes doesn't jump. Done here (not in the updater)
      // to keep setRowHeights pure.
      const rowIndex = rows.findIndex((candidate) => feedRowKey(candidate) === rowKey);
      const rowTop = rowIndex >= 0 ? rowOffsets[rowIndex] ?? 0 : 0;
      const container = containerRef.current;
      if (container && rowTop + previousHeight <= container.scrollTop) {
        container.scrollTop += height - previousHeight;
      }

      // Forward-sync the ref so a sibling measurement in the same batch
      // diffs against this height before the state commit lands.
      rowHeightsRef.current = { ...rowHeightsRef.current, [rowKey]: height };
      setRowHeights((current) =>
        (current[rowKey] ?? defaultRowHeight) === height ? current : { ...current, [rowKey]: height },
      );
    },
    [containerRef, defaultRowHeight, rowOffsets, rows],
  );

  return (
    <div
      className="virtual-list"
      data-total-rows={items.length}
      data-rendered-rows={visibleItems.length}
    >
      {topSpacerHeight > 0 && <div className="virtual-spacer" style={{ height: topSpacerHeight }} />}
      {visibleItems.map((row) => (
        <MeasuredPostRow
          post={feedRowPost(row)}
          rowKey={feedRowKey(row)}
          key={feedRowKey(row)}
          onMeasured={handleRowMeasured}
        >
          {(() => {
            const rowPost = feedRowPost(row);
            return (
              <>
                {isThreadedFeedItem(row) ? (
                  <ThreadedPostCard
                    thread={row}
                    onOpenImage={onOpenImage}
                    onOpenPost={onOpenPost}
                    onOpenProfile={onOpenProfile}
                    onReply={canReply ? (post) => toggleReplyFor(post.uri) : undefined}
                    replyActive={activeReplyParentUri === rowPost.uri}
                    onQuote={canReply ? (post) => toggleQuoteFor(post.uri) : undefined}
                    quoteActive={activeQuoteUri === rowPost.uri}
                  />
                ) : (
                  <PostCard
                    item={row}
                    currentDid={currentDid}
                    onOpenImage={onOpenImage}
                    onOpenPost={onOpenPost}
                    onOpenProfile={onOpenProfile}
                    onReply={canReply ? (post) => toggleReplyFor(post.uri) : undefined}
                    replyActive={activeReplyParentUri === rowPost.uri}
                    onQuote={canReply ? (post) => toggleQuoteFor(post.uri) : undefined}
                    quoteActive={activeQuoteUri === rowPost.uri}
                    localLists={localLists}
                    onToggleListPost={onToggleListPost}
                  />
                )}
                {activeReplyParentUri === rowPost.uri && (
                  <PostComposer
                    replyTo={{ parent: rowPost, root: replyRootRefForPost(rowPost) }}
                    canReply={canReply}
                    onClose={closeReply}
                  />
                )}
                {activeQuoteUri === rowPost.uri && (
                  <PostComposer
                    quote={rowPost}
                    onClose={closeQuote}
                  />
                )}
              </>
            );
          })()}
        </MeasuredPostRow>
      ))}
      {bottomSpacerHeight > 0 && <div className="virtual-spacer" style={{ height: bottomSpacerHeight }} />}
      {children}
    </div>
  );
}

function MeasuredPostRow({
  children,
  post,
  rowKey,
  onMeasured,
}: {
  children: React.ReactNode;
  post: FeedPost;
  rowKey: string;
  onMeasured: (rowKey: string, height: number) => void;
}) {
  const rowRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const row = rowRef.current;
    if (!row) {
      return undefined;
    }

    const measure = () => onMeasured(rowKey, Math.ceil(row.getBoundingClientRect().height));
    measure();
    const observer = "ResizeObserver" in window ? new ResizeObserver(measure) : null;
    observer?.observe(row);

    return () => observer?.disconnect();
  }, [rowKey, onMeasured]);

  return (
    <div className="virtual-row" data-post-uri={post.uri} ref={rowRef}>
      {/* Per-row boundary (H1): one malformed record degrades a single row to a
          compact fallback instead of unmounting the whole feed. The boundary
          adds no wrapper DOM in the happy path, so row measurement is unchanged. */}
      <ErrorBoundary label={`post-row:${post.uri}`} fallback={() => <PostRowFallback />}>
        {children}
      </ErrorBoundary>
    </div>
  );
}

function SurfaceView({
  containerRef,
  auth,
  name,
  defaultDensity,
  densityByContext,
  recentCount,
  savedPreferenceCount,
  localDataKeyCount,
  localLists,
  myLists,
  myListsStatus,
  onReloadMyLists,
  onCreateModList,
  onDeleteModList,
  signedInDid,
  pinnedFeedCount,
  pinnedFeedIds,
  pinnedNotificationCount,
  pinnedNotificationIds,
  pinnedProfileCount,
  pinnedSearchCount,
  columns,
  onClearLocalData,
  onCreateLocalList,
  onDensityChange,
  onFeedDensityOverrideChange,
  showMediaByFeed,
  onFeedShowMediaOverrideChange,
  onDeleteLocalList,
  onOpenFeed,
  onOpenProfile,
  onOpenPostByUri,
  onNotificationsSeen,
  onOpenSelfTab,
  onOpenSurfaceNav,
  onReauthorize,
  homeSourceId,
  homeOptions,
  onHomeSourceChange,
  onOpenSearch,
  onOpenSearchQuery,
  onSignIn,
  onSignOut,
  onTogglePinnedFeed,
  onTogglePinnedNotification,
  onSetColumnVisible,
  showNsfw,
  onToggleNsfw,
  showMedia,
  onToggleShowMedia,
  contentLanguages,
  onSelectAnyContentLanguage,
  onToggleContentLanguage,
  canFollowFeeds,
  subscribedFeeds,
  onMoveFeed,
  onReorderFeed,
  followedFeedUris,
  followBusyUri,
  onToggleFollowFeed,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  auth: AuthState;
  name: string;
  defaultDensity: DensityMode;
  densityByContext: Record<string, DensityMode>;
  recentCount: number;
  savedPreferenceCount: number;
  localDataKeyCount: number;
  localLists: LocalList[];
  myLists: { owned: ListView[]; subscribed: ListView[] };
  myListsStatus: "idle" | "loading" | "ready" | "error";
  onReloadMyLists: () => void;
  onCreateModList: (name: string, description: string) => Promise<void>;
  onDeleteModList: (listUri: string) => Promise<void>;
  signedInDid?: string;
  pinnedFeedCount: number;
  pinnedFeedIds: string[];
  pinnedNotificationCount: number;
  pinnedNotificationIds: string[];
  pinnedProfileCount: number;
  pinnedSearchCount: number;
  columns: ColumnVisibility;
  onClearLocalData: () => void | Promise<void>;
  onCreateLocalList: (name: string, description: string) => void;
  onDensityChange: (density: DensityMode) => void;
  onFeedDensityOverrideChange: (source: FeedSource, density: DensityMode | null) => void;
  showMediaByFeed: Record<string, boolean>;
  onFeedShowMediaOverrideChange: (source: FeedSource, value: boolean | null) => void;
  onDeleteLocalList: (id: string) => void;
  onOpenFeed: (source: FeedSource) => void;
  onOpenProfile: (profile: Profile) => void;
  onOpenPostByUri: (uri: string, actor: string) => void;
  onNotificationsSeen: () => void;
  onOpenSelfTab: (tab: ProfileTab) => void;
  onOpenSurfaceNav: (item: string) => void;
  onReauthorize: () => void;
  homeSourceId: string;
  homeOptions: HomeOption[];
  onHomeSourceChange: (id: string) => void;
  onOpenSearch: () => void;
  onOpenSearchQuery: (query: string) => void;
  onSignIn: (handle: string) => void | Promise<void>;
  onSignOut: () => void | Promise<void>;
  onTogglePinnedFeed: (source: FeedSource) => void;
  onTogglePinnedNotification: (id: string) => void;
  onSetColumnVisible: (which: keyof ColumnVisibility, visible: boolean) => void;
  showNsfw: boolean;
  onToggleNsfw: () => void;
  showMedia: boolean;
  onToggleShowMedia: () => void;
  contentLanguages: string[];
  onSelectAnyContentLanguage: () => void;
  onToggleContentLanguage: (code: string) => void;
  canFollowFeeds: boolean;
  subscribedFeeds: FeedSource[];
  onMoveFeed: (uri: string, direction: -1 | 1) => void;
  onReorderFeed: (fromUri: string, toUri: string) => void;
  followedFeedUris: Set<string>;
  followBusyUri: string | null;
  onToggleFollowFeed: (feedUri: string, label?: string) => void;
}) {
  const title = name.charAt(0).toUpperCase() + name.slice(1);
  // Tracks the saved feed currently being dragged for reorder (drop highlight).
  const [draggingFeedUri, setDraggingFeedUri] = useState<string | null>(null);
  const canReorderFeeds = !!auth.session && subscribedFeeds.length > 1;
  // Link to the user's PDS/entryway account-management page (/account on the OAuth
  // authorization server) — sessions, authorized apps, password. Resolved from the
  // live session; null until loaded or when signed out. See getAccountManagementUrl.
  const [accountManagementUrl, setAccountManagementUrl] = useState<string | null>(null);
  const signedInDidForAccount = auth.session?.did;
  useEffect(() => {
    if (!signedInDidForAccount) {
      setAccountManagementUrl(null);
      return;
    }
    let cancelled = false;
    getAccountManagementUrl()
      .then((url) => {
        if (!cancelled) {
          setAccountManagementUrl(url);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAccountManagementUrl(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [signedInDidForAccount]);
  const surfaces: Record<string, { copy: string; cards: Array<{ title: string; detail: string; status: string }> }> = {
    explore: {
      copy: "Search posts, people, and feeds, or jump into a trending topic. To browse and discover feeds, use the Feeds page.",
      cards: [],
    },
    feeds: {
      copy: "Your saved Bluesky feeds, the built-in feeds, and popular feeds to discover. Open any feed as a timeline, pin it to the top of the selector, or follow/unfollow it on your account.",
      cards: [
        { title: "Pinned Feeds", detail: "Local pins keep important destinations at the top of the selector, stored only in this browser.", status: "Local" },
        { title: "Discover New Feeds", detail: "Feed search opens known public Feed sources immediately.", status: "Active" },
        { title: "Follow Feeds", detail: "Following a feed saves it to your Bluesky account; the Following control writes through your session.", status: "Active" },
      ],
    },
  };
  const surface = surfaces[name] || {
    copy: "This signed-in destination has a stable static route and is ready for OAuth-backed data.",
    cards: [{ title: "Static Route", detail: "The SPA fallback can serve this destination without server code.", status: "Ready" }],
  };
  const builtInFeeds = feedSources.filter((source) => !subscribedFeeds.some((subscribed) => subscribed.uri === source.uri));

  if (name === "settings") {
    return (
      <div className="timeline comfortable">
        <section className="surface-placeholder">
          <h2>Settings</h2>
          <p>Local reader preferences and account/session controls live here. No BigBsky backend storage is used for v1 reader data.</p>
        </section>
        <section className="settings-grid" aria-label="Settings sections">
          <article className="settings-panel">
            <span>Home</span>
            <h3>Home Page</h3>
            <p>Choose what the house icon and bigbsky.com open. Following needs sign-in; if you&apos;re signed out, Home falls back to Discover so it never breaks.</p>
            <div className="settings-select" role="group" aria-label="Home page feed">
              <span id="home-picker-label">Open Home to</span>
              <HomeSourcePicker
                value={homeSourceId}
                options={homeOptions}
                signedIn={!!auth.session}
                onChange={onHomeSourceChange}
              />
            </div>
            {homeSourceId !== "discover" && !auth.session && (
              <p className="settings-note">Signed out — Home currently shows Discover until you sign in.</p>
            )}
          </article>
          <article className="settings-panel">
            <span>Active</span>
            <h3>Appearance</h3>
            <dl>
              <div>
                <dt>Default density</dt>
                <dd>{defaultDensity}</dd>
              </div>
              <div>
                <dt>Saved preference keys</dt>
                <dd>{savedPreferenceCount.toLocaleString()}</dd>
              </div>
            </dl>
            <p>Default density applies to feeds without their own view override.</p>
            <div className="settings-control-group" aria-label="Default reading density setting">
              {densityModes.map((mode) => (
                <button
                  className={defaultDensity === mode ? "selected-setting" : ""}
                  key={mode}
                  type="button"
                  disabled={mode === "media" && !showMedia}
                  onClick={() => onDensityChange(mode)}
                >
                  {mode}
                </button>
              ))}
            </div>
            {!showMedia && <p className="settings-note">Media density needs Show Media on.</p>}
            <p className="settings-note">Per-feed view overrides are managed on the Feeds page.</p>
            <p>Side columns are optional. Hide either to give the reader more room — the X on a column hides it, and these toggles bring it back. The far-left icon rail always stays.</p>
            <SettingsToggle
              checked={columns.feeds}
              label={columns.feeds ? "Feeds column shown" : "Feeds column hidden"}
              onChange={() => onSetColumnVisible("feeds", !columns.feeds)}
            />
            <SettingsToggle
              checked={columns.right}
              label={columns.right ? "Right column shown" : "Right column hidden"}
              onChange={() => onSetColumnVisible("right", !columns.right)}
            />
            <p className="settings-note">Stored locally in this browser. On narrow screens these columns hide automatically to fit.</p>
          </article>
          <article className="settings-panel">
            <span>{showMedia ? "On" : "Off"}</span>
            <h3>Media</h3>
            <p>On by default. Turn off for text-only reading: media becomes a per-post reveal control.</p>
            <SettingsToggle
              checked={showMedia}
              label={showMedia ? "Showing media" : "Hiding media"}
              onChange={onToggleShowMedia}
            />
            <p>Adult / graphic media is off by default. Enabling asks for a local confirmation, not your birthday. BigBSky does not store this on a server; it only changes how this browser displays Bluesky-hosted labeled media. Use Bluesky&apos;s moderation settings for account-wide content filtering.</p>
            <SettingsToggle
              checked={showNsfw}
              label={showNsfw ? "Showing adult / graphic media" : "Hiding adult / graphic media"}
              onChange={onToggleNsfw}
            />
            <a className="settings-link" href="https://bsky.app/moderation" target="_blank" rel="noreferrer">
              Open Bluesky moderation settings
            </a>
            <p className="settings-note">Both preferences are stored locally in this browser only.</p>
          </article>
          <article className="settings-panel">
            <span>{contentLanguages.length === 0 ? "Any" : `${contentLanguages.length} selected`}</span>
            <h3>Show posts from language</h3>
            <p>Filter the posts you see down to the languages you read. Only custom feeds (including Discover) are filtered — your Following timeline and Lists are left alone.</p>
            <div className="settings-control-group" aria-label="Content languages">
              <button
                type="button"
                className={contentLanguages.length === 0 ? "selected-setting" : ""}
                aria-pressed={contentLanguages.length === 0}
                onClick={onSelectAnyContentLanguage}
              >
                Any
              </button>
              {contentLanguages.map((code) => (
                <button
                  key={code}
                  type="button"
                  className="selected-setting"
                  aria-pressed={true}
                  title={`Remove ${languageDisplayName(code)}`}
                  onClick={() => onToggleContentLanguage(code)}
                >
                  {languageDisplayName(code)} ✕
                </button>
              ))}
            </div>
            <label className="settings-select">
              <span>Add a language</span>
              <select
                value=""
                onChange={(event) => {
                  const code = event.target.value;
                  if (code) {
                    onToggleContentLanguage(code);
                  }
                }}
              >
                <option value="">Add a language…</option>
                {POST_LANGUAGE_OPTIONS.filter((option) => !contentLanguages.includes(option.code)).map((option) => (
                  <option key={option.code} value={option.code}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <p className="settings-note">Untagged posts are detected from their text, so short or ambiguous ones may slip through (kept, not hidden). “Any” clears the filter. Stored locally in this browser only.</p>
          </article>
          <article className="settings-panel">
            <span>Local</span>
            <h3>Browser Data</h3>
            <dl>
              <div>
                <dt>Recent trail items</dt>
                <dd>{recentCount.toLocaleString()}</dd>
              </div>
              <div>
                <dt>Bookmarks</dt>
                <dd>Bluesky account</dd>
              </div>
              <div>
                <dt>Pinned feeds</dt>
                <dd>{pinnedFeedCount.toLocaleString()}</dd>
              </div>
              <div>
                <dt>Pinned profiles</dt>
                <dd>{pinnedProfileCount.toLocaleString()}</dd>
              </div>
              <div>
                <dt>Pinned searches</dt>
                <dd>{pinnedSearchCount.toLocaleString()}</dd>
              </div>
              <div>
                <dt>Pinned notifications</dt>
                <dd>{pinnedNotificationCount.toLocaleString()}</dd>
              </div>
              <div>
                <dt>Local lists</dt>
                <dd>{localLists.length.toLocaleString()}</dd>
              </div>
              <div>
                <dt>Storage scope</dt>
                <dd>bigbsky:*</dd>
              </div>
              <div>
                <dt>Local keys</dt>
                <dd>{localDataKeyCount.toLocaleString()}</dd>
              </div>
              <div>
                <dt>OAuth store</dt>
                <dd>IndexedDB</dd>
              </div>
            </dl>
            <p className="settings-note">Clears BigBSky browser-local data on this device only. It does not delete Bluesky account data.</p>
            <button type="button" onClick={onClearLocalData}>
              Clear local reader data
            </button>
          </article>
          <article className={auth.session ? "settings-panel" : "settings-panel settings-account-first"}>
            <span>{auth.session ? "Signed in" : "Signed out"}</span>
            <h3>Account</h3>
            {auth.session ? (
              <>
                <dl>
                  <div>
                    <dt>Handle</dt>
                    <dd>@{auth.session.handle}</dd>
                  </div>
                  <div>
                    <dt>DID</dt>
                    <dd>{auth.session.did}</dd>
                  </div>
                </dl>
                <p>
                  Manage sign-in sessions, review and revoke the apps authorized on your account, and change your
                  password on your hosting provider's account page.
                </p>
                {accountManagementUrl && (
                  <a className="settings-link" href={accountManagementUrl} target="_blank" rel="noreferrer">
                    Manage account &amp; sessions
                  </a>
                )}
                <p>Sign-out revokes the stored OAuth session when possible and always clears local browser auth state.</p>
                <button type="button" onClick={onSignOut}>
                  Sign out
                </button>
              </>
            ) : (
              <>
                <p>Use Bluesky OAuth from the browser. No BigBsky backend session is created.</p>
                <SignInForm status={auth.status} onSignIn={onSignIn} />
              </>
            )}
            {auth.message && <p className={auth.status === "error" ? "settings-warning" : undefined}>{auth.message}</p>}
          </article>
        </section>
      </div>
    );
  }

  if (name === "info") {
    return (
      <Suspense fallback={<LoadingState label="Loading info" />}>
        <InfoPage />
      </Suspense>
    );
  }

  if (name === "lists") {
    return (
      <ListsSurface
        containerRef={containerRef}
        signedIn={!!auth.session}
        signedInDid={signedInDid}
        myLists={myLists}
        myListsStatus={myListsStatus}
        onReloadMyLists={onReloadMyLists}
        onCreateModList={onCreateModList}
        onDeleteModList={onDeleteModList}
        onOpenFeed={onOpenFeed}
        onReauthorize={onReauthorize}
        lists={localLists}
        onCreateList={onCreateLocalList}
        onDeleteList={onDeleteLocalList}
      />
    );
  }

  if ((name === "profile" || name === "notifications") && auth.session) {
    return (
      <SelfProfileSurface
        auth={auth.session}
        pinnedFeedCount={pinnedFeedCount}
        pinnedNotificationIds={pinnedNotificationIds}
        pinnedProfileCount={pinnedProfileCount}
        pinnedSearchCount={pinnedSearchCount}
        localListCount={localLists.length}
        onOpenProfile={onOpenProfile}
        onOpenPostByUri={onOpenPostByUri}
        onOpenSearch={onOpenSearch}
        onOpenSelfTab={onOpenSelfTab}
        onOpenSurfaceNav={onOpenSurfaceNav}
        onNotificationsSeen={onNotificationsSeen}
        onReauthorize={onReauthorize}
        onSignOut={onSignOut}
        onTogglePinnedNotification={onTogglePinnedNotification}
      />
    );
  }

  if (name === "oauth-callback") {
    // Reached by returning from Bluesky's consent screen. Normally initAuthSession
    // resolves the callback and App redirects to Settings within a moment, so this
    // view is only visible while that's in flight — or when the callback failed, in
    // which case we must give the user a way forward instead of a dead placeholder.
    const inFlight = auth.status === "checking" || auth.status === "callback";
    if (inFlight) {
      return (
        <div className="timeline comfortable">
          <section className="surface-placeholder" aria-busy="true">
            <h2>Signing you in…</h2>
            <p>Finishing your Bluesky sign-in. This usually takes a second.</p>
          </section>
        </div>
      );
    }
    // Failed: either an explicit error (auth.message set), or init() returned no
    // session because the OAuth state from before the redirect was missing — e.g.
    // sign-in was started in a different browser/tab or site data was cleared.
    const failureMessage =
      auth.message ??
      "Your sign-in didn't finish. This can happen if it was started in a different browser or tab, or if the connection to Bluesky was interrupted. Try signing in again below.";
    return (
      <div className="timeline comfortable">
        <section className="surface-placeholder">
          <h2>Sign-in didn&apos;t finish</h2>
          <p className="settings-warning">{failureMessage}</p>
        </section>
        <section className="signed-out-signin" aria-label="Sign in">
          <h3>Sign in to Bluesky</h3>
          <SignInForm status={auth.status} onSignIn={onSignIn} />
        </section>
      </div>
    );
  }

  if (name === "profile" || name === "notifications") {
    // Signed out: the Profile destination is where you sign in. (The right-rail
    // Account panel is hidden on mobile, so this is the reachable sign-in entry.)
    return (
      <div className="timeline comfortable">
        <section className="surface-placeholder">
          <h2>Your profile</h2>
          <p>Sign in with your Bluesky account to see your profile and use your follows, likes, lists, posting, and notifications. BigBsky signs in with AT Protocol OAuth in your browser — no BigBsky backend session is created.</p>
        </section>
        <section className="signed-out-signin" aria-label="Sign in">
          <h3>Sign in to Bluesky</h3>
          <SignInForm status={auth.status} onSignIn={onSignIn} />
          {auth.message && <p className={auth.status === "error" ? "settings-warning" : "signed-out-signin-note"}>{auth.message}</p>}
        </section>
        <NotificationsSurface
          auth={auth}
          pinnedFeedCount={pinnedFeedCount}
          pinnedNotificationIds={pinnedNotificationIds}
          pinnedProfileCount={pinnedProfileCount}
          pinnedSearchCount={pinnedSearchCount}
          localListCount={localLists.length}
          onOpenSearch={onOpenSearch}
          onTogglePinnedNotification={onTogglePinnedNotification}
          onOpenPostByUri={onOpenPostByUri}
          onOpenProfile={onOpenProfile}
          onNotificationsSeen={() => {}}
          onReauthorize={onReauthorize}
        />
      </div>
    );
  }

  if (name === "chat") {
    return (
      <div className="timeline comfortable">
        <section className="surface-placeholder">
          <h2>Chat</h2>
          <p>
            BigBsky is a reader and intentionally does not handle direct
            messages. DMs stay on Bluesky, where your conversations and privacy
            controls already live — we don&apos;t request chat permissions or
            store any messages.
          </p>
          <a
            className="surface-action"
            href="https://bsky.app/messages"
            target="_blank"
            rel="noreferrer"
          >
            Open messages on Bluesky
          </a>
        </section>
      </div>
    );
  }

  return (
    <div className="timeline comfortable">
      <section className="surface-placeholder">
        <h2>{title}</h2>
        <p>{surface.copy}</p>
        {name === "explore" && (
          <button className="surface-action" type="button" onClick={onOpenSearch}>
            Open Search
          </button>
        )}
      </section>
      {name === "explore" && <ExploreTrendingTopics onOpenSearchQuery={onOpenSearchQuery} />}
      {name === "feeds" && (
        <>
          <section className="bsky-list-section" aria-label="Your feeds">
            <h3 className="bsky-list-section-heading">Your feeds</h3>
            {canReorderFeeds && (
              <p className="bsky-list-section-hint">
                Drag a feed by its handle, or use the up/down arrows, to set the order it appears here and in the feed selector.
              </p>
            )}
            {!auth.session ? (
              <EmptyState
                title="Sign in to see your feeds"
                message="Your saved Bluesky feeds load here once you sign in. Browse the built-in and popular feeds below in the meantime."
              />
            ) : subscribedFeeds.length === 0 ? (
              <EmptyState
                title="No saved feeds yet"
                message="Follow a feed below (or from any feed's header) and it shows up here and in the feed selector."
              />
            ) : (
              <div className="feed-directory-grid">
                {subscribedFeeds.map((source, index) => {
                  const override = feedDensityOverride(source, densityByContext);
                  const mediaOverride = feedShowMediaOverride(source, showMediaByFeed);
                  const feedShowMedia = mediaOverride ?? showMedia;
                  return (
                    <article
                      className={
                        draggingFeedUri && draggingFeedUri !== source.uri
                          ? "feed-directory-card reorderable drop-target"
                          : canReorderFeeds
                            ? "feed-directory-card reorderable"
                            : "feed-directory-card"
                      }
                      key={source.id}
                      onDragOver={
                        canReorderFeeds
                          ? (event) => {
                              event.preventDefault();
                              event.dataTransfer.dropEffect = "move";
                            }
                          : undefined
                      }
                      onDrop={
                        canReorderFeeds
                          ? (event) => {
                              event.preventDefault();
                              const fromUri = event.dataTransfer.getData("text/plain");
                              if (fromUri) {
                                onReorderFeed(fromUri, source.uri);
                              }
                              setDraggingFeedUri(null);
                            }
                          : undefined
                      }
                    >
                      {canReorderFeeds && (
                        <div
                          className="feed-card-reorder"
                          draggable
                          onDragStart={(event) => {
                            event.dataTransfer.setData("text/plain", source.uri);
                            event.dataTransfer.effectAllowed = "move";
                            setDraggingFeedUri(source.uri);
                          }}
                          onDragEnd={() => setDraggingFeedUri(null)}
                          title="Drag to reorder"
                        >
                          <span className="feed-card-grip" aria-hidden="true">
                            <GripVertical size={14} />
                          </span>
                          <button
                            className="feed-move"
                            type="button"
                            disabled={index === 0}
                            onClick={() => onMoveFeed(source.uri, -1)}
                            aria-label={`Move ${source.label} up`}
                            title="Move up"
                          >
                            <ChevronUp size={14} />
                          </button>
                          <button
                            className="feed-move"
                            type="button"
                            disabled={index === subscribedFeeds.length - 1}
                            onClick={() => onMoveFeed(source.uri, 1)}
                            aria-label={`Move ${source.label} down`}
                            title="Move down"
                          >
                            <ChevronDown size={14} />
                          </button>
                        </div>
                      )}
                      <button type="button" onClick={() => onOpenFeed(source)}>
                        <span>{source.group}</span>
                        <strong>{source.label}</strong>
                        <small>{source.description}</small>
                      </button>
                      <FeedDensityOverrideControl
                        source={source}
                        defaultDensity={defaultDensity}
                        override={override}
                        showMedia={feedShowMedia}
                        onChange={onFeedDensityOverrideChange}
                      />
                      <FeedShowMediaOverrideControl
                        source={source}
                        defaultShowMedia={showMedia}
                        override={mediaOverride}
                        onChange={onFeedShowMediaOverrideChange}
                      />
                      <div className="feed-directory-card-actions">
                        <button
                          className={pinnedFeedIds.includes(source.id) ? "directory-pin pinned" : "directory-pin"}
                          type="button"
                          onClick={() => onTogglePinnedFeed(source)}
                        >
                          {pinnedFeedIds.includes(source.id) ? "Pinned" : "Pin locally"}
                        </button>
                        {canFollowFeeds && (
                          <button
                            type="button"
                            className="directory-unfollow"
                            onClick={() => onToggleFollowFeed(source.uri, source.label)}
                            disabled={followBusyUri === source.uri}
                          >
                            {followBusyUri === source.uri ? "…" : "Following"}
                          </button>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
          <section className="bsky-list-section" aria-label="Built-in feeds">
            <h3 className="bsky-list-section-heading">Built-in feeds</h3>
            <div className="feed-directory-grid">
              {builtInFeeds.map((source) => {
                const override = feedDensityOverride(source, densityByContext);
                const mediaOverride = feedShowMediaOverride(source, showMediaByFeed);
                const feedShowMedia = mediaOverride ?? showMedia;
                return (
                  <article className="feed-directory-card" key={source.id}>
                    <button type="button" onClick={() => onOpenFeed(source)}>
                      <span>{source.group}</span>
                      <strong>{source.label}</strong>
                      <small>{source.description}</small>
                    </button>
                    <FeedDensityOverrideControl
                      source={source}
                      defaultDensity={defaultDensity}
                      override={override}
                      showMedia={feedShowMedia}
                      onChange={onFeedDensityOverrideChange}
                    />
                    <FeedShowMediaOverrideControl
                      source={source}
                      defaultShowMedia={showMedia}
                      override={mediaOverride}
                      onChange={onFeedShowMediaOverrideChange}
                    />
                    <button
                      className={pinnedFeedIds.includes(source.id) ? "directory-pin pinned" : "directory-pin"}
                      type="button"
                      onClick={() => onTogglePinnedFeed(source)}
                    >
                      {pinnedFeedIds.includes(source.id) ? "Pinned" : "Pin locally"}
                    </button>
                  </article>
                );
              })}
            </div>
          </section>
          <ExploreDiscoverFeeds
            onOpenFeed={onOpenFeed}
            pinnedFeedIds={pinnedFeedIds}
            onTogglePinnedFeed={onTogglePinnedFeed}
            canFollowFeeds={canFollowFeeds}
            followedFeedUris={followedFeedUris}
            followBusyUri={followBusyUri}
            onToggleFollowFeed={onToggleFollowFeed}
          />
        </>
      )}
      {name !== "feeds" && surface.cards.length > 0 && (
        <section className="surface-grid" aria-label={`${title} sections`}>
          {surface.cards.map((card) => (
            <article className="surface-card" key={card.title}>
              <span>{card.status}</span>
              <h3>{card.title}</h3>
              <p>{card.detail}</p>
            </article>
          ))}
        </section>
      )}
    </div>
  );
}

function SelfProfileSurface({
  auth,
  pinnedFeedCount,
  pinnedNotificationIds,
  pinnedProfileCount,
  pinnedSearchCount,
  localListCount,
  onOpenProfile,
  onOpenPostByUri,
  onOpenSearch,
  onOpenSelfTab,
  onOpenSurfaceNav,
  onNotificationsSeen,
  onReauthorize,
  onSignOut,
  onTogglePinnedNotification,
}: {
  auth: AuthSnapshot;
  pinnedFeedCount: number;
  pinnedNotificationIds: string[];
  pinnedProfileCount: number;
  pinnedSearchCount: number;
  localListCount: number;
  onOpenProfile: (profile: Profile) => void;
  onOpenPostByUri: (uri: string, actor: string) => void;
  onOpenSearch: () => void;
  onOpenSelfTab: (tab: ProfileTab) => void;
  onOpenSurfaceNav: (item: string) => void;
  onNotificationsSeen: () => void;
  onReauthorize: () => void;
  onSignOut: () => void | Promise<void>;
  onTogglePinnedNotification: (id: string) => void;
}) {
  const bskyProfileUrl = `https://bsky.app/profile/${encodeURIComponent(auth.handle || "")}`;
  // Each shortcut navigates somewhere real — own-profile tabs, app surfaces, or
  // out to Bluesky for things BigBsky delegates rather than builds.
  const shortcuts: Array<{ title: string; detail: string; cta: string; onClick?: () => void; href?: string }> = [
    { title: "New post", detail: "Open the profile composer.", cta: "Compose", onClick: () => onOpenSelfTab("new-post") },
    { title: "Posts", detail: "Your posts in the profile reader.", cta: "Open", onClick: () => onOpenSelfTab("posts") },
    { title: "Replies", detail: "Your replies tab.", cta: "Open", onClick: () => onOpenSelfTab("replies") },
    { title: "Media", detail: "Just your image and video posts.", cta: "Open", onClick: () => onOpenSelfTab("media") },
    { title: "Feeds", detail: "Your saved and pinned feeds.", cta: "Open", onClick: () => onOpenSelfTab("feeds") },
    { title: "Lists", detail: "Lists you created and subscribe to.", cta: "Open Lists", onClick: () => onOpenSurfaceNav("Lists") },
    { title: "Bookmarks", detail: "Posts you bookmarked on Bluesky, synced with your account.", cta: "Open Bookmarks", onClick: () => onOpenSurfaceNav("Bookmarks") },
    { title: "Likes", detail: "Your liked posts (opens on Bluesky).", cta: "Open on Bluesky", href: `${bskyProfileUrl}/likes` },
  ];

  return (
    <div className="timeline comfortable">
      <section className="self-profile-card">
        <div className="account-identity">
          <Avatar profile={auth} />
          <span>
            <strong>{auth.displayName || auth.handle}</strong>
            <small>@{auth.handle}</small>
          </span>
        </div>
        <dl>
          <div>
            <dt>Followers</dt>
            <dd>{auth.followersCount?.toLocaleString() ?? "-"}</dd>
          </div>
          <div>
            <dt>Following</dt>
            <dd>{auth.followsCount?.toLocaleString() ?? "-"}</dd>
          </div>
          <div>
            <dt>Posts</dt>
            <dd>{auth.postsCount?.toLocaleString() ?? "-"}</dd>
          </div>
        </dl>
        <div className="self-profile-actions">
          <button type="button" className="self-profile-primary" onClick={() => onOpenSelfTab("posts")}>
            Open Profile on BigBsky
          </button>
          <a className="self-profile-action-link" href={bskyProfileUrl} target="_blank" rel="noreferrer" title="Open your profile on Bluesky">
            Open Profile on Bluesky
          </a>
          <button type="button" className="self-profile-signout" onClick={onSignOut}>
            <LogOut size={16} /> Sign out
          </button>
        </div>
      </section>
      <section className="self-profile-tabs" aria-label="Profile shortcuts">
        {shortcuts.map((shortcut) =>
          shortcut.href ? (
            <a className="self-profile-tab-card" key={shortcut.title} href={shortcut.href} target="_blank" rel="noreferrer">
              <h3>{shortcut.title}</h3>
              <p>{shortcut.detail}</p>
              <span className="self-profile-tab-cta">{shortcut.cta}</span>
            </a>
          ) : (
            <button className="self-profile-tab-card" key={shortcut.title} type="button" onClick={shortcut.onClick}>
              <h3>{shortcut.title}</h3>
              <p>{shortcut.detail}</p>
              <span className="self-profile-tab-cta">{shortcut.cta}</span>
            </button>
          ),
        )}
      </section>
      <NotificationsSurface
        auth={{ status: "signed-in", session: auth }}
        pinnedFeedCount={pinnedFeedCount}
        pinnedNotificationIds={pinnedNotificationIds}
        pinnedProfileCount={pinnedProfileCount}
        pinnedSearchCount={pinnedSearchCount}
        localListCount={localListCount}
        onOpenSearch={onOpenSearch}
        onTogglePinnedNotification={onTogglePinnedNotification}
        onOpenPostByUri={onOpenPostByUri}
        onOpenProfile={onOpenProfile}
        onNotificationsSeen={onNotificationsSeen}
        onReauthorize={onReauthorize}
      />
    </div>
  );
}

// Bookmarks read Bluesky's native bookmark feature for the signed-in account
// (app.bsky.bookmark.getBookmarks) instead of a browser-local list. The
// Bookmark action on each card writes through the authenticated bookmark API,
// so this list and bsky.app stay in sync. The per-card Bookmark/Bookmarked
// toggle comes from BookmarkContext (consumed inside PostCard), not props.
function BookmarksView({
  containerRef,
  currentDid,
  localLists,
  signedIn,
  onOpenImage,
  onOpenPost,
  onOpenProfile,
  onToggleListPost,
  scrollAnchor,
  scrollFallbackTarget,
  onAnchorRestored,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  currentDid?: string;
  localLists: LocalList[];
  signedIn: boolean;
  onOpenImage: (image: ImageViewerState) => void;
  onOpenPost: (post: FeedPost) => void;
  onOpenProfile: (profile: Profile) => void;
  onToggleListPost: (listId: string, post: FeedPost) => void;
  scrollAnchor?: ScrollAnchor | null;
  scrollFallbackTarget?: number;
  onAnchorRestored?: () => void;
}) {
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [items, setItems] = useState<FeedItem[]>([]);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | undefined>(undefined);
  // Aborts an in-flight load-more when the surface unmounts so its fetch +
  // thread hydration don't run to completion after navigation.
  const loadMoreControllerRef = useRef<AbortController | null>(null);
  useEffect(() => () => loadMoreControllerRef.current?.abort(), []);

  useEffect(() => {
    if (!signedIn) {
      setStatus("idle");
      setItems([]);
      setCursor(undefined);
      return undefined;
    }
    const controller = new AbortController();
    const { signal } = controller;
    setStatus("loading");
    void (async () => {
      try {
        const response = await getBookmarks(undefined, signal);
        const hydratedItems = await hydrateProfileSelfThreads(response.feed, signal);
        if (signal.aborted) {
          return;
        }
        setItems(hydratedItems);
        setCursor(response.cursor);
        setStatus("ready");
      } catch {
        if (!signal.aborted) {
          setStatus("error");
        }
      }
    })();
    return () => {
      controller.abort();
    };
  }, [signedIn]);

  const loadMore = () => {
    if (!cursor || loadingMore) {
      return;
    }
    setLoadingMore(true);
    setLoadMoreError(undefined);
    const controller = new AbortController();
    loadMoreControllerRef.current = controller;
    const { signal } = controller;
    void (async () => {
      try {
        const response = await getBookmarks(cursor, signal);
        const hydratedItems = await hydrateProfileSelfThreads(response.feed, signal);
        if (signal.aborted) {
          return;
        }
        setItems((current) => [...current, ...hydratedItems]);
        setCursor(response.cursor);
      } catch (error) {
        if (signal.aborted) {
          return;
        }
        // Keep what we have and surface the error so AutoLoadMoreButton stops
        // auto-firing (which would hammer a rate-limited endpoint) and shows an
        // explicit Retry instead.
        setLoadMoreError(rateLimitMessage(error));
      } finally {
        if (!signal.aborted) {
          setLoadingMore(false);
        }
      }
    })();
  };

  return (
    <div className="timeline comfortable" ref={containerRef}>
      <section className="surface-placeholder">
        <h2>Bookmarks</h2>
        <p>Posts you bookmark on Bluesky. Bookmarks are synced with your account and also appear on bsky.app.</p>
      </section>
      {!signedIn ? (
        <EmptyState
          title="Sign in to see your bookmarks"
          message="Bookmarks use Bluesky's native bookmark feature. Sign in from Settings to bookmark posts and read them here."
        />
      ) : status === "loading" ? (
        <LoadingState label="Loading your bookmarks" />
      ) : status === "error" ? (
        <ErrorState message="Couldn't load bookmarks. If you just updated permissions, re-authorize from Settings, then try again." />
      ) : items.length === 0 ? (
        <EmptyState title="No bookmarks yet" message="Use the Bookmark action on any post to save it to your Bluesky account." />
      ) : (
        <VirtualPostList
          containerRef={containerRef}
          currentDid={currentDid}
          density="comfortable"
          items={items}
          localLists={localLists}
          onOpenImage={onOpenImage}
          onOpenPost={onOpenPost}
          onOpenProfile={onOpenProfile}
          onToggleListPost={onToggleListPost}
          onRenderedRowsChange={() => undefined}
          scrollAnchor={scrollAnchor}
          scrollFallbackTarget={scrollFallbackTarget}
          onAnchorRestored={onAnchorRestored}
        >
          {cursor && <AutoLoadMoreButton label="Load more bookmarks" onLoadMore={loadMore} error={loadMoreError} />}
          {!cursor && !loadMoreError && <EndOfFeedCard />}
        </VirtualPostList>
      )}
    </div>
  );
}

function SearchView({
  actorSearchState,
  feedSearchState,
  currentDid,
  feedSources,
  language,
  localLists,
  query,
  searchState,
  sort,
  tab,
  isPinnedSearch,
  onLoadMore,
  onLanguageChange,
  onOpenFeed,
  onOpenImage,
  onOpenPost,
  onOpenProfile,
  onQueryChange,
  onSearch,
  onClearSearch,
  onSortChange,
  onTabChange,
  onTogglePinnedSearch,
  onToggleListPost,
}: {
  actorSearchState: ActorSearchState;
  feedSearchState: FeedSearchState;
  currentDid?: string;
  feedSources: FeedSource[];
  language: string;
  localLists: LocalList[];
  query: string;
  searchState: SearchState;
  sort: "top" | "latest";
  tab: (typeof searchTabs)[number];
  isPinnedSearch: boolean;
  onLoadMore: () => void;
  onLanguageChange: (language: string) => void;
  onToggleListPost: (listId: string, post: FeedPost) => void;
  onOpenFeed: (source: FeedSource) => void;
  onOpenImage: (image: ImageViewerState) => void;
  onOpenPost: (post: FeedPost) => void;
  onOpenProfile: (profile: Profile) => void;
  onQueryChange: (query: string) => void;
  onSearch: (query: string) => void;
  onClearSearch: () => void;
  onSortChange: (sort: "top" | "latest") => void;
  onTabChange: (tab: (typeof searchTabs)[number]) => void;
  onTogglePinnedSearch: (query: string) => void;
}) {
  const feedResults = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return feedSources;
    }

    return feedSources.filter((source) => feedSourceMatches(source, normalizedQuery));
  }, [feedSources, query]);

  // When the NSFW preference is hidden, drop adult/graphic-labeled posts from
  // search results entirely (like the feed/profile timelines) rather than only
  // gating their media — a bad record in search is the highest-impact leak.
  const showNsfw = useContext(ShowNsfwContext);
  const visiblePosts = useMemo(
    () => (showNsfw ? searchState.posts : searchState.posts.filter((post) => !isAdultPost(post))),
    [searchState.posts, showNsfw],
  );

  return (
    <div className="timeline comfortable">
      <form
        className="search-workspace"
        onSubmit={(event) => {
          event.preventDefault();
          onSearch(query);
        }}
      >
        <Search size={18} />
        <input
          aria-label="Search Bluesky"
          placeholder="Search posts, hashtags, or paste a post URL"
          value={query}
          onInput={(event) => onQueryChange(event.currentTarget.value)}
        />
        <button className="clear-search-button" type="button" onClick={onClearSearch} disabled={!query.trim()} aria-label="Clear search">
          <X size={16} />
        </button>
        <button
          className={isPinnedSearch ? "clear-search-button pinned" : "clear-search-button"}
          type="button"
          onClick={() => onTogglePinnedSearch(query)}
          disabled={!query.trim()}
          aria-label={isPinnedSearch ? "Unpin search" : "Pin search"}
          title={isPinnedSearch ? "Unpin search" : "Pin search locally"}
        >
          <Bookmark size={16} />
        </button>
        <div className="segmented" aria-label="Search tabs">
          {searchTabs.map((mode) => (
            <button
              className={tab === mode ? "selected" : ""}
              key={mode}
              type="button"
              onClick={() => onTabChange(mode)}
            >
              {mode}
            </button>
          ))}
        </div>
        {tab === "posts" && (
          <div className="search-options">
            <div className="segmented" aria-label="Search sort">
              {(["top", "latest"] as const).map((mode) => (
                <button
                  className={sort === mode ? "selected" : ""}
                  key={mode}
                  type="button"
                  onClick={() => onSortChange(mode)}
                >
                  {mode}
                </button>
              ))}
            </div>
            <select aria-label="Search language" value={language} onChange={(event) => onLanguageChange(event.currentTarget.value)}>
              {searchLanguages.map((option) => (
                <option key={option.value || "any"} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        )}
      </form>

      {tab === "feeds" && (
        <>
          {feedResults.length > 0 && (
            <section className="search-results-list" aria-label="Local Feed destinations">
              <h3 className="search-section-heading">Local Feed destinations</h3>
              {feedResults.map((source) => (
                <button className="feed-result-card" key={source.id} type="button" onClick={() => onOpenFeed(source)}>
                  <span>{source.group}</span>
                  <strong>{source.label}</strong>
                  <small>{source.description}</small>
                </button>
              ))}
            </section>
          )}

          <section className="search-results-list" aria-label="Public Feed results">
            <h3 className="search-section-heading">Public Feeds on Bluesky</h3>
            {feedSearchState.status === "idle" && (
              <EmptyState title="Search public Feeds" message="Enter a term to find public Feeds across Bluesky." />
            )}
            {feedSearchState.status === "loading" && <LoadingState label="Searching public Feeds" />}
            {feedSearchState.status === "error" && <ErrorState message={feedSearchState.error || "Public Feed search failed to load."} />}
            {feedSearchState.status === "rate-limit" && <RateLimitState message={feedSearchState.error} />}
            {feedSearchState.status === "ready" && feedSearchState.feeds.length === 0 && (
              <EmptyState title="No public Feeds found" message="Try a broader term." />
            )}
            {feedSearchState.status === "ready" &&
              feedSearchState.feeds.map((feed) => (
                <button
                  className="feed-result-card"
                  key={feed.uri}
                  type="button"
                  onClick={() =>
                    onOpenFeed({
                      id: feed.uri,
                      uri: feed.uri,
                      label: feed.displayName || "Public Feed",
                      group: "Discovered",
                      description: feed.description || "Public Bluesky feed opened from search.",
                    })
                  }
                >
                  <span>by @{feed.creator?.handle ?? "unknown"}</span>
                  <strong>{feed.displayName || "Public Feed"}</strong>
                  {feed.description && <small>{feed.description}</small>}
                </button>
              ))}
          </section>
        </>
      )}

      {tab === "people" && (
        <>
          {actorSearchState.status === "idle" && <EmptyState title="Search people" message="Enter a handle, name, or keyword to search public profiles." />}
          {actorSearchState.status === "loading" && <LoadingState label="Searching public profiles" />}
          {actorSearchState.status === "error" && <ErrorState message={actorSearchState.error || "Profile search failed to load."} />}
          {actorSearchState.status === "rate-limit" && <RateLimitState message={actorSearchState.error} />}
          {actorSearchState.status === "ready" && actorSearchState.actors.length === 0 && (
            <EmptyState title="No people found" message="Try a broader name or handle." />
          )}
          {actorSearchState.status === "ready" && actorSearchState.actors.length > 0 && (
            <section className="search-results-list" aria-label="People search results">
              {actorSearchState.actors.map((actor) => (
                <button className="profile-result-card" key={actor.did} type="button" onClick={() => onOpenProfile(actor)}>
                  <Avatar profile={actor} />
                  <span>
                    <strong>{displayName(actor)}</strong>
                    <small>@{actor.handle}</small>
                    {actor.description && <em>{actor.description}</em>}
                  </span>
                </button>
              ))}
              {actorSearchState.cursor && (
                <AutoLoadMoreButton label="Load more people" onLoadMore={onLoadMore} error={actorSearchState.loadMoreError} />
              )}
            </section>
          )}
        </>
      )}

      {tab === "posts" && (
        <>
          {searchState.status === "idle" && <EmptyState title="Search public posts" message="Enter a term to search Bluesky without signing in." />}
          {searchState.status === "loading" && <LoadingState label="Searching public Bluesky posts" />}
          {searchState.status === "error" && <ErrorState message={searchState.error || "Search failed to load."} />}
          {searchState.status === "rate-limit" && <RateLimitState message={searchState.error} />}
          {searchState.status === "ready" && visiblePosts.length === 0 && (
            <EmptyState title="No posts found" message="Try a broader query or switch between top and latest results." />
          )}
          {searchState.status === "ready" && visiblePosts.length > 0 && (
            <>
              {visiblePosts.map((post) => (
                <PostCard
                  item={{ post }}
                  currentDid={currentDid}
                  key={post.uri}
                  onOpenImage={onOpenImage}
                  onOpenPost={onOpenPost}
                  onOpenProfile={onOpenProfile}
                  localLists={localLists}
                  onToggleListPost={onToggleListPost}
                />
              ))}
              {searchState.cursor && (
                <AutoLoadMoreButton label="Load more search posts" onLoadMore={onLoadMore} error={searchState.loadMoreError} />
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

function SettingsToggle({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      className={checked ? "settings-toggle on" : "settings-toggle"}
      role="switch"
      aria-checked={checked}
      onClick={onChange}
    >
      <span className="settings-toggle-track" aria-hidden="true">
        <span className="settings-toggle-thumb" />
      </span>
      <span>{label}</span>
    </button>
  );
}

function PostCardHeader({
  profile,
  post,
  timestampLabel,
  onOpenProfile,
  onOpenPost,
}: {
  profile: Profile;
  post: FeedPost;
  timestampLabel: string;
  onOpenProfile?: (profile: Profile) => void;
  onOpenPost?: (post: FeedPost) => void;
}) {
  return (
    <header className="post-header">
      <Avatar profile={profile} />
      <div className="post-author-block">
        <a
          className="author-button"
          href={profilePath(profile)}
          onClick={(event) => onOpenProfile && handleInternalLinkClick(event, () => onOpenProfile(profile))}
        >
          <strong>{displayName(profile)}</strong>
        </a>
        <div className="post-byline">
          <span>@{profile.handle}</span>
          <span aria-hidden="true">·</span>
          <a
            className="post-timestamp"
            href={postPath(post) ?? postBskyUrl(post)}
            onClick={(event) => onOpenPost && handleInternalLinkClick(event, () => onOpenPost(post))}
            title={`Open thread posted ${timestampLabel}`}
            aria-label={`Open thread posted ${timestampLabel}`}
          >
            {timestampLabel}
          </a>
        </div>
      </div>
    </header>
  );
}

function ThreadedPostCard({
  thread,
  onOpenImage,
  onOpenPost,
  onOpenProfile,
  onReply,
  replyActive = false,
  onQuote,
  quoteActive = false,
}: {
  thread: ThreadedFeedItem;
  onOpenImage?: (image: ImageViewerState) => void;
  onOpenPost?: (post: FeedPost) => void;
  onOpenProfile?: (profile: Profile) => void;
  onReply?: (post: FeedPost) => void;
  replyActive?: boolean;
  onQuote?: (post: FeedPost) => void;
  quoteActive?: boolean;
}) {
  const onOpenTag = useContext(TagSearchContext);
  const likeCtx = useContext(LikeContext);
  const bookmarkCtx = useContext(BookmarkContext);
  const posts = [thread.root.post, ...thread.replies.map((item) => item.post)];
  const rootPost = thread.root.post;
  const { shareState, handleShare } = useSharePost(rootPost, posts);
  const likeView = likeCtx?.getState(rootPost);
  const bookmarkView = bookmarkCtx?.getState(rootPost);
  const postTimeLabel = formatPostTime(postSortAt(rootPost));
  const { replyCount, repostCount, quoteCount, liveLikeCount, hideThreadMarkers } = combinedThreadStats(posts, rootPost, likeView);
  const { showReplyLimited, handleReplyClick } = useReplyGate(rootPost, onReply);

  return (
    <article className="post-card thread-combined-card text-only">
      <PostCardHeader
        profile={rootPost.author}
        post={rootPost}
        timestampLabel={postTimeLabel}
        onOpenProfile={onOpenProfile}
        onOpenPost={onOpenPost}
      />
      <button type="button" className="thread-open-chip" onClick={() => onOpenPost?.(rootPost)} title="Open full thread">
        <MessageCircle size={13} />
        <span>{posts.length} post thread</span>
      </button>
      <div className="combined-thread-text">
        {posts.map((post, index) => {
          const segment = combinedThreadSegment(post, hideThreadMarkers);
          // Mirror the thread-view CombinedThreadViewCard: render the full embed
          // set (link cards, quotes, unsupported-embed notices), not just media,
          // so a self-thread part carrying a link card or quote isn't silently
          // dropped from the feed. Skip a part that has neither text nor embeds.
          const hasEmbeds = postHasEmbeds(post);
          if (!segment.text && !hasEmbeds) {
            return null;
          }
          return (
            <section className="combined-thread-segment" key={post.uri}>
              <p className={postTextClass(segment.text)}>
                {index > 0 && <span className="combined-thread-break" aria-hidden="true" />}
                {segment.text
                  ? renderRichText(segment.text, segment.facets, onOpenProfile, onOpenTag)
                  : `Post ${index + 1} has no plain text.`}
              </p>
              <PostEmbeds
                post={post}
                onOpenImage={onOpenImage}
                onOpenPost={onOpenPost}
                onOpenProfile={onOpenProfile}
              />
            </section>
          );
        })}
      </div>
      <footer className="post-actions combined-thread-actions">
        <button type="button" onClick={() => onOpenPost?.(rootPost)} title="Open full thread replies">
          <MessageCircle size={16} /> {replyCount}
        </button>
        <span title="Total reposts across combined posts">
          <Repeat2 size={16} /> {repostCount}
        </span>
        <span title="Total quotes across combined posts">
          <Share2 size={16} /> {quoteCount}
        </span>
        {likeCtx?.canLike && likeView ? (
          <button
            type="button"
            className={likeView.liked ? "liked" : ""}
            onClick={() => likeCtx.toggle(rootPost)}
            title={likeView.liked ? "Unlike first post" : "Like first post"}
          >
            <Heart size={16} /> {liveLikeCount}
          </button>
        ) : (
          <span title="Total likes across combined posts">
            <Heart size={16} /> {liveLikeCount}
          </span>
        )}
        {bookmarkCtx?.canBookmark && bookmarkView && (
          <button
            type="button"
            className={bookmarkView.error ? "bookmark-error" : bookmarkView.bookmarked ? "bookmarked" : ""}
            onClick={() => bookmarkCtx.toggle(rootPost)}
            title={bookmarkView.error || (bookmarkView.bookmarked ? "Remove bookmark from first post" : "Bookmark first post")}
          >
            <Bookmark size={16} /> {bookmarkView.error || (bookmarkView.bookmarked ? "Bookmarked" : "Bookmark")}
          </button>
        )}
        <button type="button" onClick={handleShare} title="Share first post">
          <Share2 size={16} /> {shareButtonLabel(shareState)}
        </button>
        <a href={postBskyUrl(rootPost)} target="_blank" rel="noreferrer" title="Open first post on Bluesky">
          <LinkIcon size={16} /> Open on Bluesky
        </a>
        {onReply && (
          <button type="button" className={replyActive ? "active" : ""} onClick={handleReplyClick} title="Reply to the first post in this thread">
            <MessageCircle size={16} /> Reply
          </button>
        )}
        {onQuote && (
          <button type="button" className={quoteActive ? "active" : ""} onClick={() => onQuote(rootPost)} title="Quote the first post in this thread">
            <Quote size={16} /> Quote
          </button>
        )}
      </footer>
      {showReplyLimited && <ReplyLimitedNotice />}
    </article>
  );
}

function PostImageVideoMedia({ post, onOpenImage }: { post: FeedPost; onOpenImage?: (image: ImageViewerState) => void }) {
  const showNsfw = useContext(ShowNsfwContext);
  const showMedia = useContext(ShowMediaContext);
  const [mediaRevealed, setMediaRevealed] = useState(false);
  const images = safeEmbedImages(getEmbedImages(post.embed));
  const video = getVideoEmbed(post.embed);
  const labels = post.labels ?? [];
  const mediaWarningValues = sensitiveMediaValues([...labels, ...(post.author.labels ?? [])]);
  const gateMedia = !showNsfw && mediaWarningValues.length > 0 && (images.length > 0 || !!video) && !mediaRevealed;
  const hideMediaForSetting = !showMedia && !mediaRevealed && !gateMedia;

  if (images.length === 0 && !video) {
    return null;
  }

  if (gateMedia) {
    return <SensitiveMediaGate values={mediaWarningValues} onReveal={() => setMediaRevealed(true)} />;
  }

  if (hideMediaForSetting) {
    return <MediaHiddenButton kind={images.length > 0 ? "image" : "video"} onReveal={() => setMediaRevealed(true)} />;
  }

  const hideMediaButton =
    mediaRevealed && (mediaWarningValues.length > 0 || !showMedia) ? (
      <MediaHiddenButton kind={images.length > 0 ? "image" : "video"} revealed onReveal={() => setMediaRevealed(false)} />
    ) : null;

  return (
    <>
      {hideMediaButton}
      <div className="post-image-video-media">
        {images.length === 1 && (
          <div className="image-grid count-1">
            {images.slice(0, 1).map((image) => (
              <button
                className="image-button"
                key={image.thumb || image.fullsize}
                type="button"
                onClick={(event) => {
                  if (!clickedImageElement(event)) {
                    return;
                  }
                  const viewerImages = feedViewerImages(images);
                  if (viewerImages.length === 0) {
                    return;
                  }
                  onOpenImage?.({ images: viewerImages, index: 0 });
                }}
                aria-label={image.alt ? "Open image" : "Open full size image"}
              >
                <img
                  alt={image.alt || ""}
                  src={image.thumb || image.fullsize}
                  loading="lazy"
                  decoding="async"
                  style={
                    image.aspectRatio?.width && image.aspectRatio?.height
                      ? { aspectRatio: `${image.aspectRatio.width} / ${image.aspectRatio.height}` }
                      : undefined
                  }
                />
              </button>
            ))}
          </div>
        )}
        {images.length > 1 && (
          <div className={`image-grid image-masonry count-${Math.min(images.length, 4)}`}>
            {pairedImageRows(images.slice(0, maxPostImages)).map((row, rowIndex) => (
              <div
                className={row.length === 1 ? "image-row image-row-solo" : "image-row"}
                key={`image-row-${post.uri}-${rowIndex}`}
                style={{ "--media-row-aspect": row.reduce((total, image) => total + imageAspectRatio(image), 0) } as CSSProperties}
              >
                {row.map((image, imageIndex) => {
                  const flatIndex = rowIndex * 2 + imageIndex;
                  const viewerImages = feedViewerImages(images);
                  const selectedIndex = Math.max(0, viewerImages.findIndex((viewerImage) => viewerImage.src === (image.fullsize || image.thumb)));
                  return (
                    <button
                      className="image-button"
                      key={image.thumb || image.fullsize}
                      type="button"
                      style={{ "--media-aspect": imageAspectRatio(image) } as CSSProperties}
                      onClick={(event) => {
                        if (!clickedImageElement(event)) {
                          return;
                        }
                        if (viewerImages.length === 0) {
                          return;
                        }
                        onOpenImage?.({ images: viewerImages, index: selectedIndex });
                      }}
                      aria-label={image.alt ? "Open image" : "Open full size image"}
                    >
                      <img
                        alt={image.alt || ""}
                        src={image.thumb || image.fullsize}
                        loading="lazy"
                        decoding="async"
                        style={
                          row.length === 1 && image.aspectRatio?.width && image.aspectRatio?.height
                            ? { aspectRatio: `${image.aspectRatio.width} / ${image.aspectRatio.height}` }
                            : undefined
                        }
                      />
                      {images.length > maxPostImages && flatIndex === maxPostImages - 1 && (
                        <span className="more-media-badge">+{images.length - maxPostImages}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        )}
        {video && <VideoEmbedCard video={video} />}
      </div>
    </>
  );
}

function feedViewerImages(images: ReturnType<typeof getEmbedImages>) {
  return images
    .slice(0, maxPostImages)
    .map((viewerImage) => ({
      src: viewerImage.fullsize || viewerImage.thumb || "",
      previewSrc: viewerImage.thumb && viewerImage.fullsize && viewerImage.thumb !== viewerImage.fullsize ? viewerImage.thumb : undefined,
      alt: viewerImage.alt || "",
    }))
    .filter((viewerImage) => viewerImage.src);
}

function clickedImageElement(event: ReactMouseEvent<HTMLButtonElement>) {
  return event.target instanceof HTMLImageElement;
}

function imageAspectRatio(image: ReturnType<typeof getEmbedImages>[number]) {
  const width = image.aspectRatio?.width;
  const height = image.aspectRatio?.height;
  return width && height ? Math.max(0.45, Math.min(2.4, width / height)) : 1;
}

function pairedImageRows(images: ReturnType<typeof getEmbedImages>) {
  const rows: Array<ReturnType<typeof getEmbedImages>> = [];
  for (let index = 0; index < images.length; index += 2) {
    rows.push(images.slice(index, index + 2));
  }
  return rows;
}

function mediaImageRows(images: ReturnType<typeof getEmbedImages>) {
  const rows: Array<ReturnType<typeof getEmbedImages>> = [];
  for (let index = 0; index < images.length; ) {
    const remaining = images.length - index;
    const count = remaining === 4 ? 2 : Math.min(3, remaining);
    rows.push(images.slice(index, index + count));
    index += count;
  }
  return rows;
}

function MediaOnlyImageTile({
  image,
  viewerImages,
  onOpenImage,
}: {
  image: ReturnType<typeof getEmbedImages>[number];
  viewerImages: ImageViewerImage[];
  onOpenImage?: (image: ImageViewerState) => void;
}) {
  const src = image.thumb || image.fullsize;
  const [aspectRatio, setAspectRatio] = useState(() => imageAspectRatio(image));
  const viewerIndex = viewerImages.findIndex((viewerImage) => viewerImage.src === (image.fullsize || image.thumb));

  return (
    <button
      className="media-only-tile"
      type="button"
      style={{ "--media-aspect": aspectRatio } as CSSProperties}
      onClick={(event) => {
        if (!clickedImageElement(event)) {
          return;
        }
        if (viewerImages.length > 0) {
          onOpenImage?.({ images: viewerImages, index: Math.max(0, viewerIndex) });
        }
      }}
      aria-label={image.alt ? "Open image" : "Open full size image"}
    >
      <img
        alt={image.alt || ""}
        src={src}
        loading="lazy"
        decoding="async"
        onLoad={(event) => {
          const img = event.currentTarget;
          if (img.naturalWidth > 0 && img.naturalHeight > 0) {
            setAspectRatio(Math.max(0.45, Math.min(2.8, img.naturalWidth / img.naturalHeight)));
          }
        }}
      />
    </button>
  );
}

function MediaOnlyPostCard({
  post,
  onOpenImage,
  onOpenPost,
  onOpenProfile,
  onReply,
  replyActive = false,
  canReply = true,
  onQuote,
  quoteActive = false,
  localLists = [],
  onToggleListPost,
  canDeletePost = false,
  canBlockAuthor = false,
}: {
  post: FeedPost;
  onOpenImage?: (image: ImageViewerState) => void;
  onOpenPost?: (post: FeedPost) => void;
  onOpenProfile?: (profile: Profile) => void;
  onReply?: (post: FeedPost) => void;
  replyActive?: boolean;
  canReply?: boolean;
  onQuote?: (post: FeedPost) => void;
  quoteActive?: boolean;
  localLists?: LocalList[];
  onToggleListPost?: (listId: string, post: FeedPost) => void;
  canDeletePost?: boolean;
  canBlockAuthor?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const images = safeEmbedImages(getEmbedImages(post.embed)).slice(0, maxPostImages);
  const video = getVideoEmbed(post.embed);
  const text = post.record.text?.trim() || "";
  const threadMarker = threadMarkerMatch(text);
  const postTimeLabel = formatPostTime(postSortAt(post));
  const viewerImages = feedViewerImages(images);

  if (images.length === 0 && !video) {
    return null;
  }

  return (
    <article className="post-card media-only-card">
      {images.length === 1 && (
        <button
          className="media-only-single"
          type="button"
          onClick={(event) => {
            if (!clickedImageElement(event)) {
              return;
            }
            if (viewerImages.length > 0) {
              onOpenImage?.({ images: viewerImages, index: 0 });
            }
          }}
          aria-label={images[0].alt ? "Open image" : "Open full size image"}
        >
          <img
            alt={images[0].alt || ""}
            src={images[0].thumb || images[0].fullsize}
            loading="lazy"
            decoding="async"
            style={
              images[0].aspectRatio?.width && images[0].aspectRatio?.height
                ? { aspectRatio: `${images[0].aspectRatio.width} / ${images[0].aspectRatio.height}` }
                : undefined
            }
          />
        </button>
      )}
      {images.length > 1 && (
        <div className="media-only-justified" aria-label="Post media">
          {mediaImageRows(images).map((row, rowIndex) => (
            <div
              className="media-only-row"
              key={`media-row-${post.uri}-${rowIndex}`}
              style={{ "--media-row-aspect": row.reduce((total, image) => total + imageAspectRatio(image), 0) } as CSSProperties}
            >
              {row.map((image) => (
                <MediaOnlyImageTile
                  image={image}
                  key={image.thumb || image.fullsize}
                  viewerImages={viewerImages}
                  onOpenImage={onOpenImage}
                />
              ))}
            </div>
          ))}
        </div>
      )}
      {video && <VideoEmbedCard video={video} />}
      <footer className="media-only-footer">
        <button
          type="button"
          className="media-only-expand"
          onClick={() => setExpanded((current) => !current)}
          aria-expanded={expanded}
          aria-label={expanded ? "Hide post details" : "Show post details"}
          title={expanded ? "Hide post details" : "Show post details"}
        >
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>
        {expanded && (
          <div className="media-only-details">
            {threadMarker && (
              <button type="button" className="thread-open-chip" onClick={() => onOpenPost?.(post)} title="Open full thread">
                <MessageCircle size={13} />
                <span>
                  Open Thread {threadMarker.index}/{threadMarker.total}
                </span>
              </button>
            )}
            <div className="media-only-meta">
              <a
                className="media-only-author"
                href={profilePath(post.author)}
                onClick={(event) => onOpenProfile && handleInternalLinkClick(event, () => onOpenProfile(post.author))}
              >
                <strong>{displayName(post.author)}</strong>
                <span>@{post.author.handle}</span>
              </a>
              <span aria-hidden="true">·</span>
              <a
                className="media-only-timestamp"
                href={postPath(post) ?? postBskyUrl(post)}
                onClick={(event) => onOpenPost && handleInternalLinkClick(event, () => onOpenPost(post))}
                title={`Open thread posted ${postTimeLabel}`}
              >
                {postTimeLabel}
              </a>
              {text && (
                <span className="media-only-text">
                  {text}
                </span>
              )}
            </div>
            <PostActionBar
              post={post}
              onOpenPost={onOpenPost}
              onReply={onReply}
              replyActive={replyActive}
              canReply={canReply}
              onQuote={onQuote}
              quoteActive={quoteActive}
              localLists={localLists}
              onToggleListPost={onToggleListPost}
              canDeletePost={canDeletePost}
              canBlockAuthor={canBlockAuthor}
            />
          </div>
        )}
      </footer>
    </article>
  );
}

function PostActionBar({
  post,
  commentCount,
  commentTitle = "Open thread",
  onOpenPost,
  onReply,
  replyActive = false,
  canReply = true,
  onQuote,
  quoteActive = false,
  localLists = [],
  onToggleListPost,
  canDeletePost = false,
  canBlockAuthor = false,
}: {
  post: FeedPost;
  commentCount?: number;
  commentTitle?: string;
  onOpenPost?: (post: FeedPost) => void;
  onReply?: (post: FeedPost) => void;
  replyActive?: boolean;
  canReply?: boolean;
  onQuote?: (post: FeedPost) => void;
  quoteActive?: boolean;
  localLists?: LocalList[];
  onToggleListPost?: (listId: string, post: FeedPost) => void;
  canDeletePost?: boolean;
  canBlockAuthor?: boolean;
}) {
  const likeCtx = useContext(LikeContext);
  const likeView = likeCtx?.getState(post);
  const bookmarkCtx = useContext(BookmarkContext);
  const bookmarkView = bookmarkCtx?.getState(post);
  const blockCtx = useContext(BlockContext);
  const blockView = blockCtx?.getState(post.author);
  const deletePostCtx = useContext(DeletePostContext);
  const { shareState, handleShare } = useSharePost(post, [post]);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const moreMenuRef = useRef<HTMLDetailsElement | null>(null);
  const { showReplyLimited, handleReplyClick } = useReplyGate(post, onReply);
  const displayedCommentCount = commentCount ?? post.replyCount ?? 0;

  useDismissMenu(moreMenuRef, moreMenuOpen, () => setMoreMenuOpen(false));

  return (
    <>
      <footer className="post-actions">
        <button type="button" onClick={() => onOpenPost?.(post)} aria-label={commentTitle} title={commentTitle}>
          <MessageCircle size={16} /> {displayedCommentCount}
        </button>
        <span>
          <Repeat2 size={16} /> {post.repostCount ?? 0}
        </span>
        {likeCtx?.canLike && likeView ? (
          <button
            type="button"
            className={likeView.liked ? "liked" : ""}
            onClick={() => likeCtx.toggle(post)}
            aria-label={likeView.liked ? "Unlike post" : "Like post"}
            title={likeView.liked ? "Unlike" : "Like"}
          >
            <Heart size={16} /> {likeView.count}
          </button>
        ) : (
          <span>
            <Heart size={16} /> {post.likeCount ?? 0}
          </span>
        )}
        {bookmarkCtx?.canBookmark && bookmarkView ? (
          <button
            className={bookmarkView.error ? "bookmark-error" : bookmarkView.bookmarked ? "bookmarked" : ""}
            type="button"
            onClick={() => bookmarkCtx.toggle(post)}
            aria-label={bookmarkView.error || (bookmarkView.bookmarked ? "Remove bookmark" : "Bookmark post")}
            title={bookmarkView.error || (bookmarkView.bookmarked ? "Remove bookmark" : "Bookmark post")}
          >
            <Bookmark size={16} /> {bookmarkView.error || (bookmarkView.bookmarked ? "Bookmarked" : "Bookmark")}
          </button>
        ) : null}
        <button type="button" onClick={handleShare} aria-label={shareButtonLabel(shareState)} title="Share post">
          <Share2 size={16} /> {shareButtonLabel(shareState)}
        </button>
        {onReply && (
          <button
            type="button"
            className={replyActive ? "active" : ""}
            onClick={handleReplyClick}
            disabled={!canReply}
            title="Reply to this post"
          >
            <MessageCircle size={16} /> Reply
          </button>
        )}
        {onQuote && (
          <button
            type="button"
            className={quoteActive ? "active" : ""}
            onClick={() => onQuote(post)}
            title="Quote this post"
          >
            <Quote size={16} /> Quote
          </button>
        )}
        {localLists.length > 0 && (
          <details className="post-list-menu">
            <summary title="Add post to local lists">
              <List size={16} /> Lists
            </summary>
            <div>
              {localLists.map((list) => {
                const isListed = !!list.posts?.some((listPost) => listPost.uri === post.uri);
                return (
                  <button
                    className={isListed ? "listed" : ""}
                    key={list.id}
                    type="button"
                    onClick={() => onToggleListPost?.(list.id, post)}
                  >
                    {isListed ? "Remove from" : "Add to"} {list.name}
                  </button>
                );
              })}
            </div>
          </details>
        )}
        <details
          className="post-list-menu post-more-menu"
          open={moreMenuOpen}
          ref={moreMenuRef}
          onToggle={(event) => setMoreMenuOpen(event.currentTarget.open)}
        >
          <summary title="More options" aria-label="More options">
            <MoreHorizontal size={16} />
          </summary>
          <div>
            <a href={postBskyUrl(post)} target="_blank" rel="noreferrer" onClick={() => setMoreMenuOpen(false)}>
              Open on Bluesky
            </a>
            {canDeletePost && (
              <button
                type="button"
                onClick={() => {
                  setMoreMenuOpen(false);
                  deletePostCtx?.deletePost(post);
                }}
              >
                Delete post
              </button>
            )}
            {canBlockAuthor && (
              <button
                type="button"
                className={blockView?.blocked ? "block-listed" : ""}
                onClick={() => {
                  setMoreMenuOpen(false);
                  blockCtx?.toggle(post.author);
                }}
              >
                {blockView?.blocked ? `Unblock @${post.author.handle}` : `Block @${post.author.handle}`}
              </button>
            )}
          </div>
        </details>
      </footer>
      {showReplyLimited && <ReplyLimitedNotice />}
    </>
  );
}

function CombinedThreadViewCard({
  parts,
  activeReplyParentUri,
  canReply,
  onOpenImage,
  onOpenPost,
  onOpenProfile,
  onShowReplies,
  onOpenReply,
  onCloseReply,
  onReplied,
  threadRootRef,
  activeQuoteUri,
  onOpenQuote,
  onCloseQuote,
  onQuoted,
}: {
  parts: ThreadPart[];
  activeReplyParentUri: string | null;
  canReply: boolean;
  onOpenImage: (image: ImageViewerState) => void;
  onOpenPost: (post: FeedPost) => void;
  onOpenProfile: (profile: Profile) => void;
  onShowReplies?: () => void;
  onOpenReply: (post: FeedPost) => void;
  onCloseReply: () => void;
  onReplied?: () => void;
  threadRootRef: PostRefValue;
  activeQuoteUri: string | null;
  onOpenQuote: (post: FeedPost) => void;
  onCloseQuote: () => void;
  onQuoted?: () => void;
}) {
  const onOpenTag = useContext(TagSearchContext);
  const likeCtx = useContext(LikeContext);
  const bookmarkCtx = useContext(BookmarkContext);
  const rootPost = parts[0].node.post;
  const posts = parts.map((part) => part.node.post);
  const { shareState, handleShare } = useSharePost(rootPost, posts);
  const likeView = likeCtx?.getState(rootPost);
  const bookmarkView = bookmarkCtx?.getState(rootPost);
  const postTimeLabel = formatPostTime(postSortAt(rootPost));
  const { replyCount, repostCount, quoteCount, liveLikeCount, hideThreadMarkers } = combinedThreadStats(posts, rootPost, likeView);
  const { showReplyLimited, handleReplyClick } = useReplyGate(rootPost, onOpenReply);

  return (
    <article className="post-card combined-thread-view-card text-only">
      <PostCardHeader
        profile={rootPost.author}
        post={rootPost}
        timestampLabel={postTimeLabel}
        onOpenProfile={onOpenProfile}
        onOpenPost={onOpenPost}
      />
      <div className="combined-thread-text">
        {parts.map((part, index) => {
          const post = part.node.post;
          const segment = combinedThreadSegment(post, hideThreadMarkers);
          const hasEmbeds = postHasEmbeds(post);
          if (!segment.text && !hasEmbeds) {
            return null;
          }
          return (
            <section className="combined-thread-segment" key={post.uri}>
              <p className={postTextClass(segment.text)}>
                {index > 0 && <span className="combined-thread-break" aria-hidden="true" />}
                {segment.text
                  ? renderRichText(segment.text, segment.facets, onOpenProfile, onOpenTag)
                  : `Post ${index + 1} has no plain text.`}
              </p>
              <PostEmbeds
                post={post}
                onOpenImage={onOpenImage}
                onOpenPost={onOpenPost}
                onOpenProfile={onOpenProfile}
              />
            </section>
          );
        })}
      </div>
      {activeReplyParentUri === rootPost.uri && (
        <PostComposer
          replyTo={{ parent: rootPost, root: threadRootRef }}
          canReply={canReply}
          onClose={onCloseReply}
          onReplied={onReplied}
        />
      )}
      {activeQuoteUri === rootPost.uri && (
        <PostComposer quote={rootPost} onClose={onCloseQuote} onQuoted={onQuoted} />
      )}
      <footer className="post-actions combined-thread-actions">
        <button type="button" onClick={() => (onShowReplies ? onShowReplies() : onOpenPost(rootPost))} title="Show full thread replies">
          <MessageCircle size={16} /> {replyCount}
        </button>
        <span title="Total reposts across combined posts">
          <Repeat2 size={16} /> {repostCount}
        </span>
        <span title="Total quotes across combined posts">
          <Share2 size={16} /> {quoteCount}
        </span>
        {likeCtx?.canLike && likeView ? (
          <button
            type="button"
            className={likeView.liked ? "liked" : ""}
            onClick={() => likeCtx.toggle(rootPost)}
            title={likeView.liked ? "Unlike first post" : "Like first post"}
          >
            <Heart size={16} /> {liveLikeCount}
          </button>
        ) : (
          <span title="Total likes across combined posts">
            <Heart size={16} /> {liveLikeCount}
          </span>
        )}
        {bookmarkCtx?.canBookmark && bookmarkView ? (
          <button
            type="button"
            className={bookmarkView.error ? "bookmark-error" : bookmarkView.bookmarked ? "bookmarked" : ""}
            onClick={() => bookmarkCtx.toggle(rootPost)}
            title={bookmarkView.error || (bookmarkView.bookmarked ? "Remove bookmark from first post" : "Bookmark first post")}
          >
            <Bookmark size={16} /> {bookmarkView.error || (bookmarkView.bookmarked ? "Bookmarked" : "Bookmark")}
          </button>
        ) : null}
        <button type="button" onClick={handleShare} title="Share first post">
          <Share2 size={16} /> {shareButtonLabel(shareState)}
        </button>
        <a href={postBskyUrl(rootPost)} target="_blank" rel="noreferrer" title="Open first post on Bluesky">
          <LinkIcon size={16} /> Open on Bluesky
        </a>
        <button
          type="button"
          className={activeReplyParentUri === rootPost.uri ? "active" : ""}
          onClick={handleReplyClick}
          disabled={!canReply}
          title="Reply to the first post in this thread"
        >
          <MessageCircle size={16} /> Reply
        </button>
        <button
          type="button"
          className={activeQuoteUri === rootPost.uri ? "active" : ""}
          onClick={() => onOpenQuote(rootPost)}
          disabled={!canReply}
          title="Quote the first post in this thread"
        >
          <Quote size={16} /> Quote
        </button>
      </footer>
      {showReplyLimited && <ReplyLimitedNotice />}
    </article>
  );
}

function PostEmbeds({
  post,
  onOpenImage,
  onOpenPost,
  onOpenProfile,
}: {
  post: FeedPost;
  onOpenImage?: (image: ImageViewerState) => void;
  onOpenPost?: (post: FeedPost) => void;
  onOpenProfile?: (profile: Profile) => void;
}) {
  const showMedia = useContext(ShowMediaContext);
  const [linkMediaRevealed, setLinkMediaRevealed] = useState(false);
  const images = safeEmbedImages(getEmbedImages(post.embed));
  const video = getVideoEmbed(post.embed);
  const external = getExternalEmbed(post.embed);
  const externalThumb = safeHttpUrl(external?.thumb);
  const recordEmbed = getRecordEmbed(post.embed);
  const linkMediaHidden = !showMedia && !linkMediaRevealed && !!externalThumb;
  // If the post carries an embed we don't know how to render and none of the
  // known extractors produced anything, tell the reader rather than dropping it.
  const renderedEmbed = images.length > 0 || !!video || !!external || !!recordEmbed;
  const unknownEmbedType = renderedEmbed ? null : getUnknownEmbedType(post.embed);

  return (
    <>
      <PostImageVideoMedia post={post} onOpenImage={onOpenImage} />
      {!showMedia && externalThumb && (
        <MediaHiddenButton kind="image" revealed={linkMediaRevealed} onReveal={() => setLinkMediaRevealed((current) => !current)} />
      )}
      {external && (
        <ExternalLinkCard
          external={external}
          hideThumbnail={linkMediaHidden}
        />
      )}
      {recordEmbed && (
        <QuotedPostCard
          record={recordEmbed}
          onOpenPost={onOpenPost}
          onOpenProfile={onOpenProfile}
        />
      )}
      {unknownEmbedType && <UnsupportedEmbedNotice embedType={unknownEmbedType} post={post} />}
    </>
  );
}

function PostCard({
  currentDid,
  item,
  localLists = [],
  onOpenImage,
  onOpenPost,
  onOpenProfile,
  onReply,
  replyActive = false,
  onQuote,
  quoteActive = false,
  forceFullCard,
  onToggleListPost,
}: {
  currentDid?: string;
  item: FeedItem;
  localLists?: LocalList[];
  onOpenImage?: (image: ImageViewerState) => void;
  onOpenPost?: (post: FeedPost) => void;
  onOpenProfile?: (profile: Profile) => void;
  onReply?: (post: FeedPost) => void;
  replyActive?: boolean;
  onQuote?: (post: FeedPost) => void;
  quoteActive?: boolean;
  // In thread context we always want the full post card, never the compact
  // media-only variant that "media" density would otherwise substitute.
  forceFullCard?: boolean;
  onToggleListPost?: (listId: string, post: FeedPost) => void;
}) {
  const post = item.post;
  const onOpenTag = useContext(TagSearchContext);
  const showMedia = useContext(ShowMediaContext);
  const density = useContext(DensityContext);
  const blockCtx = useContext(BlockContext);
  const deletePostCtx = useContext(DeletePostContext);
  const canBlockAuthor = !!blockCtx?.canBlock && post.author.did !== blockCtx?.selfDid;
  const images = safeEmbedImages(getEmbedImages(post.embed));
  const external = getExternalEmbed(post.embed);
  const recordEmbed = getRecordEmbed(post.embed);
  const video = getVideoEmbed(post.embed);
  const text = post.record.text?.trim() || "";
  const postTimestamp = postSortAt(post);
  const postTimeLabel = formatPostTime(postTimestamp);
  const threadMarker = threadMarkerMatch(text);
  const hasRichContent = images.length > 0 || !!external || !!recordEmbed || !!video;
  const postVariant = images.length > 0 || !!video ? "has-media" : external ? "has-link" : recordEmbed ? "has-quote" : "text-only";
  const hasHiddenMedia = !showMedia && (images.length > 0 || !!video || !!external || !!recordEmbed);
  const isOwnPost = !!currentDid && post.author.did === currentDid;
  const canDeletePost = !!deletePostCtx?.canDelete && isOwnPost;
  const labels = post.labels ?? [];
  // Adult content is often labeled at the account level, not the post, so check
  // the author's labels too when deciding whether to hide media.
  const sensitiveLabels = [...labels, ...(post.author.labels ?? [])].filter(isSensitiveLabel);
  const moderationNotes = [
    ...(post.viewer?.threadMuted ? ["Thread muted"] : []),
    ...sensitiveLabels.map(moderationLabelText),
  ];

  if (density === "media" && !forceFullCard && (images.length > 0 || !!video)) {
    return (
      <MediaOnlyPostCard
        post={post}
        onOpenImage={onOpenImage}
        onOpenPost={onOpenPost}
        onOpenProfile={onOpenProfile}
        onReply={onReply}
        replyActive={replyActive}
        canReply={!!onReply}
        onQuote={onQuote}
        quoteActive={quoteActive}
        localLists={localLists}
        onToggleListPost={onToggleListPost}
        canDeletePost={canDeletePost}
        canBlockAuthor={canBlockAuthor}
      />
    );
  }

  return (
    <article className={`post-card ${postVariant}${hasHiddenMedia ? " media-hidden" : ""}`}>
      <PostCardHeader
        profile={post.author}
        post={post}
        timestampLabel={postTimeLabel}
        onOpenProfile={onOpenProfile}
        onOpenPost={onOpenPost}
      />
      {threadMarker && (
        <button type="button" className="thread-open-chip" onClick={() => onOpenPost?.(post)} title="Open full thread">
          <MessageCircle size={13} />
          <span>
            Open Thread {threadMarker.index}/{threadMarker.total}
          </span>
        </button>
      )}
      {item.reason?.by && <p className="reason">Reposted by {displayName(item.reason.by)}</p>}
      {item.reply?.parent && <p className="reason">Replying in a thread from @{item.reply.parent.author.handle}</p>}
      {(isOwnPost || labels.length > 0) && (
        <div className="post-badges" aria-label="Post context">
          {isOwnPost && <span>Your post</span>}
          {labels.slice(0, 3).map((label) => (
            <span className={isSensitiveLabel(label) ? "sensitive" : ""} key={`${post.uri}:${label.val || label.src || label.uri}`}>
              {moderationLabelText(label)}
            </span>
          ))}
        </div>
      )}
      {moderationNotes.length > 0 && (
        <div className="moderation-notice">
          <ShieldAlert size={15} />
          <span>{moderationNotes.join(", ")}</span>
        </div>
      )}
      {text ? (
        <p className={postTextClass(text)}>
          {renderRichText(post.record.facets?.length ? post.record.text || "" : text, post.record.facets, onOpenProfile, onOpenTag)}
        </p>
      ) : (
        !hasRichContent && <p className="post-text muted">Post has no plain text.</p>
      )}
      <PostEmbeds
        post={post}
        onOpenImage={onOpenImage}
        onOpenPost={onOpenPost}
        onOpenProfile={onOpenProfile}
      />
      <PostActionBar
        post={post}
        onOpenPost={onOpenPost}
        onReply={onReply}
        replyActive={replyActive}
        onQuote={onQuote}
        quoteActive={quoteActive}
        localLists={localLists}
        onToggleListPost={onToggleListPost}
        canDeletePost={canDeletePost}
        canBlockAuthor={canBlockAuthor}
      />
    </article>
  );
}

function QuotedPostCard({
  record,
  onOpenPost,
  onOpenProfile,
}: {
  record: RecordEmbedView;
  onOpenPost?: (post: FeedPost) => void;
  onOpenProfile?: (profile: Profile) => void;
}) {
  const onOpenTag = useContext(TagSearchContext);
  const showNsfw = useContext(ShowNsfwContext);
  const showMedia = useContext(ShowMediaContext);
  const [mediaRevealed, setMediaRevealed] = useState(false);
  const quoteEmbedSource = record.embeds?.[0] ?? record.value?.embed;
  const embeddedExternal = getExternalEmbed(quoteEmbedSource);
  const embeddedExternalThumb = safeHttpUrl(embeddedExternal?.thumb);
  const embeddedImages = safeEmbedImages(getEmbedImages(quoteEmbedSource));
  const embeddedVideo = getVideoEmbed(quoteEmbedSource);
  // Same generic fallback as PostEmbeds: if the quoted post carries an embed we
  // can't render and none of the known extractors produced output, surface a
  // notice instead of silently dropping the nested content.
  const quoteRenderedEmbed = embeddedImages.length > 0 || !!embeddedVideo || !!embeddedExternal;
  const unknownQuoteEmbedType = quoteRenderedEmbed ? null : getUnknownEmbedType(quoteEmbedSource);
  const hasHiddenPreviewMedia = embeddedImages.length > 0 || !!embeddedVideo || !!embeddedExternalThumb;
  const hiddenPreviewMediaKind = embeddedImages.length > 0 || embeddedExternalThumb ? "image" : "video";
  const text = record.value?.text?.trim() || "";
  const mediaWarningValues = sensitiveMediaValues([
    ...((record.labels as Array<{ val?: string }> | undefined) ?? []),
    ...(record.author?.labels ?? []),
  ]);
  const gateMedia = !showNsfw && mediaWarningValues.length > 0 && (embeddedImages.length > 0 || !!embeddedVideo) && !mediaRevealed;
  const hideMediaForSetting = !showMedia && !mediaRevealed && !gateMedia;
  const hiddenMediaControl =
    hideMediaForSetting && hasHiddenPreviewMedia ? (
      <MediaHiddenButton kind={hiddenPreviewMediaKind} onReveal={() => setMediaRevealed(true)} />
    ) : null;
  const quotedPost = record.author
    ? ({
        uri: record.uri,
        cid: record.cid || "",
        author: record.author,
        record: {
          text: record.value?.text,
          createdAt: record.value?.createdAt,
          embed: record.value?.embed,
        },
        embed: record.embeds?.[0],
        replyCount: record.replyCount,
        repostCount: record.repostCount,
        likeCount: record.likeCount,
        quoteCount: record.quoteCount,
        indexedAt: record.indexedAt,
      } satisfies FeedPost)
    : null;
  const openQuotedThreadButton = quotedPost ? (
    <button className="quote-open-button" type="button" onClick={() => onOpenPost?.(quotedPost)}>
      Open quoted thread
    </button>
  ) : null;
  // Show the quoted post's timestamp in the header (and make it the permalink
  // affordance), matching the main post card. Without this the feed/profile
  // quote header only showed author + handle with no way to open the quote by
  // its timestamp. Only rendered when the quote carries a parseable time.
  const quoteTimestamp = quotedPost ? postSortAt(quotedPost) : undefined;
  const quoteTimeLabel = quoteTimestamp ? formatPostTime(quoteTimestamp) : null;
  const quoteTimestampLink =
    quotedPost && quoteTimeLabel ? (
      <a
        className="post-timestamp"
        href={postPath(quotedPost) ?? postBskyUrl(quotedPost)}
        onClick={(event) => onOpenPost && handleInternalLinkClick(event, () => onOpenPost(quotedPost))}
        title={`Open quoted post posted ${quoteTimeLabel}`}
        aria-label={`Open quoted post posted ${quoteTimeLabel}`}
      >
        {quoteTimeLabel}
      </a>
    ) : null;

  return (
    <div className={mediaRevealed ? "quote-card revealed" : "quote-card"}>
      {record.author && (
        <header className="quote-header">
          <Avatar profile={record.author} />
          <div className="quote-header-main">
            <div className="post-author-block">
              <a
                className="author-button"
                href={profilePath(record.author as Profile)}
                onClick={(event) => onOpenProfile && handleInternalLinkClick(event, () => onOpenProfile(record.author as Profile))}
              >
                <strong>{displayName(record.author)}</strong>
              </a>
              <div className="post-byline">
                <span>@{record.author.handle}</span>
                {quoteTimestampLink && <span aria-hidden="true">·</span>}
                {quoteTimestampLink}
              </div>
            </div>
            {hiddenMediaControl}
            {openQuotedThreadButton}
          </div>
        </header>
      )}
      {text ? (
        <p className={text.includes("\n") ? "quote-text has-line-breaks" : "quote-text"}>
          {renderRichText(
            record.value?.facets?.length ? record.value.text || "" : text,
            record.value?.facets,
            onOpenProfile,
            onOpenTag,
          )}
        </p>
      ) : (
        <p className="quote-text muted">Quoted post has no plain text.</p>
      )}
      {!record.author && hiddenMediaControl}
      {gateMedia ? (
        <SensitiveMediaGate values={mediaWarningValues} onReveal={() => setMediaRevealed(true)} />
      ) : hideMediaForSetting && hasHiddenPreviewMedia ? (
        null
      ) : (
        <>
          {embeddedImages.length === 1 && (
            <div className="image-grid quote-images count-1">
              <img
                alt={embeddedImages[0].alt || ""}
                src={embeddedImages[0].thumb || embeddedImages[0].fullsize}
                loading="lazy"
                decoding="async"
                style={
                  embeddedImages[0].aspectRatio?.width && embeddedImages[0].aspectRatio?.height
                    ? { aspectRatio: `${embeddedImages[0].aspectRatio.width} / ${embeddedImages[0].aspectRatio.height}` }
                    : undefined
                }
              />
            </div>
          )}
          {embeddedImages.length > 1 && (
            // Multi-image quote galleries reuse the regular post's masonry rows
            // (pairedImageRows + --media-row-aspect / --media-aspect) so they
            // fill the quote width and cap at the viewport height, instead of the
            // old flat 2-up grid that sized each image ad hoc.
            <div className={`image-grid quote-images image-masonry count-${Math.min(embeddedImages.length, 4)}`}>
              {pairedImageRows(embeddedImages.slice(0, maxPostImages)).map((row, rowIndex) => (
                <div
                  className={row.length === 1 ? "image-row image-row-solo" : "image-row"}
                  key={`quote-image-row-${record.uri}-${rowIndex}`}
                  style={{ "--media-row-aspect": row.reduce((total, image) => total + imageAspectRatio(image), 0) } as CSSProperties}
                >
                  {row.map((image) => (
                    <img
                      alt={image.alt || ""}
                      key={image.thumb || image.fullsize}
                      src={image.thumb || image.fullsize}
                      loading="lazy"
                      decoding="async"
                      style={
                        row.length === 1 && image.aspectRatio?.width && image.aspectRatio?.height
                          ? ({ aspectRatio: `${image.aspectRatio.width} / ${image.aspectRatio.height}`, "--media-aspect": imageAspectRatio(image) } as CSSProperties)
                          : ({ "--media-aspect": imageAspectRatio(image) } as CSSProperties)
                      }
                    />
                  ))}
                </div>
              ))}
            </div>
          )}
          {embeddedVideo && <VideoEmbedCard video={embeddedVideo} compact />}
        </>
      )}
      {embeddedExternal && (
        <ExternalLinkCard
          className="quote-link-card"
          external={embeddedExternal}
          hideThumbnail={hideMediaForSetting && !!embeddedExternalThumb}
        />
      )}
      {unknownQuoteEmbedType && quotedPost && (
        <UnsupportedEmbedNotice embedType={unknownQuoteEmbedType} post={quotedPost} />
      )}
      {!record.author && openQuotedThreadButton}
    </div>
  );
}

function findFirstThreadPost(node?: ThreadNode): FeedPost | null {
  if (!node || !("post" in node)) {
    return null;
  }

  return node.post;
}

function collectThreadParents(node?: ThreadNode): ThreadNode[] {
  if (!node || !("post" in node) || !node.parent) {
    return [];
  }

  return [...collectThreadParents(node.parent), node.parent];
}

function replyPermissionLabel(post: FeedPost) {
  const labels = post.labels?.map((label) => label.val).filter(Boolean);
  if (labels?.some((label) => label?.includes("!warn") || label?.includes("adult"))) {
    return "Reply permissions may be limited by content labels";
  }

  return "Everybody can reply";
}

function ThreadView({
  currentDid,
  localLists,
  thread,
  loadingBranches,
  branchResults,
  onOpenImage,
  onLoadBranch,
  onOpenPost,
  onOpenProfile,
  onToggleListPost,
  canReply = false,
  onReplied,
}: {
  currentDid?: string;
  localLists: LocalList[];
  thread: { status: "idle" | "loading" | "ready" | "error"; node?: ThreadNode; error?: string };
  loadingBranches: Record<string, boolean>;
  branchResults: Record<string, BranchLoadResult>;
  onOpenImage: (image: ImageViewerState) => void;
  onLoadBranch: (uri: string) => void;
  onOpenPost: (post: FeedPost) => void;
  onOpenProfile: (profile: Profile) => void;
  onToggleListPost: (listId: string, post: FeedPost) => void;
  canReply?: boolean;
  onReplied?: () => void;
}) {
  const density = useContext(DensityContext);
  const [expandedBranches, setExpandedBranches] = useState<Record<string, boolean>>({});
  const [engagement, setEngagement] = useState<null | "reposts" | "quotes" | "likes">(null);
  const { activeReplyParentUri, activeQuoteUri, toggleReplyFor, toggleQuoteFor, closeReply, closeQuote } = useComposerTargets();
  const [threadDisplayMode, setThreadDisplayMode] = useState<"combined" | "separated">("combined");
  // Re-root self-threads: when the opened post is mid-chain (e.g. part 3 of 5
  // via search/URL), buildAnchoredThreadParts walks UP the parent chain so the
  // whole self-thread combines from its true root instead of splitting parts
  // 1–2 into "Reply context". selfRootNode is that true root; the header stats
  // and parent-context list key off it (not the anchored post).
  const threadParts = thread.node ? buildAnchoredThreadParts(thread.node) : [];
  const selfRootNode = threadParts[0]?.node ?? thread.node;
  const rootPost = findFirstThreadPost(selfRootNode);
  const parentNodes = collectThreadParents(selfRootNode);
  const threadRootRef = rootPost ? replyRootRefForPost(rootPost) : null;
  const canCombineThread = threadParts.length > 1;

  if (thread.status === "loading") {
    return <LoadingState label="Loading thread" />;
  }

  if (thread.status === "error") {
    return <ErrorState message={thread.error || "Thread failed to load."} />;
  }

  if (!thread.node) {
    return <ErrorState message="No thread selected." />;
  }

  return (
    <div className={`thread-view ${density}`}>
      {rootPost && (
        <section className="thread-detail-header">
          <div>
            <span>Conversation</span>
            <a
              className="thread-author-link"
              href={profilePath(rootPost.author)}
              onClick={(event) => handleInternalLinkClick(event, () => onOpenProfile(rootPost.author))}
            >
              <h2>{displayName(rootPost.author)}</h2>
              <p>
                @{rootPost.author.handle} · {formatPostTime(postSortAt(rootPost))}
              </p>
            </a>
          </div>
          <dl>
            <div>
              <dt>Replies</dt>
              <dd>{(rootPost.replyCount ?? 0).toLocaleString()}</dd>
            </div>
            {([
              { key: "reposts", label: "Reposts", count: rootPost.repostCount },
              { key: "quotes", label: "Quotes", count: rootPost.quoteCount },
              { key: "likes", label: "Likes", count: rootPost.likeCount },
            ] as const).map((stat) => (
              <div key={stat.key}>
                <dt>{stat.label}</dt>
                <dd>
                  <button
                    type="button"
                    className={engagement === stat.key ? "thread-stat-button active" : "thread-stat-button"}
                    onClick={() => setEngagement((current) => (current === stat.key ? null : stat.key))}
                    disabled={!stat.count}
                    aria-pressed={engagement === stat.key}
                  >
                    {(stat.count ?? 0).toLocaleString()}
                  </button>
                </dd>
              </div>
            ))}
          </dl>
          <div className="thread-permissions">
            <Users size={15} />
            <span>{replyPermissionLabel(rootPost)}</span>
          </div>
          {canCombineThread && (
            <div className="thread-view-mode" role="group" aria-label="Thread display mode">
              <button
                type="button"
                className={threadDisplayMode === "combined" ? "selected" : ""}
                onClick={() => setThreadDisplayMode("combined")}
              >
                Combined
              </button>
              <button
                type="button"
                className={threadDisplayMode === "separated" ? "selected" : ""}
                onClick={() => setThreadDisplayMode("separated")}
              >
                Separated
              </button>
            </div>
          )}
          {engagement && (
            <ThreadEngagementPanel
              uri={rootPost.uri}
              kind={engagement}
              onOpenProfile={onOpenProfile}
              onOpenPost={onOpenPost}
              onClose={() => setEngagement(null)}
            />
          )}
        </section>
      )}
      {parentNodes.length > 0 && (
        <section className="thread-parent-context" aria-label="Parent posts">
          <header>
            <span>Reply context</span>
            <strong>{parentNodes.length === 1 ? "1 parent post" : `${parentNodes.length} parent posts`}</strong>
          </header>
          {parentNodes.map((parentNode, index) =>
            renderThreadContextNode(
              parentNode,
              index,
              parentNodes.length,
              { loadingBranches, branchResults, onLoadBranch, onOpenImage, onOpenPost, onOpenProfile },
              { currentDid, localLists, onToggleListPost },
            ),
          )}
        </section>
      )}
      {canCombineThread && threadDisplayMode === "combined" && threadRootRef ? (
        <CombinedThreadViewCard
          parts={threadParts}
          activeReplyParentUri={activeReplyParentUri}
          canReply={canReply}
          onOpenImage={onOpenImage}
          onOpenPost={onOpenPost}
          onOpenProfile={onOpenProfile}
          onShowReplies={() => setThreadDisplayMode("separated")}
          onOpenReply={(post) => toggleReplyFor(post.uri)}
          onCloseReply={closeReply}
          onReplied={onReplied}
          threadRootRef={threadRootRef}
          activeQuoteUri={activeQuoteUri}
          onOpenQuote={(post) => toggleQuoteFor(post.uri)}
          onCloseQuote={closeQuote}
          onQuoted={onReplied}
        />
      ) : threadParts.length > 1 && threadRootRef ? (
        <LongThreadCard
          parts={threadParts}
          expandedReplies={expandedBranches}
          onToggleReplies={(uri) => setExpandedBranches((current) => ({ ...current, [`part-replies:${uri}`]: !current[`part-replies:${uri}`] }))}
          onToggleBranch={(uri) => setExpandedBranches((current) => ({ ...current, [uri]: !current[uri] }))}
          handlers={{
            loadingBranches,
            branchResults,
            onLoadBranch,
            onOpenImage,
            onOpenPost,
            onOpenProfile,
            activeReplyParentUri,
            canReply,
            onOpenReply: (post) => toggleReplyFor(post.uri),
            onCloseReply: closeReply,
            onReplied,
            threadRootRef,
            activeQuoteUri,
            onOpenQuote: (post) => toggleQuoteFor(post.uri),
            onCloseQuote: closeQuote,
            onQuoted: onReplied,
          }}
          savedState={{ currentDid, localLists, onToggleListPost }}
        />
      ) : (
        renderThreadNode(thread.node, 0, expandedBranches, (uri) =>
          setExpandedBranches((current) => ({ ...current, [uri]: !current[uri] })),
          {
            loadingBranches,
            branchResults,
            onLoadBranch,
            onOpenImage,
            onOpenPost,
            onOpenProfile,
            activeReplyParentUri,
            canReply,
            onOpenReply: (post) => toggleReplyFor(post.uri),
            onCloseReply: closeReply,
            onReplied,
            threadRootRef,
            activeQuoteUri,
            onOpenQuote: (post) => toggleQuoteFor(post.uri),
            onCloseQuote: closeQuote,
            onQuoted: onReplied,
          },
          { currentDid, localLists, onToggleListPost },
          1,
        )
      )}
    </div>
  );
}

function renderThreadContextNode(
  node: ThreadNode,
  index: number,
  total: number,
  handlers: {
    loadingBranches: Record<string, boolean>;
    branchResults: Record<string, BranchLoadResult>;
    onLoadBranch: (uri: string) => void;
    onOpenImage: (image: ImageViewerState) => void;
    onOpenPost: (post: FeedPost) => void;
    onOpenProfile: (profile: Profile) => void;
  },
  savedState: {
    currentDid?: string;
    localLists: LocalList[];
    onToggleListPost: (listId: string, post: FeedPost) => void;
  },
) {
  if (!("post" in node)) {
    const state = threadUnavailableState(node);

    return (
      <div className={`thread-context-item unavailable ${state.tone}`} key={`parent:${index}`}>
        <span className="thread-context-step">{index + 1}</span>
        <div className={`thread-alert ${state.tone}`}>
          <ShieldAlert size={16} />
          <span>
            <strong>{state.title}</strong>
            <small>{state.detail}</small>
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="thread-context-item" key={node.post.uri}>
      <span className="thread-context-step">{index + 1}</span>
      <div>
        <small>
          {index + 1 === total ? "Direct parent" : `Parent ${index + 1} of ${total}`}
        </small>
        <PostCard
          item={{ post: node.post }}
          currentDid={savedState.currentDid}
          forceFullCard
          onOpenImage={handlers.onOpenImage}
          onOpenPost={handlers.onOpenPost}
          onOpenProfile={handlers.onOpenProfile}
          localLists={savedState.localLists}
          onToggleListPost={savedState.onToggleListPost}
        />
      </div>
    </div>
  );
}

function LongThreadCard({
  parts,
  expandedReplies,
  onToggleReplies,
  onToggleBranch,
  handlers,
  savedState,
}: {
  parts: ThreadPart[];
  expandedReplies: Record<string, boolean>;
  onToggleReplies: (uri: string) => void;
  onToggleBranch: (uri: string) => void;
  handlers: {
    loadingBranches: Record<string, boolean>;
    branchResults: Record<string, BranchLoadResult>;
    onLoadBranch: (uri: string) => void;
    onOpenImage: (image: ImageViewerState) => void;
    onOpenPost: (post: FeedPost) => void;
    onOpenProfile: (profile: Profile) => void;
    activeReplyParentUri: string | null;
    canReply: boolean;
    onOpenReply: (post: FeedPost) => void;
    onCloseReply: () => void;
    onReplied?: () => void;
    threadRootRef: PostRefValue;
    activeQuoteUri: string | null;
    onOpenQuote: (post: FeedPost) => void;
    onCloseQuote: () => void;
    onQuoted?: () => void;
  };
  savedState: {
    currentDid?: string;
    localLists: LocalList[];
    onToggleListPost: (listId: string, post: FeedPost) => void;
  };
}) {
  const onOpenTag = useContext(TagSearchContext);
  const rootPost = parts[0].node.post;
  const firstTimeLabel = formatPostTime(postSortAt(rootPost));
  const totalReplies = parts.reduce((total, part) => total + part.replies.length, 0);

  return (
    <article className="post-card long-thread-card text-only">
      <PostCardHeader
        profile={rootPost.author}
        post={rootPost}
        timestampLabel={firstTimeLabel}
        onOpenProfile={handlers.onOpenProfile}
        onOpenPost={handlers.onOpenPost}
      />
      <div className="post-badges" aria-label="Thread context">
        <span>{parts.length.toLocaleString()} part thread</span>
        <span>{totalReplies === 1 ? "1 reply" : `${totalReplies.toLocaleString()} replies`}</span>
      </div>
      <div className="long-thread-parts">
        {parts.map((part, index) => {
          const post = part.node.post;
          const text = post.record.text?.trim() || "";
          const replyCount = part.replies.length;
          const expanded = !!expandedReplies[`part-replies:${post.uri}`];
          const hasThreadContinuation = parts[index + 1]?.node.post.record.reply?.parent?.uri === post.uri;
          // post.replyCount (AppView) counts ALL replies incl. the continuation,
          // so subtract it. The fallback (part.replies) already excludes the
          // continuation in buildThreadParts, so it must NOT be decremented again.
          const commentCount =
            post.replyCount != null ? Math.max(0, post.replyCount - (hasThreadContinuation ? 1 : 0)) : replyCount;
          return (
            <section className="long-thread-part" key={post.uri}>
              <div className="long-thread-part-label">Thread post {part.partNumber} of {parts.length}</div>
              {text ? (
                <p className={postTextClass(text)}>
                  {renderRichText(post.record.facets?.length ? post.record.text || "" : text, post.record.facets, handlers.onOpenProfile, onOpenTag)}
                </p>
              ) : (
                <p className="post-text muted">Thread post {part.partNumber} has no plain text.</p>
              )}
              <PostEmbeds
                post={post}
                onOpenImage={handlers.onOpenImage}
                onOpenPost={handlers.onOpenPost}
                onOpenProfile={handlers.onOpenProfile}
              />
              <PostActionBar
                post={post}
                commentCount={commentCount}
                commentTitle={
                  part.replies.length > 0
                    ? "Show replies to this thread post"
                    : commentCount > 0
                      ? "Open this thread post to see its replies"
                      : "No replies to this thread post"
                }
                onOpenPost={() => {
                  // Descendant parts carry their hydrated replies, so toggle them
                  // inline. Ancestor parts (from buildAnchoredThreadParts) have
                  // their replies stripped to [] — the AppView only hydrates the
                  // anchor subtree — so an inline toggle has nothing to show. When
                  // such a part still reports replies (commentCount > 0), open it
                  // in its own thread view where its replies hydrate, instead of
                  // leaving a dead button.
                  if (part.replies.length > 0) {
                    onToggleReplies(post.uri);
                  } else if (commentCount > 0) {
                    handlers.onOpenPost(post);
                  }
                }}
                onReply={handlers.onOpenReply}
                replyActive={handlers.activeReplyParentUri === post.uri}
                canReply={handlers.canReply}
                onQuote={handlers.onOpenQuote}
                quoteActive={handlers.activeQuoteUri === post.uri}
              />
              {handlers.activeReplyParentUri === post.uri && (
                <PostComposer
                  replyTo={{ parent: post, root: handlers.threadRootRef }}
                  canReply={handlers.canReply}
                  onClose={handlers.onCloseReply}
                  onReplied={handlers.onReplied}
                />
              )}
              {handlers.activeQuoteUri === post.uri && (
                <PostComposer quote={post} onClose={handlers.onCloseQuote} onQuoted={handlers.onQuoted} />
              )}
              {expanded && part.replies.length > 0 && (
                <div className="long-thread-replies">
                  <div className="thread-replies-divider">
                    <span>Replies to thread post {part.partNumber}</span>
                  </div>
                  {part.replies.map((reply) =>
                    renderThreadNode(
                      reply,
                      0,
                      expandedReplies,
                      onToggleBranch,
                      handlers,
                      savedState,
                    ),
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </article>
  );
}

function threadDepthStyle(depth: number): CSSProperties {
  return { "--thread-depth": depth } as CSSProperties;
}

function renderThreadNode(
  node: ThreadNode,
  depth: number,
  expandedBranches: Record<string, boolean>,
  onToggleBranch: (uri: string) => void,
  handlers: {
    loadingBranches: Record<string, boolean>;
    branchResults: Record<string, BranchLoadResult>;
    onLoadBranch: (uri: string) => void;
    onOpenImage: (image: ImageViewerState) => void;
    onOpenPost: (post: FeedPost) => void;
    onOpenProfile: (profile: Profile) => void;
    activeReplyParentUri: string | null;
    canReply: boolean;
    onOpenReply: (post: FeedPost) => void;
    onCloseReply: () => void;
    onReplied?: () => void;
    threadRootRef: PostRefValue | null;
    activeQuoteUri: string | null;
    onOpenQuote: (post: FeedPost) => void;
    onCloseQuote: () => void;
    onQuoted?: () => void;
  },
  savedState: {
    currentDid?: string;
    localLists: LocalList[];
    onToggleListPost: (listId: string, post: FeedPost) => void;
  },
  opPartIndex?: number,
): React.ReactNode {
  if (!("post" in node)) {
    const state = threadUnavailableState(node);

    return (
      <div className={`thread-alert ${state.tone}`} style={threadDepthStyle(depth)}>
        <ShieldAlert size={16} />
        <span>
          <strong>{state.title}</strong>
          <small>{state.detail}</small>
        </span>
      </div>
    );
  }

  const replies = node.replies ?? [];
  const isExpanded = !!expandedBranches[node.post.uri];
  const continuationReply = getContinuationReply(node.post, replies);
  const discussionReplies = continuationReply ? replies.filter((reply) => reply !== continuationReply) : replies;
  const visibleReplies = isExpanded ? discussionReplies : discussionReplies.slice(0, 8);
  const hiddenReplyCount = Math.max(0, discussionReplies.length - visibleReplies.length);
  const hasCollapsedReplies = discussionReplies.length > 8;
  const knownReplyCount = node.post.replyCount ?? 0;
  const hasUnloadedReplies = knownReplyCount > replies.length;
  const isLoadingBranch = !!handlers.loadingBranches[node.post.uri];
  const branchResult = handlers.branchResults[node.post.uri];
  const canLoadUnloadedReplies = hasUnloadedReplies && (!hasCollapsedReplies || isExpanded);

  return (
    <div className="thread-node" key={node.post.uri} style={threadDepthStyle(depth)}>
      <PostCard
        item={{ post: node.post }}
        currentDid={savedState.currentDid}
        forceFullCard
        onOpenImage={handlers.onOpenImage}
        onOpenPost={handlers.onOpenPost}
        onOpenProfile={handlers.onOpenProfile}
        onReply={handlers.canReply ? handlers.onOpenReply : undefined}
        replyActive={handlers.activeReplyParentUri === node.post.uri}
        onQuote={handlers.canReply ? handlers.onOpenQuote : undefined}
        quoteActive={handlers.activeQuoteUri === node.post.uri}
        localLists={savedState.localLists}
        onToggleListPost={savedState.onToggleListPost}
      />
      {handlers.activeReplyParentUri === node.post.uri && handlers.threadRootRef && (
        <PostComposer
          replyTo={{ parent: node.post, root: handlers.threadRootRef }}
          canReply={handlers.canReply}
          onClose={handlers.onCloseReply}
          onReplied={handlers.onReplied}
        />
      )}
      {handlers.activeQuoteUri === node.post.uri && (
        <PostComposer quote={node.post} onClose={handlers.onCloseQuote} onQuoted={handlers.onQuoted} />
      )}
      {continuationReply && (
        <>
          <div className="thread-continuation" style={threadDepthStyle(depth + 1)}>
            <span>Post continues</span>
          </div>
          {renderThreadNode(continuationReply, depth + 1, expandedBranches, onToggleBranch, handlers, savedState, (opPartIndex ?? 1) + 1)}
        </>
      )}
      {visibleReplies.length > 0 && (
        <div className="thread-replies-divider" style={threadDepthStyle(depth + 1)}>
          <span>{opPartIndex ? `Replies to post ${opPartIndex}` : "Replies"}</span>
        </div>
      )}
      {visibleReplies.map((reply) =>
        renderThreadNode(reply, depth + 1, expandedBranches, onToggleBranch, handlers, savedState),
      )}
      {hasCollapsedReplies && (
        <button className="load-more branch-toggle" type="button" onClick={() => onToggleBranch(node.post.uri)}>
          {isExpanded ? "Show fewer replies" : `Show ${hiddenReplyCount} more replies`}
        </button>
      )}
      {canLoadUnloadedReplies && isLoadingBranch && (
        <div className="branch-load-status" role="status">
          Loading replies...
        </div>
      )}
      {canLoadUnloadedReplies && !isLoadingBranch && (
        <button
          className="load-more branch-toggle"
          type="button"
          onClick={() => handlers.onLoadBranch(node.post.uri)}
        >
          {`Load ${knownReplyCount - replies.length} more replies`}
        </button>
      )}
      {!isLoadingBranch && branchResult?.error && (
        <div className="branch-load-status branch-load-error" role="alert">
          Couldn't load replies — {branchResult.error}
        </div>
      )}
      {!isLoadingBranch && branchResult && branchResult.error === undefined && (
        <div className="branch-load-status" role="status">
          {branchResult.added > 0
            ? `Loaded ${branchResult.added.toLocaleString()} more ${branchResult.added === 1 ? "reply" : "replies"}`
            : "No new replies returned"}
        </div>
      )}
    </div>
  );
}

