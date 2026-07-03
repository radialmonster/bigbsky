const CACHE_NAME = "bigbsky-shell-v5";
const SHELL_URLS = ["/", "/index.html"];

// Cache-first hashed build assets (/assets/*-<hash>.{js,css}) accumulate one set
// per deploy. Because sw.js is byte-identical across deploys unless CACHE_NAME is
// bumped, `activate` (which only runs on an SW update) can't be relied on to evict
// stale assets — so bound the asset cache at runtime with a FIFO sweep after each
// insert. Content-hashed URLs make eviction safe: the current deploy's assets are
// the most-recently inserted (kept), older deploys' assets fall off the front, and
// any wrongly-evicted entry is simply re-fetched from network on next request.
// A build emits ~9 assets, so this holds several deploys' worth of headroom.
const MAX_ASSET_ENTRIES = 40;

async function cacheShellResponse(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response.ok) {
      await cache.put("/index.html", response.clone());
    }
    return response;
  } catch {
    return cache.match("/index.html");
  }
}

// Evict oldest cached /assets/* entries beyond the cap. cache.keys() returns
// entries in insertion order, so the front is the least-recently added.
async function trimAssetCache(cache) {
  const keys = await cache.keys();
  const assetKeys = keys.filter((request) => new URL(request.url).pathname.startsWith("/assets/"));
  const excess = assetKeys.length - MAX_ASSET_ENTRIES;
  for (let i = 0; i < excess; i += 1) {
    await cache.delete(assetKeys[i]);
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(cacheShellResponse(request));
    return;
  }

  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached && !cached.headers.get("content-type")?.includes("text/html")) {
          return cached;
        }

        const response = await fetch(request);
        if (response.ok && !response.headers.get("content-type")?.includes("text/html")) {
          await cache.put(request, response.clone());
          // Bound storage after inserting a fresh asset; never let a sweep
          // failure break the response.
          event.waitUntil(trimAssetCache(cache).catch(() => {}));
        }
        return response;
      }),
    );
  }
});
