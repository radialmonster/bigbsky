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

export function getAuthorFeed(actor: string, cursor?: string, signal?: AbortSignal) {
  return getJson<FeedResponse>(
    "app.bsky.feed.getAuthorFeed",
    {
      actor,
      limit: "30",
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

export async function resolveHandle(handleOrDid: string, signal?: AbortSignal) {
  if (handleOrDid.startsWith("did:")) {
    return handleOrDid;
  }

  const result = await getJson<{ did: string }>(
    "com.atproto.identity.resolveHandle",
    { handle: handleOrDid },
    signal,
  );
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
      depth: "6",
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
