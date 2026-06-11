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
  Link as LinkIcon,
  List,
  Loader2,
  LogOut,
  Menu,
  Plus,
  X,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  MessageCircle,
  MoreHorizontal,
  Repeat2,
  Search,
  Send,
  Settings,
  Share2,
  ShieldAlert,
  User,
  Users,
} from "lucide-react";
import { createContext, type CSSProperties, type FormEvent, type ReactNode, type RefObject, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
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
  type ThreadPostNode,
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
  getFeed,
  getFeedGenerator,
  getPopularFeedGenerators,
  getTrendingTopics,
  getRecordEmbed,
  getVideoEmbed,
  searchActors,
} from "./api";
import {
  type AuthSnapshot,
  type ListMember,
  type NotificationItem,
  type SubscribedFeed,
  blockAccount,
  bookmarkPost,
  clearOAuthSessionStorage,
  followAccount,
  followFeed,
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
  initAuthSession,
  likePost,
  MAX_POST_IMAGES,
  publishPost,
  publishThread,
  deletePost,
  searchPostsAuthed,
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

const navIcons = [Home, Compass, Hash, List, Bookmark, User, Settings];

// Lets deeply-nested post cards open an in-app hashtag search without threading
// a callback through every PostCard/VirtualPostList call site.
const TagSearchContext = createContext<((tag: string) => void) | null>(null);

// Browser-local NSFW preference; false (hide/warn) by default for everyone.
// Read by post cards to decide whether adult/graphic media is gated.
const ShowNsfwContext = createContext<boolean>(false);

// Read by post cards to decide whether to render images/video at all. When
// off, media is replaced by a click-to-reveal affordance (text still shows).
const ShowMediaContext = createContext<boolean>(true);

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
type BookmarkView = { bookmarked: boolean };
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

type ImageViewerState = {
  images: Array<{
    src: string;
    alt: string;
  }>;
  index: number;
} | null;

type LinkPreviewState = {
  uri: string;
  title?: string;
  description?: string;
  thumb?: string;
  sourcePost?: FeedPost;
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

const densityModes = ["comfortable", "compact", "media"];
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
const widthModes = ["balanced", "wide", "focus"] as const;
const searchTabs = ["posts", "people", "feeds"] as const;
const profileTabs = ["posts", "replies", "media", "videos", "feeds", "lists"] as const;
type ProfileTab = (typeof profileTabs)[number] | "new-post";
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
const showNsfwStorageKey = "bigbsky:show-nsfw";
const showMediaStorageKey = "bigbsky:show-media";
const pinnedFeedsStorageKey = "bigbsky:pinned-feeds";
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

function countBigbskyLocalKeys() {
  try {
    return Object.keys(localStorage).filter((key) => key.startsWith("bigbsky:")).length;
  } catch {
    return 0;
  }
}

function readDensityPreferences() {
  try {
    return JSON.parse(localStorage.getItem("bigbsky:density-by-context") || "{}") as Record<string, string>;
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

// Per-feed width memory, mirroring the per-context density map. Keyed the same
// way as density (route.kind, or `feed:<id>`). Migrates the previous single
// global width preference into the `default` slot so existing users keep their
// chosen width.
function readWidthPreferences(): Record<string, string> {
  try {
    const stored = JSON.parse(localStorage.getItem(widthByContextStorageKey) || "{}") as Record<string, string>;
    if (stored && typeof stored === "object" && Object.keys(stored).length > 0) {
      return stored;
    }
    const legacy = localStorage.getItem(workspaceWidthStorageKey);
    if (widthModes.includes(legacy as (typeof widthModes)[number])) {
      return { default: legacy as string };
    }
    return {};
  } catch {
    return {};
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

function writeTimelineScrollCache(cache: Record<string, number>) {
  try {
    sessionStorage.setItem(timelineScrollStorageKey, JSON.stringify(cache));
  } catch {
    // Scroll restoration is best-effort browser state.
  }
}

function postPath(post: FeedPost) {
  const rkey = post.uri.split("/").pop();
  return rkey ? `/profile/${encodeURIComponent(post.author.handle)}/post/${encodeURIComponent(rkey)}` : null;
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

function countThreadRows(node?: ThreadNode): number {
  if (!node || !("post" in node)) {
    return 0;
  }

  return 1 + (node.replies ?? []).reduce((total, reply) => total + countThreadRows(reply), 0);
}

function postReplyRootUri(post: FeedPost) {
  return post.record.reply?.root?.uri;
}

function postReplyParentUri(post: FeedPost) {
  return post.record.reply?.parent?.uri;
}

function isSelfThreadReply(item: FeedItem, rootPost?: FeedPost) {
  const rootUri = postReplyRootUri(item.post);
  if (!rootUri) {
    return false;
  }
  const rootAuthorDid = rootPost?.author.did || item.reply?.root?.author.did;
  return !!rootAuthorDid && item.post.author.did === rootAuthorDid;
}

function postSortTime(post: FeedPost) {
  return new Date(post.record.createdAt || post.indexedAt || 0).getTime();
}

type ThreadedFeedItem = {
  root: FeedItem;
  replies: FeedItem[];
};

type FeedRow = FeedItem | ThreadedFeedItem;
type PostRefValue = { uri: string; cid: string };
const CONTINUATION_REPLY_WINDOW_MS = 10 * 60 * 1000;
type ThreadPart = {
  node: ThreadPostNode;
  partNumber: number;
  replies: ThreadNode[];
};

function isThreadedFeedItem(row: FeedRow): row is ThreadedFeedItem {
  return "root" in row && "replies" in row;
}

function feedRowKey(row: FeedRow) {
  return isThreadedFeedItem(row) ? `thread:${row.root.post.uri}` : row.post.uri;
}

function feedRowPost(row: FeedRow) {
  return isThreadedFeedItem(row) ? row.root.post : row.post;
}

function replyRootRefForPost(post: FeedPost): PostRefValue {
  const rootRef = post.record.reply?.root;
  return rootRef?.uri && rootRef?.cid ? { uri: rootRef.uri, cid: rootRef.cid } : { uri: post.uri, cid: post.cid };
}

function isThreadPostNode(node: ThreadNode): node is ThreadPostNode {
  return "post" in node;
}

function getContinuationReply(parent: FeedPost, replies: ThreadNode[]) {
  const parentTime = postSortTime(parent);
  const candidates = replies
    .filter(isThreadPostNode)
    .filter((reply) => {
      if (reply.post.author.did !== parent.author.did || postReplyParentUri(reply.post) !== parent.uri) {
        return false;
      }
      const replyTime = postSortTime(reply.post);
      return Number.isFinite(parentTime) && Number.isFinite(replyTime) && replyTime - parentTime >= 0 && replyTime - parentTime <= CONTINUATION_REPLY_WINDOW_MS;
    })
    .sort((first, second) => postSortTime(first.post) - postSortTime(second.post));
  return candidates[0] ?? null;
}

function buildThreadParts(root: ThreadNode): ThreadPart[] {
  if (!isThreadPostNode(root)) {
    return [];
  }

  const parts: ThreadPart[] = [];
  let current: ThreadPostNode | null = root;
  let partNumber = 1;

  while (current) {
    const replies = current.replies ?? [];
    const continuation = getContinuationReply(current.post, replies);
    parts.push({
      node: current,
      partNumber,
      replies: continuation ? replies.filter((reply) => reply !== continuation) : replies,
    });
    current = continuation;
    partNumber += 1;
  }

  return parts;
}

function buildThreadedFeedRows(items: FeedItem[]): FeedRow[] {
  const byUri = new Map(items.map((item) => [item.post.uri, item]));
  const repliesByRoot = new Map<string, FeedItem[]>();
  const groupedReplyUris = new Set<string>();

  for (const item of items) {
    const rootUri = postReplyRootUri(item.post);
    if (!rootUri) {
      continue;
    }
    const rootItem = byUri.get(rootUri);
    if (!rootItem || !isSelfThreadReply(item, rootItem.post)) {
      continue;
    }
    const replyTime = postSortTime(item.post);
    const rootTime = postSortTime(rootItem.post);
    if (!Number.isFinite(replyTime) || !Number.isFinite(rootTime) || replyTime - rootTime < 0 || replyTime - rootTime > CONTINUATION_REPLY_WINDOW_MS) {
      continue;
    }
    repliesByRoot.set(rootUri, [...(repliesByRoot.get(rootUri) ?? []), item]);
    groupedReplyUris.add(item.post.uri);
  }

  const rows: FeedRow[] = [];
  for (const item of items) {
    if (groupedReplyUris.has(item.post.uri)) {
      continue;
    }

    const replies = repliesByRoot.get(item.post.uri);
    if (!replies?.length) {
      rows.push(item);
      continue;
    }

    rows.push({
      root: item,
      replies: replies.slice().sort((first, second) => postSortTime(first.post) - postSortTime(second.post)),
    });
  }
  return rows;
}

function replaceThreadBranch(node: ThreadNode, uri: string, replacement: ThreadNode): ThreadNode {
  if (!("post" in node)) {
    return node;
  }

  if (node.post.uri === uri) {
    return replacement;
  }

  return {
    ...node,
    replies: node.replies?.map((reply) => replaceThreadBranch(reply, uri, replacement)),
  };
}

function hasPostImages(post: FeedPost) {
  return getEmbedImages(post.embed).length > 0;
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
  const aspectRatio =
    video.aspectRatio?.width && video.aspectRatio?.height
      ? { aspectRatio: `${video.aspectRatio.width} / ${video.aspectRatio.height}` }
      : undefined;

  return (
    <div className={compact ? "video-card quote-video-card" : "video-card"}>
      {video.playlist ? (
        <video
          controls
          playsInline
          preload="metadata"
          poster={video.thumbnail}
          aria-label={video.alt ? `${kind}: ${video.alt}` : kind}
          style={aspectRatio}
        >
          <source src={video.playlist} type="application/vnd.apple.mpegurl" />
          {kind} playback is not supported by this browser.
        </video>
      ) : video.thumbnail ? (
        <a className="video-fallback-link" href={video.thumbnail} target="_blank" rel="noreferrer">
          <img alt={video.alt || ""} src={video.thumbnail} loading="lazy" decoding="async" style={aspectRatio} />
        </a>
      ) : (
        <span className="video-placeholder" />
      )}
      <span className="video-label">
        <Film size={16} /> {kind}
      </span>
      {video.alt && <span className="video-alt-text">{video.alt}</span>}
      {video.playlist && (
        <a className="video-open-link" href={video.playlist} target="_blank" rel="noreferrer">
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
    try {
      localStorage.setItem(homeSourceStorageKey, id);
    } catch {
      /* ignore storage failures */
    }
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
  const bookmarkInFlight = useRef<Set<string>>(new Set());
  const [localLists, setLocalLists] = useState<LocalList[]>(() => readLocalLists());
  // The signed-in user's real Bluesky lists (owned + subscribed), loaded on the
  // /lists route. Status drives loading/empty/error rendering.
  const [myLists, setMyLists] = useState<{ owned: ListView[]; subscribed: ListView[] }>({ owned: [], subscribed: [] });
  const [myListsStatus, setMyListsStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [imageViewer, setImageViewer] = useState<ImageViewerState>(null);
  const [linkPreview, setLinkPreview] = useState<LinkPreviewState>(null);
  // The primary nav icon bar is hidden by default and revealed with the
  // hamburger control in the feed-title header.
  const [navOpen, setNavOpen] = useState<boolean>(false);
  const [densityByContext, setDensityByContext] = useState<Record<string, string>>(() => readDensityPreferences());
  const [widthByContext, setWidthByContext] = useState<Record<string, string>>(() => readWidthPreferences());
  const [showNsfw, setShowNsfw] = useState<boolean>(() => readShowNsfw());
  const [showMedia, setShowMedia] = useState<boolean>(() => readShowMedia());
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
  const [followBusyUri, setFollowBusyUri] = useState<string | null>(null);
  const [virtualRenderedRows, setVirtualRenderedRows] = useState(0);
  const [thread, setThread] = useState<{ status: "idle" | "loading" | "ready" | "error"; node?: ThreadNode; error?: string }>({
    status: "idle",
  });
  const [loadingThreadBranches, setLoadingThreadBranches] = useState<Record<string, boolean>>({});
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
    });

    return () => {
      cancelled = true;
    };
  }, []);

  // When signed in, load the user's subscribed/pinned feeds from their AT
  // Protocol preferences and surface them in the feed selector. Cleared on
  // sign-out. Failures are non-fatal: the selector keeps its public feeds.
  const signedInDid = authState.status === "signed-in" ? authState.session?.did : undefined;

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
    localStorage.setItem(reauthDismissKey, signature);
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
      return resolveHomeSource(homeSourceId, !!signedInDid, subscribedFeeds);
    }
    return feedSources.find((source) => source.id === activeSourceId) ?? feedSources[0];
  }, [route, activeSourceId, subscribedFeeds, homeSourceId, signedInDid]);
  // Static public feeds plus the signed-in user's subscribed feeds (deduped by
  // URI so a saved copy of a built-in feed does not appear twice).
  const allSources = useMemo(() => {
    const staticUris = new Set(feedSources.map((source) => source.uri));
    const extras = subscribedFeeds.filter((source) => !staticUris.has(source.uri));
    // The Following home timeline is only available when signed in.
    const base = signedInDid ? [followingSource, ...feedSources] : feedSources;
    return [...base, ...extras];
  }, [subscribedFeeds, signedInDid]);
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
  const densityKey = route.kind === "feed" ? `feed:${activeSource.id}` : route.kind;
  const density = densityByContext[densityKey] || densityByContext.default || "comfortable";
  const storedWidth = widthByContext[densityKey] || widthByContext.default;
  const workspaceWidth = (
    widthModes.includes(storedWidth as (typeof widthModes)[number]) ? storedWidth : "balanced"
  ) as (typeof widthModes)[number];
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
        requestAnimationFrame(() => timelineRef.current?.scrollTo({ top: scrollCacheRef.current[cacheKey] || 0 }));
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
      const response =
        source.uri === "following"
          ? await getFollowingTimeline(cursor, signal)
          : isListUri(source.uri)
            ? await getListFeed(source.uri, cursor, signal)
            : signedInDid
              ? await getFeedAuthed(source.uri, cursor, signal)
              : await getFeed(source.uri, cursor, signal);
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
        requestAnimationFrame(() => timelineRef.current?.scrollTo({ top: scrollCacheRef.current[cacheKey] || 0 }));
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
  }, [signedInDid]);

  const loadProfileFeed = useCallback(async (actor: string, cursor?: string, signal?: AbortSignal) => {
    const cacheKey = `profile:${actor}`;
    if (!cursor) {
      const cached = profileCacheRef.current[cacheKey];
      if (cached?.feed.status === "ready") {
        setDevMetrics((current) => ({ ...current, cacheHits: current.cacheHits + 1 }));
        setProfile(cached.profile);
        setFeedState(cached.feed);
        requestAnimationFrame(() => timelineRef.current?.scrollTo({ top: scrollCacheRef.current[cacheKey] || 0 }));
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
      getAuthorFeedAuthed(actor, cursor, signal),
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
      const feedResponse = feedResult.value;
      setFeedState((current) => {
        const next = {
          items: cursor ? [...current.items, ...feedResponse.feed] : feedResponse.feed,
          cursor: feedResponse.cursor,
          status: "ready" as const,
        };
        profileCacheRef.current[cacheKey] = { feed: next, profile: profileResponse ?? profileCacheRef.current[cacheKey]?.profile ?? null };
        return next;
      });
      if (!cursor) {
        requestAnimationFrame(() => timelineRef.current?.scrollTo({ top: scrollCacheRef.current[cacheKey] || 0 }));
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

    const controller = new AbortController();
    if (route.kind === "profile") {
      setProfile(null);
      void loadProfileFeed(route.actor, undefined, controller.signal);
      return () => controller.abort();
    }

    setProfile(null);
    void loadFeed(activeSource, undefined, controller.signal);
    return () => controller.abort();
  }, [activeSource, loadFeed, loadProfileFeed, route]);

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
  }, [activeSource, route.kind]);

  useEffect(() => {
    const onPopState = () => setRoute(getRouteState());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
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

  useEffect(() => {
    if (route.kind !== "post") {
      setThread({ status: "idle" });
      setLoadingThreadBranches({});
      return;
    }

    const cacheKey = `${route.actor}:${route.rkey}`;
    const cached = threadCacheRef.current[cacheKey];
    if (cached) {
      setDevMetrics((current) => ({ ...current, cacheHits: current.cacheHits + 1 }));
      setThread({ status: "ready", node: cached });
      return;
    }

    const controller = new AbortController();
    setThread({ status: "loading" });
    getPostThreadAuthed(route.actor, route.rkey, controller.signal)
      .then((response) => {
        threadCacheRef.current[cacheKey] = response.thread;
        setThread({ status: "ready", node: response.thread });
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setThread({
            status: "error",
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });
    return () => controller.abort();
  }, [route]);

  // Re-fetch the open thread (bypassing the cache) after publishing a reply so
  // the new reply appears in the conversation.
  const reloadThread = useCallback(() => {
    if (route.kind !== "post") {
      return;
    }
    const cacheKey = `${route.actor}:${route.rkey}`;
    delete threadCacheRef.current[cacheKey];
    setThread({ status: "loading" });
    getPostThreadAuthed(route.actor, route.rkey)
      .then((response) => {
        threadCacheRef.current[cacheKey] = response.thread;
        setThread({ status: "ready", node: response.thread });
      })
      .catch((error) => {
        setThread({ status: "error", error: error instanceof Error ? error.message : String(error) });
      });
  }, [route]);

  function loadThreadBranch(uri: string) {
    if (thread.status !== "ready" || !thread.node || loadingThreadBranches[uri]) {
      return;
    }

    const cachedBranch = threadBranchCacheRef.current[uri];
    if (cachedBranch) {
      setDevMetrics((current) => ({ ...current, cacheHits: current.cacheHits + 1 }));
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
    getPostThreadByUriAuthed(uri)
      .then((response) => {
        threadBranchCacheRef.current[uri] = response.thread;
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
        setThread((current) => ({
          ...current,
          error: error instanceof Error ? error.message : String(error),
        }));
      })
      .finally(() => {
        setLoadingThreadBranches((current) => {
          const { [uri]: _removed, ...rest } = current;
          return rest;
        });
      });
  }

  function updateDensity(nextDensity: string) {
    const nextPreferences = {
      ...densityByContext,
      [densityKey]: nextDensity,
      default: nextDensity,
    };
    setDensityByContext(nextPreferences);
    localStorage.setItem("bigbsky:density-by-context", JSON.stringify(nextPreferences));
  }

  function updateWorkspaceWidth(nextWidth: (typeof widthModes)[number]) {
    const nextPreferences = {
      ...widthByContext,
      [densityKey]: nextWidth,
      default: nextWidth,
    };
    setWidthByContext(nextPreferences);
    localStorage.setItem(widthByContextStorageKey, JSON.stringify(nextPreferences));
  }

  function toggleShowNsfw() {
    setShowNsfw((current) => {
      const next = !current;
      localStorage.setItem(showNsfwStorageKey, next ? "true" : "false");
      return next;
    });
  }

  function toggleShowMedia() {
    setShowMedia((current) => {
      const next = !current;
      localStorage.setItem(showMediaStorageKey, next ? "true" : "false");
      return next;
    });
  }

  async function clearLocalReaderData() {
    Object.keys(localStorage)
      .filter((key) => key.startsWith("bigbsky:"))
      .forEach((key) => localStorage.removeItem(key));
    Object.keys(sessionStorage)
      .filter((key) => key.startsWith("bigbsky:"))
      .forEach((key) => sessionStorage.removeItem(key));
    await clearOAuthSessionStorage();
    setDensityByContext({});
    setWidthByContext({});
    setRecentItems([]);
    setComposerDraft({ posts: [""] });
    setLocalLists([]);
    setPinnedFeedIds([]);
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
      localStorage.setItem(recentStorageKey, JSON.stringify(next));
      return next;
    });
  }

  function clearRecentItems() {
    setRecentItems([]);
    localStorage.removeItem(recentStorageKey);
  }

  const getBookmarkState = useCallback(
    (post: FeedPost): BookmarkView => {
      const ov = bookmarkOverrides[post.uri];
      if (ov !== undefined) {
        return { bookmarked: ov };
      }
      return { bookmarked: !!post.viewer?.bookmarked };
    },
    [bookmarkOverrides],
  );

  const toggleBookmark = useCallback(
    (post: FeedPost) => {
      if (!signedInDid || bookmarkInFlight.current.has(post.uri)) {
        return;
      }
      const ov = bookmarkOverrides[post.uri];
      const bookmarked = ov !== undefined ? ov : !!post.viewer?.bookmarked;
      bookmarkInFlight.current.add(post.uri);
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
      localStorage.setItem(localListsStorageKey, JSON.stringify(next));
      return next;
    });
  }

  function deleteLocalList(id: string) {
    setLocalLists((current) => {
      const next = current.filter((list) => list.id !== id);
      localStorage.setItem(localListsStorageKey, JSON.stringify(next));
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
      localStorage.setItem(localListsStorageKey, JSON.stringify(next));
      return next;
    });
  }

  function togglePinnedFeed(source: FeedSource) {
    const willPin = !pinnedFeedIds.includes(source.id);
    setPinnedFeedIds((current) => {
      const next = willPin
        ? [source.id, ...current.filter((id) => id !== source.id)].slice(0, 12)
        : current.filter((id) => id !== source.id);
      localStorage.setItem(pinnedFeedsStorageKey, JSON.stringify(next));
      return next;
    });
    // Discovered Feeds aren't in the static feedSources list, so persist their
    // metadata separately; otherwise the pinned id can't be resolved on reload.
    if (!feedSources.some((item) => item.id === source.id)) {
      setPinnedFeedMeta((current) => {
        const withoutSource = current.filter((item) => item.id !== source.id);
        const next = willPin ? [{ ...source }, ...withoutSource].slice(0, 12) : withoutSource;
        localStorage.setItem(pinnedFeedMetaStorageKey, JSON.stringify(next));
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
      localStorage.setItem(pinnedFeedsStorageKey, JSON.stringify(next));
      return next;
    });
  }

  function togglePinnedSearch(query: string) {
    const trimmed = query.trim();
    if (!trimmed) {
      return;
    }

    setPinnedSearches((current) => {
      const exists = current.some((item) => item.toLowerCase() === trimmed.toLowerCase());
      const next = exists ? current.filter((item) => item.toLowerCase() !== trimmed.toLowerCase()) : [trimmed, ...current].slice(0, 12);
      localStorage.setItem(pinnedSearchesStorageKey, JSON.stringify(next));
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
      localStorage.setItem(pinnedProfilesStorageKey, JSON.stringify(next));
      return next;
    });
  }

  function togglePinnedNotification(id: string) {
    setPinnedNotificationIds((current) => {
      const next = current.includes(id) ? current.filter((item) => item !== id) : [id, ...current].slice(0, 20);
      localStorage.setItem(pinnedNotificationsStorageKey, JSON.stringify(next));
      return next;
    });
  }

  function toggleCollapsedFeedGroup(group: string) {
    setCollapsedFeedGroups((current) => {
      const next = { ...current, [group]: !current[group] };
      localStorage.setItem(collapsedFeedGroupsStorageKey, JSON.stringify(next));
      return next;
    });
  }

  function navigate(nextRoute: RouteState, path = "/") {
    window.history.pushState(null, "", path);
    setRoute(nextRoute);
  }

  function openNavigation(item: string) {
    if (item === "Chat") {
      // BigBSky does not handle DMs; the Chat nav opens Bluesky messages
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

  function openNewPostComposer() {
    if (!authState.session) {
      navigate({ kind: "surface", name: "profile" }, "/profile");
      return;
    }

    openSelfTab("new-post");
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
    route.kind === "profile"
      ? `profile:${route.actor}`
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
    const timeline = timelineRef.current;
    if (!timeline || !activeScrollKey) {
      return undefined;
    }

    const rememberScroll = () => {
      scrollCacheRef.current[activeScrollKey] = timeline.scrollTop;
    };
    const persistScroll = () => {
      rememberScroll();
      writeTimelineScrollCache(scrollCacheRef.current);
    };
    timeline.addEventListener("scroll", rememberScroll, { passive: true });
    window.addEventListener("pagehide", persistScroll);
    return () => {
      persistScroll();
      timeline.removeEventListener("scroll", rememberScroll);
      window.removeEventListener("pagehide", persistScroll);
    };
  }, [activeScrollKey]);

  useEffect(() => {
    if (!activeScrollKey.startsWith("surface:")) {
      return undefined;
    }

    const frame = requestAnimationFrame(() => {
      timelineRef.current?.scrollTo({ top: scrollCacheRef.current[activeScrollKey] || 0 });
    });
    return () => cancelAnimationFrame(frame);
  }, [activeScrollKey]);

  const loadMore = () => {
    if (route.kind === "search") {
      if (route.query && searchTab === "posts" && searchState.cursor) {
        void loadSearch(route.query, searchSort, searchLanguage, searchState.cursor);
      }
      if (route.query && searchTab === "people" && actorSearchState.cursor) {
        void loadActorSearch(route.query, actorSearchState.cursor);
      }
      return;
    }

    if (!feedState.cursor) {
      return;
    }

    if (route.kind === "profile") {
      void loadProfileFeed(route.actor, feedState.cursor);
      return;
    }

    void loadFeed(activeSource, feedState.cursor);
  };
  const reloadCurrentProfile = useCallback(() => {
    if (route.kind !== "profile") {
      return;
    }
    delete profileCacheRef.current[route.actor];
    void loadProfileFeed(route.actor);
  }, [loadProfileFeed, route]);
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

  const openLinkPreview = (link: NonNullable<LinkPreviewState>) => {
    setLinkPreview(link);
  };
  const isViewingSelfProfile =
    route.kind === "profile" &&
    !!authState.session &&
    !!signedInDid &&
    (profile?.did === signedInDid || route.actor === authState.session.handle || route.actor === signedInDid);

  return (
    <TagSearchContext.Provider value={openTag}>
      <ShowNsfwContext.Provider value={showNsfw}>
      <ShowMediaContext.Provider value={showMedia}>
      <LikeContext.Provider value={likeContextValue}>
      <BookmarkContext.Provider value={bookmarkContextValue}>
      <BlockContext.Provider value={blockContextValue}>
      <DeletePostContext.Provider value={deletePostContextValue}>
      <div className={`app-shell width-${workspaceWidth} ${navOpen ? "nav-open" : "nav-hidden"}`}>
      <aside className="left-rail" aria-label="Primary">
        <nav className="rail-nav">
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
                <Icon size={20} />
                <span>{item}</span>
              </button>
            );
          })}
        </nav>
        <button className="compose-button" type="button" title="New post" aria-label="New post" onClick={openNewPostComposer}>
          <Send size={20} />
        </button>
      </aside>

      <aside className="feed-map" aria-label="Feeds">
        <div className="feed-map-header">
          <strong>Feeds</strong>
          <button type="button" title="Search feeds" onClick={() => setFeedSearch("")}>
            <Search size={16} />
          </button>
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
        <header className="workspace-header">
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
          <button className="mobile-compose-button" type="button" title="New post" aria-label="New post" onClick={openNewPostComposer}>
            <Send size={20} />
          </button>
        </header>

        {missingScopes.length > 0 && (
          <div className="reauth-banner" role="status">
            <div>
              <strong>Permissions updated</strong>
              <span>BigBSky added new capabilities since you signed in. Re-authorize to keep everything working.</span>
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
            onOpenImage={setImageViewer}
            onOpenPost={openPost}
            onOpenProfile={openProfile}
            onOpenLinkPreview={openLinkPreview}
            onLoadBranch={loadThreadBranch}
            localLists={localLists}
            onToggleListPost={togglePostInLocalList}
            canReply={!!authState.session}
            onReplied={reloadThread}
          />
        ) : route.kind === "surface" && route.name === "bookmarks" ? (
          <BookmarksView
            containerRef={timelineRef}
            signedIn={!!authState.session}
            currentDid={authState.session?.did}
            onOpenImage={setImageViewer}
            onOpenPost={openPost}
            onOpenProfile={openProfile}
            onOpenLinkPreview={openLinkPreview}
            localLists={localLists}
            onToggleListPost={togglePostInLocalList}
          />
        ) : route.kind === "surface" ? (
          <SurfaceView
            containerRef={timelineRef}
            auth={authState}
            name={route.name}
            density={density}
            recentCount={recentItems.length}
            savedPreferenceCount={Object.keys(densityByContext).length}
            localDataKeyCount={countBigbskyLocalKeys()}
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
            workspaceWidth={workspaceWidth}
            onClearLocalData={clearLocalReaderData}
            onCreateLocalList={createLocalList}
            onDensityChange={updateDensity}
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
            onWorkspaceWidthChange={updateWorkspaceWidth}
            showNsfw={showNsfw}
            onToggleNsfw={toggleShowNsfw}
            showMedia={showMedia}
            onToggleShowMedia={toggleShowMedia}
            canFollowFeeds={!!signedInDid}
            subscribedFeeds={subscribedFeeds}
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
            onOpenImage={setImageViewer}
            onOpenPost={openPost}
            onOpenProfile={openProfile}
            onOpenLinkPreview={openLinkPreview}
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
              <Composer
                draft={composerDraft}
                onDraftChange={setComposerDraft}
                onPosted={reloadCurrentProfile}
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
                  profileTab === "posts" && feedState.items.length > 0 ? (
                    <EmptyState
                      title="No standalone posts"
                      message="This account's loaded activity is all replies. Open the Replies tab to see them."
                    />
                  ) : (
                    <EmptyState title="No posts in this tab" message="This public profile has no loaded posts matching the selected view." />
                  )
                )}
                {feedState.status === "ready" && visibleProfileItems.length > 0 && (
                  <VirtualPostList
                    containerRef={timelineRef}
                    density={density}
                    items={visibleProfileItems}
                    onOpenImage={setImageViewer}
                    onOpenPost={openPost}
                    onOpenProfile={openProfile}
                    onOpenLinkPreview={openLinkPreview}
                    currentDid={authState.session?.did}
                    localLists={localLists}
                    onToggleListPost={togglePostInLocalList}
                    onRenderedRowsChange={setVirtualRenderedRows}
                  >
                    {feedState.cursor && (
                      <AutoLoadMoreButton label="Load more profile posts" onLoadMore={loadMore} error={feedState.loadMoreError} />
                    )}
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
            {feedState.status === "loading" && <LoadingState label="Loading public Bluesky posts" />}
            {feedState.status === "error" && <ErrorState message={feedState.error || "Feed failed to load."} />}
            {feedState.status === "rate-limit" && <RateLimitState message={feedState.error} />}
            {feedState.status === "ready" && (
              <VirtualPostList
                containerRef={timelineRef}
                density={density}
                items={feedState.items}
                onOpenImage={setImageViewer}
                onOpenPost={openPost}
                onOpenProfile={openProfile}
                onOpenLinkPreview={openLinkPreview}
                currentDid={authState.session?.did}
                localLists={localLists}
                onToggleListPost={togglePostInLocalList}
                onRenderedRowsChange={setVirtualRenderedRows}
              >
                {feedState.cursor && (
                  <AutoLoadMoreButton label="Load more feed posts" onLoadMore={loadMore} error={feedState.loadMoreError} />
                )}
              </VirtualPostList>
            )}
          </div>
        )}
        <BackToTopButton containerRef={timelineRef} watchKey={`${route.kind}:${activeSource.id}`} />
      </main>

      <aside className="right-rail" aria-label="Context">
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
        <LinkPreviewPanel
          preview={linkPreview}
          onClose={() => setLinkPreview(null)}
          onOpenPost={openPost}
        />
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

      {imageViewer && <ImageViewer image={imageViewer} onChange={setImageViewer} onClose={() => setImageViewer(null)} />}
      </div>
      </DeletePostContext.Provider>
      </BlockContext.Provider>
      </BookmarkContext.Provider>
      </LikeContext.Provider>
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
  onOpenImage,
  onOpenLinkPreview,
  onOpenPost,
  onOpenProfile,
  onToggleListPost,
  onRenderedRowsChange,
}: {
  children?: React.ReactNode;
  containerRef: RefObject<HTMLDivElement | null>;
  currentDid?: string;
  density: string;
  items: FeedItem[];
  localLists: LocalList[];
  onOpenImage: (image: ImageViewerState) => void;
  onOpenLinkPreview: (link: NonNullable<LinkPreviewState>) => void;
  onOpenPost: (post: FeedPost) => void;
  onOpenProfile: (profile: Profile) => void;
  onToggleListPost: (listId: string, post: FeedPost) => void;
  onRenderedRowsChange: (count: number) => void;
}) {
  // When the NSFW preference is hidden, drop adult/graphic-labeled posts from
  // the feed entirely (not just gate their media), so they never appear.
  const showNsfw = useContext(ShowNsfwContext);
  const items = useMemo(
    () => (showNsfw ? incomingItems : incomingItems.filter((item) => !isAdultPost(item.post))),
    [incomingItems, showNsfw],
  );
  const rows = useMemo(() => buildThreadedFeedRows(items), [items]);
  const defaultRowHeight = density === "compact" ? 190 : density === "media" ? 360 : 260;
  const overscanPixels = defaultRowHeight * 3;
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(720);
  const [rowHeights, setRowHeights] = useState<Record<string, number>>({});
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
            setRowHeights((current) => {
              const rowKey = feedRowKey(row);
              const previousHeight = current[rowKey] ?? defaultRowHeight;
              if (previousHeight === height) {
                return current;
              }

              const rowIndex = rows.findIndex((candidate) => feedRowKey(candidate) === rowKey);
              const rowTop = rowIndex >= 0 ? rowOffsets[rowIndex] ?? 0 : 0;
              const container = containerRef.current;
              if (container && rowTop + previousHeight <= container.scrollTop) {
                container.scrollTop += height - previousHeight;
              }

              return { ...current, [rowKey]: height };
            });
          }}
        >
          {(() => {
            const rowPost = feedRowPost(row);
            return (
              <>
                {isThreadedFeedItem(row) ? (
                  <ThreadedPostCard
                    thread={row}
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
                    onOpenLinkPreview={onOpenLinkPreview}
                    onOpenPost={onOpenPost}
                    onOpenProfile={onOpenProfile}
                    onReply={canReply ? (post) => setActiveReplyParentUri((current) => (current === post.uri ? null : post.uri)) : undefined}
                    replyActive={activeReplyParentUri === rowPost.uri}
                    localLists={localLists}
                    onToggleListPost={onToggleListPost}
                  />
                )}
                {activeReplyParentUri === rowPost.uri && (
                  <ReplyComposer
                    parent={rowPost}
                    root={replyRootRefForPost(rowPost)}
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
  density,
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
  workspaceWidth,
  onClearLocalData,
  onCreateLocalList,
  onDensityChange,
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
  onWorkspaceWidthChange,
  showNsfw,
  onToggleNsfw,
  showMedia,
  onToggleShowMedia,
  canFollowFeeds,
  subscribedFeeds,
  followedFeedUris,
  followBusyUri,
  onToggleFollowFeed,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  auth: AuthState;
  name: string;
  density: string;
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
  workspaceWidth: (typeof widthModes)[number];
  onClearLocalData: () => void | Promise<void>;
  onCreateLocalList: (name: string, description: string) => void;
  onDensityChange: (density: string) => void;
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
  onWorkspaceWidthChange: (width: (typeof widthModes)[number]) => void;
  showNsfw: boolean;
  onToggleNsfw: () => void;
  showMedia: boolean;
  onToggleShowMedia: () => void;
  canFollowFeeds: boolean;
  subscribedFeeds: FeedSource[];
  followedFeedUris: Set<string>;
  followBusyUri: string | null;
  onToggleFollowFeed: (feedUri: string, label?: string) => void;
}) {
  const title = name.charAt(0).toUpperCase() + name.slice(1);
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
        { title: "New List", detail: "Create local list shells without sending anything to BigBSky infrastructure.", status: "Active" },
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
        { title: "Privacy", detail: "No BigBSky backend storage is used for v1 reader data.", status: "Static" },
      ],
    },
  };
  const surface = surfaces[name] || {
    copy: "This signed-in destination has a stable static route and is ready for OAuth-backed data.",
    cards: [{ title: "Static Route", detail: "The SPA fallback can serve this destination without server code.", status: "Ready" }],
  };

  if (name === "settings") {
    return (
      <div className="timeline comfortable">
        <section className="surface-placeholder">
          <h2>Settings</h2>
          <p>Local reader preferences and account/session controls live here. No BigBSky backend storage is used for v1 reader data.</p>
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
                <dt>Current density</dt>
                <dd>{density}</dd>
              </div>
              <div>
                <dt>Saved preference keys</dt>
                <dd>{savedPreferenceCount.toLocaleString()}</dd>
              </div>
            </dl>
            <p>Density is stored locally and applied before timeline rows paint.</p>
            <div className="settings-control-group" aria-label="Reading density setting">
              {densityModes.map((mode) => (
                <button
                  className={density === mode ? "selected-setting" : ""}
                  key={mode}
                  type="button"
                  onClick={() => onDensityChange(mode)}
                >
                  {mode}
                </button>
              ))}
            </div>
            <p>Feed width is stored locally and changes how much desktop space the reader claims from side context.</p>
            <div className="settings-control-group" aria-label="Feed width setting">
              {widthModes.map((mode) => (
                <button
                  className={workspaceWidth === mode ? "selected-setting" : ""}
                  key={mode}
                  type="button"
                  onClick={() => onWorkspaceWidthChange(mode)}
                >
                  {mode}
                </button>
              ))}
            </div>
          </article>
          <article className="settings-panel">
            <span>{showNsfw ? "Showing" : "Hidden"}</span>
            <h3>Content &amp; Media</h3>
            <p>Adult and graphic media is hidden behind a warning by default. Turn this on to show labeled media without the per-post Show step.</p>
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
            <p>This preference is stored locally in this browser only.</p>
          </article>
          <article className="settings-panel">
            <span>{showMedia ? "On" : "Off"}</span>
            <h3>Show Media</h3>
            <p>When on (default), posts show their images and videos. Turn off to read text-only: posts and link previews still appear, but images and videos are replaced by a small control you can click to reveal the media per post.</p>
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
              <span>{showMedia ? "Showing images & videos" : "Hiding images & videos"}</span>
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
                <p>Sign-out revokes the stored OAuth session when possible and always clears local browser auth state.</p>
                <button type="button" onClick={onSignOut}>
                  Sign out
                </button>
              </>
            ) : (
              <>
                <p>Use Bluesky OAuth from the browser. No BigBSky backend session is created.</p>
                <SignInForm status={auth.status} onSignIn={onSignIn} />
              </>
            )}
            {auth.message && <p className={auth.status === "error" ? "settings-warning" : undefined}>{auth.message}</p>}
          </article>
        </section>
      </div>
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
          <p>Sign in with your Bluesky account to see your profile and use your follows, likes, lists, posting, and notifications. BigBSky signs in with AT Protocol OAuth in your browser — no BigBSky backend session is created.</p>
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
            BigBSky is a reader and intentionally does not handle direct
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
        {name === "explore" && <ExploreSearch onSearch={onOpenSearchQuery} />}
      </section>
      {name === "explore" && <ExploreTrendingTopics onOpenSearchQuery={onOpenSearchQuery} />}
      {name === "feeds" && (
        <>
          <section className="bsky-list-section" aria-label="Your feeds">
            <h3 className="bsky-list-section-heading">Your feeds</h3>
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
                {subscribedFeeds.map((source) => (
                  <article className="feed-directory-card" key={source.id}>
                    <button type="button" onClick={() => onOpenFeed(source)}>
                      <span>{source.group}</span>
                      <strong>{source.label}</strong>
                      <small>{source.description}</small>
                    </button>
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
                ))}
              </div>
            )}
          </section>
          <section className="bsky-list-section" aria-label="Built-in feeds">
            <h3 className="bsky-list-section-heading">Built-in feeds</h3>
            <div className="feed-directory-grid">
              {feedSources.map((source) => (
                <article className="feed-directory-card" key={source.id}>
                  <button type="button" onClick={() => onOpenFeed(source)}>
                    <span>{source.group}</span>
                    <strong>{source.label}</strong>
                    <small>{source.description}</small>
                  </button>
                  <button
                    className={pinnedFeedIds.includes(source.id) ? "directory-pin pinned" : "directory-pin"}
                    type="button"
                    onClick={() => onTogglePinnedFeed(source)}
                  >
                    {pinnedFeedIds.includes(source.id) ? "Pinned" : "Pin locally"}
                  </button>
                </article>
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

function ExploreSearch({ onSearch }: { onSearch: (query: string) => void }) {
  const [query, setQuery] = useState("");
  return (
    <form
      className="explore-search"
      onSubmit={(event) => {
        event.preventDefault();
        onSearch(query);
      }}
    >
      <Search size={18} />
      <input
        aria-label="Search Bluesky"
        placeholder="Search posts, people, and feeds"
        value={query}
        onInput={(event) => setQuery(event.currentTarget.value)}
      />
      <button type="submit">Search</button>
    </form>
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
        <p>Live from Bluesky. Open one to search posts about it in BigBSky.</p>
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
        <p>Popular public Bluesky Feeds, loaded live. Open one to read it in BigBSky without signing in.</p>
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
  // out to Bluesky for things BigBSky delegates rather than builds.
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
          <button type="button" onClick={() => onOpenProfile(auth as Profile)}>
            Open public profile
          </button>
          <a className="self-profile-action-link" href={bskyProfileUrl} target="_blank" rel="noreferrer" title="Edit your profile on Bluesky">
            Edit profile on Bluesky
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
              <ErrorState message="Notifications need updated permissions. BigBSky added notification access since you last signed in — re-authorize to load them." />
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

const POST_GRAPHEME_LIMIT = 300;

type GraphemeSegmenter = {
  segment(input: string): Iterable<{ segment: string; index: number }>;
};

function graphemeSegments(text: string): Array<{ segment: string; index: number }> {
  const Segmenter = (
    Intl as typeof Intl & {
      Segmenter?: new (locales: string | undefined, options: { granularity: "grapheme" }) => GraphemeSegmenter;
    }
  ).Segmenter;
  if (Segmenter) {
    return Array.from(new Segmenter(undefined, { granularity: "grapheme" }).segment(text));
  }
  let index = 0;
  return Array.from(text).map((segment) => {
    const current = { segment, index };
    index += segment.length;
    return current;
  });
}

function graphemeLength(text: string) {
  return graphemeSegments(text).length;
}

function codeUnitIndexAfterGraphemes(text: string, count: number) {
  const segments = graphemeSegments(text);
  if (segments.length <= count) {
    return text.length;
  }
  const segment = segments[count - 1];
  return segment.index + segment.segment.length;
}

function lastMatchEnd(text: string, pattern: RegExp, minimumEnd: number) {
  let fallback = -1;
  let preferred = -1;
  for (const match of text.matchAll(pattern)) {
    const end = (match.index ?? 0) + match[0].length;
    fallback = end;
    if (end >= minimumEnd) {
      preferred = end;
    }
  }
  return preferred >= 0 ? preferred : Math.max(0, fallback);
}

function splitTextForThread(text: string, limit = POST_GRAPHEME_LIMIT) {
  const posts: string[] = [];
  let remaining = text.replace(/\r\n/g, "\n").trim();
  while (remaining && graphemeLength(remaining) > limit) {
    const hardEnd = codeUnitIndexAfterGraphemes(remaining, limit);
    const windowText = remaining.slice(0, hardEnd);
    const minimumEnd = Math.floor(hardEnd * 0.66);
    const splitAt =
      lastMatchEnd(windowText, /\n\s*\n/g, minimumEnd) ||
      lastMatchEnd(windowText, /[.!?…]["')\]]?\s+/g, minimumEnd) ||
      lastMatchEnd(windowText, /[,;:]\s+/g, minimumEnd) ||
      lastMatchEnd(windowText, /\s+/g, minimumEnd) ||
      hardEnd;
    const chunk = remaining.slice(0, splitAt).trim();
    if (chunk) {
      posts.push(chunk);
    }
    remaining = remaining.slice(splitAt).trimStart();
  }
  if (remaining) {
    posts.push(remaining);
  }
  return posts;
}

function Composer({
  draft,
  onDraftChange,
  onPosted,
  defaultExpanded = false,
}: {
  draft: { posts: string[] };
  onDraftChange: (draft: { posts: string[] }) => void;
  onPosted?: () => void;
  defaultExpanded?: boolean;
}) {
  const drafts = draft.posts.length > 0 ? draft.posts : [""];
  const draftText = drafts.join("\n\n");
  const generatedPosts = splitTextForThread(draftText);
  const generatedPostCount = Math.max(generatedPosts.length, 1);
  // Real attached images live in component state (not the persisted draft):
  // File objects and object-URLs can't be JSON-serialized to localStorage, so
  // they are session-only — text drafts persist across reloads, images don't.
  const [images, setImages] = useState<Record<number, ComposerImageState[]>>({});
  const hasImages = Object.values(images).some((list) => list.length > 0);
  const hasContent = draftText.trim().length > 0 || hasImages;
  // Collapsed by default to keep the top of the feed clean; expand on click.
  // Start expanded if a local draft is already in progress so it isn't hidden.
  const [expanded, setExpanded] = useState(defaultExpanded || hasContent);
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  // Hidden file input shared across posts; attachTarget records which post the
  // picked files belong to.
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const attachTarget = useRef<number>(0);

  useEffect(() => {
    if (draftText.trim().length > 0) {
      localStorage.setItem(composerDraftStorageKey, JSON.stringify({ posts: [draftText] }));
    } else {
      localStorage.removeItem(composerDraftStorageKey);
    }
  }, [draftText]);

  // Revoke any outstanding object URLs when the composer unmounts.
  useEffect(() => {
    return () => {
      Object.values(images)
        .flat()
        .forEach((image) => URL.revokeObjectURL(image.url));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setDraftText(value: string) {
    onDraftChange({ posts: [value] });
  }

  function attachImage(index: number) {
    attachTarget.current = index;
    fileInputRef.current?.click();
  }

  function onFilesSelected(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) {
      return;
    }
    const index = attachTarget.current;
    const picked = Array.from(fileList).filter((file) => file.type.startsWith("image/"));
    setImages((current) => {
      const existing = current[index] ?? [];
      const room = MAX_POST_IMAGES - existing.length;
      const added = picked.slice(0, Math.max(0, room)).map((file) => ({
        id: `${file.name}-${file.size}-${file.lastModified}-${existing.length}`,
        file,
        url: URL.createObjectURL(file),
        alt: "",
      }));
      return { ...current, [index]: [...existing, ...added] };
    });
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function removeImage(index: number, id: string) {
    setImages((current) => {
      const list = current[index] ?? [];
      const target = list.find((image) => image.id === id);
      if (target) {
        URL.revokeObjectURL(target.url);
      }
      return { ...current, [index]: list.filter((image) => image.id !== id) };
    });
  }

  function setImageAlt(index: number, id: string, alt: string) {
    setImages((current) => ({
      ...current,
      [index]: (current[index] ?? []).map((image) => (image.id === id ? { ...image, alt } : image)),
    }));
  }

  function clearDraft() {
    Object.values(images)
      .flat()
      .forEach((image) => URL.revokeObjectURL(image.url));
    setImages({});
    const emptyDraft = { posts: [""] };
    localStorage.removeItem(composerDraftStorageKey);
    onDraftChange(emptyDraft);
  }

  async function handlePostAll() {
    if (posting || !hasContent) {
      return;
    }
    setPosting(true);
    setPostError(null);
    try {
      const postTexts = splitTextForThread(draftText);
      const composerImages = (images[0] ?? []).map((image) => ({ file: image.file, alt: image.alt }));
      const postsToPublish =
        postTexts.length > 0
          ? postTexts.map((text, index) => ({
              text,
              images: index === 0 ? composerImages : [],
            }))
          : [{ text: "", images: composerImages }];
      await publishThread(
        postsToPublish,
      );
      // Posted: clear the draft + images, collapse, and refresh the feed.
      Object.values(images)
        .flat()
        .forEach((image) => URL.revokeObjectURL(image.url));
      setImages({});
      const emptyDraft = { posts: [""] };
      localStorage.removeItem(composerDraftStorageKey);
      onDraftChange(emptyDraft);
      setExpanded(false);
      onPosted?.();
    } catch (error) {
      setPostError(error instanceof Error ? error.message : "Could not publish. Try again.");
    } finally {
      setPosting(false);
    }
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
            placeholder="What's on your mind?"
            value={draftText}
            onChange={(event) => setDraftText(event.target.value)}
          />
          {(images[0]?.length ?? 0) > 0 && (
            <div className="composer-media-grid" aria-label="Attached images">
              {(images[0] ?? []).map((image) => (
                <div className="composer-media-item" key={image.id}>
                  <img src={image.url} alt={image.alt || "Attached image preview"} />
                  <button
                    type="button"
                    className="composer-media-remove"
                    title="Remove image"
                    aria-label="Remove image"
                    onClick={() => removeImage(0, image.id)}
                  >
                    <X size={14} />
                  </button>
                  <input
                    className="composer-media-alt"
                    type="text"
                    placeholder="Alt text (describe the image)"
                    value={image.alt}
                    maxLength={2000}
                    onChange={(event) => setImageAlt(0, image.id, event.target.value)}
                  />
                </div>
              ))}
            </div>
          )}
          <div className="composer-actions">
            <button
              type="button"
              title="Attach image"
              onClick={() => attachImage(0)}
              disabled={(images[0]?.length ?? 0) >= MAX_POST_IMAGES}
            >
              <Image size={18} />
            </button>
            <span>
              {graphemeLength(draftText)} chars
              {draftText.trim() && generatedPostCount > 1 ? ` / ${generatedPostCount} posts` : ""}
            </span>
          </div>
        </div>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(event) => onFilesSelected(event.target.files)}
      />
      {postError && <p className="composer-error" role="alert">{postError}</p>}
      <div className="composer-footer">
        <span>{posting ? "Publishing…" : hasContent ? "Draft autosaved locally" : "No local draft"}</span>
        <button type="button" onClick={clearDraft} disabled={!hasContent || posting}>
          Clear draft
        </button>
        <button type="button" onClick={handlePostAll} disabled={!hasContent || posting}>
          {posting ? "Posting…" : draftText.trim() && generatedPostCount > 1 ? "Post thread" : "Post"}
        </button>
      </div>
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
  onOpenLinkPreview,
  onOpenPost,
  onOpenProfile,
  onToggleListPost,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  currentDid?: string;
  localLists: LocalList[];
  signedIn: boolean;
  onOpenImage: (image: ImageViewerState) => void;
  onOpenLinkPreview: (link: NonNullable<LinkPreviewState>) => void;
  onOpenPost: (post: FeedPost) => void;
  onOpenProfile: (profile: Profile) => void;
  onToggleListPost: (listId: string, post: FeedPost) => void;
}) {
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    if (!signedIn) {
      setStatus("idle");
      setPosts([]);
      setCursor(undefined);
      return undefined;
    }
    let cancelled = false;
    setStatus("loading");
    void (async () => {
      try {
        const response = await getBookmarks();
        if (cancelled) {
          return;
        }
        setPosts(response.feed.map((item) => item.post));
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
        setPosts((current) => [...current, ...response.feed.map((item) => item.post)]);
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
      ) : posts.length === 0 ? (
        <EmptyState title="No bookmarks yet" message="Use the Bookmark action on any post to save it to your Bluesky account." />
      ) : (
        <section className="bookmarks-list" aria-label="Bookmarks">
          {posts.map((post) => (
            <PostCard
              item={{ post }}
              currentDid={currentDid}
              key={post.uri}
              onOpenImage={onOpenImage}
              onOpenLinkPreview={onOpenLinkPreview}
              onOpenPost={onOpenPost}
              onOpenProfile={onOpenProfile}
              localLists={localLists}
              onToggleListPost={onToggleListPost}
            />
          ))}
          {cursor && <AutoLoadMoreButton label="Load more bookmarks" onLoadMore={loadMore} />}
        </section>
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
  onOpenLinkPreview,
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
  onOpenLinkPreview: (link: NonNullable<LinkPreviewState>) => void;
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
                  onOpenLinkPreview={onOpenLinkPreview}
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
  const usable = (facets ?? []).filter(
    (facet) =>
      typeof facet.index?.byteStart === "number" &&
      typeof facet.index?.byteEnd === "number" &&
      Array.isArray(facet.features) &&
      facet.features.length > 0,
  );
  if (usable.length === 0) {
    return text;
  }

  const bytes = new TextEncoder().encode(text);
  const decoder = new TextDecoder();
  const sorted = [...usable].sort((a, b) => (a.index!.byteStart ?? 0) - (b.index!.byteStart ?? 0));
  const nodes: ReactNode[] = [];
  let cursor = 0;

  sorted.forEach((facet, index) => {
    const start = facet.index!.byteStart ?? 0;
    const end = facet.index!.byteEnd ?? 0;
    if (start < cursor || start >= end || end > bytes.length) {
      return;
    }
    if (start > cursor) {
      nodes.push(decoder.decode(bytes.slice(cursor, start)));
    }
    const segment = decoder.decode(bytes.slice(start, end));
    const feature = facet.features?.find((item) => typeof item.$type === "string");
    const type = feature?.$type;

    if (type === "app.bsky.richtext.facet#link" && feature?.uri) {
      nodes.push(
        <a
          key={index}
          className="post-link"
          href={feature.uri}
          target="_blank"
          rel="noreferrer"
          onClick={(event) => event.stopPropagation()}
        >
          {segment}
        </a>,
      );
    } else if (type === "app.bsky.richtext.facet#mention" && feature?.did && onOpenProfile) {
      const did = feature.did;
      const handle = segment.replace(/^@/, "");
      nodes.push(
        <button
          key={index}
          type="button"
          className="post-mention"
          onClick={(event) => {
            event.stopPropagation();
            onOpenProfile({ did, handle });
          }}
        >
          {segment}
        </button>,
      );
    } else if (type === "app.bsky.richtext.facet#tag" && (feature?.tag || segment) && onOpenTag) {
      const tag = feature?.tag || segment.replace(/^#/, "");
      nodes.push(
        <button
          key={index}
          type="button"
          className="post-tag"
          onClick={(event) => {
            event.stopPropagation();
            onOpenTag(tag);
          }}
        >
          {segment}
        </button>,
      );
    } else {
      nodes.push(segment);
    }
    cursor = end;
  });

  if (cursor < bytes.length) {
    nodes.push(decoder.decode(bytes.slice(cursor)));
  }

  return nodes;
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
function MediaHiddenButton({ kind, onReveal }: { kind: "image" | "video"; onReveal: () => void }) {
  const label = kind === "video" ? "Video hidden" : "Media hidden";
  return (
    <button type="button" className="media-hidden-button" onClick={onReveal}>
      {kind === "video" ? <Film size={16} /> : <Image size={16} />}
      <span>{label}</span>
      <span className="media-hidden-show">Show</span>
    </button>
  );
}

function ThreadedPostCard({
  thread,
  onOpenPost,
  onOpenProfile,
  onReply,
  replyActive = false,
}: {
  thread: ThreadedFeedItem;
  onOpenPost?: (post: FeedPost) => void;
  onOpenProfile?: (profile: Profile) => void;
  onReply?: (post: FeedPost) => void;
  replyActive?: boolean;
}) {
  const onOpenTag = useContext(TagSearchContext);
  const bookmarkCtx = useContext(BookmarkContext);
  const posts = [thread.root.post, ...thread.replies.map((item) => item.post)];
  const rootPost = thread.root.post;
  const bookmarkView = bookmarkCtx?.getState(rootPost);
  const postTimeLabel = formatPostTime(rootPost.record.createdAt || rootPost.indexedAt);
  const replyCount = posts.reduce((total, post) => total + (post.replyCount ?? 0), 0);
  const repostCount = posts.reduce((total, post) => total + (post.repostCount ?? 0), 0);
  const likeCount = posts.reduce((total, post) => total + (post.likeCount ?? 0), 0);

  return (
    <article className="post-card thread-combined-card text-only">
      <header className="post-header">
        <Avatar profile={rootPost.author} />
        <div className="post-author-block">
          <button className="author-button" type="button" onClick={() => onOpenProfile?.(rootPost.author)}>
            <strong>{displayName(rootPost.author)}</strong>
          </button>
          <div className="post-byline">
            <span>@{rootPost.author.handle}</span>
            <span aria-hidden="true">·</span>
            <button
              className="post-timestamp"
              type="button"
              onClick={() => onOpenPost?.(rootPost)}
              title={`Open thread posted ${postTimeLabel}`}
              aria-label={`Open thread posted ${postTimeLabel}`}
            >
              {postTimeLabel}
            </button>
          </div>
        </div>
      </header>
      <div className="post-badges" aria-label="Thread context">
        <span>{posts.length.toLocaleString()} posts combined</span>
      </div>
      <div className="thread-combined-body">
        {posts.map((post, index) => {
          const text = post.record.text?.trim() || "";
          const preservesLineBreaks = text.includes("\n");
          return (
            <section className="thread-combined-part" key={post.uri}>
              {text ? (
                <p className={preservesLineBreaks ? "post-text has-line-breaks" : "post-text"}>
                  {renderRichText(post.record.facets?.length ? post.record.text || "" : text, post.record.facets, onOpenProfile, onOpenTag)}
                </p>
              ) : (
                <p className="post-text muted">Post {index + 1} has no plain text.</p>
              )}
            </section>
          );
        })}
      </div>
      <footer className="post-actions">
        <button type="button" onClick={() => onOpenPost?.(rootPost)} title="Open full thread replies">
          <MessageCircle size={16} /> {replyCount}
        </button>
        <span title="Total reposts across combined posts">
          <Repeat2 size={16} /> {repostCount}
        </span>
        <span title="Total likes across combined posts">
          <Heart size={16} /> {likeCount}
        </span>
        {bookmarkCtx?.canBookmark && bookmarkView && (
          <button
            type="button"
            className={bookmarkView.bookmarked ? "bookmarked" : ""}
            onClick={() => bookmarkCtx.toggle(rootPost)}
            title={bookmarkView.bookmarked ? "Remove thread bookmark" : "Bookmark thread"}
          >
            <Bookmark size={16} /> {bookmarkView.bookmarked ? "Bookmarked" : "Bookmark"}
          </button>
        )}
        <button type="button" onClick={() => onOpenPost?.(rootPost)} title="Open full thread">
          Open thread
        </button>
        {onReply && (
          <button type="button" className={replyActive ? "active" : ""} onClick={() => onReply(rootPost)} title="Reply to this thread">
            <MessageCircle size={16} /> Reply
          </button>
        )}
      </footer>
    </article>
  );
}

function PostCard({
  currentDid,
  item,
  localLists = [],
  onOpenImage,
  onOpenLinkPreview,
  onOpenPost,
  onOpenProfile,
  onReply,
  replyActive = false,
  onToggleListPost,
}: {
  currentDid?: string;
  item: FeedItem;
  localLists?: LocalList[];
  onOpenImage?: (image: ImageViewerState) => void;
  onOpenLinkPreview?: (link: NonNullable<LinkPreviewState>) => void;
  onOpenPost?: (post: FeedPost) => void;
  onOpenProfile?: (profile: Profile) => void;
  onReply?: (post: FeedPost) => void;
  replyActive?: boolean;
  onToggleListPost?: (listId: string, post: FeedPost) => void;
}) {
  const post = item.post;
  const onOpenTag = useContext(TagSearchContext);
  const showNsfw = useContext(ShowNsfwContext);
  const showMedia = useContext(ShowMediaContext);
  const likeCtx = useContext(LikeContext);
  const likeView = likeCtx?.getState(post);
  const bookmarkCtx = useContext(BookmarkContext);
  const bookmarkView = bookmarkCtx?.getState(post);
  const blockCtx = useContext(BlockContext);
  const blockView = blockCtx?.getState(post.author);
  const deletePostCtx = useContext(DeletePostContext);
  const canBlockAuthor = !!blockCtx?.canBlock && post.author.did !== blockCtx?.selfDid;
  const [shareState, setShareState] = useState<"idle" | "copied" | "shared" | "error">("idle");
  const [mediaRevealed, setMediaRevealed] = useState(false);
  const images = getEmbedImages(post.embed);
  const external = getExternalEmbed(post.embed);
  const recordEmbed = getRecordEmbed(post.embed);
  const video = getVideoEmbed(post.embed);
  const text = post.record.text?.trim() || "";
  const postTimestamp = post.record.createdAt || post.indexedAt;
  const postTimeLabel = formatPostTime(postTimestamp);
  const preservesLineBreaks = text.includes("\n");
  const hasRichContent = images.length > 0 || !!external || !!recordEmbed || !!video;
  const postVariant = images.length > 0 || !!video ? "has-media" : external ? "has-link" : recordEmbed ? "has-quote" : "text-only";
  const isOwnPost = !!currentDid && post.author.did === currentDid;
  const canDeletePost = !!deletePostCtx?.canDelete && isOwnPost;
  const labels = post.labels ?? [];
  // Adult content is often labeled at the account level, not the post, so check
  // the author's labels too when deciding whether to hide media.
  const sensitiveLabels = [...labels, ...(post.author.labels ?? [])].filter(isSensitiveLabel);
  // Gate adult/graphic media behind a click-to-reveal warning (spam labels are
  // not about media, so they don't hide images/video).
  const mediaWarningValues = sensitiveMediaValues([...labels, ...(post.author.labels ?? [])]);
  const gateMedia = !showNsfw && mediaWarningValues.length > 0 && (images.length > 0 || !!video) && !mediaRevealed;
  // "Show Media" off: hide images/video/link-thumb behind a per-card reveal,
  // unless already gated as sensitive (that gate wins) or revealed for this card.
  const hideMediaForSetting = !showMedia && !mediaRevealed && !gateMedia;
  const linkMediaHidden = hideMediaForSetting && !!external?.thumb;
  const moderationNotes = [
    ...(post.viewer?.threadMuted ? ["Thread muted"] : []),
    ...(post.viewer?.replyDisabled ? ["Replies limited"] : []),
    ...(post.viewer?.embeddingDisabled ? ["Embedding disabled"] : []),
    ...sensitiveLabels.map(moderationLabelText),
  ];
  const handleShare = async () => {
    const url = postBskyUrl(post);
    const title = `${displayName(post.author)} on Bluesky`;

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
    <article className={`post-card ${postVariant}`}>
      <header className="post-header">
        <Avatar profile={post.author} />
        <div className="post-author-block">
          <button className="author-button" type="button" onClick={() => onOpenProfile?.(post.author)}>
            <strong>{displayName(post.author)}</strong>
          </button>
          <div className="post-byline">
            <span>@{post.author.handle}</span>
            <span aria-hidden="true">·</span>
            <button
              className="post-timestamp"
              type="button"
              onClick={() => onOpenPost?.(post)}
              title={`Open thread posted ${postTimeLabel}`}
              aria-label={`Open thread posted ${postTimeLabel}`}
            >
              {postTimeLabel}
            </button>
          </div>
        </div>
      </header>
      {item.reason?.by && <p className="reason">Reposted by {displayName(item.reason.by)}</p>}
      {item.reply?.parent && <p className="reason">Replying in a thread from @{item.reply.parent.author.handle}</p>}
      {(isOwnPost || labels.length > 0 || moderationNotes.length > 0) && (
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
      {gateMedia ? (
        <SensitiveMediaGate values={mediaWarningValues} onReveal={() => setMediaRevealed(true)} />
      ) : hideMediaForSetting && (images.length > 0 || !!video) ? (
        <MediaHiddenButton kind={images.length > 0 ? "image" : "video"} onReveal={() => setMediaRevealed(true)} />
      ) : (
        <>
          {images.length > 0 && (
            <div className={`image-grid count-${Math.min(images.length, 4)}`}>
              {images.slice(0, maxPostImages).map((image, imageIndex) => (
                <button
                  className="image-button"
                  key={image.thumb || image.fullsize}
                  type="button"
                  onClick={() => {
                    const viewerImages = images
                      .slice(0, maxPostImages)
                      .map((viewerImage) => ({
                        src: viewerImage.fullsize || viewerImage.thumb || "",
                        alt: viewerImage.alt || "",
                      }))
                      .filter((viewerImage) => viewerImage.src);
                    if (viewerImages.length === 0) {
                      return;
                    }
                    const selectedIndex = Math.max(0, viewerImages.findIndex((viewerImage) => viewerImage.src === (image.fullsize || image.thumb)));
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
                      image.aspectRatio?.width && image.aspectRatio?.height
                        ? { aspectRatio: `${image.aspectRatio.width} / ${image.aspectRatio.height}` }
                        : undefined
                    }
                  />
                  {image.alt && <span className="alt-badge">ALT</span>}
                  {images.length > maxPostImages && imageIndex === maxPostImages - 1 && (
                    <span className="more-media-badge">+{images.length - maxPostImages}</span>
                  )}
                </button>
              ))}
            </div>
          )}
          {video && <VideoEmbedCard video={video} />}
          {mediaRevealed && mediaWarningValues.length > 0 && (
            <button type="button" className="sensitive-media-hide" onClick={() => setMediaRevealed(false)}>
              <EyeOff size={13} /> Hide sensitive media
            </button>
          )}
          {mediaRevealed && mediaWarningValues.length === 0 && !showMedia && (images.length > 0 || !!video) && (
            <button type="button" className="sensitive-media-hide" onClick={() => setMediaRevealed(false)}>
              <EyeOff size={13} /> Hide media
            </button>
          )}
        </>
      )}
      {external && (
        <div className={linkMediaHidden ? "link-card no-media" : "link-card"}>
          <a href={external.uri} target="_blank" rel="noreferrer">
            {external.thumb && !linkMediaHidden && <img alt="" src={external.thumb} loading="lazy" decoding="async" />}
            <span>
              <strong>{external.title || external.uri}</strong>
              <small>{external.description}</small>
            </span>
          </a>
          {linkMediaHidden && (
            <button type="button" className="media-hidden-button link-media-hidden" onClick={() => setMediaRevealed(true)}>
              <Image size={15} />
              <span className="media-hidden-show">Show image</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => onOpenLinkPreview?.({ ...external, sourcePost: post, uri: external.uri || "" })}
            title="Preview link context"
          >
            <LinkIcon size={15} /> Preview
          </button>
        </div>
      )}
      {recordEmbed && (
        <QuotedPostCard
          record={recordEmbed}
          onOpenPost={onOpenPost}
          onOpenProfile={onOpenProfile}
        />
      )}
      <footer className="post-actions">
        <button type="button" onClick={() => onOpenPost?.(post)} title="Open thread">
          <MessageCircle size={16} /> {post.replyCount ?? 0}
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
            className={bookmarkView.bookmarked ? "bookmarked" : ""}
            type="button"
            onClick={() => bookmarkCtx.toggle(post)}
            title={bookmarkView.bookmarked ? "Remove bookmark" : "Bookmark post"}
          >
            <Bookmark size={16} /> {bookmarkView.bookmarked ? "Bookmarked" : "Bookmark"}
          </button>
        ) : null}
        <button type="button" onClick={handleShare} title="Share post">
          <Share2 size={16} /> {shareState === "copied" ? "Copied" : shareState === "shared" ? "Shared" : shareState === "error" ? "Copy failed" : "Share"}
        </button>
        {onReply && (
          <button type="button" className={replyActive ? "active" : ""} onClick={() => onReply(post)} title="Reply to this post">
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
        <details className="post-list-menu post-more-menu">
          <summary title="More options">
            <MoreHorizontal size={16} />
          </summary>
          <div>
            <a
              href={`https://bsky.app/profile/${encodeURIComponent(post.author.handle)}/post/${post.uri.split("/").pop() || ""}`}
              target="_blank"
              rel="noreferrer"
            >
              Open on Bluesky
            </a>
            {canDeletePost && (
              <button type="button" className="danger-action" onClick={() => deletePostCtx?.deletePost(post)}>
                Delete post
              </button>
            )}
            {canBlockAuthor && (
              <button
                type="button"
                className={blockView?.blocked ? "block-listed" : ""}
                onClick={() => blockCtx?.toggle(post.author)}
              >
                {blockView?.blocked ? `Unblock @${post.author.handle}` : `Block @${post.author.handle}`}
              </button>
            )}
          </div>
        </details>
      </footer>
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
  const embeddedExternal = getExternalEmbed(record.embeds?.[0] ?? record.value?.embed);
  const embeddedImages = getEmbedImages(record.embeds?.[0] ?? record.value?.embed);
  const embeddedVideo = getVideoEmbed(record.embeds?.[0] ?? record.value?.embed);
  const text = record.value?.text?.trim() || "";
  const mediaWarningValues = sensitiveMediaValues([
    ...((record.labels as Array<{ val?: string }> | undefined) ?? []),
    ...(record.author?.labels ?? []),
  ]);
  const gateMedia = !showNsfw && mediaWarningValues.length > 0 && (embeddedImages.length > 0 || !!embeddedVideo) && !mediaRevealed;
  const hideMediaForSetting = !showMedia && !mediaRevealed && !gateMedia;
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

  return (
    <div className="quote-card">
      {record.author && (
        <header className="quote-header">
          <Avatar profile={record.author} />
          <button className="author-button" type="button" onClick={() => onOpenProfile?.(record.author as Profile)}>
            <strong>{displayName(record.author)}</strong>
            <span>@{record.author.handle}</span>
          </button>
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
      {gateMedia ? (
        <SensitiveMediaGate values={mediaWarningValues} onReveal={() => setMediaRevealed(true)} />
      ) : hideMediaForSetting && (embeddedImages.length > 0 || !!embeddedVideo) ? (
        <MediaHiddenButton kind={embeddedImages.length > 0 ? "image" : "video"} onReveal={() => setMediaRevealed(true)} />
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
        <a className={hideMediaForSetting && embeddedExternal.thumb ? "link-card quote-link-card no-media" : "link-card quote-link-card"} href={embeddedExternal.uri} target="_blank" rel="noreferrer">
          {embeddedExternal.thumb && !hideMediaForSetting && <img alt="" src={embeddedExternal.thumb} loading="lazy" decoding="async" />}
          <span>
            <strong>{embeddedExternal.title || embeddedExternal.uri}</strong>
            <small>{embeddedExternal.description}</small>
          </span>
        </a>
      )}
      {quotedPost && (
        <button className="quote-open-button" type="button" onClick={() => onOpenPost?.(quotedPost)}>
          Open quoted thread
        </button>
      )}
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
  onOpenImage,
  onOpenLinkPreview,
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
  onOpenImage: (image: ImageViewerState) => void;
  onOpenLinkPreview: (link: NonNullable<LinkPreviewState>) => void;
  onLoadBranch: (uri: string) => void;
  onOpenPost: (post: FeedPost) => void;
  onOpenProfile: (profile: Profile) => void;
  onToggleListPost: (listId: string, post: FeedPost) => void;
  canReply?: boolean;
  onReplied?: () => void;
}) {
  const [expandedBranches, setExpandedBranches] = useState<Record<string, boolean>>({});
  const [engagement, setEngagement] = useState<null | "reposts" | "quotes" | "likes">(null);
  const [activeReplyParentUri, setActiveReplyParentUri] = useState<string | null>(null);
  const rootPost = findFirstThreadPost(thread.node);
  const parentNodes = collectThreadParents(thread.node);
  const threadRootRef = rootPost ? replyRootRefForPost(rootPost) : null;
  const threadParts = thread.node ? buildThreadParts(thread.node) : [];

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
    <div className="thread-view">
      {rootPost && (
        <section className="thread-detail-header">
          <div>
            <span>Conversation</span>
            <h2>{displayName(rootPost.author)}</h2>
            <p>
              @{rootPost.author.handle} · {formatPostTime(rootPost.record.createdAt || rootPost.indexedAt)}
            </p>
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
              { loadingBranches, onLoadBranch, onOpenImage, onOpenPost, onOpenProfile },
              onOpenLinkPreview,
              { currentDid, localLists, onToggleListPost },
            ),
          )}
        </section>
      )}
      {threadParts.length > 1 && threadRootRef ? (
        <LongThreadCard
          parts={threadParts}
          expandedReplies={expandedBranches}
          onToggleReplies={(uri) => setExpandedBranches((current) => ({ ...current, [`part-replies:${uri}`]: !current[`part-replies:${uri}`] }))}
          onToggleBranch={(uri) => setExpandedBranches((current) => ({ ...current, [uri]: !current[uri] }))}
          handlers={{
            loadingBranches,
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
          onOpenLinkPreview={onOpenLinkPreview}
          savedState={{ currentDid, localLists, onToggleListPost }}
        />
      ) : (
        renderThreadNode(thread.node, 0, expandedBranches, (uri) =>
          setExpandedBranches((current) => ({ ...current, [uri]: !current[uri] })),
          {
            loadingBranches,
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
          onOpenLinkPreview,
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
    onLoadBranch: (uri: string) => void;
    onOpenImage: (image: ImageViewerState) => void;
    onOpenPost: (post: FeedPost) => void;
    onOpenProfile: (profile: Profile) => void;
  },
  onOpenLinkPreview: (link: NonNullable<LinkPreviewState>) => void,
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
          onOpenImage={handlers.onOpenImage}
          onOpenLinkPreview={onOpenLinkPreview}
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
  onOpenLinkPreview,
  savedState,
}: {
  parts: ThreadPart[];
  expandedReplies: Record<string, boolean>;
  onToggleReplies: (uri: string) => void;
  onToggleBranch: (uri: string) => void;
  handlers: {
    loadingBranches: Record<string, boolean>;
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
  onOpenLinkPreview: (link: NonNullable<LinkPreviewState>) => void;
  savedState: {
    currentDid?: string;
    localLists: LocalList[];
    onToggleListPost: (listId: string, post: FeedPost) => void;
  };
}) {
  const onOpenTag = useContext(TagSearchContext);
  const rootPost = parts[0].node.post;
  const firstTimeLabel = formatPostTime(rootPost.record.createdAt || rootPost.indexedAt);
  const totalReplies = parts.reduce((total, part) => total + part.replies.length, 0);

  return (
    <article className="post-card long-thread-card text-only">
      <header className="post-header">
        <Avatar profile={rootPost.author} />
        <div className="post-author-block">
          <button className="author-button" type="button" onClick={() => handlers.onOpenProfile(rootPost.author)}>
            <strong>{displayName(rootPost.author)}</strong>
          </button>
          <div className="post-byline">
            <span>@{rootPost.author.handle}</span>
            <span aria-hidden="true">·</span>
            <button
              className="post-timestamp"
              type="button"
              onClick={() => handlers.onOpenPost(rootPost)}
              title={`Open thread posted ${firstTimeLabel}`}
              aria-label={`Open thread posted ${firstTimeLabel}`}
            >
              {firstTimeLabel}
            </button>
          </div>
        </div>
      </header>
      <div className="post-badges" aria-label="Thread context">
        <span>{parts.length.toLocaleString()} part thread</span>
        <span>{totalReplies === 1 ? "1 reply" : `${totalReplies.toLocaleString()} replies`}</span>
      </div>
      <div className="long-thread-parts">
        {parts.map((part) => {
          const post = part.node.post;
          const text = post.record.text?.trim() || "";
          const replyCount = part.replies.length;
          const expanded = !!expandedReplies[`part-replies:${post.uri}`];
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
              <div className="long-thread-part-actions">
                <button type="button" onClick={() => onToggleReplies(post.uri)} disabled={replyCount === 0}>
                  {replyCount === 1 ? "1 reply to this thread post" : `${replyCount.toLocaleString()} replies to this thread post`}
                </button>
                <button
                  type="button"
                  className={handlers.activeReplyParentUri === post.uri ? "active" : ""}
                  onClick={() => handlers.onOpenReply(post)}
                  disabled={!handlers.canReply}
                >
                  <MessageCircle size={15} /> Reply
                </button>
              </div>
              {handlers.activeReplyParentUri === post.uri && (
                <ReplyComposer
                  parent={post}
                  root={handlers.threadRootRef}
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
                      onOpenLinkPreview,
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

function ReplyComposer({
  parent,
  root,
  canReply,
  onClose,
  onReplied,
}: {
  parent: FeedPost;
  root: PostRefValue;
  canReply: boolean;
  onClose: () => void;
  onReplied?: () => void;
}) {
  const [replyPosting, setReplyPosting] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  const replyDraftKey = `${replyDraftPrefix}${parent.uri}`;
  const [replyText, setReplyText] = useState("");
  const remainingReplyChars = 300 - replyText.length;

  useEffect(() => {
    setReplyText(localStorage.getItem(replyDraftKey) || "");
  }, [replyDraftKey]);

  useEffect(() => {
    if (replyText.trim()) {
      localStorage.setItem(replyDraftKey, replyText);
    } else {
      localStorage.removeItem(replyDraftKey);
    }
  }, [replyDraftKey, replyText]);

  async function handleReply() {
    if (replyPosting || !replyText.trim() || remainingReplyChars < 0) {
      return;
    }
    setReplyPosting(true);
    setReplyError(null);
    try {
      await publishPost({ text: replyText.trim(), reply: { root, parent: { uri: parent.uri, cid: parent.cid } } });
      setReplyText("");
      localStorage.removeItem(replyDraftKey);
      onClose();
      onReplied?.();
    } catch (error) {
      setReplyError(error instanceof Error ? error.message : "Could not publish reply. Try again.");
    } finally {
      setReplyPosting(false);
    }
  }

  return (
    <section className="reply-composer inline" aria-label={`Reply to ${displayName(parent.author)}`}>
      <textarea
        autoFocus
        placeholder={canReply ? `Reply to @${parent.author.handle}` : "Sign in to reply."}
        value={replyText}
        onChange={(event) => setReplyText(event.currentTarget.value)}
        disabled={!canReply || replyPosting}
      />
      {replyError && <p className="composer-error" role="alert">{replyError}</p>}
      <div className="composer-actions">
        <span className={remainingReplyChars < 0 ? "over-limit" : ""}>{remainingReplyChars}</span>
        <button type="button" onClick={onClose} disabled={replyPosting}>
          Cancel
        </button>
        <button
          type="button"
          onClick={handleReply}
          disabled={!canReply || replyPosting || remainingReplyChars < 0 || replyText.trim().length === 0}
        >
          {replyPosting ? "Replying..." : "Reply"}
        </button>
      </div>
    </section>
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
  const clearSelection = useCallback(() => {
    window.getSelection()?.removeAllRanges();
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
      className="image-viewer"
      role="dialog"
      aria-modal="true"
      aria-label="Image viewer"
      onPointerDown={clearSelection}
      onMouseDown={clearSelection}
      onMouseUp={clearSelection}
      onSelect={clearSelection}
      onDragStart={(event) => {
        event.preventDefault();
        clearSelection();
      }}
      onClick={(event) => {
        clearSelection();
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
      <button
        className="image-viewer-close"
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
        aria-label="Close image viewer"
      >
        <X size={22} />
      </button>
      {hasMultiple && (
        <>
          <button
            className="image-viewer-nav previous"
            type="button"
            onMouseDown={(event) => {
              event.preventDefault();
              clearSelection();
            }}
            onClick={(event) => {
              event.stopPropagation();
              goPrevious();
              event.currentTarget.blur();
            }}
            aria-label="Previous image"
          >
            <ChevronLeft size={30} />
          </button>
          <button
            className="image-viewer-nav next"
            type="button"
            onMouseDown={(event) => {
              event.preventDefault();
              clearSelection();
            }}
            onClick={(event) => {
              event.stopPropagation();
              goNext();
              event.currentTarget.blur();
            }}
            aria-label="Next image"
          >
            <ChevronRight size={30} />
          </button>
          <div className="image-viewer-count">
            {image.index + 1} / {image.images.length}
          </div>
        </>
      )}
      <img
        src={selected.src}
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
      />
      <div className="image-viewer-footer" onClick={(event) => event.stopPropagation()}>
        <div>
          <strong>{hasMultiple ? `Image ${image.index + 1} of ${image.images.length}` : "Image"}</strong>
          <span>{selected.alt || "No alt text provided."}</span>
        </div>
        <a href={selected.src} target="_blank" rel="noreferrer">
          <LinkIcon size={15} /> Open original
        </a>
      </div>
      {hasMultiple && (
        <div className="image-viewer-thumbs" onClick={(event) => event.stopPropagation()}>
          {image.images.map((thumb, index) => (
            <button
              className={index === image.index ? "selected" : ""}
              key={`${thumb.src}:${index}`}
              type="button"
              onClick={() => onChange({ images: image.images, index })}
              aria-label={`Open image ${index + 1}`}
            >
              <img src={thumb.src} alt="" draggable={false} />
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
  onOpenLinkPreview: (link: NonNullable<LinkPreviewState>) => void,
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
  const knownReplyCount = node.post.replyCount ?? 0;
  const hasUnloadedReplies = knownReplyCount > replies.length;
  const isLoadingBranch = !!handlers.loadingBranches[node.post.uri];

  return (
    <div className="thread-node" key={node.post.uri} style={threadDepthStyle(depth)}>
      <PostCard
        item={{ post: node.post }}
        currentDid={savedState.currentDid}
        onOpenImage={handlers.onOpenImage}
        onOpenLinkPreview={onOpenLinkPreview}
        onOpenPost={handlers.onOpenPost}
        onOpenProfile={handlers.onOpenProfile}
        onReply={handlers.canReply ? handlers.onOpenReply : undefined}
        replyActive={handlers.activeReplyParentUri === node.post.uri}
        localLists={savedState.localLists}
        onToggleListPost={savedState.onToggleListPost}
      />
      {handlers.activeReplyParentUri === node.post.uri && handlers.threadRootRef && (
        <ReplyComposer
          parent={node.post}
          root={handlers.threadRootRef}
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
          {renderThreadNode(continuationReply, depth + 1, expandedBranches, onToggleBranch, handlers, onOpenLinkPreview, savedState, (opPartIndex ?? 1) + 1)}
        </>
      )}
      {visibleReplies.length > 0 && (
        <div className="thread-replies-divider" style={threadDepthStyle(depth + 1)}>
          <span>{opPartIndex ? `Replies to post ${opPartIndex}` : "Replies"}</span>
        </div>
      )}
      {visibleReplies.map((reply) =>
        renderThreadNode(reply, depth + 1, expandedBranches, onToggleBranch, handlers, onOpenLinkPreview, savedState),
      )}
      {discussionReplies.length > 8 && (
        <button className="load-more branch-toggle" type="button" onClick={() => onToggleBranch(node.post.uri)}>
          {isExpanded ? "Show fewer replies" : `Show ${hiddenReplyCount} more replies`}
        </button>
      )}
      {hasUnloadedReplies && (
        <button
          className="load-more branch-toggle"
          type="button"
          disabled={isLoadingBranch}
          onClick={() => handlers.onLoadBranch(node.post.uri)}
        >
          {isLoadingBranch ? "Loading branch" : `Load ${knownReplyCount - replies.length} more from Bluesky`}
        </button>
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

function LinkPreviewPanel({
  preview,
  onClose,
  onOpenPost,
}: {
  preview: LinkPreviewState;
  onClose: () => void;
  onOpenPost: (post: FeedPost) => void;
}) {
  if (!preview) {
    return null;
  }

  let hostname = "Link";
  try {
    hostname = preview.uri ? new URL(preview.uri).hostname : "Link";
  } catch {
    hostname = preview.uri;
  }

  return (
    <section className="context-panel link-preview-panel">
      <div className="context-panel-header">
        <h2>Link Preview</h2>
        <button type="button" onClick={onClose} aria-label="Close link preview">
          <X size={14} />
        </button>
      </div>
      {preview.thumb && <img src={preview.thumb} alt="" loading="lazy" decoding="async" />}
      <strong>{preview.title || preview.uri}</strong>
      <small>{hostname}</small>
      {preview.description && <p>{preview.description}</p>}
      <a href={preview.uri} target="_blank" rel="noreferrer">
        Open link
      </a>
      {preview.sourcePost && (
        <button type="button" onClick={() => onOpenPost(preview.sourcePost as FeedPost)}>
          Open source post
        </button>
      )}
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
    if (!el) {
      setVisible(false);
      return;
    }
    const onScroll = () => setVisible(el.scrollTop > 600);
    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [containerRef, watchKey]);
  if (!visible) {
    return null;
  }
  return (
    <button
      type="button"
      className="back-to-top"
      onClick={() => containerRef.current?.scrollTo({ top: 0, behavior: "smooth" })}
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
