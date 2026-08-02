// Behavioral tests for the App data loaders (issue #28). The loaders are built
// by factories (createFeedLoader / createProfileFeedLoader / …) so each can be
// exercised with mock caches, state setters, and api/auth reads — no App mount.
// These tests replace the reader-verifier source-text regexes that used to pin
// the loader bodies in App.tsx (see scripts/verify-reader-behavior.mjs, #19).
//
// Note: the thread-branch loader's rejection tests deliberately do NOT reset
// `getPostThreadByUriAuthed` in a describe-level `beforeEach`. Vitest's jsdom
// environment attributes a mock-returned rejected promise to the mock set-up
// line as an unhandled rejection even though the loader's `.catch` consumes it,
// and `mockReset()` in beforeEach makes that attribution fail the test. The
// "no-ops" test (which asserts NOT called) resets the mock itself instead.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCache } from "./cache";
import type { FeedGeneratorView, FeedItem, FeedPost, ListView, Profile, ThreadNode } from "../api";
import type { FeedSource } from "../sources";

const mocks = vi.hoisted(() => ({
  getFollowingTimeline: vi.fn(),
  getFeedAuthed: vi.fn(),
  getFeed: vi.fn(),
  getListFeed: vi.fn(),
  getAuthorFeed: vi.fn(),
  getAuthorFeedAuthed: vi.fn(),
  getProfileAuthed: vi.fn(),
  getPostThreadAuthed: vi.fn(),
  getPostThreadByUriAuthed: vi.fn(),
  searchPostsAuthed: vi.fn(),
  searchActors: vi.fn(),
  getPopularFeedGenerators: vi.fn(),
  getFeedGenerator: vi.fn(),
  getList: vi.fn(),
}));

vi.mock("../auth", () => ({
  getFollowingTimeline: (cursor?: string, signal?: AbortSignal) => mocks.getFollowingTimeline(cursor, signal),
  getFeedAuthed: (feedUri: string, cursor?: string, signal?: AbortSignal) => mocks.getFeedAuthed(feedUri, cursor, signal),
  getAuthorFeedAuthed: (actor: string, cursor?: string, signal?: AbortSignal, filter?: string) =>
    mocks.getAuthorFeedAuthed(actor, cursor, signal, filter),
  getProfileAuthed: (actor: string, signal?: AbortSignal) => mocks.getProfileAuthed(actor, signal),
  getPostThreadAuthed: (actor: string, rkey: string, signal?: AbortSignal) => mocks.getPostThreadAuthed(actor, rkey, signal),
  getPostThreadByUriAuthed: (uri: string, signal?: AbortSignal) => mocks.getPostThreadByUriAuthed(uri, signal),
  searchPostsAuthed: (query: string, sort?: string, lang?: string, cursor?: string, signal?: AbortSignal) =>
    mocks.searchPostsAuthed(query, sort, lang, cursor, signal),
}));

vi.mock("../api", () => ({
  getFeed: (feed: string, cursor?: string, signal?: AbortSignal) => mocks.getFeed(feed, cursor, signal),
  getListFeed: (list: string, cursor?: string, signal?: AbortSignal) => mocks.getListFeed(list, cursor, signal),
  getAuthorFeed: (actor: string, cursor?: string, signal?: AbortSignal, filter?: string) =>
    mocks.getAuthorFeed(actor, cursor, signal, filter),
  getPopularFeedGenerators: (limit?: number, signal?: AbortSignal, query?: string, cursor?: string) =>
    mocks.getPopularFeedGenerators(limit, signal, query, cursor),
  getFeedGenerator: (feed: string, signal?: AbortSignal) => mocks.getFeedGenerator(feed, signal),
  getList: (list: string, signal?: AbortSignal) => mocks.getList(list, signal),
  searchActors: (query: string, cursor?: string, signal?: AbortSignal) => mocks.searchActors(query, cursor, signal),
  // Pure helpers used by the loader internals (countVisualFeedItems,
  // postHasVisualMedia) are kept real so their behavior is exercised, not mocked.
  isListUri: (uri: string) => uri.includes("/app.bsky.graph.list/"),
  isRateLimit: (error: unknown) => (error as { status?: number } | null)?.status === 429,
  rateLimitMessage: (error: unknown) =>
    (error as { status?: number })?.status === 429 ? "rate limited" : error instanceof Error ? error.message : "failed",
  getEmbedImages: () => [],
  getVideoEmbed: () => null,
}));

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
  type ThreadState,
} from "./loaders";

const makeProfile = (handle: string): Profile => ({ did: `did:${handle}`, handle });

const makePost = (uri: string, author: Profile, text = "hello"): FeedPost => ({
  uri,
  cid: `cid:${uri}`,
  author,
  record: { text, createdAt: "2024-01-01T00:00:00Z" },
});

const makeFeedItem = (post: FeedPost): FeedItem => ({ post });

const discoverSource: FeedSource = {
  id: "discover",
  label: "Discover",
  uri: "at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.generator/whats-hot",
  group: "Core",
  description: "Bluesky's public discovery feed",
};

const devMetricsInitial: DevMetrics = {
  apiRequests: 0,
  cacheHits: 0,
  sameOriginRequests: 0,
  runtimeWarnings: [],
  serviceWorkerState: "checking",
};

// A mutable harness that records every state-setter invocation so tests can
// assert the exact transition sequence without React.
function stateSink<T>(initial: T) {
  const snapshots: T[] = [initial];
  const set = (updater: T | ((current: T) => T)) => {
    const next = typeof updater === "function" ? (updater as (current: T) => T)(snapshots[snapshots.length - 1]) : updater;
    snapshots.push(next);
  };
  return { set, snapshots };
}

const rateError = (message = "rate limited") => {
  const error = new Error(message) as Error & { status?: number };
  error.status = 429;
  return error;
};

describe("createFeedLoader", () => {
  beforeEach(() => {
    mocks.getFollowingTimeline.mockReset();
    mocks.getFeedAuthed.mockReset();
    mocks.getFeed.mockReset();
    mocks.getListFeed.mockReset();
  });

  it("serves a cache hit without fetching, bumps cacheHits, restores scroll, and keeps ready state", async () => {
    const author = makeProfile("alice");
    const post = makePost("at://alice/1", author);
    const cached: FeedState = { items: [makeFeedItem(post)], status: "ready" };
    const feedCache = createCache<FeedState>({ "feed:discover": cached });
    const feedState = stateSink<FeedState>({ items: [], status: "idle" });
    const metrics = stateSink<DevMetrics>(devMetricsInitial);
    const restoreScrollFor = vi.fn();

    const loadFeed = createFeedLoader({
      feedCache,
      setFeedState: feedState.set,
      setDevMetrics: metrics.set,
      restoreScrollFor,
      density: "comfortable",
      signedInDid: null,
    });

    await loadFeed(discoverSource);

    expect(mocks.getFeed).not.toHaveBeenCalled();
    expect(feedState.snapshots[1]).toEqual(cached);
    expect(restoreScrollFor).toHaveBeenCalledWith("feed:discover");
    expect(metrics.snapshots[metrics.snapshots.length - 1].cacheHits).toBe(1);
  });

  it("loads the public feed on a fresh read, writes the cache, and restores via the anchor-aware helper", async () => {
    const author = makeProfile("alice");
    const response = { cursor: "next", feed: [makeFeedItem(makePost("at://alice/1", author))] };
    mocks.getFeed.mockResolvedValue(response);
    const feedCache = createCache<FeedState>();
    const feedState = stateSink<FeedState>({ items: [], status: "idle" });
    const metrics = stateSink<DevMetrics>(devMetricsInitial);
    const restoreScrollFor = vi.fn();

    const loadFeed = createFeedLoader({
      feedCache,
      setFeedState: feedState.set,
      setDevMetrics: metrics.set,
      restoreScrollFor,
      density: "comfortable",
      signedInDid: null,
    });

    await loadFeed(discoverSource);

    expect(mocks.getFeed).toHaveBeenCalledWith(discoverSource.uri, undefined, undefined);
    expect(feedState.snapshots[1].status).toBe("loading");
    const ready = feedState.snapshots[feedState.snapshots.length - 1];
    expect(ready).toEqual({ items: response.feed, cursor: "next", status: "ready" });
    expect(feedCache.get("feed:discover")).toEqual(ready);
    // Cold loads now restore through restoreScrollFor (anchor-aware, with the
    // pixel fallback inside), not the raw pixel path (issue #45).
    expect(restoreScrollFor).toHaveBeenCalledWith("feed:discover");
  });

  it("routes list URIs through getListFeed and the following sentinel through getFollowingTimeline", async () => {
    const author = makeProfile("alice");
    const listResponse = { feed: [makeFeedItem(makePost("at://alice/1", author))] };
    mocks.getListFeed.mockResolvedValue(listResponse);
    const listSource: FeedSource = {
      ...discoverSource,
      id: "mylist",
      uri: "at://did:plc:abc/app.bsky.graph.list/mylist",
    };

    const listState = stateSink<FeedState>({ items: [], status: "idle" });
    await createFeedLoader({
      feedCache: createCache<FeedState>(),
      setFeedState: listState.set,
      setDevMetrics: stateSink<DevMetrics>(devMetricsInitial).set,
      restoreScrollFor: vi.fn(),

      density: "comfortable",
      signedInDid: null,
    })(listSource);

    expect(mocks.getListFeed).toHaveBeenCalledWith(listSource.uri, undefined, undefined);
    expect(mocks.getFeed).not.toHaveBeenCalled();

    mocks.getFollowingTimeline.mockResolvedValue({ feed: [makeFeedItem(makePost("at://alice/2", author))] });
    const followingSource: FeedSource = { ...discoverSource, id: "following", uri: "following" };
    const followingState = stateSink<FeedState>({ items: [], status: "idle" });
    await createFeedLoader({
      feedCache: createCache<FeedState>(),
      setFeedState: followingState.set,
      setDevMetrics: stateSink<DevMetrics>(devMetricsInitial).set,
      restoreScrollFor: vi.fn(),

      density: "comfortable",
      signedInDid: null,
    })(followingSource);

    expect(mocks.getFollowingTimeline).toHaveBeenCalledWith(undefined, undefined);
  });

  it("loads the authed feed when signed in", async () => {
    const author = makeProfile("alice");
    mocks.getFeedAuthed.mockResolvedValue({ feed: [makeFeedItem(makePost("at://alice/1", author))] });
    await createFeedLoader({
      feedCache: createCache<FeedState>(),
      setFeedState: stateSink<FeedState>({ items: [], status: "idle" }).set,
      setDevMetrics: stateSink<DevMetrics>(devMetricsInitial).set,
      restoreScrollFor: vi.fn(),

      density: "comfortable",
      signedInDid: "did:alice",
    })(discoverSource);

    expect(mocks.getFeedAuthed).toHaveBeenCalledWith(discoverSource.uri, undefined, undefined);
    expect(mocks.getFeed).not.toHaveBeenCalled();
  });

  it("appends a load-more page and keeps ready state", async () => {
    const author = makeProfile("alice");
    mocks.getFeed.mockResolvedValue({
      cursor: undefined,
      feed: [makeFeedItem(makePost("at://alice/2", author))],
    });
    const feedCache = createCache<FeedState>();
    const feedState = stateSink<FeedState>({ items: [makeFeedItem(makePost("at://alice/1", author))], status: "ready" });

    await createFeedLoader({
      feedCache,
      setFeedState: feedState.set,
      setDevMetrics: stateSink<DevMetrics>(devMetricsInitial).set,
      restoreScrollFor: vi.fn(),

      density: "comfortable",
      signedInDid: null,
    })(discoverSource, "page2");

    const ready = feedState.snapshots[feedState.snapshots.length - 1];
    expect(ready.items).toHaveLength(2);
    expect(ready.status).toBe("ready");
  });

  it("keeps already-loaded results and surfaces a loadMoreError on a failed pagination", async () => {
    mocks.getFeed.mockRejectedValue(rateError());
    const feedCache = createCache<FeedState>();
    const feedState = stateSink<FeedState>({ items: [makeFeedItem(makePost("at://alice/1", makeProfile("alice")))], status: "ready" });

    await createFeedLoader({
      feedCache,
      setFeedState: feedState.set,
      setDevMetrics: stateSink<DevMetrics>(devMetricsInitial).set,
      restoreScrollFor: vi.fn(),

      density: "comfortable",
      signedInDid: null,
    })(discoverSource, "page2");

    const ready = feedState.snapshots[feedState.snapshots.length - 1];
    expect(ready.items).toHaveLength(1);
    expect(ready.status).toBe("ready");
    expect(ready.loadMoreError).toBe("rate limited");
  });

  it("classifies a first-page rate limit as status rate-limit", async () => {
    mocks.getFeed.mockRejectedValue(rateError());
    const feedState = stateSink<FeedState>({ items: [], status: "idle" });

    await createFeedLoader({
      feedCache: createCache<FeedState>(),
      setFeedState: feedState.set,
      setDevMetrics: stateSink<DevMetrics>(devMetricsInitial).set,
      restoreScrollFor: vi.fn(),

      density: "comfortable",
      signedInDid: null,
    })(discoverSource);

    const error = feedState.snapshots[feedState.snapshots.length - 1];
    expect(error.status).toBe("rate-limit");
    expect(error.error).toBe("rate limited");
  });

  it("does not mutate state after an aborted fetch", async () => {
    const controller = new AbortController();
    controller.abort();
    mocks.getFeed.mockRejectedValue(new DOMException("Aborted", "AbortError"));
    const feedState = stateSink<FeedState>({ items: [], status: "idle" });

    await createFeedLoader({
      feedCache: createCache<FeedState>(),
      setFeedState: feedState.set,
      setDevMetrics: stateSink<DevMetrics>(devMetricsInitial).set,
      restoreScrollFor: vi.fn(),

      density: "comfortable",
      signedInDid: null,
    })(discoverSource, undefined, controller.signal);

    expect(feedState.snapshots).toHaveLength(2); // loading was set, but no ready/error after abort
    expect(feedState.snapshots[1].status).toBe("loading");
  });
});

describe("createProfileFeedLoader", () => {
  beforeEach(() => {
    mocks.getProfileAuthed.mockReset();
    mocks.getAuthorFeedAuthed.mockReset();
    mocks.getAuthorFeed.mockReset();
  });

  it("serves a cached profile + feed and restores scroll", async () => {
    const author = makeProfile("alice");
    const cached = {
      feed: { items: [makeFeedItem(makePost("at://alice/1", author))], status: "ready" as const },
      profile: author,
    };
    const profileCache = createCache<{ feed: FeedState; profile: Profile | null }>({ "profile:did:alice:posts_with_replies": cached });
    const feedState = stateSink<FeedState>({ items: [], status: "idle" });
    const profileState = stateSink<Profile | null>(null);
    const restoreScrollFor = vi.fn();

    await createProfileFeedLoader({
      profileCache,
      setProfile: profileState.set,
      setFeedState: feedState.set,
      setDevMetrics: stateSink<DevMetrics>(devMetricsInitial).set,
      restoreScrollFor,
    })("did:alice");

    expect(mocks.getProfileAuthed).not.toHaveBeenCalled();
    expect(mocks.getAuthorFeedAuthed).not.toHaveBeenCalled();
    expect(profileState.snapshots[1]).toEqual(author);
    expect(feedState.snapshots[1]).toEqual(cached.feed);
    expect(restoreScrollFor).toHaveBeenCalledWith("profile:did:alice:posts_with_replies");
  });

  it("loads profile and feed together on a fresh read", async () => {
    const author = makeProfile("alice");
    mocks.getProfileAuthed.mockResolvedValue(author);
    mocks.getAuthorFeedAuthed.mockResolvedValue({ feed: [makeFeedItem(makePost("at://alice/1", author))] });
    const feedState = stateSink<FeedState>({ items: [], status: "idle" });
    const profileState = stateSink<Profile | null>(null);

    await createProfileFeedLoader({
      profileCache: createCache<{ feed: FeedState; profile: Profile | null }>(),
      setProfile: profileState.set,
      setFeedState: feedState.set,
      setDevMetrics: stateSink<DevMetrics>(devMetricsInitial).set,
      restoreScrollFor: vi.fn(),
    })("did:alice");

    expect(mocks.getProfileAuthed).toHaveBeenCalledWith("did:alice", undefined);
    expect(mocks.getAuthorFeedAuthed).toHaveBeenCalledWith("did:alice", undefined, undefined, "posts_with_replies");
    expect(profileState.snapshots[1]).toEqual(author);
    const ready = feedState.snapshots[feedState.snapshots.length - 1];
    expect(ready.status).toBe("ready");
    expect(ready.items).toHaveLength(1);
  });

  it("keeps the profile header when the author feed is blocked (allSettled separation)", async () => {
    const author = makeProfile("alice");
    mocks.getProfileAuthed.mockResolvedValue(author);
    mocks.getAuthorFeedAuthed.mockRejectedValue(new Error("Requester has blocked actor"));
    const feedState = stateSink<FeedState>({ items: [], status: "idle" });
    const profileState = stateSink<Profile | null>(null);

    await createProfileFeedLoader({
      profileCache: createCache<{ feed: FeedState; profile: Profile | null }>(),
      setProfile: profileState.set,
      setFeedState: feedState.set,
      setDevMetrics: stateSink<DevMetrics>(devMetricsInitial).set,
      restoreScrollFor: vi.fn(),
    })("did:alice");

    expect(profileState.snapshots[1]).toEqual(author); // header survives
    const error = feedState.snapshots[feedState.snapshots.length - 1];
    expect(error.status).toBe("error");
    expect(error.error).toContain("blocked");
  });

  it("falls back to the public author feed when the authed feed is empty", async () => {
    const author: Profile = { ...makeProfile("alice"), postsCount: 5 };
    mocks.getProfileAuthed.mockResolvedValue(author);
    mocks.getAuthorFeedAuthed.mockResolvedValue({ feed: [] });
    mocks.getAuthorFeed.mockResolvedValue({ feed: [makeFeedItem(makePost("at://alice/1", author))] });
    const feedState = stateSink<FeedState>({ items: [], status: "idle" });

    await createProfileFeedLoader({
      profileCache: createCache<{ feed: FeedState; profile: Profile | null }>(),
      setProfile: stateSink<Profile | null>(null).set,
      setFeedState: feedState.set,
      setDevMetrics: stateSink<DevMetrics>(devMetricsInitial).set,
      restoreScrollFor: vi.fn(),
    })("did:alice");

    expect(mocks.getAuthorFeed).toHaveBeenCalledWith("did:alice", undefined, undefined, "posts_with_replies");
    expect(feedState.snapshots[feedState.snapshots.length - 1].items).toHaveLength(1);
  });
});

describe("createSearchLoader", () => {
  beforeEach(() => mocks.searchPostsAuthed.mockReset());

  it("serves a cache hit and bumps cacheHits", async () => {
    const author = makeProfile("alice");
    const cached: SearchState = { posts: [makePost("at://alice/1", author)], status: "ready" };
    const searchCache = createCache<SearchState>({ "search:latest:any:hello": cached });
    const searchState = stateSink<SearchState>({ posts: [], status: "idle" });
    const metrics = stateSink<DevMetrics>(devMetricsInitial);

    await createSearchLoader({
      searchCache,
      setSearchState: searchState.set,
      setDevMetrics: metrics.set,
    })("hello", "latest", "");

    expect(mocks.searchPostsAuthed).not.toHaveBeenCalled();
    expect(searchState.snapshots[1]).toEqual(cached);
    expect(metrics.snapshots[metrics.snapshots.length - 1].cacheHits).toBe(1);
  });

  it("loads a fresh search and appends load-more pages", async () => {
    const author = makeProfile("alice");
    mocks.searchPostsAuthed.mockResolvedValue({
      cursor: "next",
      posts: [makePost("at://alice/1", author)],
    });
    const searchCache = createCache<SearchState>();
    const searchState = stateSink<SearchState>({ posts: [], status: "idle" });

    const loadSearch = createSearchLoader({
      searchCache,
      setSearchState: searchState.set,
      setDevMetrics: stateSink<DevMetrics>(devMetricsInitial).set,
    });

    await loadSearch("hello", "top", "en");
    const first = searchState.snapshots[searchState.snapshots.length - 1];
    expect(first.status).toBe("ready");
    expect(first.posts).toHaveLength(1);

    mocks.searchPostsAuthed.mockResolvedValue({
      cursor: undefined,
      posts: [makePost("at://alice/2", author)],
    });
    await loadSearch("hello", "top", "en", "next");
    const second = searchState.snapshots[searchState.snapshots.length - 1];
    expect(second.posts).toHaveLength(2);
  });
});

describe("createActorSearchLoader", () => {
  beforeEach(() => mocks.searchActors.mockReset());

  it("loads actors and appends load-more pages", async () => {
    mocks.searchActors.mockResolvedValue({ cursor: "next", actors: [makeProfile("alice")] });
    const actorCache = createCache<ActorSearchState>();
    const actorState = stateSink<ActorSearchState>({ actors: [], status: "idle" });

    const loadActorSearch = createActorSearchLoader({
      actorSearchCache: actorCache,
      setActorSearchState: actorState.set,
      setDevMetrics: stateSink<DevMetrics>(devMetricsInitial).set,
    });

    await loadActorSearch("alice");
    expect(actorState.snapshots[actorState.snapshots.length - 1].actors).toHaveLength(1);

    mocks.searchActors.mockResolvedValue({ cursor: undefined, actors: [makeProfile("bob")] });
    await loadActorSearch("alice", "next");
    expect(actorState.snapshots[actorState.snapshots.length - 1].actors).toHaveLength(2);
  });
});

describe("createFeedSearchLoader", () => {
  it("serves a cache hit", async () => {
    mocks.getPopularFeedGenerators.mockReset();
    const cached: FeedSearchState = { feeds: [], status: "ready" };
    const feedSearchCache = createCache<FeedSearchState>({ "feeds:hello": cached });
    const feedSearchState = stateSink<FeedSearchState>({ feeds: [], status: "idle" });

    await createFeedSearchLoader({
      feedSearchCache,
      setFeedSearchState: feedSearchState.set,
      setDevMetrics: stateSink<DevMetrics>(devMetricsInitial).set,
    })("Hello");

    expect(mocks.getPopularFeedGenerators).not.toHaveBeenCalled();
    expect(feedSearchState.snapshots[1]).toEqual(cached);
  });

  it("loads feeds on a fresh query", async () => {
    const feed = {
      uri: "at://did:plc:abc/app.bsky.feed.generator/whats-hot",
      displayName: "Discover",
      creator: makeProfile("alice"),
    };
    mocks.getPopularFeedGenerators.mockResolvedValue({ feeds: [feed] });
    const feedSearchState = stateSink<FeedSearchState>({ feeds: [], status: "idle" });

    await createFeedSearchLoader({
      feedSearchCache: createCache<FeedSearchState>(),
      setFeedSearchState: feedSearchState.set,
      setDevMetrics: stateSink<DevMetrics>(devMetricsInitial).set,
    })("discover");

    expect(mocks.getPopularFeedGenerators).toHaveBeenCalledWith(20, undefined, "discover", undefined);
    expect(feedSearchState.snapshots[feedSearchState.snapshots.length - 1].feeds).toHaveLength(1);
  });

  it("appends feeds and carries the cursor on load-more", async () => {
    const feedA = { uri: "at://did:plc:abc/app.bsky.feed.generator/a", displayName: "A", creator: makeProfile("alice") };
    const feedB = { uri: "at://did:plc:abc/app.bsky.feed.generator/b", displayName: "B", creator: makeProfile("alice") };
    mocks.getPopularFeedGenerators.mockResolvedValue({ feeds: [feedB], cursor: "page2" });
    const feedSearchCache = createCache<FeedSearchState>();
    const feedSearchState = stateSink<FeedSearchState>({ feeds: [feedA], cursor: "page1", status: "ready" });

    await createFeedSearchLoader({
      feedSearchCache,
      setFeedSearchState: feedSearchState.set,
      setDevMetrics: stateSink<DevMetrics>(devMetricsInitial).set,
    })("discover", "page1");

    expect(mocks.getPopularFeedGenerators).toHaveBeenCalledWith(20, undefined, "discover", "page1");
    expect(feedSearchState.snapshots[feedSearchState.snapshots.length - 1]).toEqual({
      feeds: [feedA, feedB],
      cursor: "page2",
      status: "ready",
    });
  });

  it("surfaces a load-more error without dropping loaded feeds", async () => {
    const feedA = { uri: "at://did:plc:abc/app.bsky.feed.generator/a", displayName: "A", creator: makeProfile("alice") };
    mocks.getPopularFeedGenerators.mockRejectedValue(rateError());
    const feedSearchState = stateSink<FeedSearchState>({ feeds: [feedA], cursor: "page1", status: "ready" });

    await createFeedSearchLoader({
      feedSearchCache: createCache<FeedSearchState>(),
      setFeedSearchState: feedSearchState.set,
      setDevMetrics: stateSink<DevMetrics>(devMetricsInitial).set,
    })("discover", "page1");

    const finalState = feedSearchState.snapshots[feedSearchState.snapshots.length - 1];
    expect(finalState.status).toBe("ready");
    expect(finalState.feeds).toEqual([feedA]);
    expect(finalState.loadMoreError).toBe("rate limited");
  });
});

describe("createThreadLoader (startThreadLoad)", () => {
  it("aborts a prior controller, caches, and commits the ready thread", async () => {
    const author = makeProfile("alice");
    const thread: ThreadNode = { post: makePost("at://alice/1", author) };
    mocks.getPostThreadAuthed.mockResolvedValue({ thread });
    const threadCache = createCache<ThreadNode>();
    const threadState = stateSink<ThreadState>({ status: "idle" });
    const controllerRef: { current: AbortController | null } = { current: null };

    const startThreadLoad = createThreadLoader({
      threadCache,
      setThread: threadState.set,
      setThreadBranchResults: vi.fn(),
      threadLoadControllerRef: controllerRef,
    });
    const controller = startThreadLoad("did:alice", "1");

    expect(controllerRef.current).toBe(controller);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const ready = threadState.snapshots[threadState.snapshots.length - 1];
    expect(ready.status).toBe("ready");
    expect(ready.node).toEqual(thread);
    expect(threadCache.get("did:alice:1")).toEqual(thread);
  });

  it("commits an error state on failure", async () => {
    mocks.getPostThreadAuthed.mockImplementation(() => Promise.reject(new Error("boom")));
    const threadState = stateSink<ThreadState>({ status: "idle" });

    createThreadLoader({
      threadCache: createCache<ThreadNode>(),
      setThread: threadState.set,
      setThreadBranchResults: vi.fn(),
      threadLoadControllerRef: { current: null },
    })("did:alice", "1");

    await new Promise((resolve) => setTimeout(resolve, 10));
    const error = threadState.snapshots[threadState.snapshots.length - 1];
    expect(error.status).toBe("error");
    expect(error.error).toBe("boom");
  });
});

describe("createThreadBranchLoader (loadThreadBranch)", () => {
  const author = makeProfile("alice");
  const root: ThreadNode = {
    post: makePost("at://alice/1", author),
    replies: [{ post: makePost("at://alice/2", author) }],
  };
  const branch: ThreadNode = { post: makePost("at://alice/3", author) };

  it("applies a cached branch without fetching", () => {
    mocks.getPostThreadByUriAuthed.mockReset();
    const threadState = stateSink<ThreadState>({ status: "ready", node: root });
    const loadingState = stateSink<Record<string, boolean>>({});
    const branchResults = stateSink<Record<string, BranchLoadResult>>({});
    const threadCache = createCache<ThreadNode>();
    const branchCache = createCache<ThreadNode>();
    const controllerRef: { current: AbortController | null } = { current: new AbortController() };

    const loadBranch = createThreadBranchLoader({
      threadBranchCache: branchCache,
      threadCache,
      threadLoadControllerRef: controllerRef,
      setThread: threadState.set,
      setThreadBranchResults: branchResults.set,
      setLoadingThreadBranches: loadingState.set,
      setDevMetrics: stateSink<DevMetrics>(devMetricsInitial).set,
      getThread: () => threadState.snapshots[threadState.snapshots.length - 1],
      getLoadingThreadBranches: () => loadingState.snapshots[loadingState.snapshots.length - 1],
      getRoute: () => ({ kind: "post" as const, actor: "did:alice", rkey: "1" }),
    });
    branchCache.set("at://alice/3", branch);
    loadBranch("at://alice/3");

    expect(mocks.getPostThreadByUriAuthed).not.toHaveBeenCalled();
    const updated = threadState.snapshots[threadState.snapshots.length - 1];
    expect(updated.node).not.toBe(root);
    expect(updated.node && "post" in updated.node ? updated.node.post.uri : undefined).toBe("at://alice/1");
  });

  it("fetches, caches, and applies a fresh branch", async () => {
    mocks.getPostThreadByUriAuthed.mockReset();
    mocks.getPostThreadByUriAuthed.mockResolvedValue({ thread: branch });
    const threadState = stateSink<ThreadState>({ status: "ready", node: root });
    const loadingState = stateSink<Record<string, boolean>>({});
    const branchResults = stateSink<Record<string, BranchLoadResult>>({});
    const threadCache = createCache<ThreadNode>();
    const branchCache = createCache<ThreadNode>();
    const controllerRef: { current: AbortController | null } = { current: new AbortController() };

    const loadBranch = createThreadBranchLoader({
      threadBranchCache: branchCache,
      threadCache,
      threadLoadControllerRef: controllerRef,
      setThread: threadState.set,
      setThreadBranchResults: branchResults.set,
      setLoadingThreadBranches: loadingState.set,
      setDevMetrics: stateSink<DevMetrics>(devMetricsInitial).set,
      getThread: () => threadState.snapshots[threadState.snapshots.length - 1],
      getLoadingThreadBranches: () => loadingState.snapshots[loadingState.snapshots.length - 1],
      getRoute: () => ({ kind: "post" as const, actor: "did:alice", rkey: "1" }),
    });
    loadBranch("at://alice/3");

    expect(mocks.getPostThreadByUriAuthed).toHaveBeenCalledWith("at://alice/3", expect.anything());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(branchCache.get("at://alice/3")).toEqual(branch);
    const applied = threadState.snapshots[threadState.snapshots.length - 1].node;
    expect(applied && "post" in applied ? applied.post.uri : undefined).toBe("at://alice/1");
  });

  it("records a branch error result on failure", async () => {
    mocks.getPostThreadByUriAuthed.mockImplementation(() => Promise.reject(new Error("branch boom")));
    const threadState = stateSink<ThreadState>({ status: "ready", node: root });
    const loadingState = stateSink<Record<string, boolean>>({});
    const branchResults = stateSink<Record<string, BranchLoadResult>>({});

    const loadBranch = createThreadBranchLoader({
      threadBranchCache: createCache<ThreadNode>(),
      threadCache: createCache<ThreadNode>(),
      threadLoadControllerRef: { current: new AbortController() },
      setThread: threadState.set,
      setThreadBranchResults: branchResults.set,
      setLoadingThreadBranches: loadingState.set,
      setDevMetrics: stateSink<DevMetrics>(devMetricsInitial).set,
      getThread: () => threadState.snapshots[threadState.snapshots.length - 1],
      getLoadingThreadBranches: () => loadingState.snapshots[loadingState.snapshots.length - 1],
      getRoute: () => ({ kind: "post" as const, actor: "did:alice", rkey: "1" }),
    });

    loadBranch("at://alice/3");

    await new Promise((resolve) => setTimeout(resolve, 10));
    const results = branchResults.snapshots[branchResults.snapshots.length - 1];
    expect(results["at://alice/3"].error).toBe("branch boom");
  });

  it("no-ops when the thread is not ready", () => {
    mocks.getPostThreadByUriAuthed.mockReset();
    const threadState = stateSink<ThreadState>({ status: "loading" });
    const loadBranch = createThreadBranchLoader({
      threadBranchCache: createCache<ThreadNode>(),
      threadCache: createCache<ThreadNode>(),
      threadLoadControllerRef: { current: new AbortController() },
      setThread: threadState.set,
      setThreadBranchResults: vi.fn(),
      setLoadingThreadBranches: vi.fn(),
      setDevMetrics: vi.fn(),
      getThread: () => threadState.snapshots[threadState.snapshots.length - 1],
      getLoadingThreadBranches: () => ({}),
      getRoute: () => ({ kind: "post" as const, actor: "did:alice", rkey: "1" }),
    });

    loadBranch("at://alice/3");
    expect(mocks.getPostThreadByUriAuthed).not.toHaveBeenCalled();
  });
});

describe("metadata loaders", () => {
  beforeEach(() => {
    mocks.getFeedGenerator.mockReset();
    mocks.getList.mockReset();
  });

  it("loadFeedMetadata serves a cache hit", async () => {
    const view = { uri: "at://did:plc:abc/app.bsky.feed.generator/whats-hot", displayName: "Discover", creator: makeProfile("alice") };
    const cache = createCache<FeedGeneratorView>({ "at://did:plc:abc/app.bsky.feed.generator/whats-hot": view });
    const metaState = stateSink<FeedGeneratorView | null>(null);

    await createFeedMetadataLoader({
      feedMetadataCache: cache,
      setFeedMetadata: metaState.set,
      setDevMetrics: stateSink<DevMetrics>(devMetricsInitial).set,
    })("at://did:plc:abc/app.bsky.feed.generator/whats-hot");

    expect(mocks.getFeedGenerator).not.toHaveBeenCalled();
    expect(metaState.snapshots[1]).toEqual(view);
  });

  it("loadFeedMetadata fetches and caches on a miss", async () => {
    const view = { uri: "at://did:plc:abc/app.bsky.feed.generator/whats-hot", displayName: "Discover", creator: makeProfile("alice") };
    mocks.getFeedGenerator.mockResolvedValue({ view });
    const cache = createCache<FeedGeneratorView>();
    const metaState = stateSink<FeedGeneratorView | null>(null);

    await createFeedMetadataLoader({
      feedMetadataCache: cache,
      setFeedMetadata: metaState.set,
      setDevMetrics: stateSink<DevMetrics>(devMetricsInitial).set,
    })("at://did:plc:abc/app.bsky.feed.generator/whats-hot");

    expect(mocks.getFeedGenerator).toHaveBeenCalledWith("at://did:plc:abc/app.bsky.feed.generator/whats-hot", undefined);
    expect(cache.get("at://did:plc:abc/app.bsky.feed.generator/whats-hot")).toEqual(view);
    expect(metaState.snapshots[metaState.snapshots.length - 1]).toEqual(view);
  });

  it("loadListMetadata clears the list on a failed fetch", async () => {
    mocks.getList.mockRejectedValue(new Error("gone"));
    const metaState = stateSink<ListView | null>(null);

    await createListMetadataLoader({
      listMetadataCache: createCache<ListView>(),
      setListMetadata: metaState.set,
      setDevMetrics: stateSink<DevMetrics>(devMetricsInitial).set,
    })("at://did:plc:abc/app.bsky.graph.list/l");

    expect(metaState.snapshots[metaState.snapshots.length - 1]).toBeNull();
  });
});
