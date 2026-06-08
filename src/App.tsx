import {
  Bell,
  Bookmark,
  Compass,
  Feather,
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
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ApiError,
  type FeedItem,
  type FeedPost,
  type Profile,
  type SearchPostsResponse,
  type ThreadNode,
  getAuthorFeed,
  getEmbedImages,
  getExternalEmbed,
  getFeed,
  getPostThread,
  getProfile,
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
  mediaPostUris: string[];
};

const densityModes = ["comfortable", "compact", "media"];
const recentStorageKey = "bigbsky:recent";
const emptyFeedState: FeedState = { items: [], status: "idle" };
const emptySearchState: SearchState = { posts: [], status: "idle" };

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

function isRateLimit(error: unknown) {
  return error instanceof ApiError && error.status === 429;
}

function rateLimitMessage(error: unknown) {
  return error instanceof Error ? error.message : "Bluesky rate limit reached.";
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
  const [feedState, setFeedState] = useState<FeedState>(emptyFeedState);
  const [searchState, setSearchState] = useState<SearchState>(emptySearchState);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [composerText, setComposerText] = useState("");
  const [imageViewer, setImageViewer] = useState<ImageViewerState>(null);
  const [densityByContext, setDensityByContext] = useState<Record<string, string>>(() => readDensityPreferences());
  const [recentItems, setRecentItems] = useState<RecentItem[]>(() => readRecentItems());
  const [thread, setThread] = useState<{ status: "idle" | "loading" | "ready" | "error"; node?: ThreadNode; error?: string }>({
    status: "idle",
  });
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const feedCacheRef = useRef<Record<string, FeedState>>({});
  const profileCacheRef = useRef<Record<string, { feed: FeedState; profile: Profile | null }>>({});
  const searchCacheRef = useRef<Record<string, SearchState>>({});
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
  const entityCache = useMemo<EntityCache>(() => {
    const posts: Record<string, FeedPost> = {};
    const profiles: Record<string, Profile> = {};
    const linkUrls: string[] = [];
    const mediaPostUris: string[] = [];

    for (const post of [...feedState.items.map((item) => item.post), ...searchState.posts]) {
      posts[post.uri] = post;
      profiles[post.author.did] = post.author;
      profiles[post.author.handle] = post.author;

      const external = getExternalEmbed(post.embed);
      if (external?.uri) {
        linkUrls.push(external.uri);
      }

      if (getEmbedImages(post.embed).length > 0) {
        mediaPostUris.push(post.uri);
      }
    }

    return { posts, profiles, linkUrls, mediaPostUris };
  }, [feedState.items, searchState.posts]);

  const loadFeed = useCallback(async (source: FeedSource, cursor?: string, signal?: AbortSignal) => {
    const cacheKey = `feed:${source.id}`;
    if (!cursor) {
      const cached = feedCacheRef.current[cacheKey];
      if (cached?.status === "ready") {
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

  const loadSearch = useCallback(async (query: string, sort: "top" | "latest", cursor?: string, signal?: AbortSignal) => {
    const cacheKey = `search:${sort}:${query}`;
    if (!cursor) {
      const cached = searchCacheRef.current[cacheKey];
      if (cached?.status === "ready") {
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
      const response: SearchPostsResponse = await searchPosts(query, sort, cursor, signal);
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

  useEffect(() => {
    if (route.kind === "post" || route.kind === "search") {
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
      return undefined;
    }

    setGlobalSearchText(route.query || "");
    if (!route.query) {
      setSearchState(emptySearchState);
      return undefined;
    }

    const controller = new AbortController();
    void loadSearch(route.query, searchSort, undefined, controller.signal);
    return () => controller.abort();
  }, [loadSearch, route, searchSort]);

  useEffect(() => {
    const onPopState = () => setRoute(getRouteState());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (route.kind !== "post") {
      setThread({ status: "idle" });
      return;
    }

    const cacheKey = `${route.actor}:${route.rkey}`;
    const cached = threadCacheRef.current[cacheKey];
    if (cached) {
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

  const remainingChars = 300 - composerText.length;
  const isProfileRoute = route.kind === "profile";
  const workspaceLabel =
    route.kind === "post" ? "Thread" : route.kind === "search" ? "Search" : isProfileRoute ? "Profile Feed" : "Active Feed";
  const workspaceTitle =
    route.kind === "post"
      ? "Post Conversation"
      : route.kind === "search"
        ? route.query
          ? `Search: ${route.query}`
          : "Search Bluesky"
        : isProfileRoute
          ? displayName(profile ?? undefined)
          : activeSource.label;
  const activeScrollKey = route.kind === "profile" ? `profile:${route.actor}` : route.kind === "feed" ? `feed:${activeSource.id}` : "";

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
      if (route.query && searchState.cursor) {
        void loadSearch(route.query, searchSort, searchState.cursor);
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
              <button key={item} className="rail-button" type="button" title={item}>
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
            <h2>{group}</h2>
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
          <ThreadView thread={thread} />
        ) : route.kind === "search" ? (
          <SearchView
            query={globalSearchText}
            searchState={searchState}
            sort={searchSort}
            onLoadMore={loadMore}
            onOpenImage={setImageViewer}
            onOpenPost={openPost}
            onOpenProfile={openProfile}
            onQueryChange={setGlobalSearchText}
            onSearch={submitSearch}
            onSortChange={setSearchSort}
          />
        ) : (
          <div
            className={`timeline ${density}`}
            ref={timelineRef}
          >
            <Composer
              remainingChars={remainingChars}
              text={composerText}
              onTextChange={setComposerText}
            />
            {feedState.status === "loading" && <LoadingState label="Loading public Bluesky posts" />}
            {feedState.status === "error" && <ErrorState message={feedState.error || "Feed failed to load."} />}
            {feedState.status === "rate-limit" && <RateLimitState message={feedState.error} />}
            {feedState.status === "ready" && (
              <>
                {feedState.items.map((item) => (
                  <PostCard
                    item={item}
                    key={item.post.uri}
                    onOpenImage={setImageViewer}
                    onOpenPost={openPost}
                    onOpenProfile={openProfile}
                  />
                ))}
                {feedState.cursor && (
                  <button className="load-more" type="button" onClick={loadMore}>
                    Load more
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </main>

      <aside className="right-rail" aria-label="Context">
        <SearchBox value={globalSearchText} onChange={setGlobalSearchText} onSearch={submitSearch} />
        {route.kind === "profile" ? (
          <ProfileContextPanel actor={route.actor} profile={profile ?? entityCache.profiles[route.actor] ?? null} />
        ) : (
          <FeedContextPanel source={activeSource} entityCache={entityCache} />
        )}
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
        placeholder="Search Bluesky"
        value={value}
        onInput={(event) => onChange(event.currentTarget.value)}
      />
    </form>
  );
}

function SearchView({
  query,
  searchState,
  sort,
  onLoadMore,
  onOpenImage,
  onOpenPost,
  onOpenProfile,
  onQueryChange,
  onSearch,
  onSortChange,
}: {
  query: string;
  searchState: SearchState;
  sort: "top" | "latest";
  onLoadMore: () => void;
  onOpenImage: (image: ImageViewerState) => void;
  onOpenPost: (post: FeedPost) => void;
  onOpenProfile: (profile: Profile) => void;
  onQueryChange: (query: string) => void;
  onSearch: (query: string) => void;
  onSortChange: (sort: "top" | "latest") => void;
}) {
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
          aria-label="Search posts"
          placeholder="Search posts, hashtags, or links"
          value={query}
          onInput={(event) => onQueryChange(event.currentTarget.value)}
        />
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
      </form>

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
    </div>
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
  const text = post.record.text || "Post has no plain text.";
  const preservesLineBreaks = text.includes("\n");

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
      <p className={preservesLineBreaks ? "post-text has-line-breaks" : "post-text"}>{text}</p>
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
      {external && (
        <a className="link-card" href={external.uri} target="_blank" rel="noreferrer">
          {external.thumb && <img alt="" src={external.thumb} loading="lazy" />}
          <span>
            <strong>{external.title || external.uri}</strong>
            <small>{external.description}</small>
          </span>
        </a>
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

function ThreadView({
  thread,
}: {
  thread: { status: "idle" | "loading" | "ready" | "error"; node?: ThreadNode; error?: string };
}) {
  const [expandedBranches, setExpandedBranches] = useState<Record<string, boolean>>({});

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
      {renderThreadNode(thread.node, 0, expandedBranches, (uri) =>
        setExpandedBranches((current) => ({ ...current, [uri]: !current[uri] })),
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
  const goPrevious = useCallback(() => {
    if (!hasMultiple) {
      return;
    }

    onChange({
      images: image.images,
      index: (image.index - 1 + image.images.length) % image.images.length,
    });
  }, [hasMultiple, image, onChange]);
  const goNext = useCallback(() => {
    if (!hasMultiple) {
      return;
    }

    onChange({
      images: image.images,
      index: (image.index + 1) % image.images.length,
    });
  }, [hasMultiple, image, onChange]);

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
      onClick={(event) => {
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
            onClick={(event) => {
              event.stopPropagation();
              goPrevious();
            }}
            aria-label="Previous image"
          >
            <ChevronLeft size={30} />
          </button>
          <button
            className="image-viewer-nav next"
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              goNext();
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
        onClick={(event) => {
          event.stopPropagation();
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
      <PostCard item={{ post: node.post }} />
      {visibleReplies.map((reply) => renderThreadNode(reply, depth + 1, expandedBranches, onToggleBranch))}
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

function FeedContextPanel({ source, entityCache }: { source: FeedSource; entityCache: EntityCache }) {
  return (
    <section className="profile-panel">
      <span className="feed-glyph">
        <Hash size={22} />
      </span>
      <h2>{source.label}</h2>
      <p>{source.description}</p>
      <dl>
        <div>
          <dt>Type</dt>
          <dd>Feed</dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd>Public</dd>
        </div>
        <div>
          <dt>Cached posts</dt>
          <dd>{Object.keys(entityCache.posts).length.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Media posts</dt>
          <dd>{entityCache.mediaPostUris.length.toLocaleString()}</dd>
        </div>
      </dl>
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
