import {
  Bell,
  Bookmark,
  Compass,
  Feather,
  Film,
  Hash,
  Home,
  Image,
  LayoutList,
  Link as LinkIcon,
  List,
  Loader2,
  LogOut,
  Plus,
  X,
  ChevronLeft,
  ChevronRight,
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
import { type ReactNode, type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  getAuthorFeed,
  getLikes,
  getQuotes,
  getRepostedBy,
  getEmbedImages,
  getExternalEmbed,
  getFeed,
  getFeedGenerator,
  getPopularFeedGenerators,
  getPostThread,
  getTrendingTopics,
  getPostThreadByUri,
  getProfile,
  getRecordEmbed,
  getVideoEmbed,
  searchActors,
  searchPosts,
} from "./api";
import {
  type AuthSnapshot,
  clearOAuthSessionStorage,
  initAuthSession,
  looksLikeOAuthCallback,
  signOut,
  startSignIn,
} from "./auth";
import { getRouteState, type RouteState } from "./router";
import { displayName, feedSources, navigationItems, type FeedSource } from "./sources";

const navIcons = [Home, Compass, Bell, MessageCircle, Hash, List, Bookmark, User, Settings];

type FeedState = {
  items: FeedItem[];
  cursor?: string;
  status: "idle" | "loading" | "ready" | "error" | "rate-limit";
  error?: string;
};

type SearchState = {
  posts: FeedPost[];
  cursor?: string;
  status: "idle" | "loading" | "ready" | "error" | "rate-limit";
  error?: string;
};

type ActorSearchState = {
  actors: Profile[];
  cursor?: string;
  status: "idle" | "loading" | "ready" | "error" | "rate-limit";
  error?: string;
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
  status: "checking" | "signed-out" | "signing-in" | "signed-in" | "callback" | "error";
  session: AuthSnapshot | null;
  message?: string;
};

const densityModes = ["comfortable", "compact", "media"];
const widthModes = ["balanced", "wide", "focus"] as const;
const searchTabs = ["posts", "people", "feeds"] as const;
const profileTabs = ["posts", "replies", "media", "videos", "feeds", "lists"] as const;
const searchLanguages = [
  { label: "Any language", value: "" },
  { label: "English", value: "en" },
  { label: "Spanish", value: "es" },
  { label: "Japanese", value: "ja" },
  { label: "German", value: "de" },
  { label: "French", value: "fr" },
];
const recentStorageKey = "bigbsky:recent";
const savedPostsStorageKey = "bigbsky:saved-posts";
const composerDraftStorageKey = "bigbsky:composer-draft";
const localListsStorageKey = "bigbsky:local-lists";
const workspaceWidthStorageKey = "bigbsky:workspace-width";
const pinnedFeedsStorageKey = "bigbsky:pinned-feeds";
const pinnedFeedMetaStorageKey = "bigbsky:pinned-feed-meta";
const pinnedSearchesStorageKey = "bigbsky:pinned-searches";
const pinnedProfilesStorageKey = "bigbsky:pinned-profiles";
const pinnedNotificationsStorageKey = "bigbsky:pinned-notifications";
const collapsedFeedGroupsStorageKey = "bigbsky:collapsed-feed-groups";
const timelineScrollStorageKey = "bigbsky:timeline-scroll";
const replyDraftPrefix = "bigbsky:reply-draft:";
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

function readSavedPosts() {
  try {
    const posts = JSON.parse(localStorage.getItem(savedPostsStorageKey) || "[]") as FeedPost[];
    return Array.isArray(posts) ? posts : [];
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
      mediaSlots?: Record<string, number>;
    };
    return {
      posts: Array.isArray(draft.posts) && draft.posts.length > 0 ? draft.posts : [""],
      mediaSlots: draft.mediaSlots ?? {},
    };
  } catch {
    return { posts: [""], mediaSlots: {} };
  }
}

function readWorkspaceWidthPreference() {
  try {
    const stored = localStorage.getItem(workspaceWidthStorageKey);
    return widthModes.includes(stored as (typeof widthModes)[number]) ? (stored as (typeof widthModes)[number]) : "balanced";
  } catch {
    return "balanced";
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
    (source.group === "Core" || source.group === "Official" || source.group === "Project")
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

function rateLimitMessage(error: unknown) {
  return error instanceof Error ? error.message : "Bluesky rate limit reached.";
}

function countThreadRows(node?: ThreadNode): number {
  if (!node || !("post" in node)) {
    return 0;
  }

  return 1 + (node.replies ?? []).reduce((total, reply) => total + countThreadRows(reply), 0);
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
  const [feedSearch, setFeedSearch] = useState("");
  const [globalSearchText, setGlobalSearchText] = useState(() => {
    const initialRoute = getRouteState();
    return initialRoute.kind === "search" ? initialRoute.query || "" : "";
  });
  const [searchSort, setSearchSort] = useState<"top" | "latest">("top");
  const [searchTab, setSearchTab] = useState<(typeof searchTabs)[number]>("posts");
  const [searchLanguage, setSearchLanguage] = useState("");
  const [profileTab, setProfileTab] = useState<(typeof profileTabs)[number]>("posts");
  const [feedState, setFeedState] = useState<FeedState>(emptyFeedState);
  const [searchState, setSearchState] = useState<SearchState>(emptySearchState);
  const [actorSearchState, setActorSearchState] = useState<ActorSearchState>(emptyActorSearchState);
  const [feedSearchState, setFeedSearchState] = useState<FeedSearchState>(emptyFeedSearchState);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [feedMetadata, setFeedMetadata] = useState<FeedGeneratorView | null>(null);
  const [composerDraft, setComposerDraft] = useState(() => readComposerDraft());
  const [savedPosts, setSavedPosts] = useState<FeedPost[]>(() => readSavedPosts());
  const [localLists, setLocalLists] = useState<LocalList[]>(() => readLocalLists());
  const [imageViewer, setImageViewer] = useState<ImageViewerState>(null);
  const [linkPreview, setLinkPreview] = useState<LinkPreviewState>(null);
  const [densityByContext, setDensityByContext] = useState<Record<string, string>>(() => readDensityPreferences());
  const [workspaceWidth, setWorkspaceWidth] = useState<(typeof widthModes)[number]>(() => readWorkspaceWidthPreference());
  const [pinnedFeedMeta, setPinnedFeedMeta] = useState<FeedSource[]>(() => readPinnedFeedMeta());
  const [pinnedFeedIds, setPinnedFeedIds] = useState<string[]>(() => readPinnedFeedIds(pinnedFeedMeta));
  const [pinnedSearches, setPinnedSearches] = useState<string[]>(() => readPinnedSearches());
  const [pinnedProfiles, setPinnedProfiles] = useState<Profile[]>(() => readPinnedProfiles());
  const [pinnedNotificationIds, setPinnedNotificationIds] = useState<string[]>(() => readPinnedNotifications());
  const [collapsedFeedGroups, setCollapsedFeedGroups] = useState<Record<string, boolean>>(() => readCollapsedFeedGroups());
  const [recentItems, setRecentItems] = useState<RecentItem[]>(() => readRecentItems());
  const [devMetrics, setDevMetrics] = useState<DevMetrics>(initialDevMetrics);
  const [authState, setAuthState] = useState<AuthState>(initialAuthState);
  const [isAccountSwitcherOpen, setIsAccountSwitcherOpen] = useState(false);
  const [virtualRenderedRows, setVirtualRenderedRows] = useState(0);
  const [thread, setThread] = useState<{ status: "idle" | "loading" | "ready" | "error"; node?: ThreadNode; error?: string }>({
    status: "idle",
  });
  const [loadingThreadBranches, setLoadingThreadBranches] = useState<Record<string, boolean>>({});
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const feedCacheRef = useRef<Record<string, FeedState>>({});
  const feedMetadataCacheRef = useRef<Record<string, FeedGeneratorView>>({});
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

  const activeSource = useMemo<FeedSource>(() => {
    if (route.kind === "feed" && route.uri) {
      const known = feedSources.find((source) => source.id === route.uri || source.uri === route.uri);
      if (known) {
        return known;
      }
      if (route.uri.startsWith("at://")) {
        return {
          id: route.uri,
          uri: route.uri,
          label: "Public Feed",
          group: "Project",
          description: "Public Bluesky feed opened from discovery.",
        };
      }
    }
    return feedSources.find((source) => source.id === activeSourceId) ?? feedSources[0];
  }, [route, activeSourceId]);
  const feedRoutePath = (source: FeedSource) => `/feed/${encodeURIComponent(source.id)}`;
  const densityKey = route.kind === "feed" ? `feed:${activeSource.id}` : route.kind;
  const density = densityByContext[densityKey] || densityByContext.default || "comfortable";
  const visibleSources = useMemo(() => {
    const query = feedSearch.trim().toLowerCase();
    if (!query) {
      return feedSources;
    }

    return feedSources.filter((source) =>
      `${source.label} ${source.description} ${source.group}`.toLowerCase().includes(query),
    );
  }, [feedSearch]);
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

    return Object.fromEntries(
      Object.entries(groups).sort(([groupA], [groupB]) => {
        if (groupA === "Pinned") {
          return -1;
        }
        if (groupB === "Pinned") {
          return 1;
        }
        return groupA.localeCompare(groupB);
      }),
    ) as Record<string, FeedSource[]>;
  }, [feedSearch, pinnedSources, visibleSources]);
  const feedMapSummary = useMemo(
    () =>
      feedSources.reduce<Record<string, number>>((groups, source) => {
        groups[source.group] = (groups[source.group] ?? 0) + 1;
        return groups;
      }, {}),
    [],
  );
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
      ...savedPosts,
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
  }, [feedState.items, savedPosts, searchState.posts]);
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

    return feedState.items.filter((item) => !item.post.record.reply && !item.reply?.parent);
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
    }));

    try {
      const response = await getFeed(source.uri, cursor, signal);
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
        setFeedState((current) => ({
          ...current,
          status: isRateLimit(error) ? "rate-limit" : "error",
          error: rateLimitMessage(error),
        }));
      }
    }
  }, []);

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
    }));

    try {
      const [profileResponse, feedResponse] = await Promise.all([
        cursor ? Promise.resolve(null) : getProfile(actor, signal),
        getAuthorFeed(actor, cursor, signal),
      ]);

      if (profileResponse) {
        setProfile(profileResponse);
      }
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
    } catch (error) {
      if (!signal?.aborted) {
        setFeedState((current) => ({
          ...current,
          status: isRateLimit(error) ? "rate-limit" : "error",
          error: rateLimitMessage(error),
        }));
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
    }));

    try {
      const response: SearchPostsResponse = await searchPosts(query, sort, lang || undefined, cursor, signal);
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
        setSearchState((current) => ({
          ...current,
          status: isRateLimit(error) ? "rate-limit" : "error",
          error: rateLimitMessage(error),
        }));
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
        setActorSearchState((current) => ({
          ...current,
          status: isRateLimit(error) ? "rate-limit" : "error",
          error: rateLimitMessage(error),
        }));
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
      return undefined;
    }

    const cached = feedMetadataCacheRef.current[activeSource.uri];
    if (cached) {
      setDevMetrics((current) => ({ ...current, cacheHits: current.cacheHits + 1 }));
      setFeedMetadata(cached);
      return undefined;
    }

    const controller = new AbortController();
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
    getPostThread(route.actor, route.rkey, controller.signal)
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
    getPostThreadByUri(uri)
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
    setWorkspaceWidth(nextWidth);
    localStorage.setItem(workspaceWidthStorageKey, nextWidth);
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
    setWorkspaceWidth("balanced");
    setRecentItems([]);
    setComposerDraft({ posts: [""], mediaSlots: {} });
    setSavedPosts([]);
    setLocalLists([]);
    setPinnedFeedIds([]);
    setPinnedSearches([]);
    setPinnedProfiles([]);
    setPinnedNotificationIds([]);
    setCollapsedFeedGroups({});
    feedCacheRef.current = {};
    feedMetadataCacheRef.current = {};
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
    setIsAccountSwitcherOpen(false);
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
    setAuthState((current) => ({ ...current, status: "signing-in", message: "Signing out locally." }));
    setIsAccountSwitcherOpen(false);
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

  function toggleSavedPost(post: FeedPost) {
    setSavedPosts((current) => {
      const exists = current.some((savedPost) => savedPost.uri === post.uri);
      const next = exists ? current.filter((savedPost) => savedPost.uri !== post.uri) : [post, ...current].slice(0, 100);
      localStorage.setItem(savedPostsStorageKey, JSON.stringify(next));
      return next;
    });
  }

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
    if (item === "Home") {
      const source = feedSources[0];
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

    if (item === "Profile" && authState.session) {
      openProfile(authState.session);
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
  const workspaceLabel =
    route.kind === "post"
      ? "Thread"
      : route.kind === "search"
        ? "Search"
        : route.kind === "surface"
          ? "Signed-In Surface"
          : isProfileRoute
            ? "Profile Feed"
            : "Active Feed";
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
        : route.kind === "surface" && (route.name === "saved" || route.name === "lists")
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
  const savedUriSet = new Set(savedPosts.map((post) => post.uri));

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

  return (
    <div className={`app-shell width-${workspaceWidth}`}>
      <aside className="left-rail" aria-label="Primary">
        <button className="brand-button" type="button" onClick={() => navigate({ kind: "feed" })} title="BigBSky">
          <Feather size={22} />
        </button>
        <nav className="rail-nav">
          {navigationItems.map((item, index) => {
            const Icon = navIcons[index];
            return (
              <button key={item} className="rail-button" type="button" title={item} onClick={() => openNavigation(item)}>
                <Icon size={20} />
                <span>{item}</span>
              </button>
            );
          })}
        </nav>
        {authState.session && (
          <div className="rail-account" aria-label="Signed-in account">
            <button
              type="button"
              title={`Account: @${authState.session.handle}`}
              aria-expanded={isAccountSwitcherOpen}
              onClick={() => setIsAccountSwitcherOpen((isOpen) => !isOpen)}
            >
              <Avatar profile={authState.session} />
            </button>
            {isAccountSwitcherOpen && (
              <div className="account-switcher" role="menu" aria-label="Account switcher">
                <div className="account-identity">
                  <Avatar profile={authState.session} />
                  <span>
                    <strong>{authState.session.displayName || authState.session.handle}</strong>
                    <small>@{authState.session.handle}</small>
                  </span>
                </div>
                <div className="account-switcher-actions">
                  <button
                    type="button"
                    onClick={() => {
                      setIsAccountSwitcherOpen(false);
                      openProfile(authState.session as Profile);
                    }}
                  >
                    <User size={15} />
                    Open profile
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsAccountSwitcherOpen(false);
                      openNavigation("Settings");
                    }}
                  >
                    <Settings size={15} />
                    Account settings
                  </button>
                  <button type="button" onClick={handleSignOut}>
                    <LogOut size={15} />
                    Sign out
                  </button>
                </div>
                <div className="account-switcher-add">
                  <span>
                    <Plus size={14} />
                    Add or switch account
                  </span>
                  <SignInForm status={authState.status} onSignIn={handleSignIn} />
                </div>
              </div>
            )}
          </div>
        )}
        <button className="compose-button" type="button" title="New post">
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
              sources?.map((source) => (
                <div className="feed-source-row" key={`${group}:${source.id}`}>
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
              ))}
          </section>
        ))}
      </aside>

      <main className="workspace">
        <header className="workspace-header">
          <div>
            <p>{workspaceLabel}</p>
            <h1>{workspaceTitle}</h1>
          </div>
          <div className="header-controls">
            <div className="segmented" aria-label="Density">
              {densityModes.map((mode) => (
                <button
                  className={density === mode ? "selected" : ""}
                  key={mode}
                  type="button"
                  onClick={() => updateDensity(mode)}
                >
                  {mode}
                </button>
              ))}
            </div>
            <div className="segmented compact-segmented" aria-label="Feed width">
              {widthModes.map((mode) => (
                <button
                  className={workspaceWidth === mode ? "selected" : ""}
                  key={mode}
                  type="button"
                  onClick={() => updateWorkspaceWidth(mode)}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>
        </header>

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
            onToggleSaved={toggleSavedPost}
            savedUris={savedUriSet}
            localLists={localLists}
            onToggleListPost={togglePostInLocalList}
          />
        ) : route.kind === "surface" && route.name === "saved" ? (
          <SavedPostsView
            posts={savedPosts}
            savedUris={savedUriSet}
            currentDid={authState.session?.did}
            onOpenImage={setImageViewer}
            onOpenPost={openPost}
            onOpenProfile={openProfile}
            onOpenLinkPreview={openLinkPreview}
            onToggleSaved={toggleSavedPost}
            localLists={localLists}
            onToggleListPost={togglePostInLocalList}
          />
        ) : route.kind === "surface" ? (
          <SurfaceView
            auth={authState}
            name={route.name}
            density={density}
            recentCount={recentItems.length}
            savedPostCount={savedPosts.length}
            savedPreferenceCount={Object.keys(densityByContext).length}
            localDataKeyCount={countBigbskyLocalKeys()}
            localLists={localLists}
            pinnedFeedCount={pinnedFeedIds.length}
            pinnedFeedIds={pinnedFeedIds}
            pinnedNotificationCount={pinnedNotificationIds.length}
            pinnedNotificationIds={pinnedNotificationIds}
            pinnedProfileCount={pinnedProfiles.length}
            pinnedSearchCount={pinnedSearches.length}
            workspaceWidth={workspaceWidth}
            onClearLocalData={clearLocalReaderData}
            onCreateLocalList={createLocalList}
            onDeleteLocalList={deleteLocalList}
            onToggleListPost={togglePostInLocalList}
            onOpenFeed={openFeedSource}
            onOpenProfile={openProfile}
            onOpenSearch={() => navigate({ kind: "search" }, "/search")}
            onOpenSearchQuery={submitSearch}
            onSignIn={handleSignIn}
            onSignOut={handleSignOut}
            onTogglePinnedFeed={togglePinnedFeed}
            onWorkspaceWidthChange={updateWorkspaceWidth}
            currentDid={authState.session?.did}
            savedUris={savedUriSet}
            onOpenImage={setImageViewer}
            onOpenPost={openPost}
            onOpenLinkPreview={openLinkPreview}
            onToggleSaved={toggleSavedPost}
            onTogglePinnedNotification={togglePinnedNotification}
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
            savedUris={savedUriSet}
            onToggleSaved={toggleSavedPost}
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
              selectedTab={profileTab}
              onSelectTab={setProfileTab}
              onTogglePinned={togglePinnedProfile}
            />
            {profileTab === "feeds" ? (
              <ProfileFeedsTab
                actor={route.actor}
                pinnedFeedIds={pinnedFeedIds}
                onOpenFeed={openFeedSource}
                onTogglePinnedFeed={togglePinnedFeed}
              />
            ) : profileTab === "lists" ? (
              <ProfileListsTab actor={route.actor} />
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
                    onOpenImage={setImageViewer}
                    onOpenPost={openPost}
                    onOpenProfile={openProfile}
                    onOpenLinkPreview={openLinkPreview}
                    savedUris={savedUriSet}
                    currentDid={authState.session?.did}
                    onToggleSaved={toggleSavedPost}
                    localLists={localLists}
                    onToggleListPost={togglePostInLocalList}
                    onRenderedRowsChange={setVirtualRenderedRows}
                  >
                    {feedState.cursor && <AutoLoadMoreButton label="Load more profile posts" onLoadMore={loadMore} />}
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
            <Composer
              draft={composerDraft}
              onDraftChange={setComposerDraft}
            />
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
                savedUris={savedUriSet}
                currentDid={authState.session?.did}
                onToggleSaved={toggleSavedPost}
                localLists={localLists}
                onToggleListPost={togglePostInLocalList}
                onRenderedRowsChange={setVirtualRenderedRows}
              >
                {feedState.cursor && <AutoLoadMoreButton label="Load more feed posts" onLoadMore={loadMore} />}
              </VirtualPostList>
            )}
          </div>
        )}
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
            entityCache={entityCache}
            isPinned={pinnedFeedIds.includes(activeSource.id)}
            onTogglePinned={togglePinnedFeed}
          />
        )}
        <FeedMapPanel groups={feedMapSummary} />
        <PinnedSearchesPanel searches={pinnedSearches} onOpen={submitSearch} onToggle={togglePinnedSearch} />
        <PinnedProfilesPanel profiles={pinnedProfiles} onOpen={openProfile} onToggle={togglePinnedProfile} />
        <LinkPreviewPanel
          preview={linkPreview}
          onClose={() => setLinkPreview(null)}
          onOpenPost={openPost}
        />
        <RecentPanel
          items={recentItems}
          onOpen={(item) => {
            if (item.sourceId) {
              setActiveSourceId(item.sourceId);
            }
            navigate(item.route, item.path);
          }}
        />
        <section className="context-panel">
          <h2>Build Posture</h2>
          <p>Static SPA. No Pages Functions, Workers, bindings, KV, D1, R2, or backend sessions for v1.</p>
        </section>
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
        <section className="context-panel">
          <h2>Trending</h2>
          {trendingTopics.length > 0 ? (
            trendingTopics.map((topic) => (
              <button key={topic.tag} type="button" onClick={() => submitSearch(topic.tag)}>
                <span>{topic.tag}</span>
                <small>{topic.count.toLocaleString()}</small>
              </button>
            ))
          ) : (
            <>
              <button type="button" onClick={() => submitSearch("#atproto")}>
                #atproto
              </button>
              <button type="button" onClick={() => submitSearch("#bluesky")}>
                #bluesky
              </button>
              <button type="button" onClick={() => submitSearch("#socialweb")}>
                #socialweb
              </button>
            </>
          )}
        </section>
      </aside>

      {imageViewer && <ImageViewer image={imageViewer} onChange={setImageViewer} onClose={() => setImageViewer(null)} />}
    </div>
  );
}

function VirtualPostList({
  children,
  containerRef,
  currentDid,
  density,
  items,
  localLists,
  onOpenImage,
  onOpenLinkPreview,
  onOpenPost,
  onOpenProfile,
  onToggleListPost,
  onToggleSaved,
  onRenderedRowsChange,
  savedUris,
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
  onToggleSaved: (post: FeedPost) => void;
  onRenderedRowsChange: (count: number) => void;
  savedUris: Set<string>;
}) {
  const defaultRowHeight = density === "compact" ? 190 : density === "media" ? 360 : 260;
  const overscanPixels = defaultRowHeight * 3;
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(720);
  const [rowHeights, setRowHeights] = useState<Record<string, number>>({});
  const rowOffsets = useMemo(() => {
    let offset = 0;
    return items.map((item) => {
      const top = offset;
      offset += rowHeights[item.post.uri] ?? defaultRowHeight;
      return top;
    });
  }, [defaultRowHeight, items, rowHeights]);
  const totalHeight = useMemo(
    () => items.reduce((total, item) => total + (rowHeights[item.post.uri] ?? defaultRowHeight), 0),
    [defaultRowHeight, items, rowHeights],
  );
  const findRowIndex = useCallback(
    (targetOffset: number) => {
      let low = 0;
      let high = items.length - 1;
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
    [items.length, rowOffsets],
  );
  const startIndex = items.length > 0 ? findRowIndex(Math.max(0, scrollTop - overscanPixels)) : 0;
  const endIndex =
    items.length > 0 ? Math.min(items.length - 1, findRowIndex(scrollTop + viewportHeight + overscanPixels) + 1) : -1;
  const visibleItems = endIndex >= startIndex ? items.slice(startIndex, endIndex + 1) : [];
  const topSpacerHeight = rowOffsets[startIndex] ?? 0;
  const renderedHeight = visibleItems.reduce((total, item) => total + (rowHeights[item.post.uri] ?? defaultRowHeight), 0);
  const bottomSpacerHeight = Math.max(0, totalHeight - topSpacerHeight - renderedHeight);

  useEffect(() => {
    setRowHeights((current) => {
      const next = Object.fromEntries(items.map((item) => [item.post.uri, current[item.post.uri]]).filter(([, height]) => !!height));
      return Object.keys(next).length === Object.keys(current).length ? current : (next as Record<string, number>);
    });
  }, [items]);

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
      {visibleItems.map((item) => (
        <MeasuredPostRow
          item={item}
          key={item.post.uri}
          onMeasured={(height) => {
            setRowHeights((current) => {
              const previousHeight = current[item.post.uri] ?? defaultRowHeight;
              if (previousHeight === height) {
                return current;
              }

              const rowIndex = items.findIndex((candidate) => candidate.post.uri === item.post.uri);
              const rowTop = rowIndex >= 0 ? rowOffsets[rowIndex] ?? 0 : 0;
              const container = containerRef.current;
              if (container && rowTop + previousHeight <= container.scrollTop) {
                container.scrollTop += height - previousHeight;
              }

              return { ...current, [item.post.uri]: height };
            });
          }}
        >
          <PostCard
            item={item}
            currentDid={currentDid}
            onOpenImage={onOpenImage}
            onOpenLinkPreview={onOpenLinkPreview}
            onOpenPost={onOpenPost}
            onOpenProfile={onOpenProfile}
            isSaved={savedUris.has(item.post.uri)}
            onToggleSaved={onToggleSaved}
            localLists={localLists}
            onToggleListPost={onToggleListPost}
          />
        </MeasuredPostRow>
      ))}
      {bottomSpacerHeight > 0 && <div className="virtual-spacer" style={{ height: bottomSpacerHeight }} />}
      {children}
    </div>
  );
}

function AutoLoadMoreButton({ label, onLoadMore }: { label: string; onLoadMore: () => void }) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const cooldownRef = useRef(false);

  useEffect(() => {
    const button = buttonRef.current;
    if (!button || !("IntersectionObserver" in window)) {
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
      { root: null, rootMargin: "640px 0px 640px 0px" },
    );

    observer.observe(button);
    return () => observer.disconnect();
  }, [onLoadMore]);

  return (
    <button className="load-more" ref={buttonRef} type="button" onClick={onLoadMore}>
      {label}
    </button>
  );
}

function MeasuredPostRow({
  children,
  item,
  onMeasured,
}: {
  children: React.ReactNode;
  item: FeedItem;
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
  }, [item.post.uri, onMeasured]);

  return (
    <div className="virtual-row" ref={rowRef}>
      {children}
    </div>
  );
}

function SurfaceView({
  auth,
  name,
  density,
  recentCount,
  savedPostCount,
  savedPreferenceCount,
  localDataKeyCount,
  localLists,
  pinnedFeedCount,
  pinnedFeedIds,
  pinnedNotificationCount,
  pinnedNotificationIds,
  pinnedProfileCount,
  pinnedSearchCount,
  workspaceWidth,
  onClearLocalData,
  onCreateLocalList,
  onDeleteLocalList,
  onToggleListPost,
  onOpenFeed,
  onOpenImage,
  onOpenLinkPreview,
  onOpenProfile,
  onOpenPost,
  onOpenSearch,
  onOpenSearchQuery,
  onSignIn,
  onSignOut,
  onToggleSaved,
  onTogglePinnedFeed,
  onTogglePinnedNotification,
  onWorkspaceWidthChange,
  currentDid,
  savedUris,
}: {
  auth: AuthState;
  name: string;
  density: string;
  recentCount: number;
  savedPostCount: number;
  savedPreferenceCount: number;
  localDataKeyCount: number;
  localLists: LocalList[];
  pinnedFeedCount: number;
  pinnedFeedIds: string[];
  pinnedNotificationCount: number;
  pinnedNotificationIds: string[];
  pinnedProfileCount: number;
  pinnedSearchCount: number;
  workspaceWidth: (typeof widthModes)[number];
  onClearLocalData: () => void | Promise<void>;
  onCreateLocalList: (name: string, description: string) => void;
  onDeleteLocalList: (id: string) => void;
  onToggleListPost: (listId: string, post: FeedPost) => void;
  onOpenFeed: (source: FeedSource) => void;
  onOpenImage: (image: ImageViewerState) => void;
  onOpenLinkPreview: (link: NonNullable<LinkPreviewState>) => void;
  onOpenProfile: (profile: Profile) => void;
  onOpenPost: (post: FeedPost) => void;
  onOpenSearch: () => void;
  onOpenSearchQuery: (query: string) => void;
  onSignIn: (handle: string) => void | Promise<void>;
  onSignOut: () => void | Promise<void>;
  onToggleSaved: (post: FeedPost) => void;
  onTogglePinnedFeed: (source: FeedSource) => void;
  onTogglePinnedNotification: (id: string) => void;
  onWorkspaceWidthChange: (width: (typeof widthModes)[number]) => void;
  currentDid?: string;
  savedUris: Set<string>;
}) {
  const title = name.charAt(0).toUpperCase() + name.slice(1);
  const surfaces: Record<string, { copy: string; cards: Array<{ title: string; detail: string; status: string }> }> = {
    chat: {
      copy: "Direct messages stay deferred until the API and privacy posture are handled.",
      cards: [
        { title: "Requests", detail: "Signed-in message requests belong here once DM support is safe.", status: "Deferred" },
        { title: "Inbox", detail: "The shell reserves a message list without storing conversations on BigBSky.", status: "OAuth later" },
        { title: "New chat", detail: "Composer entry point remains disabled until private-message scopes are settled.", status: "Blocked" },
      ],
    },
    explore: {
      copy: "Explore is the public discovery doorway for search, trending topics, people, and Feed discovery while signed-in recommendations wait on OAuth.",
      cards: [
        { title: "Search", detail: "Public post, profile, and local Feed search is available now.", status: "Active" },
        { title: "Trending", detail: "The right rail keeps lightweight topic entry points visible.", status: "Static" },
        { title: "Discover Feeds", detail: "Local Feed destinations are grouped and searchable without a horizontal tab strip.", status: "Active" },
      ],
    },
    feeds: {
      copy: "Feeds are available in the desktop selector now. Local pins can keep important destinations at the top while signed-in feed sync waits for OAuth.",
      cards: [
        { title: "Pinned Feeds", detail: "Pins are stored only in this browser and reflected in the selector.", status: "Local" },
        { title: "Discover New Feeds", detail: "Feed search can open known public Feed sources immediately.", status: "Active" },
        { title: "Edit My Feeds", detail: "Account-backed pin and ordering controls wait for OAuth.", status: "Pending" },
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
      copy: "Notifications has a local inbox now so account state, saved-post activity, and draft state have a stable destination before OAuth reads are added.",
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
        ? "Self-profile is attached to the restored OAuth identity. Public posts open in the profile reader while account-only tabs are staged as account-aware panels."
        : "Self-profile needs OAuth before edit controls, likes, feeds, starter packs, and lists can be shown.",
      cards: [
        { title: "Posts", detail: "Signed-in users can open their public profile feed from this surface.", status: auth.session ? "Active" : "OAuth later" },
        { title: "Likes", detail: "Self-only liked-post reads need authenticated account context.", status: "OAuth later" },
        { title: "Edit Profile", detail: "Write scopes and local session handling are required first.", status: "Pending" },
      ],
    },
    saved: {
      copy: "Saved posts need authenticated reads and account-aware rendering.",
      cards: [
        { title: "Saved Timeline", detail: "A stable destination exists for saved-post reads.", status: "OAuth later" },
        { title: "Empty State", detail: "The route can show account-specific saved-state once signed in.", status: "Ready" },
        { title: "Go Home", detail: "Saved can route back to the active reader without a document reload.", status: "Ready" },
      ],
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
            <p>Density is stored locally per Feed or surface and applied before timeline rows paint.</p>
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
            <p>Feed width is stored locally and changes how much desktop space the reader claims from side context.</p>
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
                <dt>Saved posts</dt>
                <dd>{savedPostCount.toLocaleString()}</dd>
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
          <article className="settings-panel">
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
    return (
      <NotificationsSurface
        auth={auth}
        savedPostCount={savedPostCount}
        pinnedFeedCount={pinnedFeedCount}
        pinnedNotificationIds={pinnedNotificationIds}
        pinnedProfileCount={pinnedProfileCount}
        pinnedSearchCount={pinnedSearchCount}
        localListCount={localLists.length}
        onOpenSearch={onOpenSearch}
        onTogglePinnedNotification={onTogglePinnedNotification}
      />
    );
  }

  if (name === "lists") {
    return (
      <ListsSurface
        lists={localLists}
        currentDid={currentDid}
        savedUris={savedUris}
        onCreateList={onCreateLocalList}
        onDeleteList={onDeleteLocalList}
        onToggleListPost={onToggleListPost}
        onOpenImage={onOpenImage}
        onOpenLinkPreview={onOpenLinkPreview}
        onOpenPost={onOpenPost}
        onOpenProfile={onOpenProfile}
        onToggleSaved={onToggleSaved}
      />
    );
  }

  if (name === "profile" && auth.session) {
    return (
      <SelfProfileSurface
        auth={auth.session}
        localLists={localLists}
        pinnedFeedCount={pinnedFeedCount}
        savedPostCount={savedPostCount}
        onOpenProfile={onOpenProfile}
        onSignOut={onSignOut}
      />
    );
  }

  return (
    <div className="timeline comfortable">
      <section className="surface-placeholder">
        <h2>{title}</h2>
        <p>{surface.copy}</p>
        {name === "explore" && (
          <a className="surface-action" href="/search" onClick={(event) => {
            event.preventDefault();
            onOpenSearch();
          }}>
            Open search
          </a>
        )}
      </section>
      {name === "explore" && <ExploreTrendingTopics onOpenSearchQuery={onOpenSearchQuery} />}
      {name === "explore" && (
        <ExploreDiscoverFeeds
          onOpenFeed={onOpenFeed}
          pinnedFeedIds={pinnedFeedIds}
          onTogglePinnedFeed={onTogglePinnedFeed}
        />
      )}
      {name === "feeds" && (
        <section className="feed-directory-grid" aria-label="Known Feed destinations">
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
        </section>
      )}
      <section className="surface-grid" aria-label={`${title} sections`}>
        {surface.cards.map((card) => (
          <article className="surface-card" key={card.title}>
            <span>{card.status}</span>
            <h3>{card.title}</h3>
            <p>{card.detail}</p>
          </article>
        ))}
      </section>
    </div>
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
}: {
  onOpenFeed: (source: FeedSource) => void;
  pinnedFeedIds: string[];
  onTogglePinnedFeed: (source: FeedSource) => void;
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
}: {
  feed: FeedGeneratorView;
  isPinned: boolean;
  onOpenFeed: (source: FeedSource) => void;
  onTogglePinnedFeed: (source: FeedSource) => void;
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
    group: "Project",
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

function ProfileListsTab({ actor }: { actor: string }) {
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
            return (
              <article className="discover-feed-card" key={list.uri}>
                <div className="discover-feed-open">
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
                </div>
                <div className="discover-feed-actions">
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
  localLists,
  pinnedFeedCount,
  savedPostCount,
  onOpenProfile,
  onSignOut,
}: {
  auth: AuthSnapshot;
  localLists: LocalList[];
  pinnedFeedCount: number;
  savedPostCount: number;
  onOpenProfile: (profile: Profile) => void;
  onSignOut: () => void | Promise<void>;
}) {
  const accountPanels = [
    {
      title: "Posts",
      status: "Active",
      detail: "Open the signed-in public profile reader without leaving the static shell.",
      action: "Open public profile",
      disabled: false,
    },
    {
      title: "Replies",
      status: "Active",
      detail: "The public profile reader includes the replies tab over loaded author posts.",
      action: "Open profile reader",
      disabled: false,
    },
    {
      title: "Media",
      status: "Active",
      detail: "The public profile reader can filter loaded posts to images and video cards.",
      action: "Open profile reader",
      disabled: false,
    },
    {
      title: "Likes",
      status: "OAuth later",
      detail: `${savedPostCount.toLocaleString()} browser-local saved post${savedPostCount === 1 ? "" : "s"} are available now; Bluesky likes need authenticated reads.`,
      action: "Needs account read",
      disabled: true,
    },
    {
      title: "Feeds",
      status: "Local",
      detail: `${pinnedFeedCount.toLocaleString()} pinned Feed${pinnedFeedCount === 1 ? "" : "s"} are stored in this browser until account-backed Feed sync is added.`,
      action: "Use Feed selector",
      disabled: true,
    },
    {
      title: "Starter Packs",
      status: "Reserved",
      detail: "Starter Pack ownership and management are reserved for authenticated account APIs.",
      action: "Needs account API",
      disabled: true,
    },
    {
      title: "Lists",
      status: "Local",
      detail: `${localLists.length.toLocaleString()} browser-local list workspace${localLists.length === 1 ? "" : "s"} are staged for later Bluesky list sync.`,
      action: "Use Lists route",
      disabled: true,
    },
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
          <button type="button" disabled title="Edit profile requires authenticated write support">
            Edit profile
          </button>
          <button type="button" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </section>
      <section className="self-profile-tabs" aria-label="Self-profile account sections">
        {accountPanels.map((panel) => (
          <article className="self-profile-tab-card" key={panel.title}>
            <span>{panel.status}</span>
            <h3>{panel.title}</h3>
            <p>{panel.detail}</p>
            <button type="button" disabled={panel.disabled} onClick={() => onOpenProfile(auth as Profile)}>
              {panel.action}
            </button>
          </article>
        ))}
      </section>
    </div>
  );
}

function NotificationsSurface({
  auth,
  savedPostCount,
  pinnedFeedCount,
  pinnedNotificationIds,
  pinnedProfileCount,
  pinnedSearchCount,
  localListCount,
  onOpenSearch,
  onTogglePinnedNotification,
}: {
  auth: AuthState;
  savedPostCount: number;
  pinnedFeedCount: number;
  pinnedNotificationIds: string[];
  pinnedProfileCount: number;
  pinnedSearchCount: number;
  localListCount: number;
  onOpenSearch: () => void;
  onTogglePinnedNotification: (id: string) => void;
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
      id: "saved",
      title: `${savedPostCount.toLocaleString()} saved post${savedPostCount === 1 ? "" : "s"}`,
      detail: "Local saves are available in the Saved timeline and remain browser-only.",
      status: "Saved",
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
      title: `${localListCount.toLocaleString()} local list workspace${localListCount === 1 ? "" : "s"}`,
      detail: "List shells are local staging areas until authenticated list reads are added.",
      status: "Lists",
    },
  ];
  const sortedEvents = [
    ...events.filter((event) => pinnedNotificationIds.includes(event.id)),
    ...events.filter((event) => !pinnedNotificationIds.includes(event.id)),
  ];

  return (
    <div className="timeline comfortable">
      <section className="surface-placeholder">
        <h2>Notifications</h2>
        <p>Local reader events render here now. Account notifications, mentions, and follows can replace this inbox once signed-in reads are available.</p>
        <button className="surface-action" type="button" onClick={onOpenSearch}>
          Open mention search
        </button>
      </section>
      <section className="notification-tabs" aria-label="Notification filters">
        <button className="selected" type="button">
          All
        </button>
        <button type="button" onClick={onOpenSearch}>
          Mentions
        </button>
      </section>
      <section className="notification-list" aria-label="Local notifications">
        {sortedEvents.map((event) => {
          const isPinned = pinnedNotificationIds.includes(event.id);
          return (
            <article className={isPinned ? "notification-item pinned" : "notification-item"} key={event.id}>
              <span>{event.status}</span>
              <div>
                <h3>{event.title}</h3>
                <p>{event.detail}</p>
                <button type="button" onClick={() => onTogglePinnedNotification(event.id)}>
                  {isPinned ? "Unpin notification" : "Pin notification"}
                </button>
              </div>
            </article>
          );
        })}
      </section>
    </div>
  );
}

function ListsSurface({
  lists,
  currentDid,
  savedUris,
  onCreateList,
  onDeleteList,
  onToggleListPost,
  onOpenImage,
  onOpenLinkPreview,
  onOpenPost,
  onOpenProfile,
  onToggleSaved,
}: {
  lists: LocalList[];
  currentDid?: string;
  savedUris: Set<string>;
  onCreateList: (name: string, description: string) => void;
  onDeleteList: (id: string) => void;
  onToggleListPost: (listId: string, post: FeedPost) => void;
  onOpenImage: (image: ImageViewerState) => void;
  onOpenLinkPreview: (link: NonNullable<LinkPreviewState>) => void;
  onOpenPost: (post: FeedPost) => void;
  onOpenProfile: (profile: Profile) => void;
  onToggleSaved: (post: FeedPost) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedListId, setSelectedListId] = useState("");
  const selectedList = lists.find((list) => list.id === selectedListId) ?? lists[0];

  return (
    <div className="timeline comfortable">
      <section className="surface-placeholder">
        <h2>Lists</h2>
        <p>Local list workspaces reserve the desktop list index without creating remote Bluesky lists or storing anything on BigBSky servers.</p>
      </section>
      <form
        className="local-list-form"
        onSubmit={(event) => {
          event.preventDefault();
          onCreateList(name, description);
          setName("");
          setDescription("");
        }}
      >
        <input
          aria-label="List name"
          maxLength={80}
          placeholder="List name"
          value={name}
          onInput={(event) => setName(event.currentTarget.value)}
        />
        <input
          aria-label="List description"
          maxLength={180}
          placeholder="Description"
          value={description}
          onInput={(event) => setDescription(event.currentTarget.value)}
        />
        <button type="submit" disabled={!name.trim()}>
          New list
        </button>
      </form>
      {lists.length === 0 ? (
        <EmptyState title="No local lists yet" message="Create a local list workspace to stage the signed-in list surface." />
      ) : (
        <section className="local-list-grid" aria-label="Local lists">
          {lists.map((list) => (
            <article className={selectedList?.id === list.id ? "local-list-card selected" : "local-list-card"} key={list.id}>
              <span>Local</span>
              <h3>{list.name}</h3>
              <p>{list.description || "No description yet."}</p>
              <small>{(list.posts?.length ?? 0).toLocaleString()} post{list.posts?.length === 1 ? "" : "s"}</small>
              <small>Created {formatPostTime(list.createdAt)}</small>
              <div className="local-list-actions">
                <button type="button" onClick={() => setSelectedListId(list.id)}>
                  Open
                </button>
                <button type="button" onClick={() => onDeleteList(list.id)}>
                  Delete
                </button>
              </div>
            </article>
          ))}
        </section>
      )}
      {selectedList && (
        <section className="local-list-timeline" aria-label={`${selectedList.name} posts`}>
          <div className="local-list-timeline-header">
            <span>Local list timeline</span>
            <h3>{selectedList.name}</h3>
            <p>{selectedList.posts?.length ? "Posts added from loaded reader cards render here." : "Use a post card's Lists control to add loaded posts here."}</p>
          </div>
          {(selectedList.posts ?? []).length === 0 ? (
            <EmptyState title="No posts in this local list" message="Add loaded posts from any timeline post card." />
          ) : (
            selectedList.posts?.map((post) => (
              <PostCard
                currentDid={currentDid}
                isSaved={savedUris.has(post.uri)}
                item={{ post }}
                key={post.uri}
                localLists={lists}
                onOpenImage={onOpenImage}
                onOpenLinkPreview={onOpenLinkPreview}
                onOpenPost={onOpenPost}
                onOpenProfile={onOpenProfile}
                onToggleListPost={onToggleListPost}
                onToggleSaved={onToggleSaved}
              />
            ))
          )}
        </section>
      )}
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
  const isBusy = status === "checking" || status === "callback" || status === "signing-in";

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
}: {
  actor: string;
  isPinned: boolean;
  profile: Profile | null;
  selectedTab: (typeof profileTabs)[number];
  onSelectTab: (tab: (typeof profileTabs)[number]) => void;
  onTogglePinned: (profile: Profile | null | undefined) => void;
}) {
  const [copied, setCopied] = useState(false);
  const bskyUrl = `https://bsky.app/profile/${encodeURIComponent(profile?.handle || actor)}`;

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
          <button type="button" disabled title="Follow after OAuth is added">
            Follow
          </button>
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
        {profileTabs.map((tab) => (
          <button className={selectedTab === tab ? "selected" : ""} key={tab} type="button" onClick={() => onSelectTab(tab)}>
            {tab}
          </button>
        ))}
      </div>
    </section>
  );
}

function Composer({
  draft,
  onDraftChange,
}: {
  draft: { posts: string[]; mediaSlots: Record<string, number> };
  onDraftChange: (draft: { posts: string[]; mediaSlots: Record<string, number> }) => void;
}) {
  const drafts = draft.posts.length > 0 ? draft.posts : [""];
  const mediaSlots = draft.mediaSlots;
  const overLimit = drafts.some((postDraft) => postDraft.length > 300);
  const hasContent = drafts.some((postDraft) => postDraft.trim().length > 0) || Object.values(mediaSlots).some((count) => count > 0);

  useEffect(() => {
    if (hasContent) {
      localStorage.setItem(composerDraftStorageKey, JSON.stringify({ posts: drafts, mediaSlots }));
    } else {
      localStorage.removeItem(composerDraftStorageKey);
    }
  }, [drafts, hasContent, mediaSlots]);

  function setDrafts(nextPosts: string[], nextMediaSlots = mediaSlots) {
    onDraftChange({
      posts: nextPosts.length > 0 ? nextPosts : [""],
      mediaSlots: nextMediaSlots,
    });
  }

  function updateDraft(index: number, value: string) {
    setDrafts(drafts.map((postDraft, draftIndex) => (draftIndex === index ? value : postDraft)));
  }

  function removeDraft(index: number) {
    const nextMediaSlots: Record<string, number> = {};
    Object.entries(mediaSlots).forEach(([key, value]) => {
      const numericKey = Number(key);
      if (numericKey < index) {
        nextMediaSlots[numericKey] = value;
      } else if (numericKey > index) {
        nextMediaSlots[numericKey - 1] = value;
      }
    });
    setDrafts(drafts.filter((_, draftIndex) => draftIndex !== index), nextMediaSlots);
  }

  function attachImage(index: number) {
    onDraftChange({
      posts: drafts,
      mediaSlots: { ...mediaSlots, [index]: Math.min((mediaSlots[index] ?? 0) + 1, 4) },
    });
  }

  function clearDraft() {
    const emptyDraft = { posts: [""], mediaSlots: {} };
    localStorage.removeItem(composerDraftStorageKey);
    onDraftChange(emptyDraft);
  }

  return (
    <section className="composer" aria-label="Composer">
      <div className="composer-thread">
        {drafts.map((draft, index) => {
          const remainingChars = 300 - draft.length;
          return (
            <div className="composer-draft" key={index}>
              <div className="composer-draft-header">
                <span>Post {index + 1}</span>
                {index > 0 && (
                  <button type="button" title="Remove post from thread" onClick={() => removeDraft(index)}>
                    <X size={15} />
                  </button>
                )}
              </div>
              <textarea
                placeholder={index === 0 ? "What should BigBSky post after OAuth is added?" : "Continue the thread"}
                value={draft}
                onChange={(event) => updateDraft(index, event.target.value)}
              />
              {mediaSlots[index] > 0 && (
                <div className="composer-media-row" aria-label={`Post ${index + 1} attached media placeholders`}>
                  {Array.from({ length: mediaSlots[index] }).map((_, mediaIndex) => (
                    <span key={mediaIndex}>
                      <Image size={14} /> Image {mediaIndex + 1}
                    </span>
                  ))}
                </div>
              )}
              <div className="composer-actions">
                <button type="button" title="Attach image" onClick={() => attachImage(index)} disabled={(mediaSlots[index] ?? 0) >= 4}>
                  <Image size={18} />
                </button>
                <span className={remainingChars < 0 ? "over-limit" : ""}>{remainingChars}</span>
              </div>
            </div>
          );
        })}
      </div>
      <div className="composer-footer">
        <span>{hasContent ? "Draft autosaved locally" : "No local draft"}</span>
        <button type="button" onClick={() => setDrafts([...drafts, ""])} title="Add post to thread">
          <Plus size={17} /> Add post
        </button>
        <button type="button" onClick={clearDraft} disabled={!hasContent}>
          Clear draft
        </button>
        <button type="button" disabled={overLimit || !hasContent}>
          Post All
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
    </form>
  );
}

function SavedPostsView({
  currentDid,
  localLists,
  posts,
  savedUris,
  onOpenImage,
  onOpenLinkPreview,
  onOpenPost,
  onOpenProfile,
  onToggleListPost,
  onToggleSaved,
}: {
  posts: FeedPost[];
  currentDid?: string;
  localLists: LocalList[];
  savedUris: Set<string>;
  onOpenImage: (image: ImageViewerState) => void;
  onOpenLinkPreview: (link: NonNullable<LinkPreviewState>) => void;
  onOpenPost: (post: FeedPost) => void;
  onOpenProfile: (profile: Profile) => void;
  onToggleListPost: (listId: string, post: FeedPost) => void;
  onToggleSaved: (post: FeedPost) => void;
}) {
  return (
    <div className="timeline comfortable">
      <section className="surface-placeholder">
        <h2>Saved</h2>
        <p>Saved posts are stored only in this browser and can be cleared from Settings.</p>
      </section>
      {posts.length === 0 ? (
        <EmptyState title="No saved posts yet" message="Use the save action on loaded posts to build a local saved timeline." />
      ) : (
        <section className="saved-posts-list" aria-label="Saved posts">
          {posts.map((post) => (
            <PostCard
              item={{ post }}
              currentDid={currentDid}
              key={post.uri}
              isSaved={savedUris.has(post.uri)}
              onOpenImage={onOpenImage}
              onOpenLinkPreview={onOpenLinkPreview}
              onOpenPost={onOpenPost}
              onOpenProfile={onOpenProfile}
              localLists={localLists}
              onToggleListPost={onToggleListPost}
              onToggleSaved={onToggleSaved}
            />
          ))}
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
  onToggleSaved,
  query,
  searchState,
  savedUris,
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
  onToggleSaved: (post: FeedPost) => void;
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
  savedUris: Set<string>;
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
                      group: "Project",
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
              {actorSearchState.cursor && <AutoLoadMoreButton label="Load more people" onLoadMore={onLoadMore} />}
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
                  isSaved={savedUris.has(post.uri)}
                  onToggleSaved={onToggleSaved}
                />
              ))}
              {searchState.cursor && <AutoLoadMoreButton label="Load more search posts" onLoadMore={onLoadMore} />}
            </>
          )}
        </>
      )}
    </div>
  );
}

function renderRichText(text: string, facets: RichTextFacet[] | undefined, onOpenProfile?: (profile: Profile) => void): ReactNode {
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

function PostCard({
  currentDid,
  isSaved = false,
  item,
  localLists = [],
  onOpenImage,
  onOpenLinkPreview,
  onOpenPost,
  onOpenProfile,
  onToggleListPost,
  onToggleSaved,
}: {
  currentDid?: string;
  isSaved?: boolean;
  item: FeedItem;
  localLists?: LocalList[];
  onOpenImage?: (image: ImageViewerState) => void;
  onOpenLinkPreview?: (link: NonNullable<LinkPreviewState>) => void;
  onOpenPost?: (post: FeedPost) => void;
  onOpenProfile?: (profile: Profile) => void;
  onToggleListPost?: (listId: string, post: FeedPost) => void;
  onToggleSaved?: (post: FeedPost) => void;
}) {
  const post = item.post;
  const [shareState, setShareState] = useState<"idle" | "copied" | "shared" | "error">("idle");
  const images = getEmbedImages(post.embed);
  const external = getExternalEmbed(post.embed);
  const recordEmbed = getRecordEmbed(post.embed);
  const video = getVideoEmbed(post.embed);
  const text = post.record.text?.trim() || "";
  const preservesLineBreaks = text.includes("\n");
  const hasRichContent = images.length > 0 || !!external || !!recordEmbed || !!video;
  const postVariant = images.length > 0 || !!video ? "has-media" : external ? "has-link" : recordEmbed ? "has-quote" : "text-only";
  const isOwnPost = !!currentDid && post.author.did === currentDid;
  const labels = post.labels ?? [];
  const sensitiveLabels = labels.filter(isSensitiveLabel);
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
        <button className="author-button" type="button" onClick={() => onOpenProfile?.(post.author)}>
          <strong>{displayName(post.author)}</strong>
          <span>@{post.author.handle}</span>
        </button>
        <button type="button" title="More">
          <MoreHorizontal size={18} />
        </button>
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
          {renderRichText(post.record.facets?.length ? post.record.text || "" : text, post.record.facets, onOpenProfile)}
        </p>
      ) : (
        !hasRichContent && <p className="post-text muted">Post has no plain text.</p>
      )}
      {images.length > 0 && (
        <div className={`image-grid count-${Math.min(images.length, 4)}`}>
          {images.slice(0, 4).map((image, imageIndex) => (
            <button
              className="image-button"
              key={image.thumb || image.fullsize}
              type="button"
              onClick={() => {
                const viewerImages = images
                  .slice(0, 4)
                  .map((viewerImage) => ({
                    src: viewerImage.fullsize || viewerImage.thumb || "",
                    alt: viewerImage.alt || "",
                  }))
                  .filter((viewerImage) => viewerImage.src);
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
              {images.length > 4 && imageIndex === 3 && <span className="more-media-badge">+{images.length - 4}</span>}
            </button>
          ))}
        </div>
      )}
      {video && <VideoEmbedCard video={video} />}
      {external && (
        <div className="link-card">
          <a href={external.uri} target="_blank" rel="noreferrer">
            {external.thumb && <img alt="" src={external.thumb} loading="lazy" decoding="async" />}
            <span>
              <strong>{external.title || external.uri}</strong>
              <small>{external.description}</small>
            </span>
          </a>
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
        <span>
          <Bell size={16} /> {post.likeCount ?? 0}
        </span>
        <button
          className={isSaved ? "saved" : ""}
          type="button"
          onClick={() => onToggleSaved?.(post)}
          title={isSaved ? "Remove from saved" : "Save post locally"}
        >
          <Bookmark size={16} /> {isSaved ? "Saved" : "Save"}
        </button>
        <button type="button" onClick={handleShare} title="Share post">
          <Share2 size={16} /> {shareState === "copied" ? "Copied" : shareState === "shared" ? "Shared" : shareState === "error" ? "Copy failed" : "Share"}
        </button>
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
  const embeddedExternal = getExternalEmbed(record.embeds?.[0] ?? record.value?.embed);
  const embeddedImages = getEmbedImages(record.embeds?.[0] ?? record.value?.embed);
  const embeddedVideo = getVideoEmbed(record.embeds?.[0] ?? record.value?.embed);
  const text = record.value?.text?.trim() || "";
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
        <p className={text.includes("\n") ? "quote-text has-line-breaks" : "quote-text"}>{text}</p>
      ) : (
        <p className="quote-text muted">Quoted post has no plain text.</p>
      )}
      {embeddedImages.length > 0 && (
        <div className={`image-grid quote-images count-${Math.min(embeddedImages.length, 4)}`}>
          {embeddedImages.slice(0, 4).map((image) => (
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
      {embeddedExternal && (
        <a className="link-card quote-link-card" href={embeddedExternal.uri} target="_blank" rel="noreferrer">
          {embeddedExternal.thumb && <img alt="" src={embeddedExternal.thumb} loading="lazy" decoding="async" />}
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
  onToggleSaved,
  savedUris,
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
  onToggleSaved: (post: FeedPost) => void;
  savedUris: Set<string>;
}) {
  const [expandedBranches, setExpandedBranches] = useState<Record<string, boolean>>({});
  const [engagement, setEngagement] = useState<null | "reposts" | "quotes" | "likes">(null);
  const rootPost = findFirstThreadPost(thread.node);
  const parentNodes = collectThreadParents(thread.node);
  const replyDraftKey = rootPost ? `${replyDraftPrefix}${rootPost.uri}` : "";
  const [replyText, setReplyText] = useState("");
  const remainingReplyChars = 300 - replyText.length;

  useEffect(() => {
    setReplyText(replyDraftKey ? localStorage.getItem(replyDraftKey) || "" : "");
  }, [replyDraftKey]);

  useEffect(() => {
    if (!replyDraftKey) {
      return;
    }

    if (replyText.trim()) {
      localStorage.setItem(replyDraftKey, replyText);
    } else {
      localStorage.removeItem(replyDraftKey);
    }
  }, [replyDraftKey, replyText]);

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
      <section className="reply-composer" aria-label="Reply composer">
        <textarea
          placeholder="Write your reply after OAuth is added."
          value={replyText}
          onChange={(event) => setReplyText(event.currentTarget.value)}
        />
        <div className="composer-actions">
          <span className={remainingReplyChars < 0 ? "over-limit" : ""}>{remainingReplyChars}</span>
          <button type="button" disabled={remainingReplyChars < 0 || replyText.trim().length === 0}>
            Reply
          </button>
        </div>
      </section>
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
              { currentDid, localLists, onToggleListPost, onToggleSaved, savedUris },
            ),
          )}
        </section>
      )}
      {renderThreadNode(thread.node, 0, expandedBranches, (uri) =>
        setExpandedBranches((current) => ({ ...current, [uri]: !current[uri] })),
        { loadingBranches, onLoadBranch, onOpenImage, onOpenPost, onOpenProfile },
        onOpenLinkPreview,
        { currentDid, localLists, onToggleListPost, onToggleSaved, savedUris },
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
    onToggleSaved: (post: FeedPost) => void;
    savedUris: Set<string>;
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
          isSaved={savedState.savedUris.has(node.post.uri)}
          localLists={savedState.localLists}
          onToggleListPost={savedState.onToggleListPost}
          onToggleSaved={savedState.onToggleSaved}
        />
      </div>
    </div>
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
  },
  onOpenLinkPreview: (link: NonNullable<LinkPreviewState>) => void,
  savedState: {
    currentDid?: string;
    localLists: LocalList[];
    onToggleListPost: (listId: string, post: FeedPost) => void;
    onToggleSaved: (post: FeedPost) => void;
    savedUris: Set<string>;
  },
): React.ReactNode {
  if (!("post" in node)) {
    const state = threadUnavailableState(node);

    return (
      <div className={`thread-alert ${state.tone}`} style={{ marginLeft: depth * 22 }}>
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
  const visibleReplies = isExpanded ? replies : replies.slice(0, 8);
  const hiddenReplyCount = Math.max(0, replies.length - visibleReplies.length);
  const knownReplyCount = node.post.replyCount ?? 0;
  const hasUnloadedReplies = knownReplyCount > replies.length;
  const isLoadingBranch = !!handlers.loadingBranches[node.post.uri];

  return (
    <div className="thread-node" key={node.post.uri} style={{ marginLeft: depth * 22 }}>
      <PostCard
        item={{ post: node.post }}
        currentDid={savedState.currentDid}
        onOpenImage={handlers.onOpenImage}
        onOpenLinkPreview={onOpenLinkPreview}
        onOpenPost={handlers.onOpenPost}
        onOpenProfile={handlers.onOpenProfile}
        isSaved={savedState.savedUris.has(node.post.uri)}
        localLists={savedState.localLists}
        onToggleListPost={savedState.onToggleListPost}
        onToggleSaved={savedState.onToggleSaved}
      />
      {visibleReplies.map((reply) =>
        renderThreadNode(reply, depth + 1, expandedBranches, onToggleBranch, handlers, onOpenLinkPreview, savedState),
      )}
      {replies.length > 8 && (
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

function RecentPanel({ items, onOpen }: { items: RecentItem[]; onOpen: (item: RecentItem) => void }) {
  if (items.length === 0) {
    return null;
  }

  return (
    <section className="context-panel recent-panel">
      <h2>Recent</h2>
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
  entityCache,
  isPinned,
  onTogglePinned,
}: {
  source: FeedSource;
  metadata: FeedGeneratorView | null;
  entityCache: EntityCache;
  isPinned: boolean;
  onTogglePinned: (source: FeedSource) => void;
}) {
  const [copied, setCopied] = useState(false);
  const creatorHandle = metadata?.creator?.handle;
  const feedRkey = source.uri.split("/").pop();
  const bskyUrl = creatorHandle && feedRkey ? `https://bsky.app/profile/${creatorHandle}/feed/${feedRkey}` : "https://bsky.app";

  return (
    <section className="profile-panel">
      {metadata?.avatar ? (
        <img className="avatar" src={metadata.avatar} alt="" loading="lazy" />
      ) : (
        <span className="feed-glyph">
          <Hash size={22} />
        </span>
      )}
      <h2>{metadata?.displayName || source.label}</h2>
      <p>{metadata?.description || source.description}</p>
      <dl>
        <div>
          <dt>Type</dt>
          <dd>Feed</dd>
        </div>
        <div>
          <dt>Creator</dt>
          <dd>{metadata?.creator ? `@${metadata.creator.handle}` : "Public"}</dd>
        </div>
        <div>
          <dt>Likes</dt>
          <dd>{(metadata?.likeCount ?? metadata?.likedByCount)?.toLocaleString() ?? "-"}</dd>
        </div>
        <div>
          <dt>Cached posts</dt>
          <dd>{Object.keys(entityCache.posts).length.toLocaleString()}</dd>
        </div>
      </dl>
      <div className="context-actions" aria-label="Feed options">
        <button type="button" onClick={() => onTogglePinned(source)}>
          {isPinned ? "Unpin feed" : "Pin feed"}
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

function FeedMapPanel({ groups }: { groups: Record<string, number> }) {
  return (
    <section className="context-panel feed-map-panel">
      <h2>Feed Map</h2>
      {Object.entries(groups).map(([group, count]) => (
        <div key={group}>
          <span>{group}</span>
          <strong>{count}</strong>
        </div>
      ))}
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
