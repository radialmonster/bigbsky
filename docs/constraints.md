## Data Storage Policy

Server-side:

- Store nothing user-specific in v1.
- No account database.
- No timeline cache.
- No analytics tied to account identity.
- No server-side OAuth sessions.

Browser-local:

- OAuth session state.
- DPoP keys.
- User preferences.
- Column layout.
- Recently viewed profiles/feeds.
- Optional short-lived API response cache.

User-facing privacy position:

- The app talks directly to Bluesky/AT Protocol services from the browser.
- The app host serves static files.
- User account data is not persisted by our infrastructure.

## Static/Stateless Constraints

BigBSky should work on Cloudflare Pages Free or a similar static-first host. Treat this as a product constraint, not just an implementation preference.

Allowed:

- Static files served by Cloudflare Pages.
- Public OAuth metadata files.
- Browser-local storage for auth session state, DPoP keys, UI preferences, layout choices, per-Feed layout memory, recent history, local drafts, and short-lived API cache.
- Live reads directly from Bluesky/AT Protocol APIs.
- User-triggered writes directly to Bluesky/AT Protocol APIs after OAuth.
- Client-side computation over currently loaded data.

Not allowed in v1:

- BigBSky account database.
- Server-side user profiles, timelines, notifications, Feed caches, drafts, or analytics.
- Server-side recommendations, clustering, topic maps, trend computation, or background jobs.
- Cross-device sync for BigBSky-only preferences.
- Article crawling/extraction through our servers.
- Backend storage of OAuth tokens or user sessions.
- Pages Functions or Workers for normal reader traffic.
- SSR, edge middleware, API routes, server actions, server loaders, image optimization endpoints, or backend redirect handlers.
- Server-side link unfurling, Open Graph fetching, screenshot generation, media transcoding, or thumbnailing.
- Server-side uptime pings, pageview counters, event tracking, A/B testing, feature-flag evaluation, or remote config.
- Cloudflare service bindings, Pages Plugins, Worker routes, queue consumers, scheduled jobs, server-side cron checks, server-side cache warmers, or any request-processing rule that executes code for normal app traffic.
- Runtime dependencies that require a Node/server environment in production. Browser-only libraries are allowed; server-only SDK paths must be excluded from the v1 app bundle.

Decision rule:

- If a feature can run from static files plus browser-local state plus live Bluesky/AT Protocol API calls, keep it.
- If it requires our backend to store, enrich, sync, crawl, recommend, or precompute user-specific data, defer it.
- If the feature loses most of its value without backend storage, remove it from v1.
- If a feature would invoke a Worker/Pages Function but is not required for auth safety, account actions, or core reading, eliminate it from v1.
- If a feature is only useful for developer convenience, observability, analytics, previews, or marketing, keep it local-only or remove it.

Elimination-first quota policy:

- Do not optimize unnecessary Function/Worker invocations; delete the feature path.
- Do not add a serverless path "just in case." Leave the feature absent until a concrete static implementation is proven impossible and the feature is approved as essential.
- Replace server-side analytics with no analytics for v1, or use browser-local development counters that never leave the device.
- Replace remote feature flags with build-time constants or static JSON files deployed as assets.
- Replace server-side redirects with static `_redirects` or client-side routing.
- Replace server-rendered metadata for every profile/post with a generic static document for v1. Per-link rich unfurls can be deferred unless they can be generated statically without Functions.
- Use metadata already included in Bluesky link-card embeds; do not add server-side URL metadata generation.
- Replace image proxying/optimization with Bluesky-provided media URLs, thumbnails, `loading="lazy"`, responsive CSS, and browser decoding hints.
- Replace server-side Feed maps or recommendations with browser-local grouping over saved Feeds and loaded timeline data.
- Replace backend-synced preferences/workspaces with localStorage/IndexedDB export/import if portability becomes important.
- Replace server-side error logging with visible local error states and an optional "copy diagnostics" action.
- Replace server-side health checks with static deploy checks and client-side self-tests in development builds only.
- Replace server-side cache warming, prerender refreshes, and scheduled metadata jobs with client-side lazy loading or static build artifacts.
- Replace per-object Open Graph cards with one generic static BigBSky card unless a future build-time-only generator can produce metadata without runtime Cloudflare code.

Feature-by-feature implications:

- OAuth/login: keep if browser-app OAuth can be implemented with public client metadata and browser-local token/key storage. If browser-only OAuth proves impractical, consider a minimal Cloudflare Worker only for OAuth mediation, but that is a v1 risk because it changes the static-only posture.
- Active Feed timeline: keep. It is live API data plus client rendering.
- Feed selector/drawer/map: keep if backed by live saved/pinned Feed APIs plus browser-local grouping/order preferences. Defer shared Feed organization.
- Inline composer and multi-post/thread composer: keep if posts, blobs/images, GIFs, language, permissions, and draft handling can be done through Bluesky APIs and browser-local drafts. Do not store drafts server-side.
- Image/media attachment: keep if uploaded directly to the user's PDS/AppView-supported flow from the browser.
- Notifications: keep as live authenticated reads. Do not mirror notifications into our storage.
- Chat: keep as entry point and UI shell only until DM API/privacy requirements are clear. Do not proxy or store DMs.
- Search and trending: keep if using Bluesky APIs directly. Do not build our own search index.
- Profiles, post/thread views, lists, saved posts: keep as live API views with browser-local UI state only.
- Settings: support local BigBSky settings browser-locally. For Bluesky account settings, link to or call supported Bluesky APIs directly; do not duplicate settings that require backend account management.
- Context panels, previews, density modes, and magazine mode: keep when they are presentation changes for Bluesky-provided data, not new interpretations of post meaning or importance.
- Optional multi-column mode: keep if each column is just another live API query and local layout preference. Avoid server-persisted workspaces.

