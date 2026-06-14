import type { BrowserOAuthClient, OAuthSession } from "@atproto/oauth-client-browser";
import type { AuthorFeedFilter, FeedResponse, ListView, Profile, SearchPostsResponse, ThreadNode } from "./api";
// Static import: api.ts is already in the main chunk (App.tsx imports it
// statically), so dynamically importing these public fallbacks cannot split
// them into a separate chunk — it only triggers Vite's mixed-import warning.
import {
  getAuthorFeed,
  getFeed,
  getPostThread,
  getPostThreadByUri,
  getProfile,
  resolveHandle,
  searchPosts,
} from "./api";

const productionClientId = "https://bigbsky.com/oauth-client-metadata.json";
const handleResolver = "https://bsky.social";
const appViewDid = "did:web:api.bsky.app";
const appViewServiceType = "bsky_appview";
const activeDidKey = "bigbsky:auth:active-did";
const activeHandleKey = "bigbsky:auth:active-handle";
const oauthDatabaseName = "@atproto-oauth-client";

let clientPromise: Promise<BrowserOAuthClient> | null = null;
// Retained so authenticated reads (e.g. the signed-in user's saved feeds) can
// reuse the active OAuth session instead of re-restoring it.
let activeSession: OAuthSession | null = null;

function asAppViewAgent(agent: InstanceType<typeof import("@atproto/api").Agent>) {
  return agent.withProxy(appViewServiceType, appViewDid);
}

async function readPostBookmarked(agent: InstanceType<typeof import("@atproto/api").Agent>, uri: string): Promise<boolean> {
  const response = await asAppViewAgent(agent).app.bsky.feed.getPostThread({ uri, depth: 0, parentHeight: 0 });
  const thread = response.data.thread as ThreadNode;
  return "post" in thread ? !!thread.post.viewer?.bookmarked : false;
}

function safeLocalStorageSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Browser-local auth hints are best-effort; OAuth state lives in the client store.
  }
}

function safeLocalStorageRemove(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    // Ignore storage-denied environments.
  }
}

function isDeletedSessionError(error: unknown) {
  return /session.*deleted|deleted.*session/i.test(String(error));
}

export type SubscribedFeed = {
  uri: string;
  displayName: string;
  description?: string;
  creatorHandle?: string;
  avatar?: string;
  pinned: boolean;
};

export type AuthSnapshot = {
  did: string;
  handle: string;
  displayName?: string;
  avatar?: string;
  followersCount?: number;
  followsCount?: number;
  postsCount?: number;
  restoredFromCallback?: boolean;
};

export type AuthInitResult = {
  session: AuthSnapshot | null;
  status: "signed-out" | "restored" | "callback" | "error";
  message?: string;
};

function isLoopbackOrigin() {
  return window.location.hostname === "127.0.0.1" || window.location.hostname === "[::1]" || window.location.hostname === "localhost";
}

async function getClientId() {
  if (!isLoopbackOrigin()) {
    return productionClientId;
  }

  const [{ buildLoopbackClientId }, { OAUTH_SCOPE }] = await Promise.all([
    import("@atproto/oauth-client-browser"),
    import("./scopes"),
  ]);
  // The loopback client id carries its metadata in the query string. Append our
  // scope so localhost auth requests the same permissions as production (the
  // hosted oauth-client-metadata.json), instead of the bare `atproto` default.
  const loopbackClientId = buildLoopbackClientId({
    hostname: window.location.hostname,
    port: window.location.port,
    pathname: "/",
  });
  return `${loopbackClientId}&scope=${encodeURIComponent(OAUTH_SCOPE)}`;
}

export function looksLikeOAuthCallback() {
  const params = new URLSearchParams(window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.search);
  return params.has("state") && (params.has("code") || params.has("error"));
}

async function getClient() {
  clientPromise ??= (async () => {
    const [{ BrowserOAuthClient }, clientId] = await Promise.all([import("@atproto/oauth-client-browser"), getClientId()]);
    return BrowserOAuthClient.load({
      clientId,
      handleResolver,
    });
  })();
  return clientPromise;
}

async function snapshotSession(session: OAuthSession, restoredFromCallback = false): Promise<AuthSnapshot> {
  activeSession = session;
  const { Agent } = await import("@atproto/api");
  const agent = new Agent(session);
  const profile = await agent.getProfile({ actor: agent.accountDid });
  const data = profile.data as Profile;
  const snapshot: AuthSnapshot = {
    did: agent.accountDid,
    handle: data.handle,
    displayName: data.displayName,
    avatar: data.avatar,
    followersCount: data.followersCount,
    followsCount: data.followsCount,
    postsCount: data.postsCount,
    restoredFromCallback,
  };

  safeLocalStorageSet(activeDidKey, snapshot.did);
  safeLocalStorageSet(activeHandleKey, snapshot.handle);
  return snapshot;
}

export async function initAuthSession(): Promise<AuthInitResult> {
  try {
    const hasCallback = looksLikeOAuthCallback();
    const activeDid = localStorage.getItem(activeDidKey);
    if (!hasCallback && !activeDid) {
      return { session: null, status: "signed-out" };
    }

    const client = await getClient();
    const result = await client.init();
    if (result?.session) {
      return {
        session: await snapshotSession(result.session, "state" in result),
        status: "state" in result ? "callback" : "restored",
      };
    }

    if (activeDid) {
      const restored = await client.restore(activeDid);
      return { session: await snapshotSession(restored), status: "restored" };
    }

    return { session: null, status: "signed-out" };
  } catch (error) {
    if (isDeletedSessionError(error)) {
      await clearOAuthLocalSession();
      return { session: null, status: "signed-out" };
    }

    return {
      session: null,
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function startSignIn(input: string) {
  const client = await getClient();
  await client.signIn(input, {
    state: crypto.randomUUID(),
  });
}

export async function signOut(did?: string) {
  let revokeWarning: string | undefined;

  try {
    if (did) {
      const client = await getClient();
      await client.revoke(did);
      // Best-effort cleanup of the client's IndexedDB/listeners. The library's
      // sync dispose() is broken in this version — it calls the undefined
      // this[Symbol.dispose]() and throws "Symbol.dispose is not a function" —
      // so use the async disposer (polyfilled at runtime by the library's
      // core-js import) and swallow any failure: disposal must never turn a
      // successful revoke into a sign-out warning. Reached via a cast because
      // Symbol.asyncDispose isn't in our TS lib target.
      const asyncDispose = (Symbol as { asyncDispose?: symbol }).asyncDispose;
      if (asyncDispose) {
        try {
          await (client as unknown as Record<symbol, () => Promise<void>>)[asyncDispose]?.();
        } catch {
          /* ignore disposal failures */
        }
      }
      clientPromise = null;
    }
  } catch (error) {
    revokeWarning = error instanceof Error ? error.message : String(error);
  }

  activeSession = null;
  safeLocalStorageRemove(activeDidKey);
  safeLocalStorageRemove(activeHandleKey);
  await clearOAuthSessionStorage();
  return revokeWarning;
}

export async function clearOAuthLocalSession() {
  activeSession = null;
  clientPromise = null;
  safeLocalStorageRemove(activeDidKey);
  safeLocalStorageRemove(activeHandleKey);
  await clearOAuthSessionStorage();
}

// Authenticated reverse-chronological "Following" home timeline. Returns an
// empty feed when signed out. Same shape as the public getFeed response so the
// app's feed loader can treat it like any other source.
export async function getFollowingTimeline(cursor?: string, signal?: AbortSignal): Promise<FeedResponse> {
  const session = await ensureSession();
  if (!session) {
    return { feed: [] };
  }
  const { Agent } = await import("@atproto/api");
  const agent = new Agent(session);
  const response = await agent.app.bsky.feed.getTimeline(
    { limit: 30, ...(cursor ? { cursor } : {}) },
    signal ? { signal } : undefined,
  );
  return {
    feed: (response.data.feed ?? []) as unknown as FeedResponse["feed"],
    cursor: response.data.cursor,
  };
}

// Authenticated feed-generator read. Many feeds (e.g. a "mentions" or
// personalized feed) require the viewer's identity and fail on the public
// AppView, so when signed in we route getFeed through the user's session.
// Falls back to the public endpoint if there is no active session.
export async function getFeedAuthed(feedUri: string, cursor?: string, signal?: AbortSignal): Promise<FeedResponse> {
  const session = await ensureSession();
  if (!session) {
    return getFeed(feedUri, cursor, signal);
  }
  const { Agent } = await import("@atproto/api");
  const agent = new Agent(session);
  const response = await agent.app.bsky.feed.getFeed(
    { feed: feedUri, limit: 30, ...(cursor ? { cursor } : {}) },
    signal ? { signal } : undefined,
  );
  return {
    feed: (response.data.feed ?? []) as unknown as FeedResponse["feed"],
    cursor: response.data.cursor,
  };
}

async function ensureSession(): Promise<OAuthSession | null> {
  if (activeSession) {
    return activeSession;
  }
  const activeDid = localStorage.getItem(activeDidKey);
  if (!activeDid) {
    return null;
  }
  const client = await getClient();
  activeSession = await client.restore(activeDid);
  return activeSession;
}

// Fetch the signed-in user's saved/pinned feeds from their AT Protocol
// preferences and resolve display metadata. Returns [] when signed out. This is
// an authenticated read routed through the user's session; no BigBsky backend.
export async function getSubscribedFeeds(): Promise<SubscribedFeed[]> {
  const session = await ensureSession();
  if (!session) {
    return [];
  }

  const { Agent } = await import("@atproto/api");
  const agent = new Agent(session);
  const prefsResponse = await agent.app.bsky.actor.getPreferences();
  const preferences = (prefsResponse.data?.preferences ?? []) as Array<Record<string, unknown>>;

  // Preserve saved-feed order and pinned state. Support both the current
  // savedFeedsPrefV2 (typed items) and the legacy savedFeedsPref (uri arrays).
  const orderedUris: string[] = [];
  const pinnedByUri = new Map<string, boolean>();
  const isGeneratorUri = (value: unknown): value is string =>
    typeof value === "string" && value.includes("app.bsky.feed.generator");

  for (const pref of preferences) {
    const type = pref.$type;
    if (type === "app.bsky.actor.defs#savedFeedsPrefV2" && Array.isArray(pref.items)) {
      for (const item of pref.items as Array<Record<string, unknown>>) {
        if (item.type === "feed" && isGeneratorUri(item.value)) {
          if (!pinnedByUri.has(item.value)) {
            orderedUris.push(item.value);
          }
          pinnedByUri.set(item.value, pinnedByUri.get(item.value) || !!item.pinned);
        }
      }
    } else if (type === "app.bsky.actor.defs#savedFeedsPref") {
      const pinnedSet = new Set((Array.isArray(pref.pinned) ? pref.pinned : []) as string[]);
      for (const uri of (Array.isArray(pref.saved) ? pref.saved : []) as string[]) {
        if (isGeneratorUri(uri)) {
          if (!pinnedByUri.has(uri)) {
            orderedUris.push(uri);
          }
          pinnedByUri.set(uri, pinnedByUri.get(uri) || pinnedSet.has(uri));
        }
      }
    }
  }

  if (orderedUris.length === 0) {
    return [];
  }

  // Resolve feed-generator metadata in batches (getFeedGenerators caps inputs).
  type GeneratorMeta = {
    uri: string;
    displayName?: string;
    description?: string;
    avatar?: string;
    creator?: { handle?: string };
  };
  const metaByUri = new Map<string, GeneratorMeta>();
  for (let index = 0; index < orderedUris.length; index += 50) {
    const chunk = orderedUris.slice(index, index + 50);
    const generators = await agent.app.bsky.feed.getFeedGenerators({ feeds: chunk });
    for (const view of generators.data?.feeds ?? []) {
      metaByUri.set(view.uri, view as GeneratorMeta);
    }
  }

  return orderedUris
    .map((uri): SubscribedFeed | null => {
      const view = metaByUri.get(uri);
      if (!view) {
        return null;
      }
      return {
        uri,
        displayName: view.displayName || "Feed",
        description: view.description,
        creatorHandle: view.creator?.handle,
        avatar: view.avatar,
        pinned: pinnedByUri.get(uri) ?? false,
      };
    })
    .filter((feed): feed is SubscribedFeed => feed !== null);
}

export type MyLists = { owned: ListView[]; subscribed: ListView[] };

// Fetch the signed-in user's real Bluesky lists: the lists they created/own
// (`app.bsky.graph.getLists` for their DID — both curation and moderation
// lists) plus curation lists they subscribe to (pinned/saved as `type: "list"`
// in their saved-feeds preferences). Returns empty arrays when signed out. A
// real authenticated read through the user's session; reads already in scope.
export async function getMyLists(): Promise<MyLists> {
  const session = await ensureSession();
  if (!session) {
    return { owned: [], subscribed: [] };
  }
  const { Agent } = await import("@atproto/api");
  const agent = new Agent(session);
  const did = agent.did;
  if (!did) {
    return { owned: [], subscribed: [] };
  }

  // Lists the user created/owns.
  const ownedResponse = await agent.app.bsky.graph.getLists({ actor: did, limit: 100 });
  const owned = (ownedResponse.data?.lists ?? []) as unknown as ListView[];
  const ownedUris = new Set(owned.map((list) => list.uri));

  // Curation lists subscribed to (saved as feeds with type "list").
  let subscribedUris: string[] = [];
  try {
    const prefsResponse = await agent.app.bsky.actor.getPreferences();
    const preferences = (prefsResponse.data?.preferences ?? []) as Array<Record<string, unknown>>;
    for (const pref of preferences) {
      if (pref.$type === "app.bsky.actor.defs#savedFeedsPrefV2" && Array.isArray(pref.items)) {
        for (const item of pref.items as Array<Record<string, unknown>>) {
          if (item.type === "list" && typeof item.value === "string" && !ownedUris.has(item.value)) {
            subscribedUris.push(item.value);
          }
        }
      }
    }
  } catch {
    // Non-fatal: just show owned lists.
  }
  subscribedUris = Array.from(new Set(subscribedUris));

  // Resolve each subscribed list's metadata.
  const subscribed: ListView[] = [];
  for (const uri of subscribedUris) {
    try {
      const response = await agent.app.bsky.graph.getList({ list: uri, limit: 1 });
      if (response.data?.list) {
        subscribed.push(response.data.list as unknown as ListView);
      }
    } catch {
      // Skip lists that fail to resolve (deleted, blocked creator, etc.).
    }
  }

  return { owned, subscribed };
}

// Subscribe the signed-in user to a feed generator ("Follow") by adding it to
// their AT Protocol saved feeds (pinned), via the official preference helper.
// This is a real authenticated write routed through the user's session/PDS — no
// BigBsky backend. Throws if signed out.
export async function followFeed(feedUri: string): Promise<void> {
  const session = await ensureSession();
  if (!session) {
    throw new Error("Sign in to follow feeds.");
  }
  const { Agent } = await import("@atproto/api");
  const agent = new Agent(session);
  await agent.addSavedFeeds([{ type: "feed", value: feedUri, pinned: true }]);
}

// Remove a feed generator from the signed-in user's saved feeds. The remove API
// takes the saved-feed item id, so read preferences to map the feed URI to its
// id first. Throws if signed out.
export async function unfollowFeed(feedUri: string): Promise<void> {
  const session = await ensureSession();
  if (!session) {
    throw new Error("Sign in to manage feeds.");
  }
  const { Agent } = await import("@atproto/api");
  const agent = new Agent(session);
  const prefsResponse = await agent.app.bsky.actor.getPreferences();
  const preferences = (prefsResponse.data?.preferences ?? []) as Array<Record<string, unknown>>;
  const ids: string[] = [];
  for (const pref of preferences) {
    if (pref.$type === "app.bsky.actor.defs#savedFeedsPrefV2" && Array.isArray(pref.items)) {
      for (const item of pref.items as Array<Record<string, unknown>>) {
        if (item.type === "feed" && item.value === feedUri && typeof item.id === "string") {
          ids.push(item.id);
        }
      }
    }
  }
  if (ids.length > 0) {
    await agent.removeSavedFeeds(ids);
  }
}

// Authenticated profile read so viewer-relative state (viewer.following etc.)
// is populated. The public AppView omits viewer state, so write buttons need
// this when signed in. Falls back to the public read when signed out.
export async function getProfileAuthed(actor: string, signal?: AbortSignal): Promise<Profile> {
  const session = await ensureSession();
  if (!session) {
    return getProfile(actor, signal);
  }
  const { Agent } = await import("@atproto/api");
  const agent = new Agent(session);
  const response = await agent.app.bsky.actor.getProfile(
    { actor },
    signal ? { signal } : undefined,
  );
  return response.data as unknown as Profile;
}

// Authenticated author-feed read so viewer-relative post state (viewer.like,
// viewer.repost) and the author's viewer.following/blocking are populated.
// Falls back to the public read when signed out. Same shape as getAuthorFeed.
export async function getAuthorFeedAuthed(actor: string, cursor?: string, signal?: AbortSignal, filter?: AuthorFeedFilter): Promise<FeedResponse> {
  const session = await ensureSession();
  if (!session) {
    return getAuthorFeed(actor, cursor, signal, filter);
  }
  const { Agent } = await import("@atproto/api");
  const agent = new Agent(session);
  const response = await agent.app.bsky.feed.getAuthorFeed(
    { actor, limit: 30, ...(filter ? { filter } : {}), ...(cursor ? { cursor } : {}) },
    signal ? { signal } : undefined,
  );
  return {
    feed: (response.data.feed ?? []) as unknown as FeedResponse["feed"],
    cursor: response.data.cursor,
  };
}

// Authenticated post-thread read by AT-URI so the root post and every reply
// carry viewer state (like/repost records) for correct write-button seeding.
// Falls back to the public read when signed out.
export async function getPostThreadByUriAuthed(uri: string, signal?: AbortSignal): Promise<{ thread: ThreadNode }> {
  const session = await ensureSession();
  if (!session) {
    return getPostThreadByUri(uri, signal);
  }
  const { Agent } = await import("@atproto/api");
  const agent = new Agent(session);
  const response = await agent.app.bsky.feed.getPostThread(
    { uri, depth: 100, parentHeight: 12 },
    signal ? { signal } : undefined,
  );
  return { thread: response.data.thread as unknown as ThreadNode };
}

// Authenticated post-thread read by handle/DID + rkey. Resolves the handle, then
// reads the thread through the session. Falls back to public when signed out.
export async function getPostThreadAuthed(handleOrDid: string, rkey: string, signal?: AbortSignal): Promise<{ thread: ThreadNode }> {
  const session = await ensureSession();
  if (!session) {
    return getPostThread(handleOrDid, rkey, signal);
  }
  const did = await resolveHandle(handleOrDid, signal);
  const uri = `at://${did}/app.bsky.feed.post/${rkey}`;
  return getPostThreadByUriAuthed(uri, signal);
}

// Authenticated post search so result cards carry viewer state. Falls back to
// the public searchPosts (which routes through api.bsky.app) when signed out.
export async function searchPostsAuthed(
  query: string,
  sort: "top" | "latest",
  lang?: string,
  cursor?: string,
  signal?: AbortSignal,
): Promise<SearchPostsResponse> {
  const session = await ensureSession();
  if (!session) {
    return searchPosts(query, sort, lang, cursor, signal);
  }
  const { Agent } = await import("@atproto/api");
  const agent = new Agent(session);
  const response = await agent.app.bsky.feed.searchPosts(
    { q: query, sort, ...(lang ? { lang } : {}), limit: 30, ...(cursor ? { cursor } : {}) },
    signal ? { signal } : undefined,
  );
  return {
    posts: (response.data.posts ?? []) as unknown as SearchPostsResponse["posts"],
    cursor: response.data.cursor,
  };
}

// Compare the scope actually granted to the active session against the desired
// OAUTH_SCOPE and return the desired scope tokens that are missing from the
// grant (empty = up to date / signed out). Long-lived refresh tokens keep the
// scope from their original consent, so after we add a scope to the client
// metadata existing users keep the old grant until they re-authorize — this is
// how the app detects that and offers a one-click re-auth. Compared as token
// sets; the stored grant is byte-identical in format to OAUTH_SCOPE (verified),
// so this does not false-positive on ordering/encoding.
export async function getMissingScopes(): Promise<string[]> {
  const session = await ensureSession();
  if (!session) {
    return [];
  }
  let granted = "";
  try {
    const info = await session.getTokenInfo(false);
    granted = info.scope ?? "";
  } catch {
    return [];
  }
  const { OAUTH_SCOPE } = await import("./scopes");
  const grantedSet = new Set(granted.split(/\s+/).filter(Boolean));
  return OAUTH_SCOPE.split(/\s+/)
    .filter(Boolean)
    .filter((token) => !grantedSet.has(token));
}

export type PostRef = { uri: string; cid: string };
export type ReplyRef = { root: PostRef; parent: PostRef };
// One composer image: the raw blob to upload plus its alt text (empty allowed).
export type ComposerImage = { file: Blob; alt: string };
export type ComposerPostInput = { text: string; images?: ComposerImage[] };

// Bluesky supports up to 10 authored images via app.bsky.embed.gallery. The
// older app.bsky.embed.images embed is still capped at 4 by its lexicon, so
// buildImageEmbed writes images for 1-4 and gallery for 5-10.
export const MAX_POST_IMAGES = 10;

async function getImageAspectRatio(file: Blob): Promise<{ width: number; height: number }> {
  if ("createImageBitmap" in window) {
    const bitmap = await createImageBitmap(file);
    const ratio = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return ratio;
  }

  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new globalThis.Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: image.naturalWidth || 1, height: image.naturalHeight || 1 });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Unable to read image dimensions."));
    };
    image.src = url;
  });
}

// Upload composer images as blobs (scope blob:image/*) and build the appropriate
// Bluesky image embed. Returns undefined when there are no images.
async function buildImageEmbed(
  agent: { uploadBlob: (data: Blob, opts?: { encoding?: string }) => Promise<{ data: { blob: unknown } }> },
  images: ComposerImage[],
): Promise<unknown> {
  if (images.length === 0) {
    return undefined;
  }
  const uploaded: Array<{ alt: string; image: unknown; aspectRatio: { width: number; height: number } }> = [];
  for (const image of images.slice(0, MAX_POST_IMAGES)) {
    const [aspectRatio, response] = await Promise.all([
      getImageAspectRatio(image.file),
      agent.uploadBlob(image.file, {
        encoding: (image.file as File).type || "image/jpeg",
      }),
    ]);
    uploaded.push({ alt: image.alt || "", image: response.data.blob, aspectRatio });
  }
  if (uploaded.length <= 4) {
    return { $type: "app.bsky.embed.images", images: uploaded };
  }
  return {
    $type: "app.bsky.embed.gallery",
    items: uploaded.map((image) => ({
      $type: "app.bsky.embed.gallery#image",
      ...image,
    })),
  };
}

// Publish a single post (optionally a reply, optionally with images). Detects
// rich-text facets (links, @mentions, #hashtags) so they render/click correctly,
// the same way the reader renders incoming posts. Uploads any images as blobs
// first. Writes an app.bsky.feed.post record (scope repo:app.bsky.feed.post).
// Returns the new post's uri+cid. Throws if signed out.
export async function publishPost(opts: { text: string; reply?: ReplyRef; langs?: string[]; images?: ComposerImage[] }): Promise<PostRef> {
  const session = await ensureSession();
  if (!session) {
    throw new Error("Sign in to post.");
  }
  const { Agent, RichText } = await import("@atproto/api");
  const agent = new Agent(session);
  const richText = new RichText({ text: opts.text });
  await richText.detectFacets(agent);
  const embed = await buildImageEmbed(agent as never, opts.images ?? []);
  const result = await agent.post({
    text: richText.text,
    createdAt: new Date().toISOString(),
    ...(richText.facets ? { facets: richText.facets } : {}),
    ...(opts.reply ? { reply: opts.reply } : {}),
    ...(opts.langs && opts.langs.length > 0 ? { langs: opts.langs } : {}),
    ...(embed ? { embed: embed as never } : {}),
  });
  return { uri: result.uri, cid: result.cid };
}

// Delete one of the signed-in user's own posts by its at:// URI.
export async function deletePost(postUri: string): Promise<void> {
  const session = await ensureSession();
  if (!session) {
    throw new Error("Sign in to delete posts.");
  }
  const { Agent } = await import("@atproto/api");
  const agent = new Agent(session);
  const repo = agent.did;
  const rkey = postUri.split("/").pop();
  if (!repo || !rkey || !postUri.includes("/app.bsky.feed.post/")) {
    throw new Error("Invalid post record.");
  }
  await agent.com.atproto.repo.deleteRecord({ repo, collection: "app.bsky.feed.post", rkey });
}

// Publish an ordered thread: each post after the first replies to the previous
// one and shares the first post as the thread root, matching how bsky.app
// composes a multi-post thread. Entries with neither text nor images are
// skipped. Returns the root post's ref. Throws if signed out or nothing to post.
export async function publishThread(posts: ComposerPostInput[], langs?: string[]): Promise<PostRef> {
  const clean = posts
    .map((post) => ({ text: post.text.trim(), images: post.images ?? [] }))
    .filter((post) => post.text.length > 0 || post.images.length > 0);
  if (clean.length === 0) {
    throw new Error("Nothing to post.");
  }
  let root: PostRef | null = null;
  let parent: PostRef | null = null;
  for (const post of clean) {
    const reply: ReplyRef | undefined = root && parent ? { root, parent } : undefined;
    const ref = await publishPost({ text: post.text, images: post.images, reply, langs });
    if (!root) {
      root = ref;
    }
    parent = ref;
  }
  return root as PostRef;
}

// Follow an account: creates an app.bsky.graph.follow record in the user's
// repo (scope repo:app.bsky.graph.follow). Returns the follow record URI so the
// caller can unfollow later. Throws if signed out.
export async function followAccount(did: string): Promise<string> {
  const session = await ensureSession();
  if (!session) {
    throw new Error("Sign in to follow accounts.");
  }
  const { Agent } = await import("@atproto/api");
  const agent = new Agent(session);
  const { uri } = await agent.follow(did);
  return uri;
}

// Unfollow an account by deleting the follow record (uri from viewer.following
// or a prior followAccount call). Throws if signed out.
export async function unfollowAccount(followUri: string): Promise<void> {
  const session = await ensureSession();
  if (!session) {
    throw new Error("Sign in to manage follows.");
  }
  const { Agent } = await import("@atproto/api");
  const agent = new Agent(session);
  await agent.deleteFollow(followUri);
}

// Like a post: creates an app.bsky.feed.like record (scope
// repo:app.bsky.feed.like). Needs the post's uri and cid. Returns the like
// record URI for later unliking. Throws if signed out.
export async function likePost(uri: string, cid: string): Promise<string> {
  const session = await ensureSession();
  if (!session) {
    throw new Error("Sign in to like posts.");
  }
  const { Agent } = await import("@atproto/api");
  const agent = new Agent(session);
  const { uri: likeUri } = await agent.like(uri, cid);
  return likeUri;
}

// Unlike a post by deleting the like record (uri from viewer.like or a prior
// likePost call). Throws if signed out.
export async function unlikePost(likeUri: string): Promise<void> {
  const session = await ensureSession();
  if (!session) {
    throw new Error("Sign in to manage likes.");
  }
  const { Agent } = await import("@atproto/api");
  const agent = new Agent(session);
  await agent.deleteLike(likeUri);
}

// Save (bookmark) a post using Bluesky's native bookmarks. Bookmarks are stored
// privately by the AppView (not as a repo record), so this is an AppView call —
// no record URI comes back. Needs the post's uri and cid. Throws if signed out.
export async function bookmarkPost(uri: string, cid: string): Promise<void> {
  const session = await ensureSession();
  if (!session) {
    throw new Error("Sign in to bookmark posts.");
  }
  const { Agent } = await import("@atproto/api");
  const agent = new Agent(session);
  await asAppViewAgent(agent).app.bsky.bookmark.createBookmark({ uri, cid });
  if (!(await readPostBookmarked(agent, uri))) {
    throw new Error("Bluesky did not confirm this bookmark. Try again in a moment.");
  }
}

// Remove a native bookmark. deleteBookmark takes the POST uri (there is no
// separate bookmark-record uri). Throws if signed out.
export async function unbookmarkPost(uri: string): Promise<void> {
  const session = await ensureSession();
  if (!session) {
    throw new Error("Sign in to manage bookmarks.");
  }
  const { Agent } = await import("@atproto/api");
  const agent = new Agent(session);
  await asAppViewAgent(agent).app.bsky.bookmark.deleteBookmark({ uri });
  if (await readPostBookmarked(agent, uri)) {
    throw new Error("Bluesky did not remove this bookmark. Try again in a moment.");
  }
}

// List the signed-in user's native bookmarks. The bookmark view embeds the
// full post, so we map each present postView into a feed item — no second
// fetch. Blocked/not-found bookmarked posts are skipped. Returns empty when
// signed out.
export async function getBookmarks(cursor?: string, signal?: AbortSignal): Promise<FeedResponse> {
  const session = await ensureSession();
  if (!session) {
    return { feed: [] };
  }
  const { Agent } = await import("@atproto/api");
  const agent = new Agent(session);
  const response = await asAppViewAgent(agent).app.bsky.bookmark.getBookmarks(
    { limit: 50, ...(cursor ? { cursor } : {}) },
    signal ? { signal } : undefined,
  );
  const feed = (response.data.bookmarks ?? [])
    .filter((bookmark) => bookmark.item?.$type === "app.bsky.feed.defs#postView")
    .map((bookmark) => ({ post: bookmark.item })) as unknown as FeedResponse["feed"];
  return { feed, cursor: response.data.cursor };
}

// Block an account: creates an app.bsky.graph.block record in the user's repo
// (scope repo:app.bsky.graph.block). The @atproto Agent has no block() shortcut
// like follow()/like(), so write the record directly via createRecord. Returns
// the block record URI so the caller can unblock later. Throws if signed out.
export async function blockAccount(did: string): Promise<string> {
  const session = await ensureSession();
  if (!session) {
    throw new Error("Sign in to block accounts.");
  }
  const { Agent } = await import("@atproto/api");
  const agent = new Agent(session);
  const repo = agent.did;
  if (!repo) {
    throw new Error("No active account.");
  }
  const { data } = await agent.com.atproto.repo.createRecord({
    repo,
    collection: "app.bsky.graph.block",
    record: {
      $type: "app.bsky.graph.block",
      subject: did,
      createdAt: new Date().toISOString(),
    },
  });
  return data.uri;
}

// Unblock an account by deleting the block record (uri from viewer.blocking or a
// prior blockAccount call). Throws if signed out.
export async function unblockAccount(blockUri: string): Promise<void> {
  const session = await ensureSession();
  if (!session) {
    throw new Error("Sign in to manage blocks.");
  }
  const { Agent } = await import("@atproto/api");
  const agent = new Agent(session);
  const repo = agent.did;
  if (!repo) {
    throw new Error("No active account.");
  }
  // Block URIs look like at://<did>/app.bsky.graph.block/<rkey>.
  const rkey = blockUri.split("/").pop();
  if (!rkey) {
    throw new Error("Invalid block record.");
  }
  await agent.com.atproto.repo.deleteRecord({
    repo,
    collection: "app.bsky.graph.block",
    rkey,
  });
}

// --- Moderation / block-list curation ---
// Scopes repo:app.bsky.graph.list / .listitem / .listblock are all granted.
// (Subscribing to a *mute* list would need app.bsky.graph.muteActorList, which
// is NOT in scope, so only block-list subscription is implemented here.)

// Create a moderation list (the kind used for block/mute lists). Returns the
// new list's at:// uri. Throws if signed out.
export async function createModList(name: string, description?: string): Promise<string> {
  const session = await ensureSession();
  if (!session) {
    throw new Error("Sign in to create a list.");
  }
  const { Agent } = await import("@atproto/api");
  const agent = new Agent(session);
  const repo = agent.did;
  if (!repo) {
    throw new Error("No active account.");
  }
  const { data } = await agent.com.atproto.repo.createRecord({
    repo,
    collection: "app.bsky.graph.list",
    record: {
      $type: "app.bsky.graph.list",
      purpose: "app.bsky.graph.defs#modlist",
      name: name.trim(),
      ...(description?.trim() ? { description: description.trim() } : {}),
      createdAt: new Date().toISOString(),
    },
  });
  return data.uri;
}

// Delete a list the user owns (and implicitly its membership). Throws if signed
// out. listUri is at://<did>/app.bsky.graph.list/<rkey>.
export async function deleteModList(listUri: string): Promise<void> {
  const session = await ensureSession();
  if (!session) {
    throw new Error("Sign in to manage lists.");
  }
  const { Agent } = await import("@atproto/api");
  const agent = new Agent(session);
  const repo = agent.did;
  const rkey = listUri.split("/").pop();
  if (!repo || !rkey) {
    throw new Error("Invalid list.");
  }
  await agent.com.atproto.repo.deleteRecord({ repo, collection: "app.bsky.graph.list", rkey });
}

// Add an account to a list the user owns. Accepts a handle or DID (handles are
// resolved first). Returns the listitem record uri (needed to remove the member
// later). Throws if signed out or the handle can't be resolved.
export async function addAccountToList(listUri: string, handleOrDid: string): Promise<string> {
  const session = await ensureSession();
  if (!session) {
    throw new Error("Sign in to manage lists.");
  }
  const { Agent } = await import("@atproto/api");
  const agent = new Agent(session);
  const repo = agent.did;
  if (!repo) {
    throw new Error("No active account.");
  }
  const did = await resolveHandle(handleOrDid.trim().replace(/^@/, ""));
  const { data } = await agent.com.atproto.repo.createRecord({
    repo,
    collection: "app.bsky.graph.listitem",
    record: {
      $type: "app.bsky.graph.listitem",
      subject: did,
      list: listUri,
      createdAt: new Date().toISOString(),
    },
  });
  return data.uri;
}

// Remove a list member by deleting its listitem record (uri from getListMembers
// or a prior addAccountToList call). Throws if signed out.
export async function removeListItem(listItemUri: string): Promise<void> {
  const session = await ensureSession();
  if (!session) {
    throw new Error("Sign in to manage lists.");
  }
  const { Agent } = await import("@atproto/api");
  const agent = new Agent(session);
  const repo = agent.did;
  const rkey = listItemUri.split("/").pop();
  if (!repo || !rkey) {
    throw new Error("Invalid list item.");
  }
  await agent.com.atproto.repo.deleteRecord({ repo, collection: "app.bsky.graph.listitem", rkey });
}

export type ListMember = { listItemUri: string; subject: Profile };

// Read a list with its members. Each member carries the listitem record uri so
// the caller can remove it. Routes through the session so viewer state is set.
export async function getListMembers(listUri: string): Promise<{ list: ListView; members: ListMember[] }> {
  const session = await ensureSession();
  if (!session) {
    throw new Error("Sign in to view list members.");
  }
  const { Agent } = await import("@atproto/api");
  const agent = new Agent(session);
  const response = await agent.app.bsky.graph.getList({ list: listUri, limit: 100 });
  const list = response.data.list as unknown as ListView;
  const members = (response.data.items ?? []).map((item) => ({
    listItemUri: item.uri,
    subject: item.subject as unknown as Profile,
  }));
  return { list, members };
}

// Subscribe to a list as a block list: creates an app.bsky.graph.listblock
// record. Returns its uri (needed to unsubscribe). Throws if signed out.
export async function subscribeBlockList(listUri: string): Promise<string> {
  const session = await ensureSession();
  if (!session) {
    throw new Error("Sign in to subscribe to lists.");
  }
  const { Agent } = await import("@atproto/api");
  const agent = new Agent(session);
  const repo = agent.did;
  if (!repo) {
    throw new Error("No active account.");
  }
  const { data } = await agent.com.atproto.repo.createRecord({
    repo,
    collection: "app.bsky.graph.listblock",
    record: {
      $type: "app.bsky.graph.listblock",
      subject: listUri,
      createdAt: new Date().toISOString(),
    },
  });
  return data.uri;
}

// Unsubscribe from a block list by deleting its listblock record (uri from
// list viewer.blocked or a prior subscribeBlockList call). Throws if signed out.
export async function unsubscribeBlockList(listblockUri: string): Promise<void> {
  const session = await ensureSession();
  if (!session) {
    throw new Error("Sign in to manage list subscriptions.");
  }
  const { Agent } = await import("@atproto/api");
  const agent = new Agent(session);
  const repo = agent.did;
  const rkey = listblockUri.split("/").pop();
  if (!repo || !rkey) {
    throw new Error("Invalid list subscription.");
  }
  await agent.com.atproto.repo.deleteRecord({ repo, collection: "app.bsky.graph.listblock", rkey });
}

// Subscribe to a list as a MUTE list (app.bsky.graph.muteActorList — an AppView
// procedure, not a repo record, so there is nothing to delete; unsubscribe is
// unmuteActorList below). Needs the muteActorList scope. Throws if signed out.
export async function muteList(listUri: string): Promise<void> {
  const session = await ensureSession();
  if (!session) {
    throw new Error("Sign in to mute lists.");
  }
  const { Agent } = await import("@atproto/api");
  const agent = new Agent(session);
  await agent.app.bsky.graph.muteActorList({ list: listUri });
}

export async function unmuteList(listUri: string): Promise<void> {
  const session = await ensureSession();
  if (!session) {
    throw new Error("Sign in to manage list mutes.");
  }
  const { Agent } = await import("@atproto/api");
  const agent = new Agent(session);
  await agent.app.bsky.graph.unmuteActorList({ list: listUri });
}

// --- Notifications (AppView reads; scopes notification.listNotifications /
// getUnreadCount / updateSeen) ---

export type NotificationItem = {
  uri: string;
  cid: string;
  author: Profile;
  reason: string; // like | repost | follow | mention | reply | quote | starterpack-joined | ...
  reasonSubject?: string; // at-uri of the subject post for like/repost
  record?: { text?: string; createdAt?: string };
  isRead: boolean;
  indexedAt: string;
};

export type NotificationsPage = { notifications: NotificationItem[]; cursor?: string; seenAt?: string };

// Fetch a page of the signed-in user's notifications. Returns an empty page when
// signed out. Routed through the user's session/AppView.
export async function getNotifications(cursor?: string): Promise<NotificationsPage> {
  const session = await ensureSession();
  if (!session) {
    return { notifications: [] };
  }
  const { Agent } = await import("@atproto/api");
  const agent = new Agent(session);
  const response = await agent.app.bsky.notification.listNotifications({
    limit: 40,
    ...(cursor ? { cursor } : {}),
  });
  return {
    notifications: (response.data.notifications ?? []) as unknown as NotificationItem[],
    cursor: response.data.cursor,
    seenAt: response.data.seenAt,
  };
}

// Number of unread notifications, for a badge. 0 when signed out / on error.
export async function getUnreadNotificationCount(): Promise<number> {
  const session = await ensureSession();
  if (!session) {
    return 0;
  }
  try {
    const { Agent } = await import("@atproto/api");
    const agent = new Agent(session);
    const response = await agent.app.bsky.notification.getUnreadCount();
    return response.data.count ?? 0;
  } catch {
    return 0;
  }
}

// Mark notifications seen as of now, so the unread count resets. No-op signed out.
export async function markNotificationsSeen(): Promise<void> {
  const session = await ensureSession();
  if (!session) {
    return;
  }
  const { Agent } = await import("@atproto/api");
  const agent = new Agent(session);
  await agent.app.bsky.notification.updateSeen({ seenAt: new Date().toISOString() });
}

export async function clearOAuthSessionStorage() {
  if (!("indexedDB" in window)) {
    return;
  }

  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(oauthDatabaseName);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}
