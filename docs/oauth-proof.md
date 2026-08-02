## Static And OAuth Proof Log

This section records proof work already completed so it does not need to be rediscovered.

Public static API proof:

- File: `proof/static-api-poc.html`.
- Shape: plain static HTML with inline browser JavaScript.
- Hosting mode tested: opened directly as `file://`, with no local server and no backend.
- API host tested: `https://public.api.bsky.app`.
- Endpoints tested:
  - `app.bsky.actor.getProfile`
  - `app.bsky.feed.getAuthorFeed`
- Result: browser JavaScript successfully fetched public Bluesky profile and author-feed data.
- Conclusion: public Bluesky reads can work from a static browser page.

Browser-only OAuth loopback proof:

- Folder: `proof/oauth-loopback-poc/`.
- Stack: Vite static browser app plus `@atproto/api` and `@atproto/oauth-client-browser`.
- Dev command: `npm.cmd run dev` from `proof/oauth-loopback-poc/`.
- Dev URL: `http://127.0.0.1:5173/`.
- Verification command: `npm.cmd run build`.
- The proof app must be opened on `127.0.0.1`, not `localhost`, for loopback OAuth.
- OAuth SDK path: use `BrowserOAuthClient.load({ clientId, handleResolver: "https://bsky.social" })`.
- Working development `clientId` shape:
  - Base origin must be `http://localhost/`.
  - `redirect_uri` query parameter must point to the real loopback app URL, for example `http://127.0.0.1:5173/`.
  - `scope` query parameter used in the proof: `atproto transition:generic`.
  - Current proof derives this from `window.location.origin` so Vite port changes do not break redirects.
- Successful input: full Bluesky handle `radialmonster.com`.
- Successful result: the user signed in with Bluesky, the browser restored the OAuth session, and the proof used that session for an authenticated `getProfile` API call.
- Successful proof output:
  - DID: `did:plc:7etwu7gcc2itamrf6gexwim3`
  - Handle: `radialmonster.com`
  - Display name: `RadialMonster`
  - Live account counts returned from authenticated API response: followers, follows, and posts.
- Conclusion: browser-only OAuth can work without a BigBSky backend for local development. Session material is stored browser-side by the OAuth client, not on our infrastructure.

OAuth issues already encountered and resolved:

- Input `radial@gmail.com` is wrong for this flow. Use a Bluesky handle, DID, or PDS URL, not an email address.
- Input `radialmonster` is incomplete. Use full handle `radialmonster.com`.
- Scope `atproto` alone caused `Missing required scope "rpc:app.bsky.actor.getProfile?aud=did:web:api.bsky.app%23bsky_appview"`. The proof uses `atproto transition:generic`.
- Passing string metadata to the constructor caused a Zod error: `Expected object, received string`. The proof uses `BrowserOAuthClient.load({ clientId })` instead.
- An OAuth redirect went to `http://127.0.0.1/#...` with no port and failed with `ERR_CONNECTION_REFUSED`. The proof now includes an explicit loopback `redirect_uri` based on the actual page origin.
- `invalid_grant: Token was not issued to this client` happened after the proof `clientId` changed while an old authorization callback was still being used. Fix: clear proof storage and start a fresh authorization from the current page.
- The proof includes a `Reset proof storage` button that clears localStorage, sessionStorage, and IndexedDB for the proof origin, then reloads.
- If OAuth behaves oddly after code changes, click `Reset proof storage` before retrying.

Production OAuth proof still needed:

- Deploy the static app to the existing `bigbsky` Cloudflare Pages project.
- Use `https://bigbsky.pages.dev` for first production-origin testing while `bigbsky.com` custom domain validation is pending.
- Re-test from `https://bigbsky.com` once the custom domain becomes active.
- Publish stable OAuth client metadata at a public HTTPS URL under `bigbsky.com`.
- Use a production `client_id` equal to that metadata URL, not the loopback `http://localhost` client id.
- Confirm OAuth callback, session restore, refresh behavior, and authenticated API calls from the Cloudflare Pages origin.
- Confirm no Cloudflare Worker, Pages Function, database, KV, D1, R2, or server-side session storage is required.

## Request And Quota Strategy

Even with static hosting, BigBSky should minimize requests. Current Cloudflare docs distinguish pure static Pages traffic from serverless traffic: purely static Pages projects get unlimited free requests, while Workers/Pages Functions on the Free plan have request limits. Design BigBSky so normal use is static Pages asset delivery plus direct browser-to-Bluesky API calls, with no BigBSky serverless hop.

Quota definition for this plan:

- Free/static traffic: static Pages delivery of `index.html`, JS, CSS, images/icons, manifest, OAuth metadata, `_headers`, and `_redirects`.
- Paid/quota-triggering traffic: Pages Functions, Workers, SSR/edge middleware, API routes, server loaders/actions, image resizing/optimization, server redirects, Cloudflare service bindings, and any BigBSky-controlled backend endpoint.
- Optimization target: keep paid/quota-triggering traffic at zero for v1 normal use. Static Pages traffic should be cached and kept small, but it is not the scarce paid quota being protected.

Priority order:

- First priority: zero paid/quota-triggering Cloudflare paths in normal app usage.
- Second priority: eliminate any proposed Function/Worker/backend feature that is not essential to a safe signed-in reader.
- Third priority: prevent accidental compute activation from framework adapters, Cloudflare config, middleware, image services, analytics, or route handlers.
- Fourth priority: make repeat visits and in-app navigation avoid unnecessary static asset/document requests through browser caching and a service worker.
- Fifth priority: keep initial static asset count low for performance.
- Sixth priority: keep Bluesky/AT Protocol API calls low.

Cloudflare-side strategy:

- Avoid Pages Functions and Workers for v1 so ordinary app usage does not consume serverless request quotas.
- Bundle the app into a small number of static assets. Prefer hashed JS/CSS bundles that cache aggressively.
- Keep the static asset graph shallow: avoid many tiny lazy-loaded chunks unless they clearly reduce first-load cost. Every extra chunk is another static Pages request on cold load.
- Prefer one HTML document, one initial JS entry, one CSS file if needed, and a small bounded set of icon/manifest assets for the initial shell. Add lazy chunks only for clearly non-default surfaces such as OAuth, composer/upload, settings subpanels, and development inspectors.
- Do not create per-route HTML files, prerendered profile/post pages, generated social-card images, per-Feed static JSON, sitemap churn, or route-specific metadata files for v1.
- Serve icons, fonts, and app assets locally from `public/` where practical instead of pulling many third-party resources.
- Avoid server-side analytics, logging beacons, tracking pixels, or backend health pings.
- If a Worker becomes necessary for OAuth, keep it narrowly scoped to auth and design around the 100k/day Workers Free request limit.
- Add static cache headers:
  - `index.html`: short cache or `no-cache` so deployments can update.
  - hashed JS/CSS/assets: long `Cache-Control` with immutable caching.
  - OAuth client metadata: stable public caching, but not immutable unless the metadata URL is versioned.
- Add a service worker after the first MVP screen is stable:
  - Cache the app shell, hashed JS/CSS, icons, and static OAuth metadata.
  - Serve the app shell cache-first for repeat visits.
  - Update assets in the background after a successful load.
  - Do not cache OAuth tokens in the service worker; auth state remains in the OAuth client's browser storage.
- Make BigBSky installable as a PWA-like static app. Installed/repeat usage should usually start from the local app shell cache before hitting Cloudflare.
- Use one app shell route for normal use. Internal navigation should use client state/history and must not trigger document reloads.
- Prefer hash or query-backed shell state for transient destinations when it reduces accidental document reloads. Use clean path routes only for explicit shareable links.
- For clean shareable paths, use a static SPA fallback such as `_redirects` to serve `/index.html`; this costs only a static Pages hit on direct open/reload, not a Function hit.
- Treat client-side `window.location` document navigations inside the app as bugs unless they intentionally leave BigBSky or open a copied/shared URL.
- Make links between app destinations use client routing, not plain document links that reload `/index.html`.
- Do not host or proxy Bluesky user media through BigBSky. Use media/embed URLs provided by Bluesky/AT Protocol responses directly.
- Do not fetch remote fonts, icon libraries, tracking scripts, or large third-party UI assets at runtime. Bundle or self-host the small subset needed.
- Keep the OAuth client metadata and icon assets minimal so the authorization server fetches only a tiny static file set.
- Reuse stored OAuth sessions on repeat visits. A restored session should avoid a fresh authorization redirect and avoid extra OAuth metadata/icon fetches except when the auth server or SDK requires refresh/discovery.
- On app startup, attempt local OAuth session restore before showing a sign-in prompt. Only send the user through Bluesky authorization when restore/refresh fails or the user explicitly signs out.
- Avoid deployment patterns that generate many HTML files for pseudo-pages. BigBSky should ship one document plus static assets, not a static page per Feed/profile/thread.
- Do not implement server redirects, auth callback handlers, API facades, feed caches, image optimizers, or link-preview crawlers as Pages Functions.
- Add a CI/deploy audit that fails when the build output contains Cloudflare Function entry points, SSR manifests, server chunks, middleware, or framework adapter artifacts.
- Keep `_routes.json` or equivalent Function routing absent unless a future approved Function exists. If one exists, explicitly exclude all static assets and normal app paths from Function invocation.
- Treat a Cloudflare dashboard increase in Pages Function/Worker invocations during normal browsing as a release blocker.
- Treat unexpected Cloudflare static requests during repeat visits, in-app navigation, timeline scrolling, profile/thread preview, search typing, sign-out, or settings changes as performance regressions only. Treat any unexpected Pages Function/Worker/backend invocation in those flows as a release blocker.
- Keep service-worker update checks deliberate: background update checks are allowed, but they must not run on every route change, scroll page, hover preview, search keystroke, or account action.

Creative quota-avoidance patterns:

- Static OAuth metadata: publish `client-metadata.json`, icons, and callback routes as static assets. The browser handles callback parsing and session restore.
- Static callback shell: route OAuth callbacks to the same SPA document through `_redirects`; no callback Function.
- Hash-backed workspace state: keep selected panel, density, local Feed group, preview state, and transient UI in the URL hash when shareability is not required. Hash changes never request Cloudflare.
- Generic deep-link document: serve one static app shell for all clean routes and let the browser fetch the actual Bluesky object. Defer per-post/profile SEO metadata because dynamic metadata would require server work.
- Static remote config: if config is needed, ship a small versioned JSON asset with the build. Do not fetch a Worker-backed config endpoint.
- Local diagnostics: record request counts, cache hits, timing, and errors in memory for a development inspector. Do not post diagnostics to BigBSky servers.
- User-exported bug reports: provide a "copy diagnostics" button instead of automatic server logging.
- Client-only feature flags: use build-time flags or browser-local toggles for experiments. Do not evaluate feature flags on a backend.
- Client-only onboarding state: store dismissed tips, panel choices, density, and Feed groups locally.
- Static help/about/settings content: bundle or statically serve documentation instead of rendering help pages from a backend.
- Direct third-party exits: open Bluesky, help, source, and status links directly. Do not route outbound links through click-tracking redirects.
- No BigBSky media domain: never put user media, thumbnails, or link images behind a BigBSky URL. That avoids image proxy, cache, and transform invocations.
- Lazy import auth: keep the OAuth SDK outside the initial signed-out reader bundle if possible; load it only when restoring a known session, opening sign-in, or handling an OAuth callback.
- Lazy import write surfaces: load composer, upload, and account-action code only when authenticated controls are opened.
- Lazy import dev-only inspector: keep request-budget instrumentation out of production or behind a development-only chunk.
- Kill switch by removal: if any optional surface starts requiring serverless mediation, remove that surface from v1 instead of adding a Worker.

Expected Cloudflare request shape:

- First cold visit: one `index.html` request, a small number of JS/CSS asset requests, favicon/icon/manifest requests, and possibly OAuth metadata/icon requests during sign-in.
- Repeat visit after service worker install: ideally zero blocking Cloudflare static requests before the cached shell is interactive, followed by deliberate background static update checks.
- Repeat signed-in visit with a valid stored OAuth session: restore locally and refresh through the user's authorization server if needed; do not perform a new Bluesky authorization redirect.
- In-app navigation between Home, Feeds, Profiles, Threads, Notifications, Search, Saved, and Settings: zero Cloudflare document requests. Only Bluesky/AT Protocol API requests should occur.
- Direct open of a shared `/profile`, `/feed`, `/post`, or `/search` URL: one static Pages document fallback plus cached or hashed assets.
- Normal timeline scrolling: zero Cloudflare document/static app requests and zero paid/quota-triggering Cloudflare requests. Timeline data, media, and embeds come from Bluesky/AT Protocol services, not BigBSky infrastructure.

Bluesky/API request strategy:

- Use TanStack Query or equivalent request de-duplication so multiple components do not fetch the same Feed/profile/post separately.
- Centralize API calls in `src/api/` and make UI components consume shared query hooks.
- Define stable query keys by source type and identifier, for example Feed URI, actor DID/handle, post URI, list URI, and search query. Do not key cached data by display labels that can change.
- Normalize timeline responses into shared post/profile/embed entities before rendering contextual surfaces.
- Cache API responses in memory first, with optional short-lived IndexedDB cache for public/profile/Feed metadata.
- Keep timeline page caches scoped by active source and cursor. Route changes should retain loaded pages until the user explicitly refreshes or memory pressure requires pruning.
- Use stale-while-revalidate behavior for Feed metadata, profile data, Feed maps, and contextual panels.
- Fetch details on demand: thread expansions and liked-by/reposted-by/quotes pages should load only when opened or visible. Do not add external-link panels; external links should open directly.
- Virtualize long timelines so rendering more content does not trigger unnecessary detail fetches. Status: first pass implemented for Feed and profile timelines with measured row windowing.
- Avoid prefetching every post's author profile, thread, quote context, or media details.
- Batch or coalesce where APIs support it, especially profile lookups, post lookups, and Feed metadata.
- Use request cancellation for obsolete source/search/preview requests so late responses do not overwrite the active view.
- Prefer local references to already-loaded Bluesky entities instead of fetching separate related surfaces by default.
- Keep optional multi-column mode conservative: each extra column is another live timeline query, so it should be user-enabled and visibly count as extra activity.
- For magazine mode and other layout variants, operate only on already-loaded Feed items unless the user explicitly opens more detail.
- Back off on rate-limit responses and surface a clear local state instead of retry loops.
- Persist pagination cursors and loaded Feed state in memory during the session so route changes and context panels do not refetch from scratch.
- Cap background refresh. Invisible sources, collapsed panels, and inactive tabs should not poll.

Request and quota validation:

- Measure initial static asset requests.
- Measure initial JS/CSS gzip size and flag regressions before they reach deployment.
- Inspect the repository and build output for `functions/`, `_worker.js`, `wrangler.toml` service bindings, `_routes.json` Function routes, framework server entries, adapter server chunks, middleware manifests, API route manifests, and edge runtime files.
- Inspect generated HTML and manifests to confirm there is one app document and no per-route prerendered pages, social-card images, route metadata files, or per-object static JSON generated for Feed/profile/post URLs.
- Inspect Cloudflare project settings for disabled/absent Functions, Workers routes, Pages Plugins, service bindings, Web Analytics/Zaraz, Image Resizing/Images, queues, scheduled jobs, KV/D1/R2/Durable Object bindings, and server-side redirects.
- Measure repeat visit with service worker cache enabled.
- Measure in-app navigation across all major shell states and confirm no document reloads or paid Cloudflare triggers occur.
- Measure route changes, hash changes, panel opens, sign-out, settings changes, Feed selector searches, and search typing to confirm they do not request BigBSky HTML, static JSON, or any paid/quota-triggering Cloudflare route.
- Measure direct open of a clean shared URL and confirm it is served by static `/index.html`, not a Function.
- Measure direct open of a standalone post-thread URL and confirm Cloudflare serves only the static app shell while the browser makes one primary Bluesky thread request before first thread render.
- Measure OAuth sign-in and confirm callback handling is browser-only and metadata/icon requests are static assets.
- Measure initial signed-out Feed load requests.
- Measure initial signed-in Home/Discover load requests.
- Measure opening a profile preview, post thread, Feed selector, and right-rail panel.
- Measure standalone post-thread expansion and confirm each "load more replies/branch" action produces only the expected Bluesky request, no Cloudflare static/document request, no paid/quota-triggering Cloudflare request, and no duplicate request for branches already cached in memory.
- Measure initial standalone post-thread render and confirm it does not prefetch trending topics, suggested follows, chat, notifications, quote lists, liked-by lists, reposted-by lists, or full author sidebars before the thread is readable.
- Measure timeline scroll after several pages and confirm DOM node count stays bounded by virtualization. Status: verified; in addition to the 2026-06-08 Puppeteer smoke test (29-row Discover feed rendered only 2-3 cards), a 2026-06-09 several-page stress test on a high-volume profile feed loaded 8 pages (virtual-list height ~19,000px → 65,535px) while the rendered DOM held steady at 6 post-card rows, confirming bounded DOM independent of loaded page count.
- Measure cumulative layout shift for media-heavy Feed cards and fix unstable media/link-card sizing before release.
- Set rough budgets before implementation and fail PRs that accidentally multiply requests for common browsing flows.

Initial Cloudflare request and quota budgets:

- Cold first visit: target 6 or fewer Cloudflare static asset requests before the app is interactive, with 0 paid/quota-triggering Cloudflare requests.
- Repeat visit after service worker install: target 0 blocking Cloudflare static requests before shell interactivity and 0 paid/quota-triggering Cloudflare requests.
- Repeat signed-in visit with a valid stored OAuth session: target 0 BigBSky OAuth page/callback requests beyond cached shell update checks.
- In-app navigation after load: target 0 Cloudflare document reloads and 0 paid/quota-triggering Cloudflare requests.
- Direct shared deep link: target 1 HTML fallback request plus cached or immutable assets.
- Direct standalone post-thread deep link: target 1 HTML fallback request plus cached or immutable assets, then 1 primary Bluesky thread request before first render.
- Direct standalone post-thread deep link quota trigger target: 0 Pages Function invocations, 0 Worker invocations, 0 server redirect invocations, 0 image-resizing invocations, and 0 BigBSky API route hits.
- Installed/repeat standalone post-thread open with service-worker app shell available: target 0 blocking Cloudflare static requests before thread UI starts rendering; any update check must be a deliberate background static asset check, not a Function/Worker request.
- Standalone post-thread branch expansion: target 0 Cloudflare static/document requests, 0 paid/quota-triggering Cloudflare requests, and 1 bounded Bluesky request per explicit branch expansion, with duplicate expansions served from the session cache.
- Timeline scroll/profile preview/thread preview/search: target 0 Cloudflare static/document requests and 0 paid/quota-triggering Cloudflare requests; only Bluesky/AT Protocol network activity should happen.
- Search typing, Feed selector filtering, panel switching, settings changes, sign-out, and local preference changes: target 0 Cloudflare static/document requests and 0 paid/quota-triggering Cloudflare requests.
- Service-worker update checks: target at most one deliberate background update check per app start or configured interval, never per route/panel/feed action.
- Pages Function/Worker requests in v1 normal usage: target 0.

