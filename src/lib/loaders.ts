// Data loaders extracted from App.tsx (issue #28) so the feed/profile/search/
// thread state transitions can be exercised without mounting App. Each loader
// is built by a factory that receives the caches, state setters, and helpers it
// closes over; App wires them up once per surface, and tests call the factories
// with mock deps + mocked api/auth modules.
//
// The loaders deliberately keep the ordering contract that lives in App: the
// cache keys carry no viewer DID, so identity changes rely on App's
// `clearAllDataCaches()` running before any loader repopulates a cache.

import type { Dispatch, RefObject, SetStateAction } from "react";
import {
  type ActorSearchResponse,
  type FeedGeneratorView,
  type FeedItem,
  type FeedPost,
  type ListView,
  type Profile,
  type SearchPostsResponse,
  type ThreadNode,
  getAuthorFeed,
  getFeed,
  getFeedGenerator,
  getList,
  getListFeed,
  getPopularFeedGenerators,
  getEmbedImages,
  getVideoEmbed,
  isListUri,
  isRateLimit,
  rateLimitMessage,
  searchActors,
} from "../api";
import {
  getAuthorFeedAuthed,
  getFeedAuthed,
  getFollowingTimeline,
  getPostThreadAuthed,
  getPostThreadByUriAuthed,
  getProfileAuthed,
  searchPostsAuthed,
} from "../auth";
import type { FeedSource } from "../sources";
import type { RouteState } from "../router";
import type { Cache } from "./cache";
import {
  buildAnchoredThreadParts,
  buildThreadParts,
  countThreadPostNodes,
  expectedThreadMarkerTotal,
  findThreadNodeByUri,
  replaceThreadBranch,
  threadMarkerMatch,
} from "./threads";

// ---- Loader state types (moved out of App.tsx) ----

export type FeedState = {
  items: FeedItem[];
  cursor?: string;
  status: "idle" | "loading" | "ready" | "error" | "rate-limit";
  error?: string;
  loadMoreError?: string;
};

export type SearchState = {
  posts: FeedPost[];
  cursor?: string;
  status: "idle" | "loading" | "ready" | "error" | "rate-limit";
  error?: string;
  loadMoreError?: string;
};

export type ActorSearchState = {
  actors: Profile[];
  cursor?: string;
  status: "idle" | "loading" | "ready" | "error" | "rate-limit";
  error?: string;
  loadMoreError?: string;
};

export type FeedSearchState = {
  feeds: FeedGeneratorView[];
  status: "idle" | "loading" | "ready" | "error" | "rate-limit";
  error?: string;
};

export type DevMetrics = {
  apiRequests: number;
  cacheHits: number;
  sameOriginRequests: number;
  runtimeWarnings: string[];
  serviceWorkerState: string;
};

export type BranchLoadResult = { added: number; error?: undefined } | { added?: undefined; error: string };

export type ThreadState = {
  status: "idle" | "loading" | "ready" | "error";
  node?: ThreadNode;
  error?: string;
};

export type ProfileFeedFilter = "posts_with_replies" | "posts_no_replies" | "posts_with_media" | "posts_with_video";

export const emptyFeedState: FeedState = { items: [], status: "idle" };
export const emptySearchState: SearchState = { posts: [], status: "idle" };
export const emptyActorSearchState: ActorSearchState = { actors: [], status: "idle" };
export const emptyFeedSearchState: FeedSearchState = { feeds: [], status: "idle" };

export const initialDevMetrics: DevMetrics = {
  apiRequests: 0,
  cacheHits: 0,
  sameOriginRequests: 0,
  runtimeWarnings: [],
  serviceWorkerState: "checking",
};

// ---- Loader helpers ----

const MEDIA_DENSITY_VISIBLE_TARGET = 12;
const MEDIA_DENSITY_MAX_PREFETCH_PAGES = 4;

export function postHasVisualMedia(post: FeedPost) {
  return getEmbedImages(post.embed).length > 0 || !!getVideoEmbed(post.embed);
}

function countVisualFeedItems(items: FeedItem[]) {
  return items.filter((item) => postHasVisualMedia(item.post)).length;
}

async function hydrateThreadContinuations(root: ThreadNode, signal?: AbortSignal) {
  let hydrated = root;
  let previousLastUri: string | null = null;

  for (let attempt = 0; attempt < 12; attempt += 1) {
    // Use the anchored parts (walking UP the parent chain to the true root) so
    // the 1/N marker is read from the root even when the thread was opened
    // mid-chain (e.g. part 3 of N via a direct URL/search). buildThreadParts
    // alone would start at the anchor, whose marker is 3/N, and
    // expectedThreadMarkerTotal would bail — leaving the tail unhydrated.
    const parts = buildAnchoredThreadParts(hydrated);
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

export async function hydrateProfileSelfThreads(items: FeedItem[], signal?: AbortSignal) {
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

// ---- Loader factories ----

export interface FeedLoaderDeps {
  feedCache: Cache<FeedState>;
  setFeedState: Dispatch<SetStateAction<FeedState>>;
  setDevMetrics: Dispatch<SetStateAction<DevMetrics>>;
  restoreScrollFor: (key: string) => void;
  restoreOrResetScroll: (ref: { readonly current: HTMLElement | null }, target: number) => void;
  timelineRef: RefObject<HTMLDivElement | null>;
  scrollCache: Cache<number>;
  density: string;
  signedInDid: string | null | undefined;
}

export function createFeedLoader(deps: FeedLoaderDeps) {
  return async function loadFeed(source: FeedSource, cursor?: string, signal?: AbortSignal) {
    const { feedCache, setFeedState, setDevMetrics, restoreScrollFor, restoreOrResetScroll, timelineRef, scrollCache, density, signedInDid } = deps;
    const cacheKey = `feed:${source.id}`;
    if (!cursor) {
      const cached = feedCache.get(cacheKey);
      if (cached?.status === "ready") {
        setDevMetrics((current) => ({ ...current, cacheHits: current.cacheHits + 1 }));
        setFeedState(cached);
        restoreScrollFor(cacheKey);
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
      // Media (grid) density hides text-only posts, so a single page can yield
      // only a couple of visual items. Top up by fetching more pages until the
      // batch has ~a screenful of visual content (or we hit the page cap). This
      // runs on load-more too (by design): filtering out lots of posts is fine,
      // but we still want each load to hand the user a full grid of content
      // rather than a near-empty one. The extra fetches are bounded by
      // MEDIA_DENSITY_MAX_PREFETCH_PAGES, so this is intentional, not runaway
      // cursor exhaustion.
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
        feedCache.set(cacheKey, next);
        return next;
      });
      if (!cursor) {
        restoreOrResetScroll(timelineRef, scrollCache.get(cacheKey) || 0);
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
  };
}

export interface ProfileFeedLoaderDeps {
  profileCache: Cache<{ feed: FeedState; profile: Profile | null }>;
  setProfile: Dispatch<SetStateAction<Profile | null>>;
  setFeedState: Dispatch<SetStateAction<FeedState>>;
  setDevMetrics: Dispatch<SetStateAction<DevMetrics>>;
  restoreScrollFor: (key: string) => void;
}

export function createProfileFeedLoader(deps: ProfileFeedLoaderDeps) {
  return async function loadProfileFeed(
    actor: string,
    cursor?: string,
    signal?: AbortSignal,
    filter: ProfileFeedFilter = "posts_with_replies",
  ) {
    const { profileCache, setProfile, setFeedState, setDevMetrics, restoreScrollFor } = deps;
    const cacheKey = `profile:${actor}:${filter}`;
    if (!cursor) {
      const cached = profileCache.get(cacheKey);
      if (cached?.feed.status === "ready") {
        setDevMetrics((current) => ({ ...current, cacheHits: current.cacheHits + 1 }));
        setProfile(cached.profile);
        setFeedState(cached.feed);
        restoreScrollFor(cacheKey);
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
        profileCache.set(cacheKey, { feed: next, profile: profileResponse ?? profileCache.get(cacheKey)?.profile ?? null });
        return next;
      });
      if (!cursor) {
        restoreScrollFor(cacheKey);
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
        profileCache.set(cacheKey, {
          feed: profileCache.get(cacheKey)?.feed ?? { items: [], status: "ready" },
          profile: profileResponse,
        });
      }
    }
  };
}

export interface SearchLoaderDeps {
  searchCache: Cache<SearchState>;
  setSearchState: Dispatch<SetStateAction<SearchState>>;
  setDevMetrics: Dispatch<SetStateAction<DevMetrics>>;
}

export function createSearchLoader(deps: SearchLoaderDeps) {
  return async function loadSearch(
    query: string,
    sort: "top" | "latest",
    lang: string,
    cursor?: string,
    signal?: AbortSignal,
  ) {
    const { searchCache, setSearchState, setDevMetrics } = deps;
    const cacheKey = `search:${sort}:${lang || "any"}:${query}`;
    if (!cursor) {
      const cached = searchCache.get(cacheKey);
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
        searchCache.set(cacheKey, next);
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
  };
}

export interface ActorSearchLoaderDeps {
  actorSearchCache: Cache<ActorSearchState>;
  setActorSearchState: Dispatch<SetStateAction<ActorSearchState>>;
  setDevMetrics: Dispatch<SetStateAction<DevMetrics>>;
}

export function createActorSearchLoader(deps: ActorSearchLoaderDeps) {
  return async function loadActorSearch(query: string, cursor?: string, signal?: AbortSignal) {
    const { actorSearchCache, setActorSearchState, setDevMetrics } = deps;
    const cacheKey = `actors:${query}`;
    if (!cursor) {
      const cached = actorSearchCache.get(cacheKey);
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
        actorSearchCache.set(cacheKey, next);
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
  };
}

export interface FeedSearchLoaderDeps {
  feedSearchCache: Cache<FeedSearchState>;
  setFeedSearchState: Dispatch<SetStateAction<FeedSearchState>>;
  setDevMetrics: Dispatch<SetStateAction<DevMetrics>>;
}

export function createFeedSearchLoader(deps: FeedSearchLoaderDeps) {
  return async function loadFeedSearch(query: string, signal?: AbortSignal) {
    const { feedSearchCache, setFeedSearchState, setDevMetrics } = deps;
    const cacheKey = `feeds:${query.trim().toLowerCase()}`;
    const cached = feedSearchCache.get(cacheKey);
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
      feedSearchCache.set(cacheKey, next);
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
  };
}

export interface ThreadLoaderDeps {
  threadCache: Cache<ThreadNode>;
  setThread: Dispatch<SetStateAction<ThreadState>>;
  setThreadBranchResults: Dispatch<SetStateAction<Record<string, BranchLoadResult>>>;
  threadLoadControllerRef: { current: AbortController | null };
}

// Single source of truth for fetching a full thread: aborts any prior load,
// sets loading state, hydrates self-thread continuations, then caches and
// commits the result. Both the route effect and reloadThread go through this
// so their fetch/abort/cache logic can't drift. Returns the controller so the
// caller can abort on cleanup.
export function createThreadLoader(deps: ThreadLoaderDeps) {
  return function startThreadLoad(actor: string, rkey: string) {
    const { threadCache, setThread, setThreadBranchResults, threadLoadControllerRef } = deps;
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
        threadCache.set(cacheKey, thread);
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
  };
}

export interface ThreadBranchLoaderDeps {
  threadBranchCache: Cache<ThreadNode>;
  threadCache: Cache<ThreadNode>;
  threadLoadControllerRef: { current: AbortController | null };
  setThread: Dispatch<SetStateAction<ThreadState>>;
  setThreadBranchResults: Dispatch<SetStateAction<Record<string, BranchLoadResult>>>;
  setLoadingThreadBranches: Dispatch<SetStateAction<Record<string, boolean>>>;
  setDevMetrics: Dispatch<SetStateAction<DevMetrics>>;
  getThread: () => ThreadState;
  getLoadingThreadBranches: () => Record<string, boolean>;
  getRoute: () => RouteState;
}

export function createThreadBranchLoader(deps: ThreadBranchLoaderDeps) {
  return function loadThreadBranch(uri: string) {
    const {
      threadBranchCache,
      threadCache,
      threadLoadControllerRef,
      setThread,
      setThreadBranchResults,
      setLoadingThreadBranches,
      setDevMetrics,
      getThread,
      getLoadingThreadBranches,
      getRoute,
    } = deps;
    const thread = getThread();
    const loadingThreadBranches = getLoadingThreadBranches();
    if (thread.status !== "ready" || !thread.node || loadingThreadBranches[uri]) {
      return;
    }

    // Splice the loaded branch into the live thread and record how many NEW
    // posts it added. Both the "added" count and the replaced node are derived
    // from the SAME latest node (`current.node`) inside the updater, so if the
    // thread reloads between the click and this branch resolving, the count
    // stays consistent with the tree we're actually mutating (rather than a
    // stale closure snapshot that could make the "Loaded N more" label wrong).
    const applyBranch = (branch: ThreadNode) => {
      setThread((current) => {
        if (current.status !== "ready" || !current.node) {
          return current;
        }

        const previousBranch = findThreadNodeByUri(current.node, uri);
        const previousPostCount = Math.max(0, countThreadPostNodes(previousBranch ?? undefined) - 1);
        const added = Math.max(0, countThreadPostNodes(branch) - 1 - previousPostCount);
        setThreadBranchResults((results) => ({ ...results, [uri]: { added } }));

        const nextNode = replaceThreadBranch(current.node, uri, branch);
        const route = getRoute();
        if (route.kind === "post") {
          threadCache.set(`${route.actor}:${route.rkey}`, nextNode);
        }
        return { ...current, node: nextNode };
      });
    };

    const cachedBranch = threadBranchCache.get(uri);
    if (cachedBranch) {
      setDevMetrics((current) => ({ ...current, cacheHits: current.cacheHits + 1 }));
      applyBranch(cachedBranch);
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
        threadBranchCache.set(uri, response.thread);
        applyBranch(response.thread);
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
  };
}

// ---- Feed/list metadata loaders (the "metadata effects" from #28) ----

export interface FeedMetadataLoaderDeps {
  feedMetadataCache: Cache<FeedGeneratorView>;
  setFeedMetadata: Dispatch<SetStateAction<FeedGeneratorView | null>>;
  setDevMetrics: Dispatch<SetStateAction<DevMetrics>>;
}

export function createFeedMetadataLoader(deps: FeedMetadataLoaderDeps) {
  return async function loadFeedMetadata(uri: string, signal?: AbortSignal) {
    const { feedMetadataCache, setFeedMetadata, setDevMetrics } = deps;
    const cached = feedMetadataCache.get(uri);
    if (cached) {
      setDevMetrics((current) => ({ ...current, cacheHits: current.cacheHits + 1 }));
      setFeedMetadata(cached);
      return;
    }

    setFeedMetadata(null);
    getFeedGenerator(uri, signal)
      .then((response) => {
        feedMetadataCache.set(uri, response.view);
        setFeedMetadata(response.view);
      })
      .catch(() => {
        if (!signal?.aborted) {
          setFeedMetadata(null);
        }
      });
  };
}

export interface ListMetadataLoaderDeps {
  listMetadataCache: Cache<ListView>;
  setListMetadata: Dispatch<SetStateAction<ListView | null>>;
  setDevMetrics: Dispatch<SetStateAction<DevMetrics>>;
}

export function createListMetadataLoader(deps: ListMetadataLoaderDeps) {
  return async function loadListMetadata(uri: string, signal?: AbortSignal) {
    const { listMetadataCache, setListMetadata, setDevMetrics } = deps;
    const cached = listMetadataCache.get(uri);
    if (cached) {
      setDevMetrics((current) => ({ ...current, cacheHits: current.cacheHits + 1 }));
      setListMetadata(cached);
      return;
    }

    setListMetadata(null);
    getList(uri, signal)
      .then((response) => {
        listMetadataCache.set(uri, response.list);
        setListMetadata(response.list);
      })
      .catch(() => {
        if (!signal?.aborted) {
          setListMetadata(null);
        }
      });
  };
}
