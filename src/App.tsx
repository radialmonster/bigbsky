import {
  Bookmark,
  Compass,
  Hash,
  Home,
  Info,
  List,
  Loader2,
  LogOut,
  Menu,
  Plus,
  X,
  ChevronUp,
  ChevronDown,
  GripVertical,
  Search,
  Settings,
  User,
} from "lucide-react";
import { lazy, Suspense, type RefObject, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  type FeedItem,
  type FeedGeneratorView,
  type FeedPost,
  type ListView,
  type Profile,
  type ThreadNode,
  isListUri,
  isFeedGeneratorUri,
  getEmbedImages,
  getExternalEmbed,
  getVideoEmbed,
  rateLimitMessage,
} from "./api";
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
import { postPath, extractFacetLinks } from "./lib/url";
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
  buildThreadedFeedRows,
  countThreadRows,
  feedRowKey,
  feedRowPost,
  isSelfThreadReply,
  isThreadedFeedItem,
  postReplyRootUri,
} from "./lib/threads";
import { EmptyState, EndOfFeedCard, RateLimitState } from "./features/common/State";
import { ToastContext, ToastHost, type ToastKind, type ToastMessage } from "./features/common/ToastHost";
import { BackToTopButton } from "./features/feed/BackToTopButton";
import { safeEmbedImages } from "./features/post/PostImageVideoMedia";
import { PostCard } from "./features/post/PostCard";
import {
  BookmarkContext,
  BlockContext,
  DeletePostContext,
  DensityContext,
  LikeContext,
  TagSearchContext,
  type BookmarkContextValue,
  type BookmarkView,
  type BlockContextValue,
  type BlockView,
  type DeletePostContextValue,
  type LikeContextValue,
  type LikeView,
} from "./features/post/PostCardContexts";
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
import { ShowMediaContext, ShowNsfwContext } from "./features/common/useMediaReveal";
import { ImageViewer, type ImageViewerState } from "./features/post/ImageViewer";
import { sensitiveMediaValues } from "./lib/moderation";
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
} from "./features/composer/PostComposer";
import { ThreadView, ThreadedPostCard, replyRootRefForPost, useComposerTargets } from "./features/thread/ThreadView";

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

// Stable no-op for hot paths that only feed DEV-only widgets (see the
// DEV-gated onRenderedRowsChange in App).
const noop = () => {};

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

function hasPostImages(post: FeedPost) {
  return safeEmbedImages(getEmbedImages(post.embed)).length > 0;
}

function hasPostVideo(post: FeedPost) {
  return !!getVideoEmbed(post.embed);
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
  // The rendered-row count is only shown in the DevInspector (DEV builds). In
  // production, forwarding it would call setState on every scroll and re-render
  // the whole tree for nothing, so gate the forward behind DEV (stable noop
  // otherwise keeps the effect deps stable).
  const onRenderedRowsChange = import.meta.env.DEV ? setVirtualRenderedRows : noop;
  // The Settings "local data" key count walks localStorage; recompute it only
  // when a preference state that writes a bigbsky:* key changes, not on every
  // render.
  const localDataKeyCount = useMemo(
    () => countBigBskyLocalKeys(),
    [
      densityByContext,
      showMediaByFeed,
      columns,
      showNsfw,
      showMedia,
      contentLanguages,
      homeSourceId,
      recentItems,
      localLists,
      pinnedFeedIds,
      pinnedFeedMeta,
      feedOrder,
      pinnedSearches,
      pinnedProfiles,
      pinnedNotificationIds,
      collapsedFeedGroups,
    ],
  );
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
    likeInFlight.current.clear();
    bookmarkInFlight.current.clear();
    blockInFlight.current.clear();
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
      void loadFeedSearch(route.query, undefined, controller.signal);
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
    const next = { ...columns, [which]: visible };
    setColumns(next);
    safeLocalStorageSet(columnsStorageKey, JSON.stringify(next));
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
    // Wipe the optimistic write overrides + in-flight guards too, or a stale
    // override (or a stuck in-flight entry) would repaint/block that URI after
    // the wipe — the identity-change effect below only fires on sign-out.
    setLikeOverrides({});
    setBookmarkOverrides({});
    setBlockOverrides({});
    likeInFlight.current.clear();
    bookmarkInFlight.current.clear();
    blockInFlight.current.clear();
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

  const remember = useCallback(
    (item: RecentItem) => {
      const next = [item, ...recentItems.filter((existing) => existing.path !== item.path)].slice(0, 8);
      setRecentItems(next);
      safeLocalStorageSet(recentStorageKey, JSON.stringify(next));
    },
    [recentItems],
  );

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
    // The UUID/timestamp must be generated outside the updater (updaters must
    // be pure; crypto.randomUUID() inside one can generate a different id per
    // invocation under StrictMode double-render).
    const next = [
      {
        id: crypto.randomUUID(),
        name: trimmedName.slice(0, 80),
        description: description.trim().slice(0, 180),
        createdAt: new Date().toISOString(),
      },
      ...localLists,
    ].slice(0, 20);
    setLocalLists(next);
    safeLocalStorageSet(localListsStorageKey, JSON.stringify(next));
  }

  function deleteLocalList(id: string) {
    const next = localLists.filter((list) => list.id !== id);
    setLocalLists(next);
    safeLocalStorageSet(localListsStorageKey, JSON.stringify(next));
  }

  function togglePostInLocalList(listId: string, post: FeedPost) {
    const next = localLists.map((list) => {
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
    setLocalLists(next);
    safeLocalStorageSet(localListsStorageKey, JSON.stringify(next));
  }

  function togglePinnedFeed(source: FeedSource) {
    const willPin = !pinnedFeedIds.includes(source.id);
    const nextIds = willPin
      ? [source.id, ...pinnedFeedIds.filter((id) => id !== source.id)].slice(0, 12)
      : pinnedFeedIds.filter((id) => id !== source.id);
    setPinnedFeedIds(nextIds);
    safeLocalStorageSet(pinnedFeedsStorageKey, JSON.stringify(nextIds));
    // Discovered Feeds aren't in the static feedSources list, so persist their
    // metadata separately; otherwise the pinned id can't be resolved on reload.
    if (!feedSources.some((item) => item.id === source.id)) {
      const withoutSource = pinnedFeedMeta.filter((item) => item.id !== source.id);
      const nextMeta = willPin ? [{ ...source }, ...withoutSource].slice(0, 12) : withoutSource;
      setPinnedFeedMeta(nextMeta);
      writePinnedFeedMeta(nextMeta);
    }
  }

  // Local-only manual reordering of pinned feeds. The Pinned group renders in
  // pinnedFeedIds order, so swapping ids here reorders the selector and the
  // change persists in browser storage (no account-backed ordering yet).
  function movePinnedFeed(id: string, direction: -1 | 1) {
    const index = pinnedFeedIds.indexOf(id);
    if (index < 0) {
      return;
    }
    const target = index + direction;
    if (target < 0 || target >= pinnedFeedIds.length) {
      return;
    }
    const next = [...pinnedFeedIds];
    [next[index], next[target]] = [next[target], next[index]];
    setPinnedFeedIds(next);
    safeLocalStorageSet(pinnedFeedsStorageKey, JSON.stringify(next));
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

    const exists = pinnedSearches.some((item) => item.toLowerCase() === trimmed.toLowerCase());
    const next = exists
      ? pinnedSearches.filter((item) => item.toLowerCase() !== trimmed.toLowerCase())
      : [trimmed, ...pinnedSearches].slice(0, 12);
    setPinnedSearches(next);
    safeLocalStorageSet(pinnedSearchesStorageKey, JSON.stringify(next));
  }

  function togglePinnedProfile(profileToPin: Profile | null | undefined) {
    if (!profileToPin?.did || !profileToPin.handle) {
      return;
    }

    const exists = pinnedProfiles.some((item) => item.did === profileToPin.did || item.handle === profileToPin.handle);
    const next = exists
      ? pinnedProfiles.filter((item) => item.did !== profileToPin.did && item.handle !== profileToPin.handle)
      : [profileToPin, ...pinnedProfiles].slice(0, 16);
    setPinnedProfiles(next);
    safeLocalStorageSet(pinnedProfilesStorageKey, JSON.stringify(next));
  }

  function togglePinnedNotification(id: string) {
    const next = pinnedNotificationIds.includes(id)
      ? pinnedNotificationIds.filter((item) => item !== id)
      : [id, ...pinnedNotificationIds].slice(0, 20);
    setPinnedNotificationIds(next);
    safeLocalStorageSet(pinnedNotificationsStorageKey, JSON.stringify(next));
  }

  function toggleCollapsedFeedGroup(group: string) {
    const next = { ...collapsedFeedGroups, [group]: !collapsedFeedGroups[group] };
    setCollapsedFeedGroups(next);
    safeLocalStorageSet(collapsedFeedGroupsStorageKey, JSON.stringify(next));
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
    const surfaceDetail: Record<string, string> = {
      Lists: "Local list workspaces",
      Bookmarks: "Bookmarked posts and saves",
      Settings: "Appearance, data, and account settings",
      Info: "About BigBsky and help",
    };
    remember({
      label: item,
      detail: surfaceDetail[item] ?? item,
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
    // Keyed on the full route object (not just route.kind): surface->surface
    // navigation (e.g. bookmarks -> lists) swaps the mounted .timeline node
    // without changing route.kind, so the listener must re-attach on every
    // navigation. route, activeSource.id, profileTab, and navOpen together
    // fully determine which element timelineRef.current points at.
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
  }, [activeSource.id, navOpen, profileTab, route]);

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

    // Pending rAF for the deferred content-anchor scan (see rememberScroll).
    let anchorFrame: number | null = null;
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
      // the fallback. readTopVisibleAnchor scans the mounted rows, so defer the
      // scan to a rAF instead of running it on every scroll event (issue #40);
      // the cheap pixel write above stays synchronous.
      if (anchorFrame === null) {
        anchorFrame = requestAnimationFrame(() => {
          anchorFrame = null;
          captureAnchor();
        });
      }
    };
    const captureAnchor = () => {
      const anchor = readTopVisibleAnchor(timeline);
      if (anchor) {
        scrollAnchorCache.set(activeScrollKey, anchor);
      } else {
        scrollAnchorCache.delete(activeScrollKey);
      }
    };
    const persistScroll = () => {
      rememberScroll();
      // Flush any deferred anchor scan synchronously while the timeline is
      // still attached (pagehide fires before navigation detaches the element).
      if (anchorFrame !== null) {
        cancelAnimationFrame(anchorFrame);
        anchorFrame = null;
      }
      captureAnchor();
      writeTimelineScrollCache(Object.fromEntries(scrollCache.entries()));
      writeTimelineAnchorCache(Object.fromEntries(scrollAnchorCache.entries()));
    };
    // On mobile the document scrolls (timeline stays at 0), so also listen on
    // window; on desktop the timeline element is the scroller.
    timeline.addEventListener("scroll", rememberScroll, { passive: true });
    window.addEventListener("scroll", rememberScroll, { passive: true });
    window.addEventListener("pagehide", persistScroll);
    return () => {
      if (anchorFrame !== null) {
        cancelAnimationFrame(anchorFrame);
      }
      timeline.removeEventListener("scroll", rememberScroll);
      window.removeEventListener("scroll", rememberScroll);
      window.removeEventListener("pagehide", persistScroll);
      // Flush the last live offset captured by the scroll handlers. Do NOT
      // re-read scroll here: on navigation this cleanup runs after the timeline
      // element has detached, and a detached element reports scrollTop 0, which
      // would clobber the saved offset and break restoration on return. The
      // anchor cache likewise holds the last capture taken while attached.
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
      } else if (route.query && searchTab === "feeds" && feedSearchState.cursor) {
        promise = loadFeedSearch(route.query, feedSearchState.cursor, signal);
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
  const submitSearch = useCallback(
    (query: string) => {
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
    },
    [navigate, remember],
  );
  const openTag = useCallback(
    (tag: string) => {
      const trimmed = tag.trim();
      if (!trimmed) {
        return;
      }
      submitSearch(trimmed.startsWith("#") ? trimmed : `#${trimmed}`);
    },
    [submitSearch],
  );
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
            localDataKeyCount={localDataKeyCount}
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
                    onRenderedRowsChange={onRenderedRowsChange}
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
                onRenderedRowsChange={onRenderedRowsChange}
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
      const rowIndex = anchoredRowsRef.current.findIndex((candidate) => feedRowKey(candidate) === rowKey);
      const rowTop = rowIndex >= 0 ? anchoredRowOffsetsRef.current[rowIndex] ?? 0 : 0;
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
    [containerRef, defaultRowHeight],
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

function FeedDirectoryCard({
  source,
  densityByContext,
  showMediaByFeed,
  showMedia,
  defaultDensity,
  pinnedFeedIds,
  onOpenFeed,
  onTogglePinnedFeed,
  onFeedDensityOverrideChange,
  onFeedShowMediaOverrideChange,
  canFollowFeeds,
  followBusyUri,
  onToggleFollowFeed,
  canReorderFeeds = false,
  index = 0,
  reorderCount = 0,
  draggingFeedUri = null,
  setDraggingFeedUri,
  onReorderFeed,
  onMoveFeed,
}: {
  source: FeedSource;
  densityByContext: Record<string, DensityMode>;
  showMediaByFeed: Record<string, boolean>;
  showMedia: boolean;
  defaultDensity: DensityMode;
  pinnedFeedIds: string[];
  onOpenFeed: (source: FeedSource) => void;
  onTogglePinnedFeed: (source: FeedSource) => void;
  onFeedDensityOverrideChange: (source: FeedSource, density: DensityMode | null) => void;
  onFeedShowMediaOverrideChange: (source: FeedSource, value: boolean | null) => void;
  canFollowFeeds?: boolean;
  followBusyUri?: string | null;
  onToggleFollowFeed?: (feedUri: string, label?: string) => void;
  canReorderFeeds?: boolean;
  index?: number;
  reorderCount?: number;
  draggingFeedUri?: string | null;
  setDraggingFeedUri?: (uri: string | null) => void;
  onReorderFeed?: (fromUri: string, toUri: string) => void;
  onMoveFeed?: (uri: string, direction: -1 | 1) => void;
}) {
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
      aria-label={canReorderFeeds ? `Feed reorder target: ${source.label}` : undefined}
      key={source.id}
      onDragOver={
        canReorderFeeds && onReorderFeed
          ? (event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
            }
          : undefined
      }
      onDrop={
        canReorderFeeds && onReorderFeed
          ? (event) => {
              event.preventDefault();
              const fromUri = event.dataTransfer.getData("text/plain");
              if (fromUri) {
                onReorderFeed(fromUri, source.uri);
              }
              setDraggingFeedUri?.(null);
            }
          : undefined
      }
    >
      {canReorderFeeds && setDraggingFeedUri && onMoveFeed && (
        <div
          className="feed-card-reorder"
          draggable
          role="button"
          tabIndex={0}
          aria-label={`Drag ${source.label} to reorder`}
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
            disabled={index === reorderCount - 1}
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
        {canFollowFeeds && onToggleFollowFeed && (
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
      // The feeds surface renders its own dedicated directory layout, so no
      // generic surface cards are needed here.
      cards: [],
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
                {subscribedFeeds.map((source, index) => (
                  <FeedDirectoryCard
                    key={source.id}
                    source={source}
                    densityByContext={densityByContext}
                    showMediaByFeed={showMediaByFeed}
                    showMedia={showMedia}
                    defaultDensity={defaultDensity}
                    pinnedFeedIds={pinnedFeedIds}
                    onOpenFeed={onOpenFeed}
                    onTogglePinnedFeed={onTogglePinnedFeed}
                    onFeedDensityOverrideChange={onFeedDensityOverrideChange}
                    onFeedShowMediaOverrideChange={onFeedShowMediaOverrideChange}
                    canFollowFeeds={canFollowFeeds}
                    followBusyUri={followBusyUri}
                    onToggleFollowFeed={onToggleFollowFeed}
                    canReorderFeeds={canReorderFeeds}
                    index={index}
                    reorderCount={subscribedFeeds.length}
                    draggingFeedUri={draggingFeedUri}
                    setDraggingFeedUri={setDraggingFeedUri}
                    onReorderFeed={onReorderFeed}
                    onMoveFeed={onMoveFeed}
                  />
                ))}
              </div>
            )}
          </section>
          <section className="bsky-list-section" aria-label="Built-in feeds">
            <h3 className="bsky-list-section-heading">Built-in feeds</h3>
            <div className="feed-directory-grid">
              {builtInFeeds.map((source) => (
                <FeedDirectoryCard
                  key={source.id}
                  source={source}
                  densityByContext={densityByContext}
                  showMediaByFeed={showMediaByFeed}
                  showMedia={showMedia}
                  defaultDensity={defaultDensity}
                  pinnedFeedIds={pinnedFeedIds}
                  onOpenFeed={onOpenFeed}
                  onTogglePinnedFeed={onTogglePinnedFeed}
                  onFeedDensityOverrideChange={onFeedDensityOverrideChange}
                  onFeedShowMediaOverrideChange={onFeedShowMediaOverrideChange}
                />
              ))}
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
            {feedSearchState.status === "ready" && feedSearchState.feeds.length > 0 && (
              <>
                {feedSearchState.cursor && (
                  <AutoLoadMoreButton label="Load more feeds" onLoadMore={onLoadMore} error={feedSearchState.loadMoreError} />
                )}
                {!feedSearchState.cursor && !feedSearchState.loadMoreError && <EndOfFeedCard />}
              </>
            )}
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
