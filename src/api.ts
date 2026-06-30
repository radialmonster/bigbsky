const API_HOST = "https://public.api.bsky.app/xrpc";
const SEARCH_API_HOST = "https://api.bsky.app/xrpc";

export class ApiError extends Error {
  status: number;

  constructor(status: number, statusText: string) {
    super(`${status} ${statusText}`);
    this.status = status;
  }
}

export type Profile = {
  did: string;
  handle: string;
  displayName?: string;
  avatar?: string;
  description?: string;
  followersCount?: number;
  followsCount?: number;
  postsCount?: number;
  labels?: Array<{ val?: string; src?: string; uri?: string }>;
  // Viewer-relative state, only present on authenticated reads (the public
  // AppView omits it). `following`/`blocking` hold the record URIs when set.
  viewer?: {
    following?: string;
    followedBy?: string;
    muted?: boolean;
    blockedBy?: boolean;
    blocking?: string;
  };
};

export type FeedGeneratorView = {
  uri: string;
  cid?: string;
  did?: string;
  creator: Profile;
  displayName: string;
  description?: string;
  avatar?: string;
  likeCount?: number;
  likedByCount?: number;
  indexedAt?: string;
};

export type RichTextFacet = {
  index?: { byteStart?: number; byteEnd?: number };
  features?: Array<{ $type?: string; uri?: string; did?: string; tag?: string }>;
};

export type FeedPost = {
  uri: string;
  cid: string;
  author: Profile;
  record: {
    text?: string;
    createdAt?: string;
    embed?: unknown;
    reply?: {
      root?: { uri?: string; cid?: string };
      parent?: { uri?: string; cid?: string };
    };
    facets?: RichTextFacet[];
    langs?: string[];
    labels?: unknown;
  };
  embed?: unknown;
  replyCount?: number;
  repostCount?: number;
  likeCount?: number;
  quoteCount?: number;
  labels?: Array<{
    val?: string;
    src?: string;
    uri?: string;
  }>;
  viewer?: {
    like?: string;
    repost?: string;
    bookmarked?: boolean;
    threadMuted?: boolean;
    replyDisabled?: boolean;
    embeddingDisabled?: boolean;
  };
  indexedAt?: string;
};

export type RecordEmbedView = {
  uri: string;
  cid?: string;
  author?: Profile;
  value?: {
    text?: string;
    createdAt?: string;
    embed?: unknown;
    facets?: RichTextFacet[];
  };
  embeds?: unknown[];
  labels?: unknown[];
  replyCount?: number;
  repostCount?: number;
  likeCount?: number;
  quoteCount?: number;
  indexedAt?: string;
  $type?: string;
};

export type FeedItem = {
  post: FeedPost;
  reason?: {
    by?: Profile;
    indexedAt?: string;
  };
  reply?: {
    root?: FeedPost;
    parent?: FeedPost;
  };
};

export type FeedResponse = {
  cursor?: string;
  feed: FeedItem[];
};

export type SearchPostsResponse = {
  cursor?: string;
  posts: FeedPost[];
};

export type ActorSearchResponse = {
  cursor?: string;
  actors: Profile[];
};

export type ThreadPostNode = {
  post: FeedPost;
  parent?: ThreadNode;
  replies?: ThreadNode[];
};

export type ThreadNode =
  | ThreadPostNode
  | {
      $type: string;
      message?: string;
    };

async function getJson<T>(path: string, params: Record<string, string>, signal?: AbortSignal, host = API_HOST): Promise<T> {
  const url = new URL(`${host}/${path}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));

  window.dispatchEvent(
    new CustomEvent("bigbsky:api-request", {
      detail: {
        host: url.host,
        path,
      },
    }),
  );

  const response = await fetch(url, { signal });
  if (!response.ok) {
    // Surface the AppView's error body (e.g. {"error":"UpstreamFailure",
    // "message":"feed unavailable"}) instead of a bare status text.
    let detail = response.statusText;
    try {
      const body = (await response.json()) as { error?: string; message?: string };
      detail = body.message || body.error || detail;
    } catch {
      // non-JSON error body; keep the status text
    }
    throw new ApiError(response.status, detail);
  }

  return response.json() as Promise<T>;
}

export function getFeed(feed: string, cursor?: string, signal?: AbortSignal) {
  return getJson<FeedResponse>(
    "app.bsky.feed.getFeed",
    {
      feed,
      limit: "30",
      ...(cursor ? { cursor } : {}),
    },
    signal,
  );
}

export function getFeedGenerator(feed: string, signal?: AbortSignal) {
  return getJson<{ view: FeedGeneratorView }>("app.bsky.feed.getFeedGenerator", { feed }, signal);
}

export type PopularFeedsResponse = {
  cursor?: string;
  feeds: FeedGeneratorView[];
};

export function getPopularFeedGenerators(limit = 12, signal?: AbortSignal, query?: string) {
  return getJson<PopularFeedsResponse>(
    "app.bsky.unspecced.getPopularFeedGenerators",
    {
      limit: String(limit),
      ...(query?.trim() ? { query: query.trim() } : {}),
    },
    signal,
  );
}

export type TrendingTopic = {
  topic: string;
  link: string;
  description?: string;
};

export type TrendingTopicsResponse = {
  topics: TrendingTopic[];
  suggested: TrendingTopic[];
};

export function getTrendingTopics(limit = 10, signal?: AbortSignal) {
  return getJson<TrendingTopicsResponse>(
    "app.bsky.unspecced.getTrendingTopics",
    { limit: String(limit) },
    signal,
  );
}

export type ListView = {
  uri: string;
  cid?: string;
  name: string;
  purpose?: string;
  description?: string;
  avatar?: string;
  listItemCount?: number;
  creator?: Profile;
  indexedAt?: string;
  // Viewer-relative state on authenticated reads. `blocked` holds the
  // listblock record URI when the viewer subscribes to this list as a block
  // list; `muted` is true when subscribed as a mute list.
  viewer?: {
    muted?: boolean;
    blocked?: string;
  };
};

export type ActorListsResponse = {
  cursor?: string;
  lists: ListView[];
};

export type LikesResponse = {
  uri: string;
  cursor?: string;
  likes: Array<{ actor: Profile; createdAt?: string; indexedAt?: string }>;
};

export type RepostedByResponse = {
  uri: string;
  cursor?: string;
  repostedBy: Profile[];
};

export type QuotesResponse = {
  uri: string;
  cursor?: string;
  posts: FeedPost[];
};

export function getLikes(uri: string, limit = 30, signal?: AbortSignal) {
  return getJson<LikesResponse>("app.bsky.feed.getLikes", { uri, limit: String(limit) }, signal);
}

export function getRepostedBy(uri: string, limit = 30, signal?: AbortSignal) {
  return getJson<RepostedByResponse>("app.bsky.feed.getRepostedBy", { uri, limit: String(limit) }, signal);
}

export function getQuotes(uri: string, limit = 30, signal?: AbortSignal) {
  return getJson<QuotesResponse>("app.bsky.feed.getQuotes", { uri, limit: String(limit) }, signal);
}

export function getActorLists(actor: string, limit = 30, signal?: AbortSignal) {
  return getJson<ActorListsResponse>(
    "app.bsky.graph.getLists",
    { actor, limit: String(limit) },
    signal,
  );
}

export function isListUri(uri: string) {
  return uri.includes("/app.bsky.graph.list/");
}

export function isFeedGeneratorUri(uri: string) {
  return uri.includes("/app.bsky.feed.generator/");
}

export function getListFeed(list: string, cursor?: string, signal?: AbortSignal) {
  return getJson<FeedResponse>(
    "app.bsky.feed.getListFeed",
    {
      list,
      limit: "30",
      ...(cursor ? { cursor } : {}),
    },
    signal,
  );
}

export function getList(list: string, signal?: AbortSignal) {
  return getJson<{ list: ListView; cursor?: string }>(
    "app.bsky.graph.getList",
    { list, limit: "1" },
    signal,
  );
}

export function getActorFeeds(actor: string, limit = 30, signal?: AbortSignal) {
  return getJson<PopularFeedsResponse>(
    "app.bsky.feed.getActorFeeds",
    { actor, limit: String(limit) },
    signal,
  );
}

export type AuthorFeedFilter = "posts_with_replies" | "posts_no_replies" | "posts_with_media" | "posts_with_video";

export function getAuthorFeed(actor: string, cursor?: string, signal?: AbortSignal, filter?: AuthorFeedFilter) {
  return getJson<FeedResponse>(
    "app.bsky.feed.getAuthorFeed",
    {
      actor,
      limit: "30",
      ...(filter ? { filter } : {}),
      ...(cursor ? { cursor } : {}),
    },
    signal,
  );
}

export function getProfile(actor: string, signal?: AbortSignal) {
  return getJson<Profile>("app.bsky.actor.getProfile", { actor }, signal);
}

export function searchPosts(query: string, sort: "top" | "latest", lang?: string, cursor?: string, signal?: AbortSignal) {
  return getJson<SearchPostsResponse>(
    "app.bsky.feed.searchPosts",
    {
      q: query,
      sort,
      ...(lang ? { lang } : {}),
      limit: "30",
      ...(cursor ? { cursor } : {}),
    },
    signal,
    SEARCH_API_HOST,
  );
}

export function searchActors(query: string, cursor?: string, signal?: AbortSignal) {
  return getJson<ActorSearchResponse>(
    "app.bsky.actor.searchActors",
    {
      q: query,
      limit: "30",
      ...(cursor ? { cursor } : {}),
    },
    signal,
  );
}

// Short-lived browser-local cache for handle -> DID resolution. Opening posts by
// handle (e.g. /profile/<handle>/post/<rkey>) re-resolves the same handle on
// every thread/profile load, so a brief cache removes repeated identical lookups
// while navigating. Handles can be reassigned, so the TTL is intentionally short
// (DIDs are the durable identifiers); DIDs passed in are returned without a
// lookup and never cached. Only successful resolutions are cached, and each call
// keeps its own AbortSignal (we deliberately don't share an in-flight promise
// across callers, so one caller's abort can't reject another's lookup).
const RESOLVE_HANDLE_TTL_MS = 5 * 60 * 1000;
const resolvedHandleCache = new Map<string, { did: string; expires: number }>();

export async function resolveHandle(handleOrDid: string, signal?: AbortSignal) {
  if (handleOrDid.startsWith("did:")) {
    return handleOrDid;
  }

  const cached = resolvedHandleCache.get(handleOrDid);
  if (cached && cached.expires > Date.now()) {
    return cached.did;
  }

  const result = await getJson<{ did: string }>(
    "com.atproto.identity.resolveHandle",
    { handle: handleOrDid },
    signal,
  );
  const now = Date.now();
  // Sweep expired entries on write so the Map stays bounded by the number of
  // distinct handles resolved within one TTL window, rather than growing for
  // the lifetime of a long-lived tab. Entries are only ever read while live
  // (the `expires > now` check above), so dropping the expired ones is free.
  for (const [handle, entry] of resolvedHandleCache) {
    if (entry.expires <= now) {
      resolvedHandleCache.delete(handle);
    }
  }
  resolvedHandleCache.set(handleOrDid, {
    did: result.did,
    expires: now + RESOLVE_HANDLE_TTL_MS,
  });
  return result.did;
}

export async function getPostThread(handleOrDid: string, rkey: string, signal?: AbortSignal) {
  const did = await resolveHandle(handleOrDid, signal);
  const uri = `at://${did}/app.bsky.feed.post/${rkey}`;
  return getPostThreadByUri(uri, signal);
}

export function getPostThreadByUri(uri: string, signal?: AbortSignal) {
  return getJson<{ thread: ThreadNode }>(
    "app.bsky.feed.getPostThread",
    {
      uri,
      depth: "100",
      parentHeight: "12",
    },
    signal,
  );
}

export function getEmbedImages(embed: unknown) {
  if (!embed || typeof embed !== "object") {
    return [];
  }

  type EmbedImage = {
    thumb?: string;
    thumbnail?: string;
    fullsize?: string;
    alt?: string;
    aspectRatio?: { width?: number; height?: number };
  };
  const normalize = (images: EmbedImage[]) =>
    images.map((image) => ({
      thumb: image.thumb ?? image.thumbnail,
      fullsize: image.fullsize,
      alt: image.alt,
      aspectRatio: image.aspectRatio,
    }));

  const candidate = embed as {
    images?: EmbedImage[];
    items?: EmbedImage[];
    media?: {
      images?: EmbedImage[];
      items?: EmbedImage[];
    };
  };
  if (Array.isArray(candidate.images)) {
    return normalize(candidate.images);
  }
  if (Array.isArray(candidate.items)) {
    return normalize(candidate.items);
  }

  if (Array.isArray(candidate.media?.images)) {
    return normalize(candidate.media.images);
  }

  return Array.isArray(candidate.media?.items) ? normalize(candidate.media.items) : [];
}

export function getExternalEmbed(embed: unknown) {
  if (!embed || typeof embed !== "object") {
    return null;
  }

  const candidate = embed as {
    external?: { uri?: string; title?: string; description?: string; thumb?: string };
    media?: {
      external?: { uri?: string; title?: string; description?: string; thumb?: string };
    };
  };
  return candidate.external ?? candidate.media?.external ?? null;
}

export function getVideoEmbed(embed: unknown) {
  if (!embed || typeof embed !== "object") {
    return null;
  }

  const candidate = embed as {
    $type?: string;
    playlist?: string;
    thumbnail?: string;
    aspectRatio?: { width?: number; height?: number };
    alt?: string;
    media?: {
      $type?: string;
      playlist?: string;
      thumbnail?: string;
      aspectRatio?: { width?: number; height?: number };
      alt?: string;
    };
  };
  const video = candidate.playlist || candidate.thumbnail ? candidate : candidate.media;
  if (!video?.playlist && !video?.thumbnail) {
    return null;
  }

  return {
    type: video.$type,
    playlist: video.playlist,
    thumbnail: video.thumbnail,
    aspectRatio: video.aspectRatio,
    alt: video.alt,
  };
}

export function getRecordEmbed(embed: unknown) {
  if (!embed || typeof embed !== "object") {
    return null;
  }

  const candidate = embed as {
    record?: RecordEmbedView | { $type?: string; message?: string; record?: RecordEmbedView | { $type?: string; message?: string } };
  };
  const recordContainer = candidate.record;
  const record =
    recordContainer && typeof recordContainer === "object" && "record" in recordContainer
      ? recordContainer.record
      : recordContainer;
  if (!record || typeof record !== "object" || !("uri" in record)) {
    return null;
  }

  return record as RecordEmbedView;
}

// Hydrated AppView embed view types that BigBsky renders locally. Used to detect
// posts that carry an embed shape we don't know how to display, so we can show a
// generic fallback notice instead of silently dropping the content.
const KNOWN_EMBED_VIEW_TYPES = new Set([
  "app.bsky.embed.images#view",
  "app.bsky.embed.video#view",
  "app.bsky.embed.external#view",
  "app.bsky.embed.record#view",
  "app.bsky.embed.recordWithMedia#view",
]);

// Returns the embed's `$type` when it is a recognizable-but-unsupported embed
// view, or null when the embed is absent, untyped, or a type we already render.
// The caller should still confirm none of the known extractors produced output
// before showing a fallback, so a future/unknown shape that happens to reuse a
// known field (e.g. `images`) is not double-flagged.
export function getUnknownEmbedType(embed: unknown): string | null {
  if (!embed || typeof embed !== "object") {
    return null;
  }
  const type = (embed as { $type?: unknown }).$type;
  if (typeof type !== "string" || type.length === 0) {
    return null;
  }
  if (KNOWN_EMBED_VIEW_TYPES.has(type)) {
    return null;
  }
  return type;
}
