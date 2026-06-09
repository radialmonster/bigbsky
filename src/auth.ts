import type { BrowserOAuthClient, OAuthSession } from "@atproto/oauth-client-browser";
import type { FeedResponse, Profile } from "./api";

const productionClientId = "https://bigbsky.com/oauth-client-metadata.json";
const handleResolver = "https://bsky.social";
const activeDidKey = "bigbsky:auth:active-did";
const activeHandleKey = "bigbsky:auth:active-handle";
const oauthDatabaseName = "@atproto-oauth-client";

let clientPromise: Promise<BrowserOAuthClient> | null = null;
// Retained so authenticated reads (e.g. the signed-in user's saved feeds) can
// reuse the active OAuth session instead of re-restoring it.
let activeSession: OAuthSession | null = null;

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

  const { buildLoopbackClientId } = await import("@atproto/oauth-client-browser");
  return buildLoopbackClientId({
    hostname: window.location.hostname,
    port: window.location.port,
    pathname: "/",
  });
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

  localStorage.setItem(activeDidKey, snapshot.did);
  localStorage.setItem(activeHandleKey, snapshot.handle);
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
      client.dispose();
      clientPromise = null;
    }
  } catch (error) {
    revokeWarning = error instanceof Error ? error.message : String(error);
  }

  activeSession = null;
  localStorage.removeItem(activeDidKey);
  localStorage.removeItem(activeHandleKey);
  await clearOAuthSessionStorage();
  return revokeWarning;
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
    const { getFeed } = await import("./api");
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
// an authenticated read routed through the user's session; no BigBSky backend.
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

// Subscribe the signed-in user to a feed generator ("Follow") by adding it to
// their AT Protocol saved feeds (pinned), via the official preference helper.
// This is a real authenticated write routed through the user's session/PDS — no
// BigBSky backend. Throws if signed out.
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
