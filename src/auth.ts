import type { BrowserOAuthClient, OAuthSession } from "@atproto/oauth-client-browser";
import type { Profile } from "./api";

const productionClientId = "https://bigbsky.com/oauth-client-metadata.json";
const handleResolver = "https://bsky.social";
const activeDidKey = "bigbsky:auth:active-did";
const activeHandleKey = "bigbsky:auth:active-handle";
const oauthDatabaseName = "@atproto-oauth-client";

let clientPromise: Promise<BrowserOAuthClient> | null = null;

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

  localStorage.removeItem(activeDidKey);
  localStorage.removeItem(activeHandleKey);
  await clearOAuthSessionStorage();
  return revokeWarning;
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
