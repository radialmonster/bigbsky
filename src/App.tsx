import {
  Bookmark,
  Check,
  Compass,
  EyeOff,
  Film,
  Hash,
  Heart,
  Home,
  Image,
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
  Smile,
  User,
  Users,
} from "lucide-react";
import { createContext, lazy, Suspense, type CSSProperties, type FormEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ApiError,
  type ActorSearchResponse,
  type FeedItem,
  type FeedGeneratorView,
  type FeedPost,
  type ListView,
  type Profile,
  type RecordEmbedView,
  type RichTextFacet,
  type SearchPostsResponse,
  type ThreadNode,
  type TrendingTopic,
  getActorFeeds,
  getActorLists,
  getLikes,
  getList,
  getListFeed,
  getQuotes,
  getRepostedBy,
  isListUri,
  getEmbedImages,
  getExternalEmbed,
  getAuthorFeed,
  getFeed,
  getFeedGenerator,
  getPopularFeedGenerators,
  getTrendingTopics,
  getRecordEmbed,
  getUnknownEmbedType,
  getVideoEmbed,
  searchActors,
} from "./api";
import { segmentRichText } from "./richtext";
import { postSortAt, postSortTime } from "./lib/time";
import {
  CONTINUATION_REPLY_WINDOW_MS,
  POST_BYTE_LIMIT,
  POST_GRAPHEME_LIMIT,
  buildThreadParts,
  buildThreadedFeedRows,
  canHideCombinedThreadMarkers,
  combinedThreadText,
  countThreadPostNodes,
  countThreadRows,
  expectedThreadMarkerTotal,
  feedRowKey,
  feedRowPost,
  findThreadNodeByUri,
  getContinuationReply,
  graphemeLength,
  isSelfThreadReply,
  isThreadedFeedItem,
  postReplyRootUri,
  replaceThreadBranch,
  splitTextForThread,
  threadMarkerMatch,
  utf8ByteLength,
} from "./lib/threads";
import type { ThreadPart, ThreadedFeedItem } from "./lib/threads";
import {
  type AuthSnapshot,
  type ListMember,
  type NotificationItem,
  type SubscribedFeed,
  blockAccount,
  bookmarkPost,
  followAccount,
  followFeed,
  getAccountManagementUrl,
  getAuthorFeedAuthed,
  getFeedAuthed,
  getBookmarks,
  getFollowingTimeline,
  getPostThreadAuthed,
  getPostThreadByUriAuthed,
  addAccountToList,
  createModList,
  deleteModList,
  getListMembers,
  getMissingScopes,
  getMyLists,
  getNotifications,
  getUnreadNotificationCount,
  getProfileAuthed,
  getSubscribedFeeds,
  markNotificationsSeen,
  muteList,
  removeListItem,
  subscribeBlockList,
  unmuteList,
  unsubscribeBlockList,
  clearOAuthLocalSession,
  initAuthSession,
  likePost,
  MAX_POST_IMAGES,
  publishPost,
  publishThread,
  deletePost,
  searchPostsAuthed,
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

const navIcons = [Home, Hash, List, Bookmark, Search, Compass, User, Settings];
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

function safeLocalStorageSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function safeLocalStorageRemove(key: string) {
  try {
    localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

function safeLocalStorageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSessionStorageRemove(key: string) {
  try {
    sessionStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

function safeHttpUrl(value?: string | null) {
  if (!value) {
    return undefined;
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

type FeedState = {
  items: FeedItem[];
  cursor?: string;
  status: "idle" | "loading" | "ready" | "error" | "rate-limit";
  error?: string;
  loadMoreError?: string;
};

type SearchState = {
  posts: FeedPost[];
  cursor?: string;
  status: "idle" | "loading" | "ready" | "error" | "rate-limit";
  error?: string;
  loadMoreError?: string;
};

type ActorSearchState = {
  actors: Profile[];
  cursor?: string;
  status: "idle" | "loading" | "ready" | "error" | "rate-limit";
  error?: string;
  loadMoreError?: string;
};

type FeedSearchState = {
  feeds: FeedGeneratorView[];
  status: "idle" | "loading" | "ready" | "error" | "rate-limit";
  error?: string;
};

type ImageViewerImage = {
  src: string;
  previewSrc?: string;
  alt: string;
};

type ImageViewerState = {
  images: ImageViewerImage[];
  index: number;
} | null;

type RecentItem = {
  label: string;
  path: string;
  route: RouteState;
  detail: string;
  sourceId?: string;
};

type LocalList = {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  posts?: FeedPost[];
};

type EntityCache = {
  posts: Record<string, FeedPost>;
  profiles: Record<string, Profile>;
  linkUrls: string[];
};

type DevMetrics = {
  apiRequests: number;
  cacheHits: number;
  sameOriginRequests: number;
  runtimeWarnings: string[];
  serviceWorkerState: string;
};

type AuthState = {
  status: "checking" | "signed-out" | "signing-in" | "signing-out" | "signed-in" | "callback" | "error";
  session: AuthSnapshot | null;
  message?: string;
};

const densityModes = ["comfortable", "compact", "media"] as const;
type DensityMode = (typeof densityModes)[number];
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

// One entry in the Settings "Open Home to" picker. `group` drives the section
// headings (Following / Feeds / Lists) in the searchable picker.
type HomeOption = { id: string; label: string; needsAuth: boolean; group: "Following" | "Feeds" | "Lists" };
const searchTabs = ["posts", "people", "feeds"] as const;
const profileTabs = ["posts", "replies", "media", "videos", "feeds", "lists"] as const;
type ProfileTab = (typeof profileTabs)[number] | "new-post";
type ProfileFeedFilter = "posts_with_replies" | "posts_no_replies" | "posts_with_media" | "posts_with_video";
const searchLanguages = [
  { label: "Any language", value: "" },
  { label: "English", value: "en" },
  { label: "Spanish", value: "es" },
  { label: "Japanese", value: "ja" },
  { label: "German", value: "de" },
  { label: "French", value: "fr" },
];
const recentStorageKey = "bigbsky:recent";
const composerDraftStorageKey = "bigbsky:composer-draft";
const localListsStorageKey = "bigbsky:local-lists";
const workspaceWidthStorageKey = "bigbsky:workspace-width";
const widthByContextStorageKey = "bigbsky:width-by-context";
const columnsStorageKey = "bigbsky:columns";
const showNsfwStorageKey = "bigbsky:show-nsfw";
const showMediaStorageKey = "bigbsky:show-media";
const showMediaByFeedStorageKey = "bigbsky:show-media-by-feed";
const pinnedFeedsStorageKey = "bigbsky:pinned-feeds";
const feedOrderStorageKey = "bigbsky:feed-order";
const pinnedFeedMetaStorageKey = "bigbsky:pinned-feed-meta";
const pinnedSearchesStorageKey = "bigbsky:pinned-searches";
const pinnedProfilesStorageKey = "bigbsky:pinned-profiles";
const pinnedNotificationsStorageKey = "bigbsky:pinned-notifications";
const collapsedFeedGroupsStorageKey = "bigbsky:collapsed-feed-groups";
const timelineScrollStorageKey = "bigbsky:timeline-scroll";
const replyDraftPrefix = "bigbsky:reply-draft:";
const reauthDismissKey = "bigbsky:reauth-dismissed";
const emptyFeedState: FeedState = { items: [], status: "idle" };
const emptySearchState: SearchState = { posts: [], status: "idle" };
const emptyActorSearchState: ActorSearchState = { actors: [], status: "idle" };
const emptyFeedSearchState: FeedSearchState = { feeds: [], status: "idle" };
const initialDevMetrics: DevMetrics = {
  apiRequests: 0,
  cacheHits: 0,
  sameOriginRequests: 0,
  runtimeWarnings: [],
  serviceWorkerState: "checking",
};
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
  try {
    return JSON.parse(localStorage.getItem("bigbsky:density-by-context") || "{}") as Record<string, DensityMode>;
  } catch {
    return {};
  }
}

function readShowMediaPreferences() {
  try {
    const parsed = JSON.parse(localStorage.getItem(showMediaByFeedStorageKey) || "{}") as Record<string, unknown>;
    const result: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "boolean") {
        result[key] = value;
      }
    }
    return result;
  } catch {
    return {};
  }
}

function readRecentItems() {
  try {
    const items = JSON.parse(localStorage.getItem(recentStorageKey) || "[]") as RecentItem[];
    return Array.isArray(items) ? items.slice(0, 8) : [];
  } catch {
    return [];
  }
}

function readLocalLists() {
  try {
    const lists = JSON.parse(localStorage.getItem(localListsStorageKey) || "[]") as LocalList[];
    return Array.isArray(lists)
      ? lists
          .filter((list) => list && typeof list.id === "string" && typeof list.name === "string")
          .map((list) => ({
            ...list,
            posts: Array.isArray(list.posts)
              ? list.posts.filter((post) => post && typeof post.uri === "string").slice(0, 100)
              : [],
          }))
          .slice(0, 20)
      : [];
  } catch {
    return [];
  }
}

function readComposerDraft() {
  try {
    const draft = JSON.parse(localStorage.getItem(composerDraftStorageKey) || "{}") as {
      posts?: string[];
    };
    const posts = Array.isArray(draft.posts) ? draft.posts.filter((post) => typeof post === "string") : [];
    return {
      posts: posts.length > 0 ? [posts.join("\n\n")] : [""],
    };
  } catch {
    return { posts: [""] };
  }
}

// Side-column visibility. The far-left icon rail is always present; the feeds
// column and the right context column are each optional and toggled globally
// (not per-feed — a sidebar toggle is expected to be a window-wide preference).
// Migrates the previous balanced/wide/focus width preference: only "focus" hid
// a column (the right rail), so legacy focus users keep their right column off.
type ColumnVisibility = { feeds: boolean; right: boolean };

function readColumnPreferences(): ColumnVisibility {
  try {
    const stored = JSON.parse(localStorage.getItem(columnsStorageKey) || "null") as Partial<ColumnVisibility> | null;
    if (stored && typeof stored === "object") {
      return { feeds: stored.feeds !== false, right: stored.right !== false };
    }
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

function isPinnedFeedMeta(value: unknown): value is FeedSource {
  if (!value || typeof value !== "object") {
    return false;
  }
  const source = value as Partial<FeedSource>;
  return (
    typeof source.id === "string" &&
    source.id.startsWith("at://") &&
    typeof source.uri === "string" &&
    typeof source.label === "string" &&
    typeof source.description === "string" &&
    (source.group === "Core" ||
      source.group === "Official" ||
      source.group === "Discovered" ||
      source.group === "Project") // legacy alias for Discovered; kept so older pins still load
  );
}

function readPinnedFeedMeta(): FeedSource[] {
  try {
    const stored = JSON.parse(localStorage.getItem(pinnedFeedMetaStorageKey) || "[]") as unknown;
    return Array.isArray(stored) ? stored.filter(isPinnedFeedMeta).slice(0, 12) : [];
  } catch {
    return [];
  }
}

function readPinnedFeedIds(metaSources: FeedSource[] = readPinnedFeedMeta()) {
  try {
    const stored = JSON.parse(localStorage.getItem(pinnedFeedsStorageKey) || "[]") as string[];
    const knownIds = new Set([...feedSources.map((source) => source.id), ...metaSources.map((source) => source.id)]);
    return Array.isArray(stored) ? stored.filter((id) => knownIds.has(id)).slice(0, 12) : [];
  } catch {
    return [];
  }
}

// Browser-local manual ordering of the signed-in user's saved feeds, stored as
// a list of feed URIs. It is applied to subscribedFeeds for both the /feeds
// "Your feeds" grid and the desktop feed-selector "My Feeds" group; feeds not
// present here fall back to their account (Bluesky preference) order.
function readFeedOrder() {
  try {
    const stored = JSON.parse(localStorage.getItem(feedOrderStorageKey) || "[]") as unknown;
    return Array.isArray(stored) ? stored.filter((uri): uri is string => typeof uri === "string") : [];
  } catch {
    return [];
  }
}

function readPinnedSearches() {
  try {
    const stored = JSON.parse(localStorage.getItem(pinnedSearchesStorageKey) || "[]") as string[];
    return Array.isArray(stored) ? stored.filter((query) => typeof query === "string" && query.trim()).slice(0, 12) : [];
  } catch {
    return [];
  }
}

function readPinnedProfiles() {
  try {
    const stored = JSON.parse(localStorage.getItem(pinnedProfilesStorageKey) || "[]") as Profile[];
    return Array.isArray(stored)
      ? stored
          .filter((profile) => profile && typeof profile.did === "string" && typeof profile.handle === "string")
          .slice(0, 16)
      : [];
  } catch {
    return [];
  }
}

function readPinnedNotifications() {
  try {
    const stored = JSON.parse(localStorage.getItem(pinnedNotificationsStorageKey) || "[]") as string[];
    return Array.isArray(stored) ? stored.filter((id) => typeof id === "string" && id.trim()).slice(0, 20) : [];
  } catch {
    return [];
  }
}

function readCollapsedFeedGroups() {
  try {
    const stored = JSON.parse(localStorage.getItem(collapsedFeedGroupsStorageKey) || "{}") as Record<string, boolean>;
    return stored && typeof stored === "object" ? stored : {};
  } catch {
    return {};
  }
}

function readTimelineScrollCache() {
  try {
    const stored = JSON.parse(sessionStorage.getItem(timelineScrollStorageKey) || "{}") as Record<string, number>;
    if (!stored || typeof stored !== "object") {
      return {};
    }

    return Object.fromEntries(
      Object.entries(stored).filter((entry): entry is [string, number] => typeof entry[0] === "string" && Number.isFinite(entry[1])),
    );
  } catch {
    return {};
  }
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

function writeTimelineScrollCache(cache: Record<string, number>) {
  try {
    sessionStorage.setItem(timelineScrollStorageKey, JSON.stringify(cache));
  } catch {
    // Scroll restoration is best-effort browser state.
  }
}

// The scroll container differs by breakpoint: on desktop the bounded
// `.timeline` element scrolls, but on mobile `<html>` stays overflow:hidden
// while `body`/`#root` become height:auto + overflow-y:auto, so the document
// body is the real scroller and `timeline.scrollTop` (and often
// `window.scrollY`) stays 0. These helpers read/write whichever container is
// actually active so scroll restoration, back-to-top, and the header-hide
// logic all agree about the live offset.
const MOBILE_SCROLL_QUERY = "(max-width: 720px)";

// Live scroll offset of whichever element is actually scrolling. Only one
// candidate is non-zero at a time, so the max always picks the live offset
// regardless of which element scrolls.
function readScrollOffset(timeline: HTMLElement | null): number {
  if (typeof window === "undefined") {
    return 0;
  }
  return Math.max(
    window.scrollY,
    document.scrollingElement?.scrollTop ?? 0,
    document.documentElement?.scrollTop ?? 0,
    document.body?.scrollTop ?? 0,
    timeline?.scrollTop ?? 0,
  );
}

function scrollElementTo(element: Element | null | undefined, top: number, behavior?: ScrollBehavior) {
  if (!element) {
    return;
  }
  if (typeof element.scrollTo === "function") {
    element.scrollTo({ top, behavior });
  } else {
    element.scrollTop = top;
  }
}

// Scroll every plausible feed scroller. The button visibility uses
// `readScrollOffset`, which can be driven by the document, body, or `.timeline`
// depending on breakpoint/browser. Writing all of them keeps the action paired
// with whichever one made the button appear.
function scrollOffsetTo(timeline: HTMLElement | null, top: number, behavior?: ScrollBehavior) {
  window.scrollTo({ top, behavior });
  scrollElementTo(document.scrollingElement, top, behavior);
  scrollElementTo(document.documentElement, top, behavior);
  scrollElementTo(document.body, top, behavior);
  scrollElementTo(timeline, top, behavior);
}

// Jump instantly to the top of the feed. We deliberately do NOT use a smooth
// scroll here: VirtualPostList keeps the viewport stable when a row above it
// resizes by doing `container.scrollTop += height - previousHeight` (see the
// onMeasured compensation in VirtualPostList). As a smooth scroll-to-top runs,
// previously virtualized top rows mount, measure taller than the default
// estimate, and that compensation fires — and any direct `scrollTop` assignment
// cancels the in-flight smooth animation (CSSOM View spec), so the scroll halts
// partway. An instant jump to 0 sidesteps this: the compensation's guard
// (`rowTop + previousHeight <= scrollTop`) can never hold at scrollTop === 0,
// so the jump lands at the top and stays there.
function scrollFeedToTop(timeline: HTMLElement | null) {
  scrollOffsetTo(timeline, 0);
}

// While a saved offset is being restored, the document briefly sits near the
// top before the scroll lands. Suppress save-on-scroll during that window so a
// transient ~0 offset doesn't clobber the value we're trying to restore.
let scrollRestoreGuard: { target: number; until: number } | null = null;

// Monotonic token so a newer restore invalidates any prior rAF apply loop.
// Without it, rapid navigation between cached feeds runs two loops against the
// one shared scrollRestoreGuard, jittering toward different targets for ~30
// frames.
let scrollRestoreToken = 0;

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : 0;
}

// Arm (or refresh) the suppression window for an offset we intend to restore.
function armScrollRestore(target: number) {
  if (target <= 0) {
    return;
  }
  scrollRestoreGuard = { target, until: nowMs() + 2000 };
}

function shouldSuppressScrollSave(currentOffset: number): boolean {
  if (!scrollRestoreGuard) {
    return false;
  }
  if (nowMs() > scrollRestoreGuard.until) {
    scrollRestoreGuard = null;
    return false;
  }
  // Once the document has reached (or passed) the target the restore is done;
  // let real user scrolls — including an intentional scroll back to the top —
  // be saved again.
  return currentOffset < scrollRestoreGuard.target - 1;
}

// How long to keep re-asserting the restore target, and how many consecutive
// frames the offset must hold at target before we consider the restore settled.
const SCROLL_RESTORE_MAX_FRAMES = 30;
const SCROLL_RESTORE_STABLE_FRAMES = 3;

// Restore a saved scroll offset after a navigation/cache hit. A single
// post-render scroll often lands short because the feed content (virtualized
// rows, images, embeds) is still growing, so the early offset clamps to a
// shorter document and any stray scroll event would then overwrite the saved
// value with ~0. Re-apply across a few frames until the target is reachable.
// Takes the ref (not its current value) because the destination route's
// `.timeline` element usually has not mounted yet at the synchronous call site
// — it appears a frame or two later. Re-resolving inside each frame targets the
// live element instead of a stale/detached one.
function restoreScrollOffset(timelineRef: { readonly current: HTMLElement | null }, top: number) {
  if (top <= 0) {
    return;
  }
  const token = ++scrollRestoreToken;
  armScrollRestore(top);
  let frames = 0;
  // Count of consecutive frames the offset has already reached the target. We do
  // NOT stop the first frame the target is momentarily reached: the feed content
  // (virtualized rows measuring, images/embeds loading) keeps growing for a few
  // frames after a cache hit or fresh load, and the list can briefly remount and
  // reset scrollTop to 0. Re-asserting `top` whenever the offset falls short and
  // only finishing once it has *held* at target for a few consecutive frames lets
  // the restore survive that late reflow instead of bailing early and landing at 0.
  let stable = 0;
  const apply = () => {
    // A newer restore superseded this one — stop so the two loops don't fight
    // over the shared guard/scroll position.
    if (token !== scrollRestoreToken) {
      return;
    }
    const timeline = timelineRef.current;
    if (readScrollOffset(timeline) < top - 1) {
      scrollOffsetTo(timeline, top);
      stable = 0;
    } else {
      stable += 1;
    }
    frames += 1;
    if (frames < SCROLL_RESTORE_MAX_FRAMES && stable < SCROLL_RESTORE_STABLE_FRAMES) {
      requestAnimationFrame(apply);
    } else {
      scrollRestoreGuard = null;
    }
  };
  requestAnimationFrame(apply);
}

function feedPreferenceKeys(source: FeedSource) {
  const keys = new Set([`feed:${source.uri}`, `feed:${source.id}`]);
  for (const known of feedSources) {
    if (known.uri === source.uri) {
      keys.add(`feed:${known.id}`);
    }
  }
  return [...keys];
}

function feedPreferenceKey(source: FeedSource) {
  return `feed:${source.uri}`;
}

function feedDensityOverride(source: FeedSource, preferences: Record<string, DensityMode>) {
  const value = preferences[feedPreferenceKey(source)];
  return densityModes.includes(value) ? value : undefined;
}

// Per-feed Show Media override: true (always on) / false (always off) / undefined
// (inherit the global Settings preference). Mirrors feedDensityOverride.
function feedShowMediaOverride(source: FeedSource, preferences: Record<string, boolean>) {
  const value = preferences[feedPreferenceKey(source)];
  return typeof value === "boolean" ? value : undefined;
}

function postHasVisualMedia(post: FeedPost) {
  return getEmbedImages(post.embed).length > 0 || !!getVideoEmbed(post.embed);
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

function isRateLimit(error: unknown) {
  return error instanceof ApiError && error.status === 429;
}

function isNetworkError(error: unknown) {
  // fetch() rejects with a TypeError ("Failed to fetch") on network/CORS failures,
  // which also covers rate-limited responses returned without CORS headers.
  return error instanceof TypeError;
}

// A feed generator (or other upstream service) being down, as opposed to our
// app or the viewer's network. The AppView returns 502/503/504 UpstreamFailure
// with "feed unavailable"; the authed agent surfaces the same message text.
function isUpstreamFailure(error: unknown) {
  const status = error instanceof ApiError ? error.status : (error as { status?: number } | null)?.status;
  const message = (error instanceof Error ? error.message : "").toLowerCase();
  return (
    status === 502 ||
    status === 503 ||
    status === 504 ||
    message.includes("feed unavailable") ||
    message.includes("upstreamfailure")
  );
}

function rateLimitMessage(error: unknown) {
  if (isRateLimit(error)) {
    return "Bluesky rate limit reached. Pause a moment, then try again.";
  }
  if (isUpstreamFailure(error)) {
    return "This feed's provider isn't responding right now — the feed may be down or removed. Try again later, or pick another feed.";
  }
  if (isNetworkError(error)) {
    return "Network request failed — Bluesky may be rate-limiting or briefly unreachable. Try again.";
  }
  return error instanceof Error ? error.message : "Something went wrong loading this.";
}

type PostRefValue = { uri: string; cid: string };
type BranchLoadResult = { added: number; error?: undefined } | { added?: undefined; error: string };
const MEDIA_DENSITY_VISIBLE_TARGET = 12;
const MEDIA_DENSITY_MAX_PREFETCH_PAGES = 4;

function replyRootRefForPost(post: FeedPost): PostRefValue {
  const rootRef = post.record.reply?.root;
  return rootRef?.uri && rootRef?.cid ? { uri: rootRef.uri, cid: rootRef.cid } : { uri: post.uri, cid: post.cid };
}

async function hydrateThreadContinuations(root: ThreadNode, signal?: AbortSignal) {
  let hydrated = root;
  let previousLastUri: string | null = null;

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const parts = buildThreadParts(hydrated);
    const expectedTotal = expectedThreadMarkerTotal(parts);
    if (!expectedTotal || parts.length >= expectedTotal || parts.length === 0) {
      return hydrated;
    }

    const lastPart = parts[parts.length - 1];
    const lastUri = lastPart.node.post.uri;
    if (lastUri === previousLastUri) {
      return hydrated;
    }
    previousLastUri = lastUri;

    const branchResponse = await getPostThreadByUriAuthed(lastUri, signal);
    if (signal?.aborted) {
      return hydrated;
    }

    const branchParts = buildThreadParts(branchResponse.thread);
    if (branchParts.length <= 1) {
      return hydrated;
    }

    hydrated = replaceThreadBranch(hydrated, lastUri, branchResponse.thread);
  }

  return hydrated;
}

function countVisualFeedItems(items: FeedItem[]) {
  return items.filter((item) => postHasVisualMedia(item.post)).length;
}

// Run an async mapper over items with a bounded number of in-flight calls.
// Hydration fans out one deep getPostThread (depth 100) per root, so an
// unbounded Promise.all could fire dozens of concurrent reads on an active
// profile; cap it. Returns settled results in input order, like allSettled.
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results = new Array<PromiseSettledResult<R>>(items.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor++;
      try {
        results[index] = { status: "fulfilled", value: await mapper(items[index], index) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function hydrateProfileSelfThreads(items: FeedItem[], signal?: AbortSignal) {
  const threadRoots = items.filter((item) => {
    const marker = threadMarkerMatch(item.post.record.text || "");
    // The non-marker branch optimistically fetches any own top-level post that
    // has replies (it may be an unmarked self-thread); buildThreadParts below
    // discards the ones that turn out to have no self-continuation.
    return (marker?.index === 1 && marker.total > 1) || (!item.post.record.reply && (item.post.replyCount ?? 0) > 0);
  });

  if (threadRoots.length === 0) {
    return items;
  }

  const threadResults = await mapWithConcurrency(threadRoots, 4, async (item) => {
    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    const response = await getPostThreadByUriAuthed(item.post.uri, signal);
    const thread = await hydrateThreadContinuations(response.thread, signal);
    return {
      uri: item.post.uri,
      parts: buildThreadParts(thread).map((part) => part.node.post),
    };
  });

  if (signal?.aborted) {
    return items;
  }

  const continuationsByRoot = new Map<string, FeedItem[]>();
  threadResults.forEach((result) => {
    if (result.status !== "fulfilled" || result.value.parts.length <= 1) {
      return;
    }
    continuationsByRoot.set(
      result.value.uri,
      result.value.parts.slice(1).map((post) => ({ post })),
    );
  });

  if (continuationsByRoot.size === 0) {
    return items;
  }

  return items.flatMap((item) => [item, ...(continuationsByRoot.get(item.post.uri) ?? [])]);
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

function postBskyUrl(post: FeedPost) {
  const rkey = post.uri.split("/").pop();
  return rkey ? `https://bsky.app/profile/${post.author.handle}/post/${rkey}` : `https://bsky.app/profile/${post.author.handle}`;
}

function extractHashtags(text?: string) {
  if (!text) {
    return [];
  }

  return Array.from(text.matchAll(/(^|[\s([{])#([\p{L}\p{N}_-]{2,64})/gu), (match) => `#${match[2]}`);
}

function moderationLabelText(label: { val?: string }) {
  const value = label.val?.trim();
  if (!value) {
    return "Content label";
  }

  return value
    .replace(/^!/, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function isSensitiveLabel(label: { val?: string }) {
  const value = label.val?.toLowerCase() || "";
  return [
    "adult",
    "graphic",
    "gore",
    "nudity",
    "porn",
    "sexual",
    "spam",
    "violence",
  ].some((term) => value.includes(term));
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
  const [virtualRenderedRows, setVirtualRenderedRows] = useState(0);
  const [thread, setThread] = useState<{ status: "idle" | "loading" | "ready" | "error"; node?: ThreadNode; error?: string }>({
    status: "idle",
  });
  const [loadingThreadBranches, setLoadingThreadBranches] = useState<Record<string, boolean>>({});
  const [threadBranchResults, setThreadBranchResults] = useState<Record<string, BranchLoadResult>>({});
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const feedCacheRef = useRef<Record<string, FeedState>>({});
  const feedMetadataCacheRef = useRef<Record<string, FeedGeneratorView>>({});
  const listMetadataCacheRef = useRef<Record<string, ListView>>({});
  const profileCacheRef = useRef<Record<string, { feed: FeedState; profile: Profile | null }>>({});
  const searchCacheRef = useRef<Record<string, SearchState>>({});
  const actorSearchCacheRef = useRef<Record<string, ActorSearchState>>({});
  const feedSearchCacheRef = useRef<Record<string, FeedSearchState>>({});
  const threadCacheRef = useRef<Record<string, ThreadNode>>({});
  const threadBranchCacheRef = useRef<Record<string, ThreadNode>>({});
  // Tracks the in-flight full-thread load (initial fetch or post-reply reload) so
  // a stale response can't overwrite the thread after navigating to another post.
  const threadLoadControllerRef = useRef<AbortController | null>(null);
  const scrollCacheRef = useRef<Record<string, number>>(readTimelineScrollCache());

  useEffect(() => {
    let cancelled = false;

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
        window.history.replaceState(null, "", "/settings");
        setRoute({ kind: "surface", name: "settings" });
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
        if (cancelled) {
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
        } finally {
          blockInFlight.current.delete(author.did);
        }
      })();
    },
    [signedInDid, blockOverrides],
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
  const authCacheMountRef = useRef(false);
  useEffect(() => {
    if (!authCacheMountRef.current) {
      authCacheMountRef.current = true;
      return;
    }
    feedCacheRef.current = {};
    feedMetadataCacheRef.current = {};
    listMetadataCacheRef.current = {};
    profileCacheRef.current = {};
    searchCacheRef.current = {};
    actorSearchCacheRef.current = {};
    feedSearchCacheRef.current = {};
    threadCacheRef.current = {};
    threadBranchCacheRef.current = {};
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
  const orderedSubscribedFeeds = useMemo(() => {
    if (feedOrder.length === 0) {
      return subscribedFeeds;
    }
    const rank = new Map(feedOrder.map((uri, index) => [uri, index]));
    const fallback = feedOrder.length;
    return [...subscribedFeeds].sort(
      (a, b) => (rank.get(a.uri) ?? fallback) - (rank.get(b.uri) ?? fallback),
    );
  }, [subscribedFeeds, feedOrder]);
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

    return allSources.filter((source) =>
      `${source.label} ${source.description} ${source.group}`.toLowerCase().includes(query),
    );
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
      const pinnedMatches = query
        ? pinnedSources.filter((source) =>
            `${source.label} ${source.description} ${source.group}`.toLowerCase().includes(query),
          )
        : pinnedSources;
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
      if (!rootItem || !isSelfThreadReply(item, rootItem.post)) {
        return false;
      }
      const replyTime = postSortTime(item.post);
      const rootTime = postSortTime(rootItem.post);
      return Number.isFinite(replyTime) && Number.isFinite(rootTime) && replyTime - rootTime >= 0 && replyTime - rootTime <= CONTINUATION_REPLY_WINDOW_MS;
    });
  }, [feedState.items, profileTab, route.kind]);

  const loadFeed = useCallback(async (source: FeedSource, cursor?: string, signal?: AbortSignal) => {
    const cacheKey = `feed:${source.id}`;
    if (!cursor) {
      const cached = feedCacheRef.current[cacheKey];
      if (cached?.status === "ready") {
        setDevMetrics((current) => ({ ...current, cacheHits: current.cacheHits + 1 }));
        setFeedState(cached);
        restoreScrollOffset(timelineRef, scrollCacheRef.current[cacheKey] || 0);
        return;
      }
    }

    setFeedState((current) => ({
      ...current,
      status: cursor ? current.status : "loading",
      error: undefined,
      loadMoreError: undefined,
    }));

    try {
      const readPage = (pageCursor?: string) =>
        source.uri === "following"
          ? getFollowingTimeline(pageCursor, signal)
          : isListUri(source.uri)
            ? getListFeed(source.uri, pageCursor, signal)
            : signedInDid
              ? getFeedAuthed(source.uri, pageCursor, signal)
              : getFeed(source.uri, pageCursor, signal);
      let response =
        source.uri === "following"
          ? await getFollowingTimeline(cursor, signal)
          : isListUri(source.uri)
            ? await getListFeed(source.uri, cursor, signal)
            : signedInDid
              ? await getFeedAuthed(source.uri, cursor, signal)
              : await getFeed(source.uri, cursor, signal);
      if (density === "media" && response.cursor && countVisualFeedItems(response.feed) < MEDIA_DENSITY_VISIBLE_TARGET) {
        let nextCursor: string | undefined = response.cursor;
        let combinedFeed = response.feed;
        let extraPages = 0;
        while (
          nextCursor &&
          countVisualFeedItems(combinedFeed) < MEDIA_DENSITY_VISIBLE_TARGET &&
          extraPages < MEDIA_DENSITY_MAX_PREFETCH_PAGES
        ) {
          const nextResponse = await readPage(nextCursor);
          combinedFeed = [...combinedFeed, ...nextResponse.feed];
          nextCursor = nextResponse.cursor;
          extraPages += 1;
          if (nextResponse.feed.length === 0) {
            break;
          }
        }
        response = { feed: combinedFeed, cursor: nextCursor };
      }
      if (signal?.aborted) {
        return;
      }
      setFeedState((current) => {
        const next = {
          items: cursor ? [...current.items, ...response.feed] : response.feed,
          cursor: response.cursor,
          status: "ready" as const,
        };
        feedCacheRef.current[cacheKey] = next;
        return next;
      });
      if (!cursor) {
        restoreScrollOffset(timelineRef, scrollCacheRef.current[cacheKey] || 0);
      }
    } catch (error) {
      if (!signal?.aborted) {
        setFeedState((current) =>
          cursor
            ? { ...current, status: "ready", loadMoreError: rateLimitMessage(error) }
            : { ...current, status: isRateLimit(error) ? "rate-limit" : "error", error: rateLimitMessage(error) },
        );
      }
    }
  }, [density, signedInDid]);

  const loadProfileFeed = useCallback(async (actor: string, cursor?: string, signal?: AbortSignal, filter: ProfileFeedFilter = "posts_with_replies") => {
    const cacheKey = `profile:${actor}:${filter}`;
    if (!cursor) {
      const cached = profileCacheRef.current[cacheKey];
      if (cached?.feed.status === "ready") {
        setDevMetrics((current) => ({ ...current, cacheHits: current.cacheHits + 1 }));
        setProfile(cached.profile);
        setFeedState(cached.feed);
        restoreScrollOffset(timelineRef, scrollCacheRef.current[cacheKey] || 0);
        return;
      }
    }

    setFeedState((current) => ({
      ...current,
      status: cursor ? current.status : "loading",
      error: undefined,
      loadMoreError: undefined,
    }));

    // Profile and author feed load independently. A blocked account's author
    // feed throws ("Requester has blocked actor"), but the profile read still
    // succeeds — so we must not let a feed failure wipe the profile header,
    // otherwise there is no way to reach the Unblock control. allSettled keeps
    // the two outcomes separate.
    const [profileResult, feedResult] = await Promise.allSettled([
      cursor ? Promise.resolve(null) : getProfileAuthed(actor, signal),
      getAuthorFeedAuthed(actor, cursor, signal, filter),
    ]);

    if (signal?.aborted) {
      return;
    }

    let profileResponse: Profile | null = null;
    if (profileResult.status === "fulfilled" && profileResult.value) {
      profileResponse = profileResult.value;
      setProfile(profileResponse);
    }

    if (feedResult.status === "fulfilled") {
      let feedResponse = feedResult.value;
      if (!cursor && feedResponse.feed.length === 0 && (profileResponse?.postsCount ?? 0) > 0) {
        try {
          const publicFeedResponse = await getAuthorFeed(actor, undefined, signal, filter);
          if (publicFeedResponse.feed.length > 0) {
            feedResponse = publicFeedResponse;
          }
        } catch {
          // Keep the authenticated response; the normal empty/error UI will handle it.
        }
      }
      const responseItems = filter === "posts_no_replies" ? await hydrateProfileSelfThreads(feedResponse.feed, signal) : feedResponse.feed;
      if (signal?.aborted) {
        return;
      }
      setFeedState((current) => {
        const next = {
          items: cursor ? [...current.items, ...responseItems] : responseItems,
          cursor: feedResponse.cursor,
          status: "ready" as const,
        };
        profileCacheRef.current[cacheKey] = { feed: next, profile: profileResponse ?? profileCacheRef.current[cacheKey]?.profile ?? null };
        return next;
      });
      if (!cursor) {
        restoreScrollOffset(timelineRef, scrollCacheRef.current[cacheKey] || 0);
      }
    } else {
      const error = feedResult.reason;
      setFeedState((current) =>
        cursor
          ? { ...current, status: "ready", loadMoreError: rateLimitMessage(error) }
          : { ...current, status: isRateLimit(error) ? "rate-limit" : "error", error: rateLimitMessage(error) },
      );
      // Cache the profile even when the feed is unavailable so re-entry keeps the
      // header (and its Unblock button) without another round-trip.
      if (profileResponse && !cursor) {
        profileCacheRef.current[cacheKey] = {
          feed: profileCacheRef.current[cacheKey]?.feed ?? { items: [], status: "ready" },
          profile: profileResponse,
        };
      }
    }
  }, []);

  const loadSearch = useCallback(async (query: string, sort: "top" | "latest", lang: string, cursor?: string, signal?: AbortSignal) => {
    const cacheKey = `search:${sort}:${lang || "any"}:${query}`;
    if (!cursor) {
      const cached = searchCacheRef.current[cacheKey];
      if (cached?.status === "ready") {
        setDevMetrics((current) => ({ ...current, cacheHits: current.cacheHits + 1 }));
        setSearchState(cached);
        return;
      }
    }

    setSearchState((current) => ({
      ...current,
      status: cursor ? current.status : "loading",
      error: undefined,
      loadMoreError: undefined,
    }));

    try {
      const response: SearchPostsResponse = await searchPostsAuthed(query, sort, lang || undefined, cursor, signal);
      if (signal?.aborted) {
        return;
      }
      setSearchState((current) => {
        const next = {
          posts: cursor ? [...current.posts, ...response.posts] : response.posts,
          cursor: response.cursor,
          status: "ready" as const,
        };
        searchCacheRef.current[cacheKey] = next;
        return next;
      });
    } catch (error) {
      if (!signal?.aborted) {
        setSearchState((current) =>
          cursor
            ? { ...current, status: "ready", loadMoreError: rateLimitMessage(error) }
            : { ...current, status: isRateLimit(error) ? "rate-limit" : "error", error: rateLimitMessage(error) },
        );
      }
    }
  }, []);

  const loadActorSearch = useCallback(async (query: string, cursor?: string, signal?: AbortSignal) => {
    const cacheKey = `actors:${query}`;
    if (!cursor) {
      const cached = actorSearchCacheRef.current[cacheKey];
      if (cached?.status === "ready") {
        setDevMetrics((current) => ({ ...current, cacheHits: current.cacheHits + 1 }));
        setActorSearchState(cached);
        return;
      }
    }

    setActorSearchState((current) => ({
      ...current,
      status: cursor ? current.status : "loading",
      error: undefined,
      loadMoreError: undefined,
    }));

    try {
      const response: ActorSearchResponse = await searchActors(query, cursor, signal);
      if (signal?.aborted) {
        return;
      }
      setActorSearchState((current) => {
        const next = {
          actors: cursor ? [...current.actors, ...response.actors] : response.actors,
          cursor: response.cursor,
          status: "ready" as const,
        };
        actorSearchCacheRef.current[cacheKey] = next;
        return next;
      });
    } catch (error) {
      if (!signal?.aborted) {
        setActorSearchState((current) =>
          cursor
            ? { ...current, status: "ready", loadMoreError: rateLimitMessage(error) }
            : { ...current, status: isRateLimit(error) ? "rate-limit" : "error", error: rateLimitMessage(error) },
        );
      }
    }
  }, []);

  const loadFeedSearch = useCallback(async (query: string, signal?: AbortSignal) => {
    const cacheKey = `feeds:${query.trim().toLowerCase()}`;
    const cached = feedSearchCacheRef.current[cacheKey];
    if (cached?.status === "ready") {
      setDevMetrics((current) => ({ ...current, cacheHits: current.cacheHits + 1 }));
      setFeedSearchState(cached);
      return;
    }

    setFeedSearchState({ feeds: [], status: "loading" });

    try {
      const response = await getPopularFeedGenerators(20, signal, query);
      if (signal?.aborted) {
        return;
      }
      const next: FeedSearchState = { feeds: response.feeds, status: "ready" };
      feedSearchCacheRef.current[cacheKey] = next;
      setFeedSearchState(next);
    } catch (error) {
      if (!signal?.aborted) {
        setFeedSearchState({
          feeds: [],
          status: isRateLimit(error) ? "rate-limit" : "error",
          error: rateLimitMessage(error),
        });
      }
    }
  }, []);

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
      const cachedList = listMetadataCacheRef.current[activeSource.uri];
      if (cachedList) {
        setDevMetrics((current) => ({ ...current, cacheHits: current.cacheHits + 1 }));
        setListMetadata(cachedList);
        return undefined;
      }
      setListMetadata(null);
      getList(activeSource.uri, controller.signal)
        .then((response) => {
          listMetadataCacheRef.current[activeSource.uri] = response.list;
          setListMetadata(response.list);
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setListMetadata(null);
          }
        });
      return () => controller.abort();
    }

    setListMetadata(null);
    const cached = feedMetadataCacheRef.current[activeSource.uri];
    if (cached) {
      setDevMetrics((current) => ({ ...current, cacheHits: current.cacheHits + 1 }));
      setFeedMetadata(cached);
      return undefined;
    }

    setFeedMetadata(null);
    getFeedGenerator(activeSource.uri, controller.signal)
      .then((response) => {
        feedMetadataCacheRef.current[activeSource.uri] = response.view;
        setFeedMetadata(response.view);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setFeedMetadata(null);
        }
      });
    return () => controller.abort();
  }, [activeSource, feedWaitingForAuth, route.kind]);

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

  // Single source of truth for fetching a full thread: aborts any prior load,
  // sets loading state, hydrates self-thread continuations, then caches and
  // commits the result. Both the route effect and reloadThread go through this
  // so their fetch/abort/cache logic can't drift. Returns the controller so the
  // caller can abort on cleanup.
  const startThreadLoad = useCallback((actor: string, rkey: string) => {
    const cacheKey = `${actor}:${rkey}`;
    const controller = new AbortController();
    threadLoadControllerRef.current?.abort();
    threadLoadControllerRef.current = controller;
    setThread({ status: "loading" });
    setThreadBranchResults({});
    getPostThreadAuthed(actor, rkey, controller.signal)
      .then(async (response) => {
        const thread = await hydrateThreadContinuations(response.thread, controller.signal);
        if (controller.signal.aborted) {
          return;
        }
        threadCacheRef.current[cacheKey] = thread;
        setThread({ status: "ready", node: thread });
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setThread({
            status: "error",
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });
    return controller;
  }, []);

  useEffect(() => {
    if (route.kind !== "post") {
      setThread({ status: "idle" });
      setLoadingThreadBranches({});
      setThreadBranchResults({});
      return;
    }

    const cached = threadCacheRef.current[`${route.actor}:${route.rkey}`];
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
    delete threadCacheRef.current[`${route.actor}:${route.rkey}`];
    startThreadLoad(route.actor, route.rkey);
  }, [route, startThreadLoad]);

  function loadThreadBranch(uri: string) {
    if (thread.status !== "ready" || !thread.node || loadingThreadBranches[uri]) {
      return;
    }

    const previousBranch = findThreadNodeByUri(thread.node, uri);
    const previousPostCount = Math.max(0, countThreadPostNodes(previousBranch ?? undefined) - 1);
    const cachedBranch = threadBranchCacheRef.current[uri];
    if (cachedBranch) {
      setDevMetrics((current) => ({ ...current, cacheHits: current.cacheHits + 1 }));
      setThreadBranchResults((current) => ({ ...current, [uri]: { added: Math.max(0, countThreadPostNodes(cachedBranch) - 1 - previousPostCount) } }));
      setThread((current) => {
        if (current.status !== "ready" || !current.node) {
          return current;
        }

        const nextNode = replaceThreadBranch(current.node, uri, cachedBranch);
        if (route.kind === "post") {
          threadCacheRef.current[`${route.actor}:${route.rkey}`] = nextNode;
        }
        return { ...current, node: nextNode };
      });
      return;
    }

    setLoadingThreadBranches((current) => ({ ...current, [uri]: true }));
    setThreadBranchResults((current) => {
      const { [uri]: _removed, ...rest } = current;
      return rest;
    });
    // Cancel the branch fetch when the open thread is torn down (navigation
    // aborts threadLoadControllerRef), matching how the full-thread loads abort.
    const signal = threadLoadControllerRef.current?.signal;
    getPostThreadByUriAuthed(uri, signal)
      .then((response) => {
        if (signal?.aborted) {
          return;
        }
        threadBranchCacheRef.current[uri] = response.thread;
        setThreadBranchResults((current) => ({
          ...current,
          [uri]: { added: Math.max(0, countThreadPostNodes(response.thread) - 1 - previousPostCount) },
        }));
        setThread((current) => {
          if (current.status !== "ready" || !current.node) {
            return current;
          }

          const nextNode = replaceThreadBranch(current.node, uri, response.thread);
          if (route.kind === "post") {
            threadCacheRef.current[`${route.actor}:${route.rkey}`] = nextNode;
          }
          return { ...current, node: nextNode };
        });
      })
      .catch((error) => {
        if (signal?.aborted) {
          return;
        }
        setThreadBranchResults((current) => ({
          ...current,
          [uri]: { error: error instanceof Error ? error.message : String(error) },
        }));
      })
      .finally(() => {
        setLoadingThreadBranches((current) => {
          const { [uri]: _removed, ...rest } = current;
          return rest;
        });
      });
  }

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
    safeLocalStorageSet("bigbsky:density-by-context", JSON.stringify(nextPreferences));
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
    safeLocalStorageSet("bigbsky:density-by-context", JSON.stringify(nextPreferences));
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
    setShowNsfw((current) => {
      const next = !current;
      if (next) {
        const confirmed = window.confirm(
          "Show NSFW media in BigBSky on this browser? Confirm that you are allowed to view adult content where you live. BigBSky will not ask for or store your birthday. For Bluesky account-wide moderation settings, use https://bsky.app/moderation.",
        );
        if (!confirmed) {
          return current;
        }
      }
      safeLocalStorageSet(showNsfwStorageKey, next ? "true" : "false");
      return next;
    });
  }

  function toggleShowMedia() {
    setShowMedia((current) => {
      const next = !current;
      safeLocalStorageSet(showMediaStorageKey, next ? "true" : "false");
      return next;
    });
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
    feedCacheRef.current = {};
    feedMetadataCacheRef.current = {};
    listMetadataCacheRef.current = {};
    profileCacheRef.current = {};
    searchCacheRef.current = {};
    actorSearchCacheRef.current = {};
    feedSearchCacheRef.current = {};
    threadCacheRef.current = {};
    threadBranchCacheRef.current = {};
    scrollCacheRef.current = {};
    setDevMetrics((current) => ({ ...current, cacheHits: 0 }));
    setAuthState({ status: "signed-out", session: null });
  }

  async function handleSignIn(handle: string) {
    const trimmed = handle.trim();
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
    feedCacheRef.current = {};
    profileCacheRef.current = {};
    searchCacheRef.current = {};
    threadCacheRef.current = {};
    threadBranchCacheRef.current = {};
    setBookmarkOverrides((current) => ({ ...current, [uri]: false }));
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
        safeLocalStorageSet(pinnedFeedMetaStorageKey, JSON.stringify(next));
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

  function navigate(nextRoute: RouteState, path = "/") {
    window.history.pushState(null, "", path);
    setRoute(nextRoute);
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
      // custom-feed vs Discover fallback) is current.
      const source = resolveHomeSource(homeSourceId, !!signedInDid, subscribedFeeds);
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
  const activeScrollKey =
    route.kind === "profile" && profileTab !== "feeds" && profileTab !== "lists" && profileTab !== "new-post"
      ? `profile:${route.actor}:${profileFeedFilterForTab(profileTab)}`
      : route.kind === "feed"
        ? `feed:${activeSource.id}`
        : route.kind === "surface" && (route.name === "bookmarks" || route.name === "lists")
          ? `surface:${route.name}`
          : "";
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
    armScrollRestore(scrollCacheRef.current[activeScrollKey] || 0);

    const rememberScroll = () => {
      const offset = readScrollOffset(timeline);
      if (shouldSuppressScrollSave(offset)) {
        return;
      }
      scrollCacheRef.current[activeScrollKey] = offset;
    };
    const persistScroll = () => {
      rememberScroll();
      writeTimelineScrollCache(scrollCacheRef.current);
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
      writeTimelineScrollCache(scrollCacheRef.current);
    };
  }, [activeScrollKey]);

  useEffect(() => {
    if (!activeScrollKey.startsWith("surface:")) {
      return undefined;
    }

    restoreScrollOffset(timelineRef, scrollCacheRef.current[activeScrollKey] || 0);
    return undefined;
  }, [activeScrollKey]);

  const loadMoreInFlightRef = useRef(false);
  const loadMore = () => {
    // Single in-flight gate across feed/profile/search: the cursor isn't updated
    // until the fetch resolves, so two rapid fires (un-disabled manual button, or
    // beating the observer cooldown) would otherwise fetch the same cursor and
    // append duplicate rows.
    if (loadMoreInFlightRef.current) {
      return;
    }

    let promise: Promise<unknown> | undefined;
    if (route.kind === "search") {
      if (route.query && searchTab === "posts" && searchState.cursor) {
        promise = loadSearch(route.query, searchSort, searchLanguage, searchState.cursor);
      } else if (route.query && searchTab === "people" && actorSearchState.cursor) {
        promise = loadActorSearch(route.query, actorSearchState.cursor);
      }
    } else if (feedState.cursor) {
      promise =
        route.kind === "profile"
          ? loadProfileFeed(route.actor, feedState.cursor, undefined, profileFeedFilterForTab(profileTab))
          : loadFeed(activeSource, feedState.cursor);
    }

    if (!promise) {
      return;
    }

    loadMoreInFlightRef.current = true;
    void promise.finally(() => {
      loadMoreInFlightRef.current = false;
    });
  };
  const reloadCurrentProfile = useCallback(() => {
    if (route.kind !== "profile") {
      return;
    }
    delete profileCacheRef.current[`profile:${route.actor}:${profileFeedFilterForTab(profileTab)}`];
    void loadProfileFeed(route.actor, undefined, undefined, profileFeedFilterForTab(profileTab));
  }, [loadProfileFeed, profileTab, route]);
  // After the signed-in user creates a post or reply, drop the SPA caches that
  // would otherwise serve a stale list omitting the new record: the Following
  // timeline (which includes the user's own posts) and every cached self-profile
  // tab. The refreshed reads are authenticated (PDS-proxied), so they benefit
  // from atproto read-after-write smoothing even before the AppView is fully
  // consistent. Other users' feeds aren't touched — read-after-write only
  // applies to the requesting user's own records.
  const invalidateOwnContentCaches = useCallback(() => {
    delete feedCacheRef.current["feed:following"];
    const selfIds = [signedInDid, authState.session?.handle].filter(Boolean) as string[];
    if (selfIds.length > 0) {
      for (const key of Object.keys(profileCacheRef.current)) {
        if (selfIds.some((id) => key.startsWith(`profile:${id}:`))) {
          delete profileCacheRef.current[key];
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
          {navigationItems.map((item, index) => {
            const Icon = navIcons[index];
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
                {Icon ? <Icon size={20} /> : <i className="plain-info-icon" aria-hidden="true" />}
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
            <button type="button" title="Search feeds" onClick={() => setFeedSearch("")}>
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
                items={feedState.items}
                mediaOnly={density === "media"}
                onOpenImage={openImageViewer}
                onOpenPost={openPost}
                onOpenProfile={openProfile}
                currentDid={authState.session?.did}
                localLists={localLists}
                onToggleListPost={togglePostInLocalList}
                onRenderedRowsChange={setVirtualRenderedRows}
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
      </div>
      </DeletePostContext.Provider>
      </BlockContext.Provider>
      </BookmarkContext.Provider>
      </LikeContext.Provider>
      </DensityContext.Provider>
      </ShowMediaContext.Provider>
      </ShowNsfwContext.Provider>
    </TagSearchContext.Provider>
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
  const [activeReplyParentUri, setActiveReplyParentUri] = useState<string | null>(null);
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
          key={feedRowKey(row)}
          onMeasured={(height) => {
            const rowKey = feedRowKey(row);
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
          }}
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
                    onReply={canReply ? (post) => setActiveReplyParentUri((current) => (current === post.uri ? null : post.uri)) : undefined}
                    replyActive={activeReplyParentUri === rowPost.uri}
                  />
                ) : (
                  <PostCard
                    item={row}
                    currentDid={currentDid}
                    onOpenImage={onOpenImage}
                    onOpenPost={onOpenPost}
                    onOpenProfile={onOpenProfile}
                    onReply={canReply ? (post) => setActiveReplyParentUri((current) => (current === post.uri ? null : post.uri)) : undefined}
                    replyActive={activeReplyParentUri === rowPost.uri}
                    localLists={localLists}
                    onToggleListPost={onToggleListPost}
                  />
                )}
                {activeReplyParentUri === rowPost.uri && (
                  <PostComposer
                    replyTo={{ parent: rowPost, root: replyRootRefForPost(rowPost) }}
                    canReply={canReply}
                    onClose={() => setActiveReplyParentUri(null)}
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

// The timeline scrolls inside an internal overflow container (`.timeline`),
// not the window. An IntersectionObserver with `root: null` measures the
// rootMargin against the viewport, so it cannot preload early through the
// clipped scroller — auto-load would only fire once the sentinel reaches the
// actual bottom. Observing against the nearest scrollable ancestor lets the
// 640px margin preload the next page before the user hits the end, keeping
// endless scroll seamless. Falls back to the viewport when nothing scrolls.
function findScrollParent(el: HTMLElement | null): HTMLElement | null {
  let node = el?.parentElement ?? null;
  while (node) {
    const overflowY = getComputedStyle(node).overflowY;
    if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

function AutoLoadMoreButton({ label, onLoadMore, error }: { label: string; onLoadMore: () => void; error?: string }) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const cooldownRef = useRef(false);

  useEffect(() => {
    const button = buttonRef.current;
    // When the previous page failed, stop auto-loading: requiring an explicit
    // retry click avoids hammering a rate-limited or unreachable endpoint.
    if (!button || error || !("IntersectionObserver" in window)) {
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting) || cooldownRef.current) {
          return;
        }

        cooldownRef.current = true;
        onLoadMore();
        window.setTimeout(() => {
          cooldownRef.current = false;
        }, 900);
      },
      { root: findScrollParent(button), rootMargin: "640px 0px 640px 0px" },
    );

    observer.observe(button);
    return () => observer.disconnect();
  }, [onLoadMore, error]);

  if (error) {
    return (
      <div className="load-more-error" role="status">
        <span>{error}</span>
        <button className="load-more" ref={buttonRef} type="button" onClick={onLoadMore}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <button className="load-more" ref={buttonRef} type="button" onClick={onLoadMore}>
      {label}
    </button>
  );
}

function MeasuredPostRow({
  children,
  post,
  onMeasured,
}: {
  children: React.ReactNode;
  post: FeedPost;
  onMeasured: (height: number) => void;
}) {
  const rowRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const row = rowRef.current;
    if (!row) {
      return undefined;
    }

    const measure = () => onMeasured(Math.ceil(row.getBoundingClientRect().height));
    measure();
    const observer = "ResizeObserver" in window ? new ResizeObserver(measure) : null;
    observer?.observe(row);

    return () => observer?.disconnect();
  }, [post.uri, onMeasured]);

  return (
    <div className="virtual-row" ref={rowRef}>
      {children}
    </div>
  );
}

// Searchable replacement for the old native <select> Home-page picker. A native
// dropdown doesn't scale once a user has many feeds and lists, so this filters
// as you type and groups results by Following / Feeds / Lists. Keyboard: type to
// filter, Up/Down to move, Enter to choose, Escape to close.
function HomeSourcePicker({
  value,
  options,
  signedIn,
  onChange,
}: {
  value: string;
  options: HomeOption[];
  signedIn: boolean;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  const selected = options.find((option) => option.id === value);
  const optionLabel = (option: HomeOption) =>
    `${option.label}${option.needsAuth && !signedIn ? " (needs sign-in)" : ""}`;
  const buttonLabel = selected ? optionLabel(selected) : "Choose a feed or list";

  const filtered = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) {
      return options;
    }
    return options.filter((option) => `${option.label} ${option.group}`.toLowerCase().includes(trimmed));
  }, [options, query]);

  // Group the filtered options while preserving their original order.
  const groups = useMemo(() => {
    const order: HomeOption["group"][] = ["Following", "Feeds", "Lists"];
    return order
      .map((group) => ({ group, items: filtered.filter((option) => option.group === group) }))
      .filter((entry) => entry.items.length > 0);
  }, [filtered]);

  // Close on outside click.
  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  // When opening (or as the filter changes), focus the input and point the
  // active highlight at the current selection, clamping into range.
  useEffect(() => {
    if (!open) {
      return;
    }
    inputRef.current?.focus();
  }, [open]);
  useEffect(() => {
    const selectedIndex = filtered.findIndex((option) => option.id === value);
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
  }, [filtered, value]);

  const commit = (option: HomeOption | undefined) => {
    if (!option) {
      return;
    }
    onChange(option.id);
    setOpen(false);
    setQuery("");
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, filtered.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      commit(filtered[activeIndex]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      setQuery("");
    }
  };

  // Keep the highlighted option scrolled into view.
  useEffect(() => {
    if (!open || !listRef.current) {
      return;
    }
    const node = listRef.current.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    node?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  return (
    <div className="home-picker" ref={containerRef}>
      <button
        type="button"
        className="home-picker-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span>{buttonLabel}</span>
        <ChevronDown size={16} aria-hidden />
      </button>
      {open && (
        <div className="home-picker-popover">
          <div className="home-picker-search">
            <Search size={15} aria-hidden />
            <input
              ref={inputRef}
              type="text"
              role="combobox"
              aria-expanded
              aria-controls="home-picker-list"
              aria-autocomplete="list"
              placeholder="Search feeds and lists"
              value={query}
              onInput={(event) => setQuery(event.currentTarget.value)}
              onKeyDown={onKeyDown}
            />
          </div>
          <ul className="home-picker-list" id="home-picker-list" role="listbox" ref={listRef}>
            {filtered.length === 0 ? (
              <li className="home-picker-empty" role="presentation">
                No matches
              </li>
            ) : (
              groups.map((entry) => (
                <li key={entry.group} role="presentation">
                  <div className="home-picker-group" role="presentation">
                    {entry.group}
                  </div>
                  <ul role="presentation">
                    {entry.items.map((option) => {
                      const index = filtered.indexOf(option);
                      const isSelected = option.id === value;
                      return (
                        <li
                          key={option.id}
                          data-index={index}
                          role="option"
                          aria-selected={isSelected}
                          className={`home-picker-option${index === activeIndex ? " active" : ""}`}
                          onMouseEnter={() => setActiveIndex(index)}
                          onClick={() => commit(option)}
                        >
                          <span>{optionLabel(option)}</span>
                          {isSelected && <Check size={15} aria-hidden />}
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
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
    lists: {
      copy: "Lists are staged as browser-local workspaces now. Authenticated Bluesky list sync and list timelines can attach here later.",
      cards: [
        { title: "List Index", detail: "Local list workspaces are visible on this route and clearable from Settings.", status: "Local" },
        { title: "New List", detail: "Create local list shells without sending anything to BigBsky infrastructure.", status: "Active" },
        { title: "List Timelines", detail: "Lists should behave like Feed sources once data is available.", status: "Planned" },
      ],
    },
    notifications: {
      copy: "Notifications has a local inbox now so account state, bookmark activity, and draft state have a stable destination before OAuth reads are added.",
      cards: [
        { title: "All", detail: "Local reader/account events render in an inbox-style list.", status: "Local" },
        { title: "Mentions", detail: "Mention search opens from this surface until authenticated mention reads are available.", status: "Search" },
        { title: "Settings", detail: "Notification controls remain reserved for signed-in account preferences.", status: "Pending" },
      ],
    },
    "oauth-callback": {
      copy: "The OAuth callback has a static SPA route now. Browser-side state validation and token exchange will attach here in Phase 2.",
      cards: [
        { title: "State Validation", detail: "Callback parsing must compare browser-local OAuth state.", status: "Pending" },
        { title: "Token Exchange", detail: "The exchange must remain browser-side or use an approved SDK path.", status: "Pending" },
        { title: "Session Restore", detail: "Local refresh and multi-tab behavior need explicit verification.", status: "Pending" },
      ],
    },
    profile: {
      copy: auth.session
        ? "Your profile is attached to your signed-in identity. Your posts open in the profile reader, and account-level edits open on Bluesky in a new tab."
        : "Sign in to see your own profile, posts, and account controls.",
      cards: [
        { title: "Posts", detail: "Open your public profile feed from this surface, with your like/follow state seeded.", status: auth.session ? "Active" : "Sign in" },
        { title: "Lists", detail: "Your real Bluesky lists — created and subscribed — load on the Lists route.", status: auth.session ? "Active" : "Sign in" },
        { title: "Edit Profile", detail: "Profile editing is delegated to Bluesky; the control opens your profile there in a new tab.", status: "On Bluesky" },
      ],
    },
    bookmarks: {
      copy: "Your Bluesky bookmarks live on the dedicated Bookmarks page; this entry is a fallback only.",
      cards: [],
    },
    settings: {
      copy: "Settings starts with local preferences, sign-out placement, and account/session controls.",
      cards: [
        { title: "Appearance", detail: "Density is stored locally per context and applied before feed paint.", status: "Active" },
        { title: "Account", detail: "Account identity and sign-out are shown after browser OAuth restore.", status: "Partial" },
        { title: "Privacy", detail: "No BigBsky backend storage is used for v1 reader data.", status: "Static" },
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
            <button
              type="button"
              className={columns.feeds ? "settings-toggle on" : "settings-toggle"}
              role="switch"
              aria-checked={columns.feeds}
              onClick={() => onSetColumnVisible("feeds", !columns.feeds)}
            >
              <span className="settings-toggle-track" aria-hidden="true">
                <span className="settings-toggle-thumb" />
              </span>
              <span>{columns.feeds ? "Feeds column shown" : "Feeds column hidden"}</span>
            </button>
            <button
              type="button"
              className={columns.right ? "settings-toggle on" : "settings-toggle"}
              role="switch"
              aria-checked={columns.right}
              onClick={() => onSetColumnVisible("right", !columns.right)}
            >
              <span className="settings-toggle-track" aria-hidden="true">
                <span className="settings-toggle-thumb" />
              </span>
              <span>{columns.right ? "Right column shown" : "Right column hidden"}</span>
            </button>
            <p className="settings-note">Stored locally in this browser. On narrow screens these columns hide automatically to fit.</p>
          </article>
          <article className="settings-panel">
            <span>{showNsfw ? "On" : "Off"}</span>
            <h3>Show NSFW media</h3>
            <p>Off by default. Enabling asks for a local confirmation, not your birthday. BigBSky does not store this on a server; it only changes how this browser displays Bluesky-hosted labeled media. Use Bluesky's moderation settings for account-wide content filtering.</p>
            <button
              type="button"
              className={showNsfw ? "settings-toggle on" : "settings-toggle"}
              role="switch"
              aria-checked={showNsfw}
              onClick={onToggleNsfw}
            >
              <span className="settings-toggle-track" aria-hidden="true">
                <span className="settings-toggle-thumb" />
              </span>
              <span>{showNsfw ? "Showing adult / graphic media" : "Hiding adult / graphic media"}</span>
            </button>
            <a className="settings-link" href="https://bsky.app/moderation" target="_blank" rel="noreferrer">
              Open Bluesky moderation settings
            </a>
            <p>This preference is stored locally in this browser only.</p>
          </article>
          <article className="settings-panel">
            <span>{showMedia ? "On" : "Off"}</span>
            <h3>Show Media</h3>
            <p>On by default. Turn off for text-only reading: media becomes a per-post reveal control.</p>
            <button
              type="button"
              className={showMedia ? "settings-toggle on" : "settings-toggle"}
              role="switch"
              aria-checked={showMedia}
              onClick={onToggleShowMedia}
            >
              <span className="settings-toggle-track" aria-hidden="true">
                <span className="settings-toggle-thumb" />
              </span>
              <span>{showMedia ? "Showing media" : "Hiding media"}</span>
            </button>
            <p>This preference is stored locally in this browser only.</p>
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

  if (name === "notifications") {
    // Legacy route compatibility: Notifications now lives under Profile.
  } else if (name === "lists") {
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

function FeedDensityOverrideControl({
  source,
  defaultDensity,
  override,
  showMedia,
  onChange,
}: {
  source: FeedSource;
  defaultDensity: DensityMode;
  override?: DensityMode;
  showMedia: boolean;
  onChange: (source: FeedSource, density: DensityMode | null) => void;
}) {
  const effective = override || defaultDensity;
  const mediaPaused = effective === "media" && !showMedia;
  const effectiveLabel = mediaPaused ? "media, paused" : effective;
  return (
    <>
      <label className="feed-density-control">
        <span>View</span>
        <select
          value={override || "default"}
          onChange={(event) => {
            const value = event.target.value;
            onChange(source, value === "default" ? null : (value as DensityMode));
          }}
        >
          <option value="default">Default ({effectiveLabel})</option>
          {densityModes.map((mode) => (
            <option value={mode} key={mode} disabled={mode === "media" && !showMedia}>
              {mode}
            </option>
          ))}
        </select>
      </label>
      {mediaPaused && (
        <p className="feed-media-warning">Media view paused — turn Media on for this feed.</p>
      )}
    </>
  );
}

function FeedShowMediaOverrideControl({
  source,
  defaultShowMedia,
  override,
  onChange,
}: {
  source: FeedSource;
  defaultShowMedia: boolean;
  override?: boolean;
  onChange: (source: FeedSource, value: boolean | null) => void;
}) {
  const value = override === undefined ? "default" : override ? "on" : "off";
  const defaultLabel = defaultShowMedia ? "on" : "off";
  return (
    <label className="feed-density-control">
      <span>Media</span>
      <select
        value={value}
        onChange={(event) => {
          const next = event.target.value;
          onChange(source, next === "default" ? null : next === "on");
        }}
      >
        <option value="default">Default ({defaultLabel})</option>
        <option value="on">On</option>
        <option value="off">Off</option>
      </select>
    </label>
  );
}

function ExploreTrendingTopics({ onOpenSearchQuery }: { onOpenSearchQuery: (query: string) => void }) {
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

function ExploreDiscoverFeeds({
  onOpenFeed,
  pinnedFeedIds,
  onTogglePinnedFeed,
  canFollowFeeds,
  followedFeedUris,
  followBusyUri,
  onToggleFollowFeed,
}: {
  onOpenFeed: (source: FeedSource) => void;
  pinnedFeedIds: string[];
  onTogglePinnedFeed: (source: FeedSource) => void;
  canFollowFeeds: boolean;
  followedFeedUris: Set<string>;
  followBusyUri: string | null;
  onToggleFollowFeed: (feedUri: string, label?: string) => void;
}) {
  const [state, setState] = useState<{ status: "loading" | "ready" | "error"; feeds: FeedGeneratorView[] }>({
    status: "loading",
    feeds: [],
  });
  const [draftQuery, setDraftQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setState((current) => ({ ...current, status: "loading" }));
    getPopularFeedGenerators(18, controller.signal, activeQuery)
      .then((response) => setState({ status: "ready", feeds: response.feeds }))
      .catch(() => {
        if (!controller.signal.aborted) {
          setState({ status: "error", feeds: [] });
        }
      });
    return () => controller.abort();
  }, [activeQuery]);

  return (
    <section className="discover-feeds" aria-label="Discover new Feeds">
      <header className="discover-feeds-header">
        <h3>Discover New Feeds</h3>
        <p>Popular public Bluesky Feeds, loaded live. Open one to read it in BigBsky without signing in.</p>
      </header>
      <form
        className="discover-feeds-search"
        onSubmit={(event) => {
          event.preventDefault();
          setActiveQuery(draftQuery.trim());
        }}
      >
        <Search size={16} />
        <input
          aria-label="Search public Feeds"
          placeholder="Search public Feeds by topic"
          value={draftQuery}
          onInput={(event) => setDraftQuery(event.currentTarget.value)}
        />
        {activeQuery && (
          <button
            type="button"
            className="discover-feeds-clear"
            onClick={() => {
              setDraftQuery("");
              setActiveQuery("");
            }}
            aria-label="Clear Feed search"
          >
            <X size={15} />
          </button>
        )}
      </form>
      {state.status === "loading" && <LoadingState label="Loading popular Feeds" />}
      {state.status === "error" && <ErrorState message="Popular Feeds could not be loaded right now." />}
      {state.status === "ready" && state.feeds.length === 0 && (
        <EmptyState
          title="No Feeds found"
          message={activeQuery ? `No public Feeds matched "${activeQuery}". Try a broader term.` : "Bluesky returned no popular Feeds for this request."}
        />
      )}
      {state.status === "ready" && state.feeds.length > 0 && (
        <div className="discover-feeds-grid">
          {state.feeds.map((feed) => (
            <DiscoverFeedCard
              key={feed.uri}
              feed={feed}
              isPinned={pinnedFeedIds.includes(feed.uri)}
              onOpenFeed={onOpenFeed}
              onTogglePinnedFeed={onTogglePinnedFeed}
              canFollow={canFollowFeeds}
              isFollowing={followedFeedUris.has(feed.uri)}
              followBusy={followBusyUri === feed.uri}
              onToggleFollow={onToggleFollowFeed}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function DiscoverFeedCard({
  feed,
  isPinned,
  onOpenFeed,
  onTogglePinnedFeed,
  canFollow = false,
  isFollowing = false,
  followBusy = false,
  onToggleFollow,
}: {
  feed: FeedGeneratorView;
  isPinned: boolean;
  onOpenFeed: (source: FeedSource) => void;
  onTogglePinnedFeed: (source: FeedSource) => void;
  canFollow?: boolean;
  isFollowing?: boolean;
  followBusy?: boolean;
  onToggleFollow?: (feedUri: string, label?: string) => void;
}) {
  const feedRkey = feed.uri.split("/").pop();
  const bskyUrl =
    feed.creator?.handle && feedRkey
      ? `https://bsky.app/profile/${feed.creator.handle}/feed/${feedRkey}`
      : "https://bsky.app";
  const likes = feed.likeCount ?? feed.likedByCount;
  const source: FeedSource = {
    id: feed.uri,
    uri: feed.uri,
    label: feed.displayName || "Public Feed",
    group: "Discovered",
    description: feed.description || "Public Bluesky feed opened from discovery.",
  };

  return (
    <article className="discover-feed-card">
      <button type="button" className="discover-feed-open" onClick={() => onOpenFeed(source)}>
        {feed.avatar ? (
          <img className="discover-feed-avatar" src={feed.avatar} alt="" loading="lazy" />
        ) : (
          <span className="discover-feed-glyph">
            <Hash size={20} />
          </span>
        )}
        <span className="discover-feed-body">
          <strong>{feed.displayName || "Public Feed"}</strong>
          <small>by @{feed.creator?.handle ?? "unknown"}</small>
          {feed.description && <span className="discover-feed-desc">{feed.description}</span>}
        </span>
        {typeof likes === "number" && <span className="discover-feed-likes">{likes.toLocaleString()} likes</span>}
      </button>
      <div className="discover-feed-actions">
        {canFollow && onToggleFollow && (
          <button
            type="button"
            className={isFollowing ? "discover-feed-follow following" : "discover-feed-follow"}
            onClick={() => onToggleFollow(feed.uri, feed.displayName || "Feed")}
            disabled={followBusy}
            aria-label={isFollowing ? `Unfollow ${source.label}` : `Follow ${source.label}`}
          >
            {followBusy ? <Loader2 className="spin" size={14} /> : <Plus size={14} />}
            {isFollowing ? "Following" : "Follow"}
          </button>
        )}
        <button
          type="button"
          className={isPinned ? "discover-feed-pin pinned" : "discover-feed-pin"}
          onClick={() => onTogglePinnedFeed(source)}
          aria-label={isPinned ? `Unpin ${source.label}` : `Pin ${source.label}`}
        >
          <Bookmark size={14} />
          {isPinned ? "Pinned" : "Pin locally"}
        </button>
        <a className="discover-feed-external" href={bskyUrl} target="_blank" rel="noreferrer">
          Open on Bluesky
        </a>
      </div>
    </article>
  );
}

function ProfileFeedsTab({
  actor,
  pinnedFeedIds,
  onOpenFeed,
  onTogglePinnedFeed,
}: {
  actor: string;
  pinnedFeedIds: string[];
  onOpenFeed: (source: FeedSource) => void;
  onTogglePinnedFeed: (source: FeedSource) => void;
}) {
  const [state, setState] = useState<{ status: "loading" | "ready" | "error" | "rate-limit"; feeds: FeedGeneratorView[]; error?: string }>({
    status: "loading",
    feeds: [],
  });

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading", feeds: [] });
    getActorFeeds(actor, 50, controller.signal)
      .then((response) => setState({ status: "ready", feeds: response.feeds }))
      .catch((error) => {
        if (!controller.signal.aborted) {
          setState({
            status: isRateLimit(error) ? "rate-limit" : "error",
            feeds: [],
            error: rateLimitMessage(error),
          });
        }
      });
    return () => controller.abort();
  }, [actor]);

  return (
    <section className="discover-feeds" aria-label="Feeds created by this account">
      {state.status === "loading" && <LoadingState label="Loading Feeds by this account" />}
      {state.status === "error" && <ErrorState message={state.error || "Feeds could not be loaded right now."} />}
      {state.status === "rate-limit" && <RateLimitState message={state.error} />}
      {state.status === "ready" && state.feeds.length === 0 && (
        <EmptyState title="No Feeds" message="This account has not published any Feeds." />
      )}
      {state.status === "ready" && state.feeds.length > 0 && (
        <div className="discover-feeds-grid">
          {state.feeds.map((feed) => (
            <DiscoverFeedCard
              key={feed.uri}
              feed={feed}
              isPinned={pinnedFeedIds.includes(feed.uri)}
              onOpenFeed={onOpenFeed}
              onTogglePinnedFeed={onTogglePinnedFeed}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function listPurposeLabel(purpose?: string) {
  if (purpose?.includes("modlist")) {
    return "Moderation list";
  }
  if (purpose?.includes("curatelist")) {
    return "User list";
  }
  return "List";
}

function ProfileListsTab({ actor, onOpenFeed }: { actor: string; onOpenFeed: (source: FeedSource) => void }) {
  const [state, setState] = useState<{ status: "loading" | "ready" | "error" | "rate-limit"; lists: ListView[]; error?: string }>({
    status: "loading",
    lists: [],
  });

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading", lists: [] });
    getActorLists(actor, 50, controller.signal)
      .then((response) => setState({ status: "ready", lists: response.lists }))
      .catch((error) => {
        if (!controller.signal.aborted) {
          setState({
            status: isRateLimit(error) ? "rate-limit" : "error",
            lists: [],
            error: rateLimitMessage(error),
          });
        }
      });
    return () => controller.abort();
  }, [actor]);

  return (
    <section className="discover-feeds" aria-label="Lists created by this account">
      {state.status === "loading" && <LoadingState label="Loading Lists by this account" />}
      {state.status === "error" && <ErrorState message={state.error || "Lists could not be loaded right now."} />}
      {state.status === "rate-limit" && <RateLimitState message={state.error} />}
      {state.status === "ready" && state.lists.length === 0 && (
        <EmptyState title="No Lists" message="This account has not published any public Lists." />
      )}
      {state.status === "ready" && state.lists.length > 0 && (
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
      )}
    </section>
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
  const [tab, setTab] = useState<"all" | "mentions">("all");
  // When the read fails, check whether it's because the session is missing the
  // notification scope (added after this user's last consent) so we can offer a
  // contextual re-authorize instead of a dead-end error.
  const [needsReauth, setNeedsReauth] = useState(false);

  const load = useCallback(() => {
    setStatus("loading");
    getNotifications()
      .then((page) => {
        setItems(page.notifications);
        setCursor(page.cursor);
        setStatus("ready");
        // Mark seen so the unread count resets; non-fatal if it fails.
        markNotificationsSeen()
          .then(onNotificationsSeen)
          .catch(() => {});
      })
      .catch(() => {
        setStatus("error");
        // A missing notification scope means re-auth fixes it; a generic gap
        // (network) does not. getMissingScopes tells them apart.
        void getMissingScopes()
          .then((missing) => setNeedsReauth(missing.some((scope) => scope.includes("notification"))))
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
    getNotifications(cursor)
      .then((page) => {
        setItems((current) => [...current, ...page.notifications]);
        setCursor(page.cursor);
      })
      .catch(() => {})
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
          {cursor && (
            <button type="button" className="notif-load-more" onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? "Loading…" : "Load more"}
            </button>
          )}
        </section>
      )}
    </>
  );
}

function NotificationsSurface({
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

function listToFeedSource(list: ListView): FeedSource {
  return {
    id: list.uri,
    uri: list.uri,
    label: list.name || "List",
    group: "Discovered",
    description: list.description || "Bluesky list timeline.",
  };
}

function listBskyUrl(list: ListView): string {
  const handleOrDid = list.creator?.handle || list.creator?.did;
  const rkey = list.uri.split("/").pop();
  return handleOrDid && rkey ? `https://bsky.app/profile/${handleOrDid}/lists/${rkey}` : "https://bsky.app";
}

// Inline manager for the accounts on a list the user owns. Loads members on
// mount, supports add-by-handle and per-member removal. Self-contained so the
// Lists page doesn't have to thread member state through props.
function ListMemberManager({ listUri }: { listUri: string }) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [members, setMembers] = useState<ListMember[]>([]);
  const [handle, setHandle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setStatus("loading");
    getListMembers(listUri)
      .then((result) => {
        setMembers(result.members);
        setStatus("ready");
      })
      .catch(() => setStatus("error"));
  }, [listUri]);
  useEffect(() => {
    load();
  }, [load]);

  async function handleAdd(event: FormEvent) {
    event.preventDefault();
    const value = handle.trim();
    if (!value || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await addAccountToList(listUri, value);
      setHandle("");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add that account.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(listItemUri: string) {
    setBusy(true);
    setError(null);
    try {
      await removeListItem(listItemUri);
      setMembers((current) => current.filter((member) => member.listItemUri !== listItemUri));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove that account.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="list-member-manager">
      <form className="list-member-add" onSubmit={handleAdd}>
        <input
          aria-label="Add account by handle"
          placeholder="handle.bsky.social to add"
          value={handle}
          onInput={(event) => setHandle(event.currentTarget.value)}
        />
        <button type="submit" disabled={!handle.trim() || busy}>
          Add
        </button>
      </form>
      {error && <p className="composer-error" role="alert">{error}</p>}
      {status === "loading" && <p className="list-member-note">Loading members…</p>}
      {status === "error" && <p className="list-member-note">Could not load members.</p>}
      {status === "ready" && members.length === 0 && (
        <p className="list-member-note">No accounts on this list yet. Add one by handle above.</p>
      )}
      {status === "ready" && members.length > 0 && (
        <ul className="list-member-list">
          {members.map((member) => (
            <li key={member.listItemUri}>
              <span>
                <strong>{member.subject.displayName || member.subject.handle}</strong>
                <small>@{member.subject.handle}</small>
              </span>
              <button type="button" onClick={() => handleRemove(member.listItemUri)} disabled={busy}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function BlueskyListCard({
  list,
  owned,
  signedInDid,
  onOpenFeed,
  onDelete,
  onReauthorize,
}: {
  list: ListView;
  owned: boolean;
  signedInDid?: string;
  onOpenFeed: (source: FeedSource) => void;
  onDelete?: (listUri: string) => Promise<void>;
  onReauthorize?: () => void;
}) {
  const isModlist = list.purpose?.includes("modlist") ?? false;
  const isOwn = owned || (!!signedInDid && list.creator?.did === signedInDid);
  const [managing, setManaging] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Block-list subscription state, seeded from the list's viewer.blocked record
  // URI. Only meaningful for moderation lists you don't own.
  const [blockUri, setBlockUri] = useState<string | undefined>(list.viewer?.blocked);
  const [subBusy, setSubBusy] = useState(false);
  // Mute-list subscription state, seeded from viewer.muted. muteActorList is an
  // AppView procedure (no record uri), so this is just a boolean.
  const [muted, setMuted] = useState<boolean>(!!list.viewer?.muted);
  const [muteBusy, setMuteBusy] = useState(false);
  // Surfaced when a subscribe/mute write fails. `reauth` flags a missing-scope
  // failure (re-authorize fixes it) vs a generic one.
  const [subError, setSubError] = useState<{ message: string; reauth: boolean } | null>(null);

  async function handleDelete() {
    if (!onDelete || deleting) {
      return;
    }
    if (!window.confirm(`Delete the list "${list.name}"? This removes it and its membership from your account.`)) {
      return;
    }
    setDeleting(true);
    try {
      await onDelete(list.uri);
    } finally {
      setDeleting(false);
    }
  }

  async function handleToggleSubscribe() {
    if (subBusy) {
      return;
    }
    const previous = blockUri;
    setSubBusy(true);
    try {
      if (previous) {
        setBlockUri(undefined);
        await unsubscribeBlockList(previous);
      } else {
        if (!window.confirm(`Subscribe to "${list.name}" as a block list? You'll block every account on it.`)) {
          setSubBusy(false);
          return;
        }
        setBlockUri("pending");
        const uri = await subscribeBlockList(list.uri);
        setBlockUri(uri);
      }
    } catch {
      setBlockUri(previous);
      setSubError({ message: "Could not update this block-list subscription.", reauth: false });
    } finally {
      setSubBusy(false);
    }
  }

  async function handleToggleMute() {
    if (muteBusy) {
      return;
    }
    const previous = muted;
    setMuteBusy(true);
    try {
      if (previous) {
        setMuted(false);
        await unmuteList(list.uri);
      } else {
        if (!window.confirm(`Mute everyone on "${list.name}"? Their posts and reposts will be hidden from your feeds.`)) {
          setMuteBusy(false);
          return;
        }
        setMuted(true);
        await muteList(list.uri);
      }
    } catch {
      setMuted(previous);
      // Muting needs the muteActorList scope (added recently); a missing scope
      // means re-auth fixes it. Tell the two cases apart.
      const missing = await getMissingScopes().catch(() => []);
      const needsReauth = missing.some((scope) => scope.includes("muteActorList"));
      setSubError({
        message: needsReauth
          ? "Muting a list needs updated permissions — re-authorize to enable it."
          : "Could not update this mute.",
        reauth: needsReauth,
      });
    } finally {
      setMuteBusy(false);
    }
  }

  return (
    <article className="bsky-list-card">
      <div className="bsky-list-card-head">
        {list.avatar ? (
          <img className="bsky-list-avatar" src={list.avatar} alt="" loading="lazy" decoding="async" />
        ) : (
          <span className="bsky-list-avatar placeholder">
            <List size={18} />
          </span>
        )}
        <div>
          <span className="bsky-list-purpose">{listPurposeLabel(list.purpose)}</span>
          <h3>{list.name || "List"}</h3>
          {typeof list.listItemCount === "number" && (
            <small>
              {list.listItemCount.toLocaleString()} member{list.listItemCount === 1 ? "" : "s"}
            </small>
          )}
        </div>
      </div>
      {list.description && <p className="bsky-list-desc">{list.description}</p>}
      <div className="bsky-list-actions">
        {/* Moderation lists aren't browsable timelines; only curation lists open
            as a feed via getListFeed. */}
        {!isModlist && (
          <button type="button" onClick={() => onOpenFeed(listToFeedSource(list))}>
            Open list
          </button>
        )}
        {isOwn && (
          <button type="button" onClick={() => setManaging((open) => !open)}>
            {managing ? "Done" : "Manage members"}
          </button>
        )}
        {/* Subscribing as block/mute is only meaningful for someone else's modlist. */}
        {isModlist && !isOwn && (
          <button type="button" className={blockUri ? "list-subscribed" : ""} onClick={handleToggleSubscribe} disabled={subBusy}>
            {blockUri ? "Unsubscribe block" : "Subscribe (block)"}
          </button>
        )}
        {isModlist && !isOwn && (
          <button type="button" className={muted ? "list-subscribed" : ""} onClick={handleToggleMute} disabled={muteBusy}>
            {muted ? "Unmute list" : "Mute list"}
          </button>
        )}
        <a href={listBskyUrl(list)} target="_blank" rel="noreferrer">
          Open on Bluesky
        </a>
        {isOwn && onDelete && (
          <button type="button" className="list-delete" onClick={handleDelete} disabled={deleting}>
            {deleting ? "Deleting…" : "Delete"}
          </button>
        )}
      </div>
      {subError && (
        <div className="bsky-list-suberror">
          <p className="composer-error" role="alert">{subError.message}</p>
          {subError.reauth && onReauthorize && (
            <button type="button" className="reauth-primary" onClick={onReauthorize}>
              Update permissions
            </button>
          )}
        </div>
      )}
      {managing && isOwn && <ListMemberManager listUri={list.uri} />}
    </article>
  );
}

function ListsSurface({
  containerRef,
  signedIn,
  signedInDid,
  myLists,
  myListsStatus,
  onReloadMyLists,
  onCreateModList,
  onDeleteModList,
  onOpenFeed,
  onReauthorize,
  lists,
  onCreateList,
  onDeleteList,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  signedIn: boolean;
  signedInDid?: string;
  myLists: { owned: ListView[]; subscribed: ListView[] };
  myListsStatus: "idle" | "loading" | "ready" | "error";
  onReloadMyLists: () => void;
  onCreateModList: (name: string, description: string) => Promise<void>;
  onDeleteModList: (listUri: string) => Promise<void>;
  onOpenFeed: (source: FeedSource) => void;
  onReauthorize: () => void;
  lists: LocalList[];
  onCreateList: (name: string, description: string) => void;
  onDeleteList: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [showLocal, setShowLocal] = useState(false);
  const [modName, setModName] = useState("");
  const [modDescription, setModDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  async function handleCreateModList(event: FormEvent) {
    event.preventDefault();
    if (!modName.trim() || creating) {
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      await onCreateModList(modName, modDescription);
      setModName("");
      setModDescription("");
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "Could not create the list.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="timeline comfortable" ref={containerRef}>
      <section className="surface-placeholder">
        <h2>Lists</h2>
        <p>Your Bluesky lists — the curation and moderation lists you created, plus curation lists you subscribe to. Open a curation list to read it as a timeline; manage members on a list you own.</p>
      </section>

      {signedIn && (
        <section className="mod-list-create" aria-label="Create a moderation list">
          <h3 className="bsky-list-section-heading">New moderation list</h3>
          <p className="local-collections-note">
            Create a block/mute list on your Bluesky account, then add accounts to it. You (or anyone who subscribes to it as a block list) will block every member.
          </p>
          <form className="local-list-form" onSubmit={handleCreateModList}>
            <input aria-label="List name" maxLength={64} placeholder="List name" value={modName} onInput={(event) => setModName(event.currentTarget.value)} />
            <input aria-label="List description" maxLength={300} placeholder="Description (optional)" value={modDescription} onInput={(event) => setModDescription(event.currentTarget.value)} />
            <button type="submit" disabled={!modName.trim() || creating}>
              {creating ? "Creating…" : "Create list"}
            </button>
          </form>
          {createError && <p className="composer-error" role="alert">{createError}</p>}
        </section>
      )}

      {!signedIn ? (
        <EmptyState
          title="Sign in to see your lists"
          message="Your Bluesky lists load once you sign in. Use the Sign in control in the right rail."
        />
      ) : myListsStatus === "loading" || myListsStatus === "idle" ? (
        <LoadingState label="Loading your Bluesky lists" />
      ) : myListsStatus === "error" ? (
        <div className="surface-retry">
          <ErrorState message="Could not load your lists." />
          <button type="button" onClick={onReloadMyLists}>
            Retry
          </button>
        </div>
      ) : myLists.owned.length === 0 && myLists.subscribed.length === 0 ? (
        <EmptyState
          title="No lists yet"
          message="You haven't created or subscribed to any Bluesky lists. Create one on Bluesky, or build a moderation list from a profile's Block control."
        />
      ) : (
        <>
          {myLists.owned.length > 0 && (
            <section className="bsky-list-section" aria-label="Lists you created">
              <h3 className="bsky-list-section-heading">Your lists</h3>
              <div className="bsky-list-grid">
                {myLists.owned.map((list) => (
                  <BlueskyListCard
                    key={list.uri}
                    list={list}
                    owned
                    signedInDid={signedInDid}
                    onOpenFeed={onOpenFeed}
                    onDelete={onDeleteModList}
                  />
                ))}
              </div>
            </section>
          )}
          {myLists.subscribed.length > 0 && (
            <section className="bsky-list-section" aria-label="Lists you subscribe to">
              <h3 className="bsky-list-section-heading">Subscribed lists</h3>
              <div className="bsky-list-grid">
                {myLists.subscribed.map((list) => (
                  <BlueskyListCard key={list.uri} list={list} owned={false} signedInDid={signedInDid} onOpenFeed={onOpenFeed} onReauthorize={onReauthorize} />
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {/* Browser-only collections used by the post-card "Lists" control. These
          never sync to Bluesky; kept as a secondary, collapsed utility. */}
      <section className="local-collections">
        <button type="button" className="local-collections-toggle" onClick={() => setShowLocal((open) => !open)} aria-expanded={showLocal}>
          {showLocal ? <ChevronUp size={16} /> : <Plus size={16} />}
          Browser collections {lists.length > 0 ? `(${lists.length})` : ""}
        </button>
        {showLocal && (
          <>
            <p className="local-collections-note">
              Private browser-only bookmarks for organizing loaded posts via a post card&apos;s Lists control. Not Bluesky lists; nothing leaves this browser.
            </p>
            <form
              className="local-list-form"
              onSubmit={(event) => {
                event.preventDefault();
                onCreateList(name, description);
                setName("");
                setDescription("");
              }}
            >
              <input aria-label="Collection name" maxLength={80} placeholder="Collection name" value={name} onInput={(event) => setName(event.currentTarget.value)} />
              <input aria-label="Collection description" maxLength={180} placeholder="Description" value={description} onInput={(event) => setDescription(event.currentTarget.value)} />
              <button type="submit" disabled={!name.trim()}>
                New collection
              </button>
            </form>
            {lists.length > 0 && (
              <section className="local-list-grid" aria-label="Browser collections">
                {lists.map((list) => (
                  <article className="local-list-card" key={list.id}>
                    <span>Browser</span>
                    <h3>{list.name}</h3>
                    <p>{list.description || "No description yet."}</p>
                    <small>
                      {(list.posts?.length ?? 0).toLocaleString()} post{list.posts?.length === 1 ? "" : "s"}
                    </small>
                    <div className="local-list-actions">
                      <button type="button" onClick={() => onDeleteList(list.id)}>
                        Delete
                      </button>
                    </div>
                  </article>
                ))}
              </section>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function SignInForm({
  status,
  onSignIn,
}: {
  status: AuthState["status"];
  onSignIn: (handle: string) => void | Promise<void>;
}) {
  const [handle, setHandle] = useState("");
  const isBusy = status === "checking" || status === "callback" || status === "signing-in" || status === "signing-out";

  return (
    <form
      className="sign-in-form"
      onSubmit={(event) => {
        event.preventDefault();
        void onSignIn(handle);
      }}
    >
      <input
        aria-label="Bluesky handle, DID, or PDS URL"
        autoComplete="username"
        placeholder="your.handle"
        value={handle}
        onInput={(event) => setHandle(event.currentTarget.value)}
      />
      <button type="submit" disabled={isBusy}>
        {isBusy ? "Working" : "Sign in"}
      </button>
    </form>
  );
}

function AccountPanel({
  auth,
  onSignIn,
  onSignOut,
}: {
  auth: AuthState;
  onSignIn: (handle: string) => void | Promise<void>;
  onSignOut: () => void | Promise<void>;
}) {
  return (
    <section className="context-panel account-panel">
      <h2>Account</h2>
      {auth.session ? (
        <>
          <div className="account-identity">
            <Avatar profile={auth.session} />
            <span>
              <strong>{auth.session.displayName || auth.session.handle}</strong>
              <small>@{auth.session.handle}</small>
            </span>
          </div>
          <button type="button" onClick={onSignOut}>
            Sign out
          </button>
        </>
      ) : (
        <>
          <p>
            {auth.status === "callback"
              ? "Completing OAuth callback."
              : auth.status === "checking"
                ? "Checking browser session."
                : "Signed-out public reader mode."}
          </p>
          <SignInForm status={auth.status} onSignIn={onSignIn} />
        </>
      )}
      {auth.message && <p className={auth.status === "error" ? "account-warning" : undefined}>{auth.message}</p>}
    </section>
  );
}

function ProfileDetailHeader({
  actor,
  isPinned,
  profile,
  selectedTab,
  onSelectTab,
  onTogglePinned,
  canFollow,
  onFollow,
  onUnfollow,
  onBlock,
  onUnblock,
  canPost,
}: {
  actor: string;
  isPinned: boolean;
  profile: Profile | null;
  selectedTab: ProfileTab;
  onSelectTab: (tab: ProfileTab) => void;
  onTogglePinned: (profile: Profile | null | undefined) => void;
  canFollow: boolean;
  onFollow: (did: string) => Promise<string>;
  onUnfollow: (followUri: string) => Promise<void>;
  onBlock: (did: string) => Promise<string>;
  onUnblock: (blockUri: string) => Promise<void>;
  canPost: boolean;
}) {
  const [copied, setCopied] = useState(false);
  // Follow state is seeded from the authenticated profile's viewer.following
  // record URI and re-synced when the viewed profile changes.
  const [followUri, setFollowUri] = useState<string | undefined>(profile?.viewer?.following);
  const [followBusy, setFollowBusy] = useState(false);
  // Block state is seeded from the authenticated profile's viewer.blocking
  // record URI and re-synced when the viewed profile changes.
  const [blockUri, setBlockUri] = useState<string | undefined>(profile?.viewer?.blocking);
  const [blockBusy, setBlockBusy] = useState(false);
  useEffect(() => {
    setFollowUri(profile?.viewer?.following);
    setBlockUri(profile?.viewer?.blocking);
  }, [profile?.did, profile?.viewer?.following, profile?.viewer?.blocking]);

  async function handleToggleFollow() {
    if (!profile || followBusy) {
      return;
    }
    const previous = followUri;
    setFollowBusy(true);
    try {
      if (previous) {
        setFollowUri(undefined); // optimistic
        await onUnfollow(previous);
      } else {
        setFollowUri("pending"); // optimistic placeholder
        const uri = await onFollow(profile.did);
        setFollowUri(uri);
      }
    } catch {
      setFollowUri(previous); // revert on error
    } finally {
      setFollowBusy(false);
    }
  }

  async function handleToggleBlock() {
    if (!profile || blockBusy) {
      return;
    }
    // Blocking is destructive (it also removes any follow relationship server-
    // side); confirm before creating the block record.
    if (!blockUri && !window.confirm(`Block @${profile.handle}? They won't be able to see or reply to your posts, and this also undoes any follow.`)) {
      return;
    }
    const previous = blockUri;
    setBlockBusy(true);
    try {
      if (previous) {
        setBlockUri(undefined); // optimistic
        await onUnblock(previous);
      } else {
        setBlockUri("pending"); // optimistic placeholder
        const uri = await onBlock(profile.did);
        setBlockUri(uri);
        // A block clears the follow relationship server-side; reflect that.
        setFollowUri(undefined);
      }
    } catch {
      setBlockUri(previous); // revert on error
    } finally {
      setBlockBusy(false);
    }
  }

  const bskyUrl = `https://bsky.app/profile/${encodeURIComponent(profile?.handle || actor)}`;
  const visibleTabs: ProfileTab[] = canPost ? ["new-post", ...profileTabs] : [...profileTabs];

  return (
    <section className="profile-detail-header">
      <div className="profile-banner" />
      <div className="profile-detail-main">
        <Avatar profile={profile ?? undefined} />
        <div>
          <span>Public Profile</span>
          <h2>{displayName(profile ?? undefined)}</h2>
          <p>@{profile?.handle || actor}</p>
        </div>
        <div className="profile-detail-actions">
          {canFollow && !blockUri && (
            <button
              type="button"
              className={followUri ? "following" : "follow"}
              onClick={handleToggleFollow}
              disabled={followBusy || !profile}
              title={followUri ? "Unfollow this account" : "Follow this account"}
            >
              {followBusy ? "…" : followUri ? "Following" : "Follow"}
            </button>
          )}
          {canFollow && (
            <button
              type="button"
              className={blockUri ? "blocking" : "block"}
              onClick={handleToggleBlock}
              disabled={blockBusy || !profile}
              title={blockUri ? "Unblock this account" : "Block this account"}
            >
              {blockBusy ? "…" : blockUri ? "Blocking" : "Block"}
            </button>
          )}
          <button type="button" onClick={() => onTogglePinned(profile)} disabled={!profile}>
            {isPinned ? "Unpin profile" : "Pin locally"}
          </button>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(bskyUrl);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1600);
            }}
          >
            {copied ? "Copied" : "Copy link"}
          </button>
          <a href={bskyUrl} target="_blank" rel="noreferrer">
            Open on Bluesky
          </a>
        </div>
      </div>
      {profile?.description && <p className="profile-detail-description">{profile.description}</p>}
      <dl className="profile-detail-stats">
        <div>
          <dt>Followers</dt>
          <dd>{profile?.followersCount?.toLocaleString() ?? "-"}</dd>
        </div>
        <div>
          <dt>Following</dt>
          <dd>{profile?.followsCount?.toLocaleString() ?? "-"}</dd>
        </div>
        <div>
          <dt>Posts</dt>
          <dd>{profile?.postsCount?.toLocaleString() ?? "-"}</dd>
        </div>
      </dl>
      <div className="profile-tabs" aria-label="Profile tabs">
        {visibleTabs.map((tab) => (
          <button className={selectedTab === tab ? "selected" : ""} key={tab} type="button" onClick={() => onSelectTab(tab)}>
            {tab === "new-post" ? "New post" : tab}
          </button>
        ))}
      </div>
    </section>
  );
}

// One in-progress composer image: the File to upload plus a preview object-URL,
// stable id, and editable alt text. Session-only (not persisted).
type ComposerImageState = { id: string; file: File; url: string; alt: string };

// Post language metadata. The native field is the post record's BCP-47 `langs`
// array (app.bsky.feed.post — docs allow multiple values, e.g. ["th","en-US"]),
// which we write via publishPost/publishThread.
//
// Verified against bsky.app (2026-06-14): the *default* post language is NOT an
// atproto account/profile preference — bsky stores it device-locally in
// BSKY_STORAGE.languagePrefs.postLanguage (alongside primaryLanguage/
// contentLanguages/postLanguageHistory, all client-side), initialized from the
// device locale. So there is no account-synced default to read; we mirror bsky
// by defaulting from the browser locale and persisting the choice browser-local.
const postLanguageStorageKey = "bigbsky:post-language";
// Recent post languages (most-recent-first), mirroring bsky's postLanguageHistory
// so the picker can surface the handful of languages the user actually posts in.
const postLanguageHistoryStorageKey = "bigbsky:post-language-history";
const POST_LANGUAGE_HISTORY_LIMIT = 4;

// The full set of ISO 639-1 two-letter language codes, matching the post
// languages bsky's composer offers. Names are rendered with Intl.DisplayNames in
// English (as bsky shows them), so we only need to maintain the code list.
const ISO_639_1_CODES = [
  "aa", "ab", "ae", "af", "ak", "am", "an", "ar", "as", "av", "ay", "az",
  "ba", "be", "bg", "bh", "bi", "bm", "bn", "bo", "br", "bs",
  "ca", "ce", "ch", "co", "cr", "cs", "cu", "cv", "cy",
  "da", "de", "dv", "dz",
  "ee", "el", "en", "eo", "es", "et", "eu",
  "fa", "ff", "fi", "fj", "fo", "fr", "fy",
  "ga", "gd", "gl", "gn", "gu", "gv",
  "ha", "he", "hi", "ho", "hr", "ht", "hu", "hy", "hz",
  "ia", "id", "ie", "ig", "ii", "ik", "io", "is", "it", "iu",
  "ja", "jv",
  "ka", "kg", "ki", "kj", "kk", "kl", "km", "kn", "ko", "kr", "ks", "ku", "kv", "kw", "ky",
  "la", "lb", "lg", "li", "ln", "lo", "lt", "lu", "lv",
  "mg", "mh", "mi", "mk", "ml", "mn", "mr", "ms", "mt", "my",
  "na", "nb", "nd", "ne", "ng", "nl", "nn", "no", "nr", "nv", "ny",
  "oc", "oj", "om", "or", "os",
  "pa", "pi", "pl", "ps", "pt",
  "qu",
  "rm", "rn", "ro", "ru", "rw",
  "sa", "sc", "sd", "se", "sg", "si", "sk", "sl", "sm", "sn", "so", "sq", "sr", "ss", "st", "su", "sv", "sw",
  "ta", "te", "tg", "th", "ti", "tk", "tl", "tn", "to", "tr", "ts", "tt", "tw", "ty",
  "ug", "uk", "ur", "uz",
  "ve", "vi", "vo",
  "wa", "wo",
  "xh",
  "yi", "yo",
  "za", "zh", "zu",
];

// English display name for a language code (matches bsky's English-name display),
// falling back to the uppercased code when Intl can't name it.
function languageDisplayName(code: string): string {
  try {
    const display = new Intl.DisplayNames(["en"], { type: "language" }).of(code);
    if (display && display.toLowerCase() !== code.toLowerCase()) {
      return display;
    }
  } catch {
    // Intl.DisplayNames unavailable — fall through to the code.
  }
  return code.toUpperCase();
}

const POST_LANGUAGE_OPTIONS: Array<{ code: string; label: string }> = (() => {
  const seenLabels = new Set<string>();
  return ISO_639_1_CODES.map((code) => ({ code, label: languageDisplayName(code) }))
    // Drop codes Intl couldn't name (label falls back to the bare code) and
    // collapse the rare case where two codes share one English name.
    .filter((option) => {
      if (option.label === option.code.toUpperCase() || seenLabels.has(option.label)) {
        return false;
      }
      seenLabels.add(option.label);
      return true;
    })
    .sort((a, b) => a.label.localeCompare(b.label));
})();

// Resolve a default post language: the last-used choice if any, else the
// browser's primary language (normalized to a base code we offer), else English.
function readDefaultPostLanguage(): string {
  try {
    const saved = localStorage.getItem(postLanguageStorageKey);
    if (saved && POST_LANGUAGE_OPTIONS.some((option) => option.code === saved)) {
      return saved;
    }
  } catch {
    // ignore storage failures and fall through to the browser/default guess
  }
  const candidates =
    typeof navigator !== "undefined"
      ? [navigator.language, ...(navigator.languages ?? [])].filter(Boolean)
      : [];
  for (const candidate of candidates) {
    const base = candidate.toLowerCase().split("-")[0];
    if (POST_LANGUAGE_OPTIONS.some((option) => option.code === base)) {
      return base;
    }
  }
  return "en";
}

function postLanguageLabel(code: string): string {
  return POST_LANGUAGE_OPTIONS.find((option) => option.code === code)?.label ?? code;
}

function readPostLanguageHistory(): string[] {
  try {
    const raw = localStorage.getItem(postLanguageHistoryStorageKey);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(
      (code): code is string =>
        typeof code === "string" && POST_LANGUAGE_OPTIONS.some((option) => option.code === code),
    );
  } catch {
    return [];
  }
}

// Prepend the chosen language to the recent-history list (dedup, capped).
function recordPostLanguage(code: string) {
  const next = [code, ...readPostLanguageHistory().filter((entry) => entry !== code)].slice(
    0,
    POST_LANGUAGE_HISTORY_LIMIT,
  );
  safeLocalStorageSet(postLanguageHistoryStorageKey, JSON.stringify(next));
}

// bsky-style language picker: a text button showing the current language that
// opens a small menu of recent languages (with radio markers) plus a
// "More languages…" expansion to the full list. Closes on outside-click/Escape.
function PostLanguagePicker({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (code: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onDocPointer(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
        setShowAll(false);
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        setShowAll(false);
      }
    }
    document.addEventListener("mousedown", onDocPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Recent languages to show first: the current value, then history, padded with
  // English so the short list is never empty.
  const recent: string[] = [];
  for (const code of [value, ...readPostLanguageHistory(), "en"]) {
    if (!recent.includes(code) && POST_LANGUAGE_OPTIONS.some((option) => option.code === code)) {
      recent.push(code);
    }
    if (recent.length >= POST_LANGUAGE_HISTORY_LIMIT) {
      break;
    }
  }

  function choose(code: string) {
    recordPostLanguage(code);
    onChange(code);
    setOpen(false);
    setShowAll(false);
  }

  const listed = showAll ? POST_LANGUAGE_OPTIONS.map((option) => option.code) : recent;

  return (
    <div className="composer-language" ref={rootRef}>
      <button
        type="button"
        className="composer-language-button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Post language"
        onClick={() => setOpen((current) => !current)}
      >
        {postLanguageLabel(value)}
      </button>
      {open && (
        <div className={`composer-language-menu${showAll ? " expanded" : ""}`} role="listbox">
          {listed.map((code) => (
            <button
              key={code}
              type="button"
              role="option"
              aria-selected={code === value}
              className={`composer-language-option${code === value ? " selected" : ""}`}
              onClick={() => choose(code)}
            >
              <span>{postLanguageLabel(code)}</span>
              <span className="composer-language-radio" aria-hidden="true" />
            </button>
          ))}
          {!showAll && (
            <button
              type="button"
              className="composer-language-more"
              onClick={() => setShowAll(true)}
            >
              <span>More languages…</span>
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// Curated emoji set for the composer picker, grouped the way bsky's picker is.
// Plain text insertion only — emoji are ordinary Unicode characters, so no API
// or upload is involved; they flow through the post text like any other glyph.
const EMOJI_GROUPS: Array<{ label: string; emoji: string[] }> = [
  {
    label: "Smileys",
    emoji: [
      "😀", "😃", "😄", "😁", "😆", "😅", "🤣", "😂", "🙂", "🙃",
      "😉", "😊", "😇", "🥰", "😍", "🤩", "😘", "😋", "😜", "🤪",
      "😎", "🤓", "🥳", "😏", "😴", "😪", "🤔", "🤨", "😐", "😶",
      "🙄", "😬", "😯", "😳", "🥺", "😢", "😭", "😤", "😠", "😡",
      "🤯", "😱", "😨", "😰", "😥", "🤗", "🤭", "🤐", "😴", "🤤",
    ],
  },
  {
    label: "Gestures",
    emoji: [
      "👍", "👎", "👌", "🤌", "✌️", "🤞", "🤟", "🤙", "👈", "👉",
      "👆", "👇", "☝️", "👋", "🤚", "🖐️", "✋", "👏", "🙌", "🙏",
      "🤝", "💪", "🫶", "👀", "🧠", "🫡", "🤷", "🤦",
    ],
  },
  {
    label: "Hearts",
    emoji: [
      "❤️", "🧡", "💛", "💚", "💙", "💜", "🤎", "🖤", "🤍", "💔",
      "❤️‍🔥", "💖", "💗", "💓", "💞", "💕", "💌", "💯",
    ],
  },
  {
    label: "Animals & Nature",
    emoji: [
      "🐶", "🐱", "🦊", "🐻", "🐼", "🐨", "🐯", "🦁", "🐮", "🐷",
      "🐸", "🐙", "🦋", "🐝", "🐢", "🐰", "🦄", "🌟", "⭐", "🔥",
      "🌈", "☀️", "🌙", "⚡", "❄️", "🌸", "🌹", "🌻", "🍀", "🌊",
    ],
  },
  {
    label: "Food & Drink",
    emoji: [
      "🍎", "🍊", "🍓", "🍉", "🍇", "🍌", "🍍", "🥑", "🍕", "🍔",
      "🌮", "🍟", "🍩", "🍪", "🎂", "🍰", "🍫", "🍿", "☕", "🍵",
      "🍺", "🍻", "🥂", "🍷",
    ],
  },
  {
    label: "Activities & Objects",
    emoji: [
      "⚽", "🏀", "🏈", "🎾", "🎮", "🎲", "🎯", "🎵", "🎸", "🎤",
      "🎉", "🎊", "🎁", "🏆", "🥇", "📷", "📱", "💻", "💡", "📚",
      "✈️", "🚀", "🌍", "🕰️", "💰", "🎈",
    ],
  },
  {
    label: "Symbols",
    emoji: [
      "✅", "❌", "⭕", "❓", "❗", "💬", "👁️", "🔗", "🔒", "🔔",
      "⚠️", "♻️", "✨", "💥", "💢", "💤", "🆗", "🆕", "🔝", "©️",
    ],
  },
];

function EmojiPicker({ onSelect, disabled }: { onSelect: (emoji: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onDocPointer(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function choose(emoji: string) {
    onSelect(emoji);
    setOpen(false);
  }

  return (
    <div className="composer-emoji" ref={rootRef}>
      <button
        type="button"
        title="Add emoji"
        aria-label="Add emoji"
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        <Smile size={20} />
      </button>
      {open && (
        <div className="composer-emoji-menu" role="dialog" aria-label="Emoji picker">
          {EMOJI_GROUPS.map((group) => (
            <div className="composer-emoji-group" key={group.label}>
              <p className="composer-emoji-group-label">{group.label}</p>
              <div className="composer-emoji-grid">
                {group.emoji.map((emoji, index) => (
                  <button
                    key={`${group.label}-${index}`}
                    type="button"
                    className="composer-emoji-option"
                    title={emoji}
                    onClick={() => choose(emoji)}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Default a reply's post language to the parent post's language (matching
// bsky, which seeds the composer from `replyTo?.langs`), normalized to a base
// code we offer; falls back to the user's saved/browser default.
function readReplyDefaultLanguage(parent: FeedPost): string {
  const langs = parent.record?.langs;
  if (Array.isArray(langs)) {
    for (const lang of langs) {
      if (typeof lang !== "string") {
        continue;
      }
      const base = lang.toLowerCase().split("-")[0];
      if (POST_LANGUAGE_OPTIONS.some((option) => option.code === base)) {
        return base;
      }
    }
  }
  return readDefaultPostLanguage();
}

// One composer for both new posts and replies. The mode is just whether
// `replyTo` is set (mirrors bsky's single composer keyed on `replyTo`), so every
// shared feature — text + grapheme char count, image attach/alt, the emoji
// picker, the language picker, draft autosave — lives in exactly one place and
// can't drift between the two surfaces. Only the outer skeleton (reply-target
// inline frame vs the collapsible "New post" panel), placeholder/labels, draft
// key, and submit path branch on `isReply`.
function PostComposer({
  draft,
  onDraftChange,
  onPosted,
  defaultExpanded = false,
  replyTo,
  canReply = true,
  onClose,
  onReplied,
}: {
  // New-post mode (controlled draft lifted to the app so it survives navigation):
  draft?: { posts: string[] };
  onDraftChange?: (draft: { posts: string[] }) => void;
  onPosted?: () => void;
  defaultExpanded?: boolean;
  // Reply mode (presence of `replyTo` switches the composer into a reply):
  replyTo?: { parent: FeedPost; root: PostRefValue };
  canReply?: boolean;
  onClose?: () => void;
  onReplied?: () => void;
}) {
  const isReply = !!replyTo;
  // Reply text is internal state seeded from a per-thread draft key; new-post
  // text is the controlled parent draft. `draftText`/`setText` unify the two so
  // the shared body never has to know which mode it's in.
  const [replyText, setReplyText] = useState("");
  const draftText = isReply
    ? replyText
    : (draft?.posts && draft.posts.length > 0 ? draft.posts : [""]).join("\n\n");
  const setText = (value: string) => {
    if (isReply) {
      setReplyText(value);
    } else {
      onDraftChange?.({ posts: [value] });
    }
  };
  const replyDraftKey = replyTo ? `${replyDraftPrefix}${replyTo.parent.uri}` : "";

  const generatedPosts = splitTextForThread(draftText);
  const generatedPostCount = Math.max(generatedPosts.length, 1);
  // A single post is capped on both graphemes and UTF-8 bytes. Track both and
  // surface whichever is more binding. New posts auto-split (splitTextForThread
  // honors both budgets), so this gate only blocks the reply path, which is a
  // single un-split post. Today the grapheme cap always bites first; the byte
  // cap is here so a raised grapheme limit can't let a multi-byte reply through.
  const remaining = POST_GRAPHEME_LIMIT - graphemeLength(draftText);
  const byteRemaining = POST_BYTE_LIMIT - utf8ByteLength(draftText);
  const remainingDisplay = Math.min(remaining, byteRemaining);
  const isOverLimit = remainingDisplay < 0;
  // Real attached images live in component state (not the persisted draft):
  // File objects and object-URLs can't be JSON-serialized to localStorage, so
  // they are session-only — text drafts persist across reloads, images don't.
  const [images, setImages] = useState<ComposerImageState[]>([]);
  // Mirror images into a ref so the unmount cleanup revokes the *current* blob
  // URLs. A cleanup with an empty dep array closes over the mount-time [] and
  // would leak every URL when the user attaches images then navigates away.
  const imagesRef = useRef(images);
  imagesRef.current = images;
  const hasContent = draftText.trim().length > 0 || images.length > 0;
  // Collapsed by default to keep the top of the feed clean; expand on click.
  // Start expanded if a local draft is already in progress so it isn't hidden.
  // (Replies render inline and ignore this — they're always expanded.)
  const [expanded, setExpanded] = useState(defaultExpanded || hasContent);
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const [postLang, setPostLang] = useState(() =>
    replyTo ? readReplyDefaultLanguage(replyTo.parent) : readDefaultPostLanguage(),
  );
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // New-post draft autosave (controlled draft → localStorage). No-op for replies.
  useEffect(() => {
    if (isReply) {
      return;
    }
    if (draftText.trim().length > 0) {
      safeLocalStorageSet(composerDraftStorageKey, JSON.stringify({ posts: [draftText] }));
    } else {
      safeLocalStorageRemove(composerDraftStorageKey);
    }
  }, [isReply, draftText]);

  // Reply: seed the text from the per-thread draft key when the target changes.
  useEffect(() => {
    if (!isReply) {
      return;
    }
    setReplyText(safeLocalStorageGet(replyDraftKey) || "");
  }, [isReply, replyDraftKey]);

  // Reply: autosave the text to the per-thread draft key.
  useEffect(() => {
    if (!isReply) {
      return;
    }
    if (replyText.trim()) {
      safeLocalStorageSet(replyDraftKey, replyText);
    } else {
      safeLocalStorageRemove(replyDraftKey);
    }
  }, [isReply, replyDraftKey, replyText]);

  // Revoke any outstanding object URLs when the composer unmounts.
  useEffect(() => {
    return () => {
      imagesRef.current.forEach((image) => URL.revokeObjectURL(image.url));
    };
  }, []);

  // Insert text (e.g. an emoji) at the textarea caret, replacing any selection,
  // then restore focus with the caret just after the inserted text.
  function insertAtCaret(snippet: string) {
    const el = textareaRef.current;
    if (!el) {
      setText(draftText + snippet);
      return;
    }
    const start = el.selectionStart ?? draftText.length;
    const end = el.selectionEnd ?? draftText.length;
    const caret = start + snippet.length;
    setText(draftText.slice(0, start) + snippet + draftText.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(caret, caret);
    });
  }

  function onFilesSelected(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) {
      return;
    }
    const picked = Array.from(fileList).filter((file) => file.type.startsWith("image/"));
    setImages((existing) => {
      const room = MAX_POST_IMAGES - existing.length;
      const added = picked.slice(0, Math.max(0, room)).map((file) => ({
        id: `${file.name}-${file.size}-${file.lastModified}-${existing.length}`,
        file,
        url: URL.createObjectURL(file),
        alt: "",
      }));
      return [...existing, ...added];
    });
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function removeImage(id: string) {
    setImages((current) => {
      const target = current.find((image) => image.id === id);
      if (target) {
        URL.revokeObjectURL(target.url);
      }
      return current.filter((image) => image.id !== id);
    });
  }

  function setImageAlt(id: string, alt: string) {
    setImages((current) => current.map((image) => (image.id === id ? { ...image, alt } : image)));
  }

  function clearDraft() {
    images.forEach((image) => URL.revokeObjectURL(image.url));
    setImages([]);
    safeLocalStorageRemove(composerDraftStorageKey);
    onDraftChange?.({ posts: [""] });
  }

  async function handleSubmit() {
    if (posting || !hasContent || (isReply && isOverLimit)) {
      return;
    }
    setPosting(true);
    setPostError(null);
    try {
      const composerImages = images.map((image) => ({ file: image.file, alt: image.alt }));
      if (isReply && replyTo) {
        await publishPost({
          text: draftText.trim(),
          reply: { root: replyTo.root, parent: { uri: replyTo.parent.uri, cid: replyTo.parent.cid } },
          ...(postLang ? { langs: [postLang] } : {}),
          ...(composerImages.length > 0 ? { images: composerImages } : {}),
        });
      } else {
        const postTexts = splitTextForThread(draftText);
        const postsToPublish =
          postTexts.length > 0
            ? postTexts.map((text, index) => ({ text, images: index === 0 ? composerImages : [] }))
            : [{ text: "", images: composerImages }];
        await publishThread(postsToPublish, postLang ? [postLang] : undefined);
      }
      // Posted: revoke the session image URLs and clear the draft.
      images.forEach((image) => URL.revokeObjectURL(image.url));
      setImages([]);
      if (isReply) {
        setReplyText("");
        safeLocalStorageRemove(replyDraftKey);
        onClose?.();
        onReplied?.();
      } else {
        safeLocalStorageRemove(composerDraftStorageKey);
        onDraftChange?.({ posts: [""] });
        setExpanded(false);
        onPosted?.();
      }
    } catch (error) {
      setPostError(
        error instanceof Error
          ? error.message
          : isReply
            ? "Could not publish reply. Try again."
            : "Could not publish. Try again.",
      );
    } finally {
      setPosting(false);
    }
  }

  // Shared pieces used by both skeletons.
  const mediaGrid =
    images.length > 0 ? (
      <div className="composer-media-grid" aria-label="Attached images">
        {images.map((image) => (
          <div className="composer-media-item" key={image.id}>
            <img src={image.url} alt={image.alt || "Attached image preview"} />
            <button
              type="button"
              className="composer-media-remove"
              title="Remove image"
              aria-label="Remove image"
              onClick={() => removeImage(image.id)}
            >
              <X size={14} />
            </button>
            <input
              className="composer-media-alt"
              type="text"
              placeholder="Alt text (describe the image)"
              value={image.alt}
              maxLength={2000}
              onChange={(event) => setImageAlt(image.id, event.target.value)}
            />
          </div>
        ))}
      </div>
    ) : null;

  const fileInput = (
    <input
      ref={fileInputRef}
      type="file"
      accept="image/*"
      multiple
      hidden
      onChange={(event) => onFilesSelected(event.target.files)}
    />
  );

  const errorNode = postError ? (
    <p className="composer-error" role="alert">
      {postError}
    </p>
  ) : null;

  // The tools (image + emoji) and meta (language + char count) row is identical
  // for both modes — this is the shared action bar the unification is about.
  const toolsAndMeta = (
    <>
      <div className="composer-tools">
        <button
          type="button"
          title="Add image"
          aria-label="Add image"
          onClick={() => fileInputRef.current?.click()}
          disabled={posting || (isReply && !canReply) || images.length >= MAX_POST_IMAGES}
        >
          <Image size={20} />
        </button>
        <EmojiPicker disabled={posting || (isReply && !canReply)} onSelect={insertAtCaret} />
      </div>
      <div className="composer-meta">
        <PostLanguagePicker
          value={postLang}
          disabled={posting || (isReply && !canReply)}
          onChange={(code) => {
            setPostLang(code);
            safeLocalStorageSet(postLanguageStorageKey, code);
          }}
        />
        {isReply ? (
          <span className={`composer-count${isOverLimit ? " over-limit" : ""}`}>{remainingDisplay}</span>
        ) : (
          <span className="composer-count">
            {draftText.trim() && generatedPostCount > 1 ? `${generatedPostCount} posts` : remainingDisplay}
          </span>
        )}
      </div>
    </>
  );

  if (isReply && replyTo) {
    const parentText = replyTo.parent.record.text?.trim() || "";
    return (
      <section className="reply-composer inline" aria-label={`Reply to ${displayName(replyTo.parent.author)}`}>
        <div className="reply-target-preview">
          <Avatar profile={replyTo.parent.author} />
          <div className="reply-target-body">
            <div className="reply-target-meta">
              <span className="reply-target-name">{displayName(replyTo.parent.author)}</span>
              <span className="reply-target-handle">@{replyTo.parent.author.handle}</span>
            </div>
            {parentText && <p className="reply-target-text">{parentText}</p>}
          </div>
        </div>
        <textarea
          ref={textareaRef}
          autoFocus
          placeholder={canReply ? `Reply to @${replyTo.parent.author.handle}` : "Sign in to reply."}
          value={draftText}
          onChange={(event) => setText(event.currentTarget.value)}
          disabled={!canReply || posting}
        />
        {mediaGrid}
        {fileInput}
        {errorNode}
        <div className="composer-actions">
          {toolsAndMeta}
          <div className="composer-send">
            <button type="button" className="composer-send-cancel" onClick={onClose} disabled={posting}>
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canReply || posting || isOverLimit || !hasContent}
            >
              {posting ? "Replying..." : "Reply"}
            </button>
          </div>
        </div>
      </section>
    );
  }

  if (!expanded) {
    return (
      <section className="composer composer-collapsed" aria-label="Composer">
        <button type="button" className="composer-banner" onClick={() => setExpanded(true)} aria-expanded={false}>
          <Plus size={18} />
          <span>Add New Post</span>
          {hasContent && <span className="composer-banner-badge">Draft saved</span>}
        </button>
      </section>
    );
  }

  return (
    <section className="composer" aria-label="Composer">
      <div className="composer-header">
        <strong>New post</strong>
        <button
          type="button"
          className="composer-collapse"
          onClick={() => setExpanded(false)}
          aria-label="Collapse composer"
          title="Collapse"
        >
          <ChevronUp size={18} />
        </button>
      </div>
      <div className="composer-thread">
        <div className="composer-draft">
          <textarea
            ref={textareaRef}
            placeholder="What's on your mind?"
            value={draftText}
            onChange={(event) => setText(event.target.value)}
          />
          {mediaGrid}
          <div className="composer-footer">
            {toolsAndMeta}
            <span className="composer-status">
              {posting ? "Publishing…" : hasContent ? "Draft autosaved locally" : "No local draft"}
            </span>
            <button type="button" onClick={clearDraft} disabled={!hasContent || posting}>
              Clear draft
            </button>
            <button type="button" onClick={handleSubmit} disabled={!hasContent || posting}>
              {posting ? "Posting…" : draftText.trim() && generatedPostCount > 1 ? "Post thread" : "Post"}
            </button>
          </div>
        </div>
      </div>
      {fileInput}
      {errorNode}
    </section>
  );
}

function SearchBox({
  value,
  onChange,
  onSearch,
}: {
  value: string;
  onChange: (value: string) => void;
  onSearch: (query: string) => void;
}) {
  return (
    <form
      className="search-box"
      onSubmit={(event) => {
        event.preventDefault();
        onSearch(value);
      }}
    >
      <Search size={18} />
      <input
        aria-label="Search"
        placeholder="Search or paste a post URL"
        value={value}
        onInput={(event) => onChange(event.currentTarget.value)}
      />
      {value && (
        <button type="button" className="search-box-clear" onClick={() => onChange("")} aria-label="Clear search box" title="Clear search">
          <X size={16} />
        </button>
      )}
    </form>
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
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  currentDid?: string;
  localLists: LocalList[];
  signedIn: boolean;
  onOpenImage: (image: ImageViewerState) => void;
  onOpenPost: (post: FeedPost) => void;
  onOpenProfile: (profile: Profile) => void;
  onToggleListPost: (listId: string, post: FeedPost) => void;
}) {
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [items, setItems] = useState<FeedItem[]>([]);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    if (!signedIn) {
      setStatus("idle");
      setItems([]);
      setCursor(undefined);
      return undefined;
    }
    let cancelled = false;
    setStatus("loading");
    void (async () => {
      try {
        const response = await getBookmarks();
        const hydratedItems = await hydrateProfileSelfThreads(response.feed);
        if (cancelled) {
          return;
        }
        setItems(hydratedItems);
        setCursor(response.cursor);
        setStatus("ready");
      } catch {
        if (!cancelled) {
          setStatus("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [signedIn]);

  const loadMore = () => {
    if (!cursor || loadingMore) {
      return;
    }
    setLoadingMore(true);
    void (async () => {
      try {
        const response = await getBookmarks(cursor);
        const hydratedItems = await hydrateProfileSelfThreads(response.feed);
        setItems((current) => [...current, ...hydratedItems]);
        setCursor(response.cursor);
      } catch {
        // Keep what we have; the load-more control stays for an explicit retry.
      } finally {
        setLoadingMore(false);
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
        >
          {cursor && <AutoLoadMoreButton label="Load more bookmarks" onLoadMore={loadMore} />}
          {!cursor && <EndOfFeedCard />}
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

    return feedSources.filter((source) =>
      `${source.label} ${source.description} ${source.group}`.toLowerCase().includes(normalizedQuery),
    );
  }, [feedSources, query]);

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
          {searchState.status === "ready" && searchState.posts.length === 0 && (
            <EmptyState title="No posts found" message="Try a broader query or switch between top and latest results." />
          )}
          {searchState.status === "ready" && searchState.posts.length > 0 && (
            <>
              {searchState.posts.map((post) => (
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

function renderRichText(
  text: string,
  facets: RichTextFacet[] | undefined,
  onOpenProfile?: (profile: Profile) => void,
  onOpenTag?: ((tag: string) => void) | null,
): ReactNode {
  if (!text) {
    return text;
  }
  // Byte-range/facet-selection lives in the pure, tested segmentRichText helper
  // (src/richtext.ts); here we only map segments to interactive React nodes.
  const segments = segmentRichText(text, facets);
  if (segments.length === 0) {
    return text;
  }
  if (segments.length === 1 && segments[0].kind === "text") {
    return segments[0].text;
  }

  return segments.map((segment, index) => {
    if (segment.kind === "link") {
      return (
        <a
          key={index}
          className="post-link"
          href={segment.uri}
          target="_blank"
          rel="noreferrer"
          onClick={(event) => event.stopPropagation()}
        >
          {segment.text}
        </a>
      );
    }
    if (segment.kind === "mention" && onOpenProfile) {
      const did = segment.did;
      const handle = segment.text.replace(/^@/, "");
      return (
        <button
          key={index}
          type="button"
          className="post-mention"
          onClick={(event) => {
            event.stopPropagation();
            onOpenProfile({ did, handle });
          }}
        >
          {segment.text}
        </button>
      );
    }
    if (segment.kind === "tag" && onOpenTag) {
      const tag = segment.tag;
      return (
        <button
          key={index}
          type="button"
          className="post-tag"
          onClick={(event) => {
            event.stopPropagation();
            onOpenTag(tag);
          }}
        >
          {segment.text}
        </button>
      );
    }
    return segment.text;
  });
}

function ExternalLinkCard({
  className = "",
  external,
  hideThumbnail = false,
}: {
  className?: string;
  external: NonNullable<ReturnType<typeof getExternalEmbed>>;
  hideThumbnail?: boolean;
}) {
  const href = safeHttpUrl(external.uri);
  const thumb = safeHttpUrl(external.thumb);
  if (!href) {
    return null;
  }

  const noMedia = hideThumbnail || !thumb;
  const classes = ["link-card", className, noMedia ? "no-media" : ""].filter(Boolean).join(" ");

  return (
    <div className={classes}>
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        {thumb && !hideThumbnail && <img alt="" src={thumb} loading="lazy" decoding="async" />}
        <span>
          <strong>{external.title || external.uri}</strong>
          <em>Open {formatExternalUrlLabel(external.uri || external.title || "")}</em>
          {external.description && <small>{external.description}</small>}
        </span>
      </a>
    </div>
  );
}

function formatExternalUrlLabel(uri: string) {
  try {
    const url = new URL(uri);
    const path = `${url.pathname}${url.search}`.replace(/\/$/, "");
    return `${url.hostname.replace(/^www\./, "")}${path && path !== "/" ? path : ""}`;
  } catch {
    return uri;
  }
}

function sensitiveMediaValues(labels: Array<{ val?: string }>) {
  return Array.from(
    new Set(
      labels
        .filter(isSensitiveLabel)
        .map((label) => label.val?.toLowerCase() || "")
        .filter((value) => value && !value.includes("spam")),
    ),
  );
}

function SensitiveMediaGate({ values, onReveal }: { values: string[]; onReveal: () => void }) {
  return (
    <button type="button" className="sensitive-media-gate" onClick={onReveal}>
      <EyeOff size={18} />
      <strong>Sensitive content</strong>
      <small>{values.map((value) => moderationLabelText({ val: value })).join(", ")}</small>
      <span className="sensitive-media-show">Show</span>
    </button>
  );
}

// Shown in place of images/video when the "Show Media" setting is off. Clicking
// reveals the media for that one card without changing the global setting.
function MediaHiddenButton({ kind, onReveal, revealed = false }: { kind: "image" | "video"; onReveal: () => void; revealed?: boolean }) {
  const label = revealed ? "Hide Media" : "Reveal Media";
  return (
    <button
      type="button"
      className="media-hidden-button"
      onClick={onReveal}
      title={revealed ? `Hide ${kind}` : `Show ${kind}`}
      aria-label={revealed ? `Hide ${kind}` : `Show hidden ${kind}`}
    >
      {kind === "video" ? <Film size={16} /> : <Image size={16} />}
      <span>{label}</span>
    </button>
  );
}

function ReplyLimitedNotice() {
  return (
    <p className="reply-limited-notice" role="status">
      <ShieldAlert size={14} />
      <span>Replies are limited for this post.</span>
    </p>
  );
}

function useReplyGate(post: FeedPost, onReply?: (post: FeedPost) => void) {
  const [showReplyLimited, setShowReplyLimited] = useState(false);

  useEffect(() => {
    setShowReplyLimited(false);
  }, [post.uri]);

  const handleReplyClick = () => {
    if (post.viewer?.replyDisabled) {
      setShowReplyLimited(true);
      return;
    }
    onReply?.(post);
  };

  return { showReplyLimited, handleReplyClick };
}

function ThreadedPostCard({
  thread,
  onOpenImage,
  onOpenPost,
  onOpenProfile,
  onReply,
  replyActive = false,
}: {
  thread: ThreadedFeedItem;
  onOpenImage?: (image: ImageViewerState) => void;
  onOpenPost?: (post: FeedPost) => void;
  onOpenProfile?: (profile: Profile) => void;
  onReply?: (post: FeedPost) => void;
  replyActive?: boolean;
}) {
  const onOpenTag = useContext(TagSearchContext);
  const likeCtx = useContext(LikeContext);
  const bookmarkCtx = useContext(BookmarkContext);
  const [shareState, setShareState] = useState<"idle" | "copied" | "shared" | "error">("idle");
  const posts = [thread.root.post, ...thread.replies.map((item) => item.post)];
  const rootPost = thread.root.post;
  const likeView = likeCtx?.getState(rootPost);
  const bookmarkView = bookmarkCtx?.getState(rootPost);
  const postTimeLabel = formatPostTime(postSortAt(rootPost));
  // Each continuation part is itself a reply to the previous part, so it is
  // counted in that part's replyCount. Subtract the in-thread hops so the chip
  // reflects external replies to the thread, not the thread's own continuations.
  const replyCount = Math.max(0, posts.reduce((total, post) => total + (post.replyCount ?? 0), 0) - (posts.length - 1));
  const repostCount = posts.reduce((total, post) => total + (post.repostCount ?? 0), 0);
  const quoteCount = posts.reduce((total, post) => total + (post.quoteCount ?? 0), 0);
  const likeCount = posts.reduce((total, post) => total + (post.likeCount ?? 0), 0);
  // Only the first (root) post can be liked here, so swap its static server count
  // for the optimistic live count; otherwise the heart fills on like but the
  // number never moves, reading as "the like didn't register".
  const liveLikeCount = likeCount - (rootPost.likeCount ?? 0) + (likeView ? likeView.count : rootPost.likeCount ?? 0);
  const hideThreadMarkers = canHideCombinedThreadMarkers(posts);
  const { showReplyLimited, handleReplyClick } = useReplyGate(rootPost, onReply);
  const handleShare = async () => {
    const url = postBskyUrl(rootPost);
    const title = `${displayName(rootPost.author)} on Bluesky`;
    const text = posts
      .map((post) => post.record.text?.trim())
      .filter(Boolean)
      .join("\n\n");

    try {
      if (navigator.share) {
        await navigator.share({ title, text: text || title, url });
        setShareState("shared");
      } else {
        await navigator.clipboard?.writeText(url);
        setShareState("copied");
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      try {
        await navigator.clipboard?.writeText(url);
        setShareState("copied");
      } catch {
        setShareState("error");
      }
    }

    window.setTimeout(() => setShareState("idle"), 1800);
  };

  return (
    <article className="post-card thread-combined-card text-only">
      <header className="post-header">
        <Avatar profile={rootPost.author} />
        <div className="post-author-block">
          <a
            className="author-button"
            href={profilePath(rootPost.author)}
            onClick={(event) => onOpenProfile && handleInternalLinkClick(event, () => onOpenProfile(rootPost.author))}
          >
            <strong>{displayName(rootPost.author)}</strong>
          </a>
          <div className="post-byline">
            <span>@{rootPost.author.handle}</span>
            <span aria-hidden="true">·</span>
            <a
              className="post-timestamp"
              href={postPath(rootPost) ?? postBskyUrl(rootPost)}
              onClick={(event) => onOpenPost && handleInternalLinkClick(event, () => onOpenPost(rootPost))}
              title={`Open thread posted ${postTimeLabel}`}
              aria-label={`Open thread posted ${postTimeLabel}`}
            >
              {postTimeLabel}
            </a>
          </div>
        </div>
      </header>
      <button type="button" className="thread-open-chip" onClick={() => onOpenPost?.(rootPost)} title="Open full thread">
        <MessageCircle size={13} />
        <span>{posts.length} post thread</span>
      </button>
      <div className="combined-thread-text">
        {posts.map((post, index) => {
          const text = combinedThreadText(post, hideThreadMarkers);
          const preservesLineBreaks = text.includes("\n");
          return (
            <section className="combined-thread-segment" key={post.uri}>
              <p className={preservesLineBreaks ? "post-text has-line-breaks" : "post-text"}>
                {index > 0 && <span className="combined-thread-break" aria-hidden="true" />}
                {text
                  ? renderRichText(post.record.facets?.length ? post.record.text || "" : text, post.record.facets, onOpenProfile, onOpenTag)
                  : `Post ${index + 1} has no plain text.`}
              </p>
              <PostImageVideoMedia post={post} onOpenImage={onOpenImage} />
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
          <Share2 size={16} /> {shareState === "copied" ? "Copied" : shareState === "shared" ? "Shared" : shareState === "error" ? "Copy failed" : "Share"}
        </button>
        <a href={postBskyUrl(rootPost)} target="_blank" rel="noreferrer" title="Open first post on Bluesky">
          <LinkIcon size={16} /> Open on Bluesky
        </a>
        {onReply && (
          <button type="button" className={replyActive ? "active" : ""} onClick={handleReplyClick} title="Reply to the first post in this thread">
            <MessageCircle size={16} /> Reply
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
  localLists?: LocalList[];
  onToggleListPost?: (listId: string, post: FeedPost) => void;
  canDeletePost?: boolean;
  canBlockAuthor?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const images = safeEmbedImages(getEmbedImages(post.embed)).slice(0, maxPostImages);
  const video = getVideoEmbed(post.embed);
  const text = post.record.text?.trim() || "";
  const postTimeLabel = formatPostTime(postSortAt(post));
  const viewerImages = images
    .map((image) => ({
      src: image.fullsize || image.thumb || "",
      previewSrc: image.thumb && image.fullsize && image.thumb !== image.fullsize ? image.thumb : undefined,
      alt: image.alt || "",
    }))
    .filter((image) => image.src);

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
          title={expanded ? "Hide post details" : "Show post details"}
        >
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>
        {expanded && (
          <div className="media-only-details">
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
  const [shareState, setShareState] = useState<"idle" | "copied" | "shared" | "error">("idle");
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const moreMenuRef = useRef<HTMLDetailsElement | null>(null);
  const { showReplyLimited, handleReplyClick } = useReplyGate(post, onReply);
  const displayedCommentCount = commentCount ?? post.replyCount ?? 0;

  useEffect(() => {
    if (!moreMenuOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && moreMenuRef.current?.contains(target)) {
        return;
      }
      setMoreMenuOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMoreMenuOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [moreMenuOpen]);

  const handleShare = async () => {
    const url = postBskyUrl(post);
    const title = `${displayName(post.author)} on Bluesky`;
    const text = post.record.text?.trim() || "";

    try {
      if (navigator.share) {
        await navigator.share({ title, text: text || title, url });
        setShareState("shared");
      } else {
        await navigator.clipboard?.writeText(url);
        setShareState("copied");
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      try {
        await navigator.clipboard?.writeText(url);
        setShareState("copied");
      } catch {
        setShareState("error");
      }
    }

    window.setTimeout(() => setShareState("idle"), 1800);
  };

  return (
    <>
      <footer className="post-actions">
        <button type="button" onClick={() => onOpenPost?.(post)} title={commentTitle}>
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
            title={bookmarkView.error || (bookmarkView.bookmarked ? "Remove bookmark" : "Bookmark post")}
          >
            <Bookmark size={16} /> {bookmarkView.error || (bookmarkView.bookmarked ? "Bookmarked" : "Bookmark")}
          </button>
        ) : null}
        <button type="button" onClick={handleShare} title="Share post">
          <Share2 size={16} /> {shareState === "copied" ? "Copied" : shareState === "shared" ? "Shared" : shareState === "error" ? "Copy failed" : "Share"}
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
          <summary title="More options">
            <MoreHorizontal size={16} />
          </summary>
          <div>
            <a href={postBskyUrl(post)} target="_blank" rel="noreferrer" onClick={() => setMoreMenuOpen(false)}>
              Open on Bluesky
            </a>
            {canDeletePost && (
              <button
                type="button"
                className="danger-action"
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
}) {
  const onOpenTag = useContext(TagSearchContext);
  const likeCtx = useContext(LikeContext);
  const bookmarkCtx = useContext(BookmarkContext);
  const [shareState, setShareState] = useState<"idle" | "copied" | "shared" | "error">("idle");
  const rootPost = parts[0].node.post;
  const posts = parts.map((part) => part.node.post);
  const likeView = likeCtx?.getState(rootPost);
  const bookmarkView = bookmarkCtx?.getState(rootPost);
  const postTimeLabel = formatPostTime(postSortAt(rootPost));
  // Each continuation part is itself a reply to the previous part, so it is
  // counted in that part's replyCount. Subtract the in-thread hops so the chip
  // reflects external replies to the thread, not the thread's own continuations.
  const replyCount = Math.max(0, posts.reduce((total, post) => total + (post.replyCount ?? 0), 0) - (posts.length - 1));
  const repostCount = posts.reduce((total, post) => total + (post.repostCount ?? 0), 0);
  const quoteCount = posts.reduce((total, post) => total + (post.quoteCount ?? 0), 0);
  const likeCount = posts.reduce((total, post) => total + (post.likeCount ?? 0), 0);
  // Only the first (root) post can be liked here, so swap its static server count
  // for the optimistic live count; otherwise the heart fills on like but the
  // number never moves, reading as "the like didn't register".
  const liveLikeCount = likeCount - (rootPost.likeCount ?? 0) + (likeView ? likeView.count : rootPost.likeCount ?? 0);
  const hideThreadMarkers = canHideCombinedThreadMarkers(posts);
  const { showReplyLimited, handleReplyClick } = useReplyGate(rootPost, onOpenReply);

  const handleShare = async () => {
    const url = postBskyUrl(rootPost);
    const title = `${displayName(rootPost.author)} on Bluesky`;
    const text = posts
      .map((post) => post.record.text?.trim())
      .filter(Boolean)
      .join("\n\n");

    try {
      if (navigator.share) {
        await navigator.share({ title, text: text || title, url });
        setShareState("shared");
      } else {
        await navigator.clipboard?.writeText(url);
        setShareState("copied");
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      try {
        await navigator.clipboard?.writeText(url);
        setShareState("copied");
      } catch {
        setShareState("error");
      }
    }

    window.setTimeout(() => setShareState("idle"), 1800);
  };

  return (
    <article className="post-card combined-thread-view-card text-only">
      <header className="post-header">
        <Avatar profile={rootPost.author} />
        <div className="post-author-block">
          <a
            className="author-button"
            href={profilePath(rootPost.author)}
            onClick={(event) => handleInternalLinkClick(event, () => onOpenProfile(rootPost.author))}
          >
            <strong>{displayName(rootPost.author)}</strong>
          </a>
          <div className="post-byline">
            <span>@{rootPost.author.handle}</span>
            <span aria-hidden="true">·</span>
            <a
              className="post-timestamp"
              href={postPath(rootPost) ?? postBskyUrl(rootPost)}
              onClick={(event) => handleInternalLinkClick(event, () => onOpenPost(rootPost))}
              title={`Open thread posted ${postTimeLabel}`}
              aria-label={`Open thread posted ${postTimeLabel}`}
            >
              {postTimeLabel}
            </a>
          </div>
        </div>
      </header>
      <div className="combined-thread-text">
        {parts.map((part, index) => {
          const post = part.node.post;
          const text = combinedThreadText(post, hideThreadMarkers);
          const hasEmbeds =
            getEmbedImages(post.embed).length > 0 ||
            !!getVideoEmbed(post.embed) ||
            !!getExternalEmbed(post.embed) ||
            !!getRecordEmbed(post.embed) ||
            extractFacetLinks(post.record.facets).length > 0;
          if (!text && !hasEmbeds) {
            return null;
          }
          return (
            <section className="combined-thread-segment" key={post.uri}>
              <p className={text.includes("\n") ? "post-text has-line-breaks" : "post-text"}>
                {index > 0 && <span className="combined-thread-break" aria-hidden="true" />}
                {text
                  ? renderRichText(post.record.facets?.length ? post.record.text || "" : text, post.record.facets, onOpenProfile, onOpenTag)
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
          <Share2 size={16} /> {shareState === "copied" ? "Copied" : shareState === "shared" ? "Shared" : shareState === "error" ? "Copy failed" : "Share"}
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

// Generic fallback for embed shapes BigBsky does not render locally (e.g. a new
// `app.bsky.embed.*` view, or a third-party embed type). Keeps the post readable
// and points the user to Bluesky for the full content instead of silently
// hiding it.
function UnsupportedEmbedNotice({ embedType, post }: { embedType: string; post: FeedPost }) {
  const label = formatUnsupportedEmbedType(embedType);
  return (
    <div className="unsupported-embed" role="note">
      <span>This post includes {label} that BigBsky can't display yet.</span>
      <a href={postBskyUrl(post)} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>
        Open on Bluesky
      </a>
    </div>
  );
}

// Turn an embed `$type` NSID into a short human label. Strips the trailing
// `#view`, drops the `app.bsky.embed.` prefix for the common case, and falls
// back to a generic phrase for unfamiliar namespaces.
function formatUnsupportedEmbedType(embedType: string): string {
  const withoutView = embedType.replace(/#.*$/, "");
  const known = withoutView.replace(/^app\.bsky\.embed\./, "");
  if (known !== withoutView && known.length > 0) {
    return `embedded ${known} content`;
  }
  return "embedded content";
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
  const preservesLineBreaks = text.includes("\n");
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
        localLists={localLists}
        onToggleListPost={onToggleListPost}
        canDeletePost={canDeletePost}
        canBlockAuthor={canBlockAuthor}
      />
    );
  }

  return (
    <article className={`post-card ${postVariant}${hasHiddenMedia ? " media-hidden" : ""}`}>
      <header className="post-header">
        <Avatar profile={post.author} />
        <div className="post-author-block">
          <a
            className="author-button"
            href={profilePath(post.author)}
            onClick={(event) => onOpenProfile && handleInternalLinkClick(event, () => onOpenProfile(post.author))}
          >
            <strong>{displayName(post.author)}</strong>
          </a>
          <div className="post-byline">
            <span>@{post.author.handle}</span>
            <span aria-hidden="true">·</span>
            <a
              className="post-timestamp"
              href={postPath(post) ?? postBskyUrl(post)}
              onClick={(event) => onOpenPost && handleInternalLinkClick(event, () => onOpenPost(post))}
              title={`Open thread posted ${postTimeLabel}`}
              aria-label={`Open thread posted ${postTimeLabel}`}
            >
              {postTimeLabel}
            </a>
          </div>
        </div>
      </header>
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
        <p className={preservesLineBreaks ? "post-text has-line-breaks" : "post-text"}>
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

  return (
    <div className={mediaRevealed ? "quote-card revealed" : "quote-card"}>
      {record.author && (
        <header className="quote-header">
          <Avatar profile={record.author} />
          <div className="quote-header-main">
            <a
              className="author-button"
              href={profilePath(record.author as Profile)}
              onClick={(event) => onOpenProfile && handleInternalLinkClick(event, () => onOpenProfile(record.author as Profile))}
            >
              <strong>{displayName(record.author)}</strong>
              <span>@{record.author.handle}</span>
            </a>
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
          {embeddedImages.length > 0 && (
            <div className={`image-grid quote-images count-${Math.min(embeddedImages.length, 4)}`}>
              {embeddedImages.slice(0, maxPostImages).map((image) => (
                <img
                  alt={image.alt || ""}
                  key={image.thumb || image.fullsize}
                  src={image.thumb || image.fullsize}
                  loading="lazy"
                  decoding="async"
                  style={
                    image.aspectRatio?.width && image.aspectRatio?.height
                      ? { aspectRatio: `${image.aspectRatio.width} / ${image.aspectRatio.height}` }
                      : undefined
                  }
                />
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

function formatPostTime(value?: string) {
  if (!value) {
    return "Unknown time";
  }

  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function replyPermissionLabel(post: FeedPost) {
  const labels = post.labels?.map((label) => label.val).filter(Boolean);
  if (labels?.some((label) => label?.includes("!warn") || label?.includes("adult"))) {
    return "Reply permissions may be limited by content labels";
  }

  return "Everybody can reply";
}

function ThreadEngagementPanel({
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
    error?: string;
  }>({ status: "loading", actors: [], posts: [] });

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading", actors: [], posts: [] });

    const request =
      kind === "likes"
        ? getLikes(uri, 50, controller.signal).then((response) => ({ actors: response.likes.map((like) => like.actor), posts: [] }))
        : kind === "reposts"
          ? getRepostedBy(uri, 50, controller.signal).then((response) => ({ actors: response.repostedBy, posts: [] }))
          : getQuotes(uri, 30, controller.signal).then((response) => ({ actors: [], posts: response.posts }));

    request
      .then(({ actors, posts }) => setState({ status: "ready", actors, posts }))
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

    return () => controller.abort();
  }, [uri, kind]);

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
    </section>
  );
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
  const [activeReplyParentUri, setActiveReplyParentUri] = useState<string | null>(null);
  const [threadDisplayMode, setThreadDisplayMode] = useState<"combined" | "separated">("combined");
  const rootPost = findFirstThreadPost(thread.node);
  const parentNodes = collectThreadParents(thread.node);
  const threadRootRef = rootPost ? replyRootRefForPost(rootPost) : null;
  const threadParts = thread.node ? buildThreadParts(thread.node) : [];
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
          onOpenReply={(post) => setActiveReplyParentUri((current) => (current === post.uri ? null : post.uri))}
          onCloseReply={() => setActiveReplyParentUri(null)}
          onReplied={onReplied}
          threadRootRef={threadRootRef}
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
            onOpenReply: (post) => setActiveReplyParentUri((current) => (current === post.uri ? null : post.uri)),
            onCloseReply: () => setActiveReplyParentUri(null),
            onReplied,
            threadRootRef,
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
            onOpenReply: (post) => setActiveReplyParentUri((current) => (current === post.uri ? null : post.uri)),
            onCloseReply: () => setActiveReplyParentUri(null),
            onReplied,
            threadRootRef,
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
      <header className="post-header">
        <Avatar profile={rootPost.author} />
        <div className="post-author-block">
          <a
            className="author-button"
            href={profilePath(rootPost.author)}
            onClick={(event) => handleInternalLinkClick(event, () => handlers.onOpenProfile(rootPost.author))}
          >
            <strong>{displayName(rootPost.author)}</strong>
          </a>
          <div className="post-byline">
            <span>@{rootPost.author.handle}</span>
            <span aria-hidden="true">·</span>
            <a
              className="post-timestamp"
              href={postPath(rootPost) ?? postBskyUrl(rootPost)}
              onClick={(event) => handleInternalLinkClick(event, () => handlers.onOpenPost(rootPost))}
              title={`Open thread posted ${firstTimeLabel}`}
              aria-label={`Open thread posted ${firstTimeLabel}`}
            >
              {firstTimeLabel}
            </a>
          </div>
        </div>
      </header>
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
          const commentCount = Math.max(0, (post.replyCount ?? replyCount) - (hasThreadContinuation ? 1 : 0));
          return (
            <section className="long-thread-part" key={post.uri}>
              <div className="long-thread-part-label">Thread post {part.partNumber} of {parts.length}</div>
              {text ? (
                <p className={text.includes("\n") ? "post-text has-line-breaks" : "post-text"}>
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
                commentTitle={commentCount > 0 ? "Show replies to this thread post" : "No replies to this thread post"}
                onOpenPost={() => {
                  if (part.replies.length > 0) {
                    onToggleReplies(post.uri);
                  }
                }}
                onReply={handlers.onOpenReply}
                replyActive={handlers.activeReplyParentUri === post.uri}
                canReply={handlers.canReply}
              />
              {handlers.activeReplyParentUri === post.uri && (
                <PostComposer
                  replyTo={{ parent: post, root: handlers.threadRootRef }}
                  canReply={handlers.canReply}
                  onClose={handlers.onCloseReply}
                  onReplied={handlers.onReplied}
                />
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

function ImageViewer({
  image,
  onChange,
  onClose,
}: {
  image: NonNullable<ImageViewerState>;
  onChange: (image: NonNullable<ImageViewerState>) => void;
  onClose: () => void;
}) {
  const selected = image.images[image.index] ?? image.images[0];
  const hasMultiple = image.images.length > 1;
  const [loadedOriginals, setLoadedOriginals] = useState<Set<string>>(() => new Set());
  const [infoVisible, setInfoVisible] = useState(() =>
    typeof window === "undefined" ? true : !window.matchMedia(MOBILE_SCROLL_QUERY).matches,
  );
  const [zoom, setZoom] = useState({ scale: 1, x: 0, y: 0 });
  const pointerPositionsRef = useRef(new Map<number, { x: number; y: number }>());
  const gestureRef = useRef<{
    swipeStart?: { pointerId: number; x: number; y: number };
    panStart?: { pointerId: number; x: number; y: number; originX: number; originY: number };
    pinchStart?: { distance: number; scale: number };
    moved: boolean;
  }>({ moved: false });
  const suppressNextClickRef = useRef(false);
  const zoomRef = useRef(zoom);
  const imgRef = useRef<HTMLImageElement>(null);
  const transformFrameRef = useRef<number | null>(null);
  const zoomDirtyRef = useRef(false);
  const displayedSrc = selected && loadedOriginals.has(selected.src) ? selected.src : selected?.previewSrc || selected?.src;
  const clearSelection = useCallback(() => {
    window.getSelection()?.removeAllRanges();
  }, []);
  // Write the transform straight to the DOM node so a pinch/pan gesture never
  // has to round-trip through React state (which would re-render the whole
  // viewer — thumbnails and all — on every pointermove and cause the jank).
  const applyTransform = useCallback((z: { scale: number; x: number; y: number }) => {
    const node = imgRef.current;
    if (node) {
      node.style.transform = `translate3d(${z.x}px, ${z.y}px, 0) scale(${z.scale})`;
    }
  }, []);
  // Coalesce the imperative writes to one per animation frame.
  const scheduleTransform = useCallback(() => {
    if (transformFrameRef.current != null) {
      return;
    }
    transformFrameRef.current = requestAnimationFrame(() => {
      transformFrameRef.current = null;
      applyTransform(zoomRef.current);
    });
  }, [applyTransform]);
  // Commit the live gesture value back into React state once the gesture ends,
  // so the rendered className/click behavior reflect the final zoom.
  const commitZoom = useCallback(() => {
    if (transformFrameRef.current != null) {
      cancelAnimationFrame(transformFrameRef.current);
      transformFrameRef.current = null;
    }
    if (zoomDirtyRef.current) {
      zoomDirtyRef.current = false;
      applyTransform(zoomRef.current);
      setZoom(zoomRef.current);
    }
  }, [applyTransform]);
  const resetZoom = useCallback(() => {
    zoomDirtyRef.current = false;
    zoomRef.current = { scale: 1, x: 0, y: 0 };
    setZoom({ scale: 1, x: 0, y: 0 });
  }, []);
  const goPrevious = useCallback(() => {
    if (!hasMultiple) {
      return;
    }

    clearSelection();
    onChange({
      images: image.images,
      index: (image.index - 1 + image.images.length) % image.images.length,
    });
    requestAnimationFrame(clearSelection);
  }, [clearSelection, hasMultiple, image, onChange]);
  const goNext = useCallback(() => {
    if (!hasMultiple) {
      return;
    }

    clearSelection();
    onChange({
      images: image.images,
      index: (image.index + 1) % image.images.length,
    });
    requestAnimationFrame(clearSelection);
  }, [clearSelection, hasMultiple, image, onChange]);
  const openAtIndex = useCallback(
    (index: number) => {
      resetZoom();
      onChange({ images: image.images, index });
    },
    [image.images, onChange, resetZoom],
  );
  const preloadOriginal = useCallback((viewerImage?: ImageViewerImage) => {
    if (!viewerImage?.src) {
      return;
    }
    if (loadedOriginals.has(viewerImage.src)) {
      return;
    }

    const img = new window.Image();
    img.onload = () => {
      setLoadedOriginals((current) => {
        if (current.has(viewerImage.src)) {
          return current;
        }
        const next = new Set(current);
        next.add(viewerImage.src);
        return next;
      });
    };
    img.src = viewerImage.src;
    if (img.complete) {
      img.onload?.(new Event("load"));
    }
  }, [loadedOriginals]);
  const imageDistance = useCallback((points: Array<{ x: number; y: number }>) => {
    const [a, b] = points;
    return Math.hypot(b.x - a.x, b.y - a.y);
  }, []);
  const clampZoom = useCallback((value: number) => Math.max(1, Math.min(4, value)), []);
  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      clearSelection();
      if (event.button !== 0 || (event.target as HTMLElement).closest("button, a, .image-viewer-footer, .image-viewer-thumbs")) {
        return;
      }

      try {
        event.currentTarget.setPointerCapture?.(event.pointerId);
      } catch {
        // Synthetic pointer events used by tests may not be eligible for capture.
      }
      const position = { x: event.clientX, y: event.clientY };
      pointerPositionsRef.current.set(event.pointerId, position);
      gestureRef.current.moved = false;
      const points = Array.from(pointerPositionsRef.current.values());
      if (points.length >= 2) {
        gestureRef.current = {
          moved: true,
          pinchStart: {
            distance: imageDistance(points.slice(0, 2)),
            scale: zoomRef.current.scale,
          },
        };
        suppressNextClickRef.current = true;
        return;
      }

      if (zoomRef.current.scale > 1.02) {
        gestureRef.current = {
          moved: false,
          panStart: {
            pointerId: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            originX: zoomRef.current.x,
            originY: zoomRef.current.y,
          },
        };
        return;
      }

      gestureRef.current = hasMultiple
        ? { moved: false, swipeStart: { pointerId: event.pointerId, x: event.clientX, y: event.clientY } }
        : { moved: false };
    },
    [clearSelection, hasMultiple, imageDistance],
  );
  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!pointerPositionsRef.current.has(event.pointerId)) {
        return;
      }

      pointerPositionsRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const points = Array.from(pointerPositionsRef.current.values());
      const gesture = gestureRef.current;
      if (gesture.pinchStart && points.length >= 2) {
        const distance = imageDistance(points.slice(0, 2));
        const nextScale = clampZoom(gesture.pinchStart.scale * (distance / Math.max(1, gesture.pinchStart.distance)));
        gesture.moved = true;
        suppressNextClickRef.current = true;
        const current = zoomRef.current;
        zoomRef.current = {
          scale: nextScale,
          x: nextScale <= 1.01 ? 0 : current.x,
          y: nextScale <= 1.01 ? 0 : current.y,
        };
        zoomDirtyRef.current = true;
        scheduleTransform();
        return;
      }

      if (gesture.panStart?.pointerId === event.pointerId) {
        const deltaX = event.clientX - gesture.panStart.x;
        const deltaY = event.clientY - gesture.panStart.y;
        if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) {
          gesture.moved = true;
          suppressNextClickRef.current = true;
          zoomRef.current = {
            ...zoomRef.current,
            x: gesture.panStart.originX + deltaX,
            y: gesture.panStart.originY + deltaY,
          };
          zoomDirtyRef.current = true;
          scheduleTransform();
        }
      }
    },
    [clampZoom, imageDistance, scheduleTransform],
  );
  const handlePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const start = gestureRef.current.swipeStart;
      const wasGestureMove = gestureRef.current.moved;
      pointerPositionsRef.current.delete(event.pointerId);
      if (pointerPositionsRef.current.size < 2) {
        gestureRef.current.pinchStart = undefined;
      }
      if (pointerPositionsRef.current.size === 0) {
        gestureRef.current.panStart = undefined;
      }
      // Flush the live gesture value into React state once no fingers remain.
      if (pointerPositionsRef.current.size === 0) {
        commitZoom();
      }
      if (wasGestureMove || zoomRef.current.scale > 1.02) {
        suppressNextClickRef.current = true;
      }
      if (!start || start.pointerId !== event.pointerId || zoomRef.current.scale > 1.02) {
        return;
      }

      const deltaX = event.clientX - start.x;
      const deltaY = event.clientY - start.y;
      const horizontalSwipe = Math.abs(deltaX) >= 48 && Math.abs(deltaX) > Math.abs(deltaY) * 1.25;
      if (!horizontalSwipe) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      suppressNextClickRef.current = true;
      if (deltaX < 0) {
        goNext();
      } else {
        goPrevious();
      }
    },
    [commitZoom, goNext, goPrevious],
  );

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  // Apply the committed zoom to the DOM node. Gesture moves write the transform
  // imperatively; this keeps the node in sync with React state (mount, reset,
  // double-click, gesture commit) without binding transform to every render.
  useLayoutEffect(() => {
    applyTransform(zoomDirtyRef.current ? zoomRef.current : zoom);
  }, [applyTransform, zoom, displayedSrc]);

  useEffect(() => {
    resetZoom();
    pointerPositionsRef.current.clear();
    gestureRef.current = { moved: false };
  }, [image.index, resetZoom]);

  useEffect(() => {
    return () => {
      if (transformFrameRef.current != null) {
        cancelAnimationFrame(transformFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const imagesToPreload = [
      image.images[image.index],
      image.images[(image.index + 1) % image.images.length],
      image.images[(image.index - 1 + image.images.length) % image.images.length],
    ];
    imagesToPreload.forEach(preloadOriginal);
  }, [image.images, image.index, preloadOriginal]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        goPrevious();
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        goNext();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [goNext, goPrevious, onClose]);

  // Defensive: an embed whose images all lack a usable src would leave `selected`
  // undefined. Callers already filter these out, so just close rather than crash.
  if (!selected) {
    return null;
  }

  return (
    <div
      className={infoVisible ? "image-viewer" : "image-viewer info-hidden"}
      role="dialog"
      aria-modal="true"
      aria-label="Image viewer"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={(event) => {
        pointerPositionsRef.current.delete(event.pointerId);
        gestureRef.current = { moved: false };
        if (pointerPositionsRef.current.size === 0) {
          commitZoom();
        }
      }}
      onMouseDown={clearSelection}
      onMouseUp={clearSelection}
      onSelect={clearSelection}
      onDragStart={(event) => {
        event.preventDefault();
        clearSelection();
      }}
      onClick={(event) => {
        clearSelection();
        if (suppressNextClickRef.current) {
          suppressNextClickRef.current = false;
          return;
        }
        if (zoom.scale > 1.02) {
          return;
        }
        const halfway = window.innerWidth / 2;
        if (!hasMultiple) {
          onClose();
          return;
        }

        if (event.clientX < halfway) {
          goPrevious();
        } else {
          goNext();
        }
      }}
    >
      <div className="image-viewer-controls" onClick={(event) => event.stopPropagation()}>
        <button
          className={infoVisible ? "image-viewer-info active" : "image-viewer-info"}
          type="button"
          onClick={() => setInfoVisible((visible) => !visible)}
          aria-label={infoVisible ? "Hide image information" : "Show image information"}
          aria-pressed={infoVisible}
          title={infoVisible ? "Hide image information" : "Show image information"}
        >
          <Info size={21} />
        </button>
        <button
          className="image-viewer-close"
          type="button"
          onClick={onClose}
          aria-label="Close image viewer"
          title="Close image viewer"
        >
          <X size={22} />
        </button>
      </div>
      {hasMultiple && (
        <>
          <div className="image-viewer-count">
            {image.index + 1} / {image.images.length}
          </div>
        </>
      )}
      <img
        ref={imgRef}
        className={zoom.scale > 1.02 ? "zoomed" : ""}
        src={displayedSrc}
        alt={selected.alt}
        draggable={false}
        onDragStart={(event) => {
          event.preventDefault();
          clearSelection();
        }}
        onClick={(event) => {
          event.stopPropagation();
          clearSelection();
        }}
        onDoubleClick={(event) => {
          event.stopPropagation();
          resetZoom();
        }}
      />
      {infoVisible && (
        <div className="image-viewer-footer" onClick={(event) => event.stopPropagation()}>
          <div>
            <strong>{hasMultiple ? `Image ${image.index + 1} of ${image.images.length}` : "Image"}</strong>
            <span>{selected.alt || "No alt text provided."}</span>
          </div>
          <a href={selected.src} target="_blank" rel="noreferrer">
            <LinkIcon size={15} /> Open original
          </a>
        </div>
      )}
      {hasMultiple && (
        <div className="image-viewer-thumbs" onClick={(event) => event.stopPropagation()}>
          {image.images.map((thumb, index) => (
            <button
              className={index === image.index ? "selected" : ""}
              key={`${thumb.src}:${index}`}
              type="button"
              onClick={() => openAtIndex(index)}
              aria-label={`Open image ${index + 1}`}
            >
              <img src={thumb.previewSrc || thumb.src} alt="" draggable={false} />
            </button>
          ))}
        </div>
      )}
    </div>
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

function RecentPanel({
  items,
  onOpen,
  onClear,
}: {
  items: RecentItem[];
  onOpen: (item: RecentItem) => void;
  onClear: () => void;
}) {
  if (items.length === 0) {
    return null;
  }

  return (
    <section className="context-panel recent-panel">
      <div className="context-panel-header">
        <h2>Recent</h2>
        <button type="button" className="panel-clear" onClick={onClear} aria-label="Clear recent trail" title="Clear recent">
          Clear
        </button>
      </div>
      {items.map((item) => (
        <button key={item.path} type="button" onClick={() => onOpen(item)}>
          <span>{item.label}</span>
          <small>{item.detail}</small>
        </button>
      ))}
    </section>
  );
}

function DevInspector({
  activeSource,
  apiRequests,
  cacheHits,
  loadedPages,
  renderedRows,
  route,
  runtimeWarnings,
  sameOriginRequests,
  serviceWorkerState,
}: {
  activeSource: FeedSource;
  apiRequests: number;
  cacheHits: number;
  loadedPages: number;
  renderedRows: number;
  route: RouteState;
  runtimeWarnings: string[];
  sameOriginRequests: number;
  serviceWorkerState: string;
}) {
  const routeLabel = route.kind === "feed" ? activeSource.label : route.kind;
  const warningLabel = runtimeWarnings.length > 0 ? runtimeWarnings.join(", ") : "None detected";

  return (
    <section className="context-panel dev-inspector">
      <h2>Dev Inspector</h2>
      <dl>
        <div>
          <dt>Source</dt>
          <dd>{routeLabel}</dd>
        </div>
        <div>
          <dt>Pages</dt>
          <dd>{loadedPages.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Rows</dt>
          <dd>{renderedRows.toLocaleString()}</dd>
        </div>
        <div>
          <dt>API requests</dt>
          <dd>{apiRequests.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Cache hits</dt>
          <dd>{cacheHits.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Static assets</dt>
          <dd>{sameOriginRequests.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Service worker</dt>
          <dd>{serviceWorkerState}</dd>
        </div>
        <div>
          <dt>Runtime routes</dt>
          <dd>{warningLabel}</dd>
        </div>
      </dl>
    </section>
  );
}

function FeedContextPanel({
  source,
  metadata,
  listMetadata,
  entityCache,
  isPinned,
  onTogglePinned,
}: {
  source: FeedSource;
  metadata: FeedGeneratorView | null;
  listMetadata: ListView | null;
  entityCache: EntityCache;
  isPinned: boolean;
  onTogglePinned: (source: FeedSource) => void;
}) {
  const [copied, setCopied] = useState(false);
  const isList = isListUri(source.uri);
  const avatar = isList ? listMetadata?.avatar : metadata?.avatar;
  const title = (isList ? listMetadata?.name : metadata?.displayName) || source.label;
  const description = (isList ? listMetadata?.description : metadata?.description) || source.description;
  const creatorHandle = isList ? listMetadata?.creator?.handle : metadata?.creator?.handle;
  const rkey = source.uri.split("/").pop();
  const bskyUrl = creatorHandle && rkey
    ? `https://bsky.app/profile/${creatorHandle}/${isList ? "lists" : "feed"}/${rkey}`
    : "https://bsky.app";

  return (
    <section className="profile-panel">
      {avatar ? (
        <img className="avatar" src={avatar} alt="" loading="lazy" />
      ) : (
        <span className="feed-glyph">
          {isList ? <List size={22} /> : <Hash size={22} />}
        </span>
      )}
      <h2>{title}</h2>
      <p>{description}</p>
      <dl>
        <div>
          <dt>Type</dt>
          <dd>{isList ? "List" : "Feed"}</dd>
        </div>
        <div>
          <dt>Creator</dt>
          <dd>{creatorHandle ? `@${creatorHandle}` : "Public"}</dd>
        </div>
        <div>
          <dt>{isList ? "Members" : "Likes"}</dt>
          <dd>
            {isList
              ? listMetadata?.listItemCount?.toLocaleString() ?? "-"
              : (metadata?.likeCount ?? metadata?.likedByCount)?.toLocaleString() ?? "-"}
          </dd>
        </div>
        <div>
          <dt>Cached posts</dt>
          <dd>{Object.keys(entityCache.posts).length.toLocaleString()}</dd>
        </div>
      </dl>
      <div className="context-actions" aria-label={isList ? "List options" : "Feed options"}>
        <button type="button" onClick={() => onTogglePinned(source)}>
          {isPinned ? (isList ? "Unpin list" : "Unpin feed") : isList ? "Pin list" : "Pin feed"}
        </button>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(source.uri);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1600);
          }}
        >
          {copied ? "Copied URI" : "Copy URI"}
        </button>
        <a href={bskyUrl} target="_blank" rel="noreferrer">
          Open on Bluesky
        </a>
      </div>
    </section>
  );
}

function TrendingPanel({
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

function PinnedSearchesPanel({
  searches,
  onOpen,
  onToggle,
}: {
  searches: string[];
  onOpen: (query: string) => void;
  onToggle: (query: string) => void;
}) {
  if (searches.length === 0) {
    return null;
  }

  return (
    <section className="context-panel pinned-searches-panel">
      <h2>Pinned Searches</h2>
      {searches.map((query) => (
        <div key={query}>
          <button type="button" onClick={() => onOpen(query)}>
            {query}
          </button>
          <button type="button" onClick={() => onToggle(query)} aria-label={`Unpin ${query}`}>
            <X size={13} />
          </button>
        </div>
      ))}
    </section>
  );
}

function PinnedProfilesPanel({
  profiles,
  onOpen,
  onToggle,
}: {
  profiles: Profile[];
  onOpen: (profile: Profile) => void;
  onToggle: (profile: Profile) => void;
}) {
  if (profiles.length === 0) {
    return null;
  }

  return (
    <section className="context-panel pinned-profiles-panel">
      <h2>Pinned Profiles</h2>
      {profiles.map((profile) => (
        <div key={profile.did}>
          <button type="button" onClick={() => onOpen(profile)}>
            <Avatar profile={profile} />
            <span>
              <strong>{displayName(profile)}</strong>
              <small>@{profile.handle}</small>
            </span>
          </button>
          <button type="button" onClick={() => onToggle(profile)} aria-label={`Unpin @${profile.handle}`}>
            <X size={13} />
          </button>
        </div>
      ))}
    </section>
  );
}

function ProfileContextPanel({ actor, profile }: { actor: string; profile: Profile | null }) {
  return (
    <section className="profile-panel">
      <Avatar profile={profile ?? undefined} />
      <h2>{displayName(profile ?? undefined)}</h2>
      <p>@{profile?.handle || actor}</p>
      {profile?.description && <p className="profile-description">{profile.description}</p>}
      <dl>
        <div>
          <dt>Followers</dt>
          <dd>{profile?.followersCount?.toLocaleString() ?? "-"}</dd>
        </div>
        <div>
          <dt>Posts</dt>
          <dd>{profile?.postsCount?.toLocaleString() ?? "-"}</dd>
        </div>
      </dl>
    </section>
  );
}

function Avatar({ profile }: { profile?: Profile }) {
  return profile?.avatar ? <img className="avatar" src={profile.avatar} alt="" loading="lazy" /> : <span className="avatar fallback" />;
}

// "Back to top" affordance for the wide endless-scroll reader. Appears after the
// active timeline is scrolled past a threshold and returns to the top without a
// route change. watchKey re-attaches the scroll listener when the mounted
// timeline element changes (feed <-> profile, or active source).
function BackToTopButton({ containerRef, watchKey }: { containerRef: RefObject<HTMLDivElement | null>; watchKey: string }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = containerRef.current;
    // On mobile the document scrolls (el.scrollTop stays ~0), so read the
    // active offset and listen on window too; on desktop el is the scroller.
    const onScroll = () => setVisible(readScrollOffset(el) > 600);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    el?.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      el?.removeEventListener("scroll", onScroll);
    };
  }, [containerRef, watchKey]);
  if (!visible) {
    return null;
  }
  return (
    <button
      type="button"
      className="back-to-top"
      onClick={() => {
        scrollFeedToTop(containerRef.current);
        setVisible(false);
      }}
      aria-label="Scroll to top of feed"
      title="Back to top"
    >
      <ChevronUp size={18} />
      <span>Top</span>
    </button>
  );
}

function LoadingState({ label }: { label: string }) {
  return (
    <div className="state">
      <Loader2 className="spin" size={24} />
      <span>{label}</span>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="state error">
      <strong>Unable to load</strong>
      <span>{message}</span>
    </div>
  );
}

function RateLimitState({ message }: { message?: string }) {
  return (
    <div className="state error">
      <strong>Rate limit reached</strong>
      <span>{message || "Bluesky is throttling this public API request. Wait a bit, then try again."}</span>
    </div>
  );
}

function EmptyState({ title, message }: { title: string; message: string }) {
  return (
    <div className="state empty">
      <strong>{title}</strong>
      <span>{message}</span>
    </div>
  );
}

function EndOfFeedCard({ kind = "posts" }: { kind?: "posts" | "media" }) {
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
