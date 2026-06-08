import {
  Bell,
  Bookmark,
  Compass,
  Feather,
  Film,
  Flame,
  Hash,
  Home,
  Image,
  LayoutList,
  List,
  Loader2,
  X,
  ChevronLeft,
  ChevronRight,
  MessageCircle,
  MoreHorizontal,
  Repeat2,
  Search,
  Send,
  Settings,
  User,
  Users,
} from "lucide-react";
import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ApiError,
  type ActorSearchResponse,
  type FeedItem,
  type FeedGeneratorView,
  type FeedPost,
  type Profile,
  type RecordEmbedView,
  type SearchPostsResponse,
  type ThreadNode,
  getAuthorFeed,
  getEmbedImages,
  getExternalEmbed,
  getFeed,
  getFeedGenerator,
  getPostThread,
  getProfile,
  getRecordEmbed,
  getVideoEmbed,
  searchActors,
  searchPosts,
} from "./api";
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

type ImageViewerState = {
  images: Array<{
    src: string;
    alt: string;
  }>;
  index: number;
} | null;

type RecentItem = {
  label: string;
  path: string;
  route: RouteState;
  detail: string;
  sourceId?: string;
};

type EntityCache = {
  posts: Record<string, FeedPost>;
  profiles: Record<string, Profile>;
  linkUrls: string[];
  mediaPosts: Array<{
    uri: string;
    authorHandle: string;
    thumb: string;
    alt: string;
  }>;
  smartGroups: Array<{
    key: string;
    label: string;
    count: number;
  }>;
};

type DevMetrics = {
  apiRequests: number;
  cacheHits: number;
  sameOriginRequests: number;
  runtimeWarnings: string[];
  serviceWorkerState: string;
};

const densityModes = ["comfortable", "compact", "media"];
const searchTabs = ["posts", "people", "feeds"] as const;
const searchLanguages = [
  { label: "Any language", value: "" },
  { label: "English", value: "en" },
  { label: "Spanish", value: "es" },
  { label: "Japanese", value: "ja" },
  { label: "German", value: "de" },
  { label: "French", value: "fr" },
];
const recentStorageKey = "bigbsky:recent";
const estimatedPostHeights: Record<string, number> = {
  comfortable: 310,
  compact: 238,
  media: 390,
};
const emptyFeedState: FeedState = { items: [], status: "idle" };
const emptySearchState: SearchState = { posts: [], status: "idle" };
const emptyActorSearchState: ActorSearchState = { actors: [], status: "idle" };
const initialDevMetrics: DevMetrics = {
  apiRequests: 0,
  cacheHits: 0,
  sameOriginRequests: 0,
  runtimeWarnings: [],
  serviceWorkerState: "checking",
};

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

function normalizeGroupText(text?: string) {
  return text
    ?.toLowerCase()
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[^\p{L}\p{N}#\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 96);
}

function groupLabel(key: string) {
  if (key.startsWith("link:")) {
    return `Link: ${key.slice(5)}`;
  }
  if (key.startsWith("quote:")) {
    return "Quoted post discussion";
  }
  if (key.startsWith("reply:")) {
    return "Thread activity";
  }
  return `Topic: ${key.slice(5)}`;
}

function countThreadRows(node?: ThreadNode): number {
  if (!node || !("post" in node)) {
    return 0;
  }

  return 1 + (node.replies ?? []).reduce((total, reply) => total + countThreadRows(reply), 0);
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
  const [feedState, setFeedState] = useState<FeedState>(emptyFeedState);
  const [searchState, setSearchState] = useState<SearchState>(emptySearchState);
  const [actorSearchState, setActorSearchState] = useState<ActorSearchState>(emptyActorSearchState);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [feedMetadata, setFeedMetadata] = useState<FeedGeneratorView | null>(null);
  const [composerText, setComposerText] = useState("");
  const [imageViewer, setImageViewer] = useState<ImageViewerState>(null);
  const [densityByContext, setDensityByContext] = useState<Record<string, string>>(() => readDensityPreferences());
  const [recentItems, setRecentItems] = useState<RecentItem[]>(() => readRecentItems());
  const [devMetrics, setDevMetrics] = useState<DevMetrics>(initialDevMetrics);
  const [virtualRenderedRows, setVirtualRenderedRows] = useState(0);
  const [thread, setThread] = useState<{ status: "idle" | "loading" | "ready" | "error"; node?: ThreadNode; error?: string }>({
    status: "idle",
  });
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const feedCacheRef = useRef<Record<string, FeedState>>({});
  const feedMetadataCacheRef = useRef<Record<string, FeedGeneratorView>>({});
  const profileCacheRef = useRef<Record<string, { feed: FeedState; profile: Profile | null }>>({});
  const searchCacheRef = useRef<Record<string, SearchState>>({});
  const actorSearchCacheRef = useRef<Record<string, ActorSearchState>>({});
  const threadCacheRef = useRef<Record<string, ThreadNode>>({});
  const scrollCacheRef = useRef<Record<string, number>>({});

  const routeFeedSource =
    route.kind === "feed" && route.uri ? feedSources.find((source) => source.id === route.uri || source.uri === route.uri) : undefined;
  const activeSource = routeFeedSource ?? feedSources.find((source) => source.id === activeSourceId) ?? feedSources[0];
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
  const groupedSources = useMemo(
    () =>
      visibleSources.reduce<Record<string, FeedSource[]>>((groups, source) => {
        groups[source.group] = [...(groups[source.group] ?? []), source];
        return groups;
      }, {}),
    [visibleSources],
  );
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
    const mediaPosts: EntityCache["mediaPosts"] = [];
    const groupCounts = new Map<string, number>();

    for (const post of [...feedState.items.map((item) => item.post), ...searchState.posts]) {
      posts[post.uri] = post;
      profiles[post.author.did] = post.author;
      profiles[post.author.handle] = post.author;

      const external = getExternalEmbed(post.embed);
      if (external?.uri) {
        linkUrls.push(external.uri);
        groupCounts.set(`link:${external.uri}`, (groupCounts.get(`link:${external.uri}`) ?? 0) + 1);
      }

      const record = getRecordEmbed(post.embed);
      if (record?.uri) {
        groupCounts.set(`quote:${record.uri}`, (groupCounts.get(`quote:${record.uri}`) ?? 0) + 1);
      }

      const replyRoot = feedState.items.find((item) => item.post.uri === post.uri)?.reply?.root?.uri;
      if (replyRoot) {
        groupCounts.set(`reply:${replyRoot}`, (groupCounts.get(`reply:${replyRoot}`) ?? 0) + 1);
      }

      const normalizedText = normalizeGroupText(post.record.text);
      if (normalizedText && normalizedText.length > 28) {
        groupCounts.set(`text:${normalizedText}`, (groupCounts.get(`text:${normalizedText}`) ?? 0) + 1);
      }

      const images = getEmbedImages(post.embed);
      const video = getVideoEmbed(post.embed);
      const imageThumb = images[0]?.thumb || images[0]?.fullsize;
      const videoThumb = video?.thumbnail;
      const thumb = imageThumb || videoThumb;
      if (thumb) {
        mediaPosts.push({
          uri: post.uri,
          authorHandle: post.author.handle,
          thumb,
          alt: images[0]?.alt || video?.alt || "",
        });
      }
    }

    const smartGroups = [...groupCounts.entries()]
      .filter(([, count]) => count > 1)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([key, count]) => ({ key, count, label: groupLabel(key) }));

    return { posts, profiles, linkUrls, mediaPosts: mediaPosts.slice(0, 8), smartGroups };
  }, [feedState.items, searchState.posts]);

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
      return undefined;
    }

    const controller = new AbortController();
    if (searchTab === "posts") {
      setActorSearchState(emptyActorSearchState);
      void loadSearch(route.query, searchSort, searchLanguage, undefined, controller.signal);
    } else if (searchTab === "people") {
      setSearchState(emptySearchState);
      void loadActorSearch(route.query, undefined, controller.signal);
    } else {
      setSearchState(emptySearchState);
      setActorSearchState(emptyActorSearchState);
    }
    return () => controller.abort();
  }, [loadActorSearch, loadSearch, route, searchLanguage, searchSort, searchTab]);

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

  function updateDensity(nextDensity: string) {
    const nextPreferences = {
      ...densityByContext,
      [densityKey]: nextDensity,
      default: nextDensity,
    };
    setDensityByContext(nextPreferences);
    localStorage.setItem("bigbsky:density-by-context", JSON.stringify(nextPreferences));
  }

  function remember(item: RecentItem) {
    setRecentItems((current) => {
      const next = [item, ...current.filter((existing) => existing.path !== item.path)].slice(0, 8);
      localStorage.setItem(recentStorageKey, JSON.stringify(next));
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

  const remainingChars = 300 - composerText.length;
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
  const activeScrollKey = route.kind === "profile" ? `profile:${route.actor}` : route.kind === "feed" ? `feed:${activeSource.id}` : "";
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
    timeline.addEventListener("scroll", rememberScroll, { passive: true });
    return () => {
      rememberScroll();
      timeline.removeEventListener("scroll", rememberScroll);
    };
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
    navigate({ kind: "search" }, "/search");
  };

  return (
    <div className="app-shell">
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
              {group}
              <span>{sources.length}</span>
            </h2>
            {sources?.map((source) => (
              <button
                className={source.id === activeSource.id ? "feed-source active" : "feed-source"}
                key={source.id}
                type="button"
                onClick={() => {
                  setActiveSourceId(source.id);
                  remember({
                    label: source.label,
                    detail: source.description,
                    path: feedRoutePath(source),
                    route: { kind: "feed", uri: source.id },
                    sourceId: source.id,
                  });
                  navigate({ kind: "feed", uri: source.id }, feedRoutePath(source));
                  timelineRef.current?.scrollTo({ top: 0 });
                }}
              >
                <span>{source.label}</span>
                <small>{source.description}</small>
              </button>
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
        </header>

        {route.kind === "post" ? (
          <ThreadView
            thread={thread}
            onOpenImage={setImageViewer}
            onOpenPost={openPost}
            onOpenProfile={openProfile}
          />
        ) : route.kind === "surface" ? (
          <SurfaceView name={route.name} />
        ) : route.kind === "search" ? (
          <SearchView
            actorSearchState={actorSearchState}
            feedSources={feedSources}
            language={searchLanguage}
            query={globalSearchText}
            searchState={searchState}
            sort={searchSort}
            tab={searchTab}
            onLoadMore={loadMore}
            onOpenImage={setImageViewer}
            onOpenPost={openPost}
            onOpenProfile={openProfile}
            onQueryChange={setGlobalSearchText}
            onSearch={submitSearch}
            onClearSearch={clearSearch}
            onLanguageChange={setSearchLanguage}
            onSortChange={setSearchSort}
            onTabChange={setSearchTab}
            onOpenFeed={(source) => {
              setActiveSourceId(source.id);
              remember({
                label: source.label,
                detail: source.description,
                path: feedRoutePath(source),
                route: { kind: "feed", uri: source.id },
                sourceId: source.id,
              });
              navigate({ kind: "feed", uri: source.id }, feedRoutePath(source));
            }}
          />
        ) : (
          <div
            className={`timeline ${density}`}
            ref={timelineRef}
          >
            <FeedDetailHeader source={activeSource} metadata={feedMetadata} />
            <Composer
              remainingChars={remainingChars}
              text={composerText}
              onTextChange={setComposerText}
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
                onRenderedRowsChange={setVirtualRenderedRows}
              >
                {feedState.cursor && (
                  <button className="load-more" type="button" onClick={loadMore}>
                    Load more
                  </button>
                )}
              </VirtualPostList>
            )}
          </div>
        )}
      </main>

      <aside className="right-rail" aria-label="Context">
        <SearchBox value={globalSearchText} onChange={setGlobalSearchText} onSearch={submitSearch} />
        {route.kind === "profile" ? (
          <ProfileContextPanel actor={route.actor} profile={profile ?? entityCache.profiles[route.actor] ?? null} />
        ) : (
          <FeedContextPanel source={activeSource} metadata={feedMetadata} entityCache={entityCache} />
        )}
        <FeedMapPanel groups={feedMapSummary} />
        <SmartGroupsPanel groups={entityCache.smartGroups} />
        <MediaStripPanel mediaPosts={entityCache.mediaPosts} posts={entityCache.posts} onOpenPost={openPost} />
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
          <button type="button">#atproto</button>
          <button type="button">#bluesky</button>
          <button type="button">#socialweb</button>
        </section>
      </aside>

      {imageViewer && <ImageViewer image={imageViewer} onChange={setImageViewer} onClose={() => setImageViewer(null)} />}
    </div>
  );
}

function VirtualPostList({
  children,
  containerRef,
  density,
  items,
  onOpenImage,
  onOpenPost,
  onOpenProfile,
  onRenderedRowsChange,
}: {
  children?: React.ReactNode;
  containerRef: RefObject<HTMLDivElement | null>;
  density: string;
  items: FeedItem[];
  onOpenImage: (image: ImageViewerState) => void;
  onOpenPost: (post: FeedPost) => void;
  onOpenProfile: (profile: Profile) => void;
  onRenderedRowsChange: (count: number) => void;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState({ height: 900, top: 0 });
  const estimatedHeight = estimatedPostHeights[density] ?? estimatedPostHeights.comfortable;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return undefined;
    }

    let frame = 0;
    const updateViewport = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const listTop = listRef.current?.offsetTop ?? 0;
        setViewport({
          height: container.clientHeight,
          top: Math.max(0, container.scrollTop - listTop),
        });
      });
    };

    updateViewport();
    container.addEventListener("scroll", updateViewport, { passive: true });
    window.addEventListener("resize", updateViewport);

    return () => {
      cancelAnimationFrame(frame);
      container.removeEventListener("scroll", updateViewport);
      window.removeEventListener("resize", updateViewport);
    };
  }, [containerRef, items.length]);

  const overscan = 8;
  const startIndex = Math.max(0, Math.floor(viewport.top / estimatedHeight) - overscan);
  const visibleCount = Math.ceil(viewport.height / estimatedHeight) + overscan * 2;
  const endIndex = Math.min(items.length, startIndex + visibleCount);
  const visibleItems = items.slice(startIndex, endIndex);
  const beforeHeight = startIndex * estimatedHeight;
  const afterHeight = Math.max(0, (items.length - endIndex) * estimatedHeight);

  useEffect(() => {
    onRenderedRowsChange(visibleItems.length);
  }, [onRenderedRowsChange, visibleItems.length]);

  return (
    <div className="virtual-list" ref={listRef} data-total-rows={items.length} data-rendered-rows={visibleItems.length}>
      <div style={{ height: beforeHeight }} />
      {visibleItems.map((item) => (
        <PostCard
          item={item}
          key={item.post.uri}
          onOpenImage={onOpenImage}
          onOpenPost={onOpenPost}
          onOpenProfile={onOpenProfile}
        />
      ))}
      <div style={{ height: afterHeight }} />
      {children}
    </div>
  );
}

function SurfaceView({ name }: { name: string }) {
  const title = name.charAt(0).toUpperCase() + name.slice(1);
  const copy: Record<string, string> = {
    chat: "Direct messages stay deferred until the API and privacy posture are handled.",
    explore: "Explore is the public discovery doorway for search, trending topics, people, and Feed discovery while signed-in recommendations wait on OAuth.",
    feeds: "Feeds are available in the desktop selector now. Signed-in saved feeds, pin controls, and feed editing will attach here after OAuth.",
    lists: "Lists will become timeline sources after signed-in reads are available.",
    notifications: "Notifications need OAuth, account context, and local session restore.",
    profile: "Self-profile needs OAuth before edit controls, likes, feeds, starter packs, and lists can be shown.",
    saved: "Saved posts need authenticated reads and account-aware rendering.",
    settings: "Settings will start with local preferences, sign-out, and account/session controls.",
  };

  return (
    <div className="timeline comfortable">
      <section className="surface-placeholder">
        <h2>{title}</h2>
        <p>{copy[name] || "This signed-in destination has a stable static route and is ready for OAuth-backed data."}</p>
        {name === "explore" && (
          <a className="surface-action" href="/search" onClick={(event) => {
            event.preventDefault();
            window.history.pushState(null, "", "/search");
            window.dispatchEvent(new PopStateEvent("popstate"));
          }}>
            Open search
          </a>
        )}
      </section>
    </div>
  );
}

function Composer({
  text,
  remainingChars,
  onTextChange,
}: {
  text: string;
  remainingChars: number;
  onTextChange: (value: string) => void;
}) {
  return (
    <section className="composer" aria-label="Composer">
      <textarea
        placeholder="What should BigBSky post after OAuth is added?"
        value={text}
        onChange={(event) => onTextChange(event.target.value)}
      />
      <div className="composer-actions">
        <button type="button" title="Attach image">
          <Image size={18} />
        </button>
        <span className={remainingChars < 0 ? "over-limit" : ""}>{remainingChars}</span>
        <button type="button" disabled={remainingChars < 0 || text.trim().length === 0}>
          Post
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

function SearchView({
  actorSearchState,
  feedSources,
  language,
  query,
  searchState,
  sort,
  tab,
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
}: {
  actorSearchState: ActorSearchState;
  feedSources: FeedSource[];
  language: string;
  query: string;
  searchState: SearchState;
  sort: "top" | "latest";
  tab: (typeof searchTabs)[number];
  onLoadMore: () => void;
  onLanguageChange: (language: string) => void;
  onOpenFeed: (source: FeedSource) => void;
  onOpenImage: (image: ImageViewerState) => void;
  onOpenPost: (post: FeedPost) => void;
  onOpenProfile: (profile: Profile) => void;
  onQueryChange: (query: string) => void;
  onSearch: (query: string) => void;
  onClearSearch: () => void;
  onSortChange: (sort: "top" | "latest") => void;
  onTabChange: (tab: (typeof searchTabs)[number]) => void;
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
        <section className="search-results-list" aria-label="Feed search results">
          {feedResults.length === 0 ? (
            <EmptyState title="No Feeds found" message="Try another term or clear the search to see all local Feed destinations." />
          ) : (
            feedResults.map((source) => (
              <button className="feed-result-card" key={source.id} type="button" onClick={() => onOpenFeed(source)}>
                <span>{source.group}</span>
                <strong>{source.label}</strong>
                <small>{source.description}</small>
              </button>
            ))
          )}
        </section>
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
                <button className="load-more" type="button" onClick={onLoadMore}>
                  Load more
                </button>
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
                  key={post.uri}
                  onOpenImage={onOpenImage}
                  onOpenPost={onOpenPost}
                  onOpenProfile={onOpenProfile}
                />
              ))}
              {searchState.cursor && (
                <button className="load-more" type="button" onClick={onLoadMore}>
                  Load more
                </button>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

function FeedDetailHeader({ source, metadata }: { source: FeedSource; metadata: FeedGeneratorView | null }) {
  return (
    <section className="feed-detail-header">
      <div className="feed-detail-avatar">
        {metadata?.avatar ? <img src={metadata.avatar} alt="" loading="lazy" /> : <Hash size={24} />}
      </div>
      <div>
        <span>{source.group} Feed</span>
        <h2>{metadata?.displayName || source.label}</h2>
        <p>{metadata?.description || source.description}</p>
        <dl>
          <div>
            <dt>Creator</dt>
            <dd>{metadata?.creator ? `@${metadata.creator.handle}` : "Public AppView"}</dd>
          </div>
          <div>
            <dt>Likes</dt>
            <dd>{(metadata?.likeCount ?? metadata?.likedByCount)?.toLocaleString() ?? "-"}</dd>
          </div>
          <div>
            <dt>URI</dt>
            <dd>{source.uri.split("/").pop()}</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}

function PostCard({
  item,
  onOpenImage,
  onOpenPost,
  onOpenProfile,
}: {
  item: FeedItem;
  onOpenImage?: (image: ImageViewerState) => void;
  onOpenPost?: (post: FeedPost) => void;
  onOpenProfile?: (profile: Profile) => void;
}) {
  const post = item.post;
  const images = getEmbedImages(post.embed);
  const external = getExternalEmbed(post.embed);
  const recordEmbed = getRecordEmbed(post.embed);
  const video = getVideoEmbed(post.embed);
  const text = post.record.text?.trim() || "";
  const preservesLineBreaks = text.includes("\n");
  const hasRichContent = images.length > 0 || !!external || !!recordEmbed || !!video;
  const engagementTotal = (post.replyCount ?? 0) + (post.repostCount ?? 0) + (post.likeCount ?? 0) + (post.quoteCount ?? 0);
  const hasDiscussion = (post.replyCount ?? 0) >= 10 || (post.quoteCount ?? 0) >= 8;
  const hasHighReach = engagementTotal >= 100;

  return (
    <article className="post-card">
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
      {(hasDiscussion || hasHighReach || (post.labels?.length ?? 0) > 0) && (
        <div className="post-badges" aria-label="Post context">
          {hasDiscussion && (
            <span>
              <MessageCircle size={13} /> Active discussion
            </span>
          )}
          {hasHighReach && (
            <span>
              <Flame size={13} /> High activity
            </span>
          )}
          {post.labels?.slice(0, 3).map((label) => (
            <span key={`${post.uri}:${label.val || label.src || label.uri}`}>
              {label.val || "Content label"}
            </span>
          ))}
        </div>
      )}
      {text ? (
        <p className={preservesLineBreaks ? "post-text has-line-breaks" : "post-text"}>{text}</p>
      ) : (
        !hasRichContent && <p className="post-text muted">Post has no plain text.</p>
      )}
      {images.length > 0 && (
        <div className={`image-grid count-${Math.min(images.length, 4)}`}>
          {images.slice(0, 4).map((image) => (
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
            </button>
          ))}
        </div>
      )}
      {video && (
        <a className="video-card" href={video.playlist || video.thumbnail} target="_blank" rel="noreferrer">
          {video.thumbnail ? (
            <img
              alt={video.alt || ""}
              src={video.thumbnail}
              loading="lazy"
              decoding="async"
              style={
                video.aspectRatio?.width && video.aspectRatio?.height
                  ? { aspectRatio: `${video.aspectRatio.width} / ${video.aspectRatio.height}` }
                  : undefined
              }
            />
          ) : (
            <span className="video-placeholder" />
          )}
          <span className="video-label">
            <Film size={16} /> Video
          </span>
        </a>
      )}
      {external && (
        <a className="link-card" href={external.uri} target="_blank" rel="noreferrer">
          {external.thumb && <img alt="" src={external.thumb} loading="lazy" decoding="async" />}
          <span>
            <strong>{external.title || external.uri}</strong>
            <small>{external.description}</small>
          </span>
        </a>
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
      {embeddedVideo && (
        <a className="video-card quote-video-card" href={embeddedVideo.playlist || embeddedVideo.thumbnail} target="_blank" rel="noreferrer">
          {embeddedVideo.thumbnail ? (
            <img
              alt={embeddedVideo.alt || ""}
              src={embeddedVideo.thumbnail}
              loading="lazy"
              decoding="async"
              style={
                embeddedVideo.aspectRatio?.width && embeddedVideo.aspectRatio?.height
                  ? { aspectRatio: `${embeddedVideo.aspectRatio.width} / ${embeddedVideo.aspectRatio.height}` }
                  : undefined
              }
            />
          ) : (
            <span className="video-placeholder" />
          )}
          <span className="video-label">
            <Film size={16} /> Video
          </span>
        </a>
      )}
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

function ThreadView({
  thread,
  onOpenImage,
  onOpenPost,
  onOpenProfile,
}: {
  thread: { status: "idle" | "loading" | "ready" | "error"; node?: ThreadNode; error?: string };
  onOpenImage: (image: ImageViewerState) => void;
  onOpenPost: (post: FeedPost) => void;
  onOpenProfile: (profile: Profile) => void;
}) {
  const [expandedBranches, setExpandedBranches] = useState<Record<string, boolean>>({});
  const [replyText, setReplyText] = useState("");
  const rootPost = findFirstThreadPost(thread.node);
  const remainingReplyChars = 300 - replyText.length;

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
            <div>
              <dt>Reposts</dt>
              <dd>{(rootPost.repostCount ?? 0).toLocaleString()}</dd>
            </div>
            <div>
              <dt>Quotes</dt>
              <dd>{(rootPost.quoteCount ?? 0).toLocaleString()}</dd>
            </div>
            <div>
              <dt>Likes</dt>
              <dd>{(rootPost.likeCount ?? 0).toLocaleString()}</dd>
            </div>
          </dl>
          <div className="thread-permissions">
            <Users size={15} />
            <span>{replyPermissionLabel(rootPost)}</span>
          </div>
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
      {renderThreadNode(thread.node, 0, expandedBranches, (uri) =>
        setExpandedBranches((current) => ({ ...current, [uri]: !current[uri] })),
        { onOpenImage, onOpenPost, onOpenProfile },
      )}
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
          onClose();
        }}
      />
    </div>
  );
}

function renderThreadNode(
  node: ThreadNode,
  depth: number,
  expandedBranches: Record<string, boolean>,
  onToggleBranch: (uri: string) => void,
  handlers: {
    onOpenImage: (image: ImageViewerState) => void;
    onOpenPost: (post: FeedPost) => void;
    onOpenProfile: (profile: Profile) => void;
  },
): React.ReactNode {
  if (!("post" in node)) {
    return (
      <div className="thread-alert" style={{ marginLeft: depth * 22 }}>
        {node.message || "Thread item is unavailable."}
      </div>
    );
  }

  const replies = node.replies ?? [];
  const isExpanded = !!expandedBranches[node.post.uri];
  const visibleReplies = isExpanded ? replies : replies.slice(0, 8);
  const hiddenReplyCount = Math.max(0, replies.length - visibleReplies.length);

  return (
    <div className="thread-node" key={node.post.uri} style={{ marginLeft: depth * 22 }}>
      <PostCard
        item={{ post: node.post }}
        onOpenImage={handlers.onOpenImage}
        onOpenPost={handlers.onOpenPost}
        onOpenProfile={handlers.onOpenProfile}
      />
      {visibleReplies.map((reply) => renderThreadNode(reply, depth + 1, expandedBranches, onToggleBranch, handlers))}
      {replies.length > 8 && (
        <button className="load-more branch-toggle" type="button" onClick={() => onToggleBranch(node.post.uri)}>
          {isExpanded ? "Show fewer replies" : `Show ${hiddenReplyCount} more replies`}
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
}: {
  source: FeedSource;
  metadata: FeedGeneratorView | null;
  entityCache: EntityCache;
}) {
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
        <div>
          <dt>Media posts</dt>
          <dd>{entityCache.mediaPosts.length.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Smart groups</dt>
          <dd>{entityCache.smartGroups.length.toLocaleString()}</dd>
        </div>
      </dl>
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

function SmartGroupsPanel({ groups }: { groups: EntityCache["smartGroups"] }) {
  if (groups.length === 0) {
    return null;
  }

  return (
    <section className="context-panel smart-groups-panel">
      <h2>Smart Groups</h2>
      {groups.map((group) => (
        <button key={group.key} type="button" title={group.label}>
          <span>{group.count} posts</span>
          <small>{group.label}</small>
        </button>
      ))}
    </section>
  );
}

function MediaStripPanel({
  mediaPosts,
  posts,
  onOpenPost,
}: {
  mediaPosts: EntityCache["mediaPosts"];
  posts: EntityCache["posts"];
  onOpenPost: (post: FeedPost) => void;
}) {
  if (mediaPosts.length === 0) {
    return null;
  }

  return (
    <section className="context-panel media-strip-panel">
      <h2>Media Strip</h2>
      <div className="media-strip">
        {mediaPosts.map((media) => (
          <button
            key={`${media.uri}:${media.thumb}`}
            type="button"
            onClick={() => {
              const post = posts[media.uri];
              if (post) {
                onOpenPost(post);
              }
            }}
            title={`Open @${media.authorHandle} media post`}
          >
            <img src={media.thumb} alt={media.alt} loading="lazy" decoding="async" />
          </button>
        ))}
      </div>
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
