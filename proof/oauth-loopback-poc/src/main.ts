import { Agent } from "@atproto/api";
import { BrowserOAuthClient } from "@atproto/oauth-client-browser";

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("Missing #app");
}

app.innerHTML = `
  <style>
    :root {
      color-scheme: dark;
      font-family: Inter, ui-sans-serif, system-ui, sans-serif;
      background: #0f172a;
      color: #e5e7eb;
    }

    body {
      margin: 0;
    }

    main {
      max-width: 920px;
      margin: 40px auto;
      padding: 0 24px;
    }

    form, section {
      border: 1px solid #334155;
      background: #111827;
      padding: 18px;
      margin: 18px 0;
    }

    label {
      display: block;
      margin-bottom: 8px;
      color: #cbd5e1;
    }

    input {
      width: min(520px, 100%);
      box-sizing: border-box;
      padding: 10px 12px;
      border: 1px solid #475569;
      background: #020617;
      color: #e5e7eb;
      font: inherit;
    }

    button {
      margin-left: 8px;
      padding: 10px 14px;
      border: 0;
      background: #2563eb;
      color: white;
      font: inherit;
      cursor: pointer;
    }

    pre {
      overflow: auto;
      padding: 14px;
      background: #020617;
      border: 1px solid #334155;
    }
  </style>

  <main>
    <h1>BigBSky OAuth Loopback Proof</h1>
    <p>
      This is a browser-only OAuth proof using AT Protocol loopback client support.
      It runs from static Vite assets on <code>127.0.0.1</code> and stores OAuth
      session material in browser storage managed by the OAuth client.
    </p>

    <form id="signin-form">
      <label for="handle">Bluesky handle or DID</label>
      <input id="handle" name="handle" value="radialmonster.com" autocomplete="username" />
      <button type="submit">Sign in with Bluesky</button>
      <button id="reset-storage" type="button">Reset proof storage</button>
    </form>

    <section>
      <h2>Status</h2>
      <pre id="status">Initializing...</pre>
    </section>
  </main>
`;

const statusNode = document.querySelector<HTMLPreElement>("#status");
const form = document.querySelector<HTMLFormElement>("#signin-form");
const handleInput = document.querySelector<HTMLInputElement>("#handle");
const resetButton = document.querySelector<HTMLButtonElement>("#reset-storage");

function writeStatus(value: unknown) {
  if (!statusNode) return;
  statusNode.textContent =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function getLoopbackClientId() {
  const redirectUri = new URL(location.pathname || "/", location.origin);
  redirectUri.hash = "";
  redirectUri.search = "";

  const clientId = new URL("http://localhost/");
  clientId.searchParams.set("redirect_uri", redirectUri.href);
  clientId.searchParams.set("scope", "atproto transition:generic");

  return clientId.href;
}

async function createClient() {
  const clientId = getLoopbackClientId();
  writeStatus({
    status: "Creating browser OAuth client...",
    clientId,
    note: "If this client id changed after an authorization started, reset proof storage and sign in again.",
  });

  return BrowserOAuthClient.load({
    clientId,
    handleResolver: "https://bsky.social",
    fetch: async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      writeStatus(`OAuth fetch: ${url}`);
      const response = await fetch(input, init);
      writeStatus(`OAuth fetch done: ${response.status} ${url}`);
      return response;
    },
  });
}

async function renderSession(session: ConstructorParameters<typeof Agent>[0]) {
  const agent = new Agent(session);
  const profile = await agent.getProfile({ actor: agent.accountDid });

  writeStatus({
    proof: "Signed-in browser-only OAuth session restored and used for an authenticated API call.",
    did: agent.accountDid,
    handle: profile.data.handle,
    displayName: profile.data.displayName,
    followersCount: profile.data.followersCount,
    followsCount: profile.data.followsCount,
    postsCount: profile.data.postsCount,
  });
}

async function init() {
  const callbackParams = new URLSearchParams(
    location.hash.startsWith("#") ? location.hash.slice(1) : location.search,
  );
  const looksLikeOAuthCallback =
    callbackParams.has("state") &&
    (callbackParams.has("code") || callbackParams.has("error"));

  if (!looksLikeOAuthCallback) {
    writeStatus(
      "Ready. Enter your handle and sign in. If you previously used this proof and it behaves oddly, use Reset proof storage first.",
    );
    return;
  }

  writeStatus("Handling OAuth callback...");
  const client = await createClient();
  let result: Awaited<ReturnType<typeof client.init>> | undefined;

  try {
    result = await Promise.race([
      client.init(),
      new Promise<undefined>((resolve) => {
        window.setTimeout(() => resolve(undefined), 8000);
      }),
    ]);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const staleGrant = detail.includes("invalid_grant") && detail.includes("Token was not issued to this client");

    if (staleGrant) {
      history.replaceState(null, "", location.pathname || "/");
      writeStatus({
        error: "Stale OAuth callback. The authorization code was issued to an older proof client id.",
        fix: "Click Reset proof storage, then sign in again from this page.",
        currentClientId: getLoopbackClientId(),
        detail,
      });
      return;
    }

    throw error;
  }

  if (result?.session) {
    await renderSession(result.session);
    return;
  }

  writeStatus(
    "No OAuth session restored. Enter your handle and sign in. If this was stuck on Initializing, use Reset proof storage first.",
  );
}

form?.addEventListener("submit", (event) => {
  event.preventDefault();
  const handle = handleInput?.value.trim();
  if (!handle) {
    writeStatus("Enter a Bluesky handle or DID.");
    return;
  }

  if (!handle.startsWith("did:") && !handle.startsWith("http") && !handle.includes(".")) {
    writeStatus({
      error: "Use your full Bluesky handle, DID, or PDS URL.",
      input: handle,
      example: "radialmonster.com",
    });
    return;
  }

  writeStatus(`Redirecting to Bluesky OAuth for ${handle}...`);
  void (async () => {
    try {
    const client = await createClient();
    writeStatus(`OAuth client created. Resolving ${handle}...`);
    await client.signIn(handle, { state: "bigbsky-loopback-proof" }).catch((error) => {
      writeStatus({
        error: "Sign-in failed before redirect. Use your Bluesky handle or DID, not your email address.",
        input: handle,
        detail: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
    });
  } catch (error) {
    writeStatus({
      error: "OAuth client creation failed before redirect.",
      input: handle,
      detail: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
  })();
});

resetButton?.addEventListener("click", async () => {
  writeStatus("Clearing localStorage and IndexedDB for this proof origin...");
  localStorage.clear();
  sessionStorage.clear();

  if ("databases" in indexedDB) {
    const databases = await indexedDB.databases();
    await Promise.all(
      databases.map((database) => {
        if (!database.name) return undefined;
        return new Promise<void>((resolve, reject) => {
          const request = indexedDB.deleteDatabase(database.name || "");
          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error);
          request.onblocked = () => resolve();
        });
      }),
    );
  }

  writeStatus("Proof storage cleared. Reloading...");
  location.reload();
});

init().catch((error) => {
  writeStatus({
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
});
