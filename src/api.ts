const API_HOST = "https://public.api.bsky.app/xrpc";

export type Profile = {
  did: string;
  handle: string;
  displayName?: string;
  avatar?: string;
  description?: string;
  followersCount?: number;
  followsCount?: number;
  postsCount?: number;
};

export type FeedPost = {
  uri: string;
  cid: string;
  author: Profile;
  record: {
    text?: string;
    createdAt?: string;
    embed?: unknown;
  };
  embed?: unknown;
  replyCount?: number;
  repostCount?: number;
  likeCount?: number;
  quoteCount?: number;
  indexedAt?: string;
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

export type ThreadPostNode = {
  post: FeedPost;
  replies?: ThreadNode[];
};

export type ThreadNode =
  | ThreadPostNode
  | {
      $type: string;
      message?: string;
    };

async function getJson<T>(path: string, params: Record<string, string>, signal?: AbortSignal): Promise<T> {
  const url = new URL(`${API_HOST}/${path}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));

  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
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

  const candidate = embed as {
    images?: Array<{
      thumb?: string;
      fullsize?: string;
      alt?: string;
      aspectRatio?: { width?: number; height?: number };
    }>;
  };
  return Array.isArray(candidate.images) ? candidate.images : [];
}

export function getExternalEmbed(embed: unknown) {
  if (!embed || typeof embed !== "object") {
    return null;
  }

  const candidate = embed as {
    external?: { uri?: string; title?: string; description?: string; thumb?: string };
  };
  return candidate.external ?? null;
}
