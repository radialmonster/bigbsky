# BigBSky Plan

## Goal

Build a desktop-first Bluesky reader that uses the AT Protocol and Bluesky APIs directly, with a wide-screen layout optimized for 1920x1080 and larger displays. The app should give signed-in users access to the same practical information and account surfaces they can get on `bsky.app`, but with the active Feed timeline reformatted to use desktop width better for scanning, reading, media, and post context without storing user data on our own backend.

## Working Assumptions

- Bluesky is built on AT Protocol, not a single centralized API. Reads and writes are split across PDS instances, Bluesky AppView services, and AT Protocol identity resolution.
- Public Bluesky timeline/profile/post reads can use public Bluesky AppView endpoints, especially `https://public.api.bsky.app`.
- Signed-in requests should use AT Protocol OAuth, not user passwords or app passwords.
- The first version should avoid our own database, backend sessions, or server-side user storage.
- User OAuth state, access tokens, DPoP keys, UI preferences, and lightweight cache can live locally in the browser using IndexedDB/localStorage as appropriate.
- Cloudflare Pages is a good fit if we keep the app as a static SPA with public metadata files. Pages Functions or Workers should be optional, not required for v1.

## Operator Directives

Standing instructions from the operator. These override autonomous judgment (including the `/loop` cron task):

- **Do not add new features to the sidebars (left rail or right rail) unless explicitly asked.** The current sidebars are fine as-is. The right sidebar is for search/feed-suggestions/trending/discovery/secondary context; the left rail is for app/account navigation. The operator checks the sidebars occasionally and will request changes when wanted.
- **Do not add popups, previews, peeks, hover cards, modals, or similar interstitial UI unless explicitly asked.** (An author-peek and a thread-preview side-panel were both removed for this reason.) Authors open via the profile route; threads open by opening the post.
- When unsure whether a change adds a sidebar item, popup, preview, or modal, ask first.
- **AT Protocol API reference:** the canonical source for available XRPC methods, lexicons, and types is the atproto repository — `https://github.com/bluesky-social/atproto` (lexicons under `lexicons/`, e.g. `app/bsky/...`). Check it when choosing endpoints/fields rather than guessing.

## Product Direction

The app is a desktop reader first, not a mobile clone.

BigBSky should preserve Bluesky's original post data and account surfaces. The product should improve layout, navigation, density, media sizing, and widescreen ergonomics without inventing engagement labels, topic labels, scores, clusters, or summaries that reinterpret Bluesky content.

Primary design targets:

- 1920x1080 and larger monitors.
- Persistent desktop layout around an improved central endless-scroll reading area.
- Dense but readable information hierarchy.
- Pointer-friendly desktop navigation.
- Minimal page transitions.
- Fast scanning of timelines, profiles, threads, notifications, feeds, and lists.
- Feature parity with the main signed-in Bluesky website where practical, with the main improvement concentrated on the active Feed timeline presentation.

Core layout concept:

- Left rail: narrow/compact account switcher, Home, Explore, Notifications, Chat, Feeds, Lists, Saved, Profile, Settings, and composer.
- Feed selector: a better-organized desktop control for Discover, Following, custom feeds, saved searches, and mentions. This should replace the stock horizontally scrolling top feed bar.
- Right rail: narrow/compact search, feed suggestions, trending topics, and secondary account/app context.
- Active Feed timeline: the middle endless-scroll feed for whichever Feed/timeline the user is browsing, reformatted for wide desktop use instead of a narrow mobile column.
- Wide-screen space should primarily increase visible content: wider post cards, richer media/link layouts, more posts in view, better thread/quote context, or optional adjacent content. Do not spend the extra width by simply making the left and right sidebars wider.
- Inline/context treatment inside the main area: richer post cards, better media/link layouts, thread previews, quoted-post handling, and reply context without forcing every improvement into a separate pane.
- Optional adjacent context on very wide screens: selected post details, author profile, thread tree, media viewer, notifications, trending topics, feed suggestions, saved searches, or secondary timeline.

The app should avoid a marketing-style homepage. The first screen should be the reader interface, with signed-out public exploration available and sign-in as a clear control.

## `bsky.app` Layout Findings

Observed signed-in `bsky.app` desktop layout at a wide monitor size:

- Signed-in account switcher is in the left rail.
- Left navigation exposes Home, Explore, Notifications, Chat, Feeds, Lists, Saved, Profile, Settings, and New post.
- Main feed remains about 600px wide even on a very wide screen.
- Feed tabs include Discover, Following, and user/custom feeds such as Designsky, Graphic Design, Trading, Stock Market, Tech news, Gaming, Music & Audio People, AudioSky, Videography/Filmography, OnlyPosts, and Mentions.
- The feed tab menu scrolls horizontally as more feeds extend off-screen to the right, which is a poor desktop organization pattern.
- Signed-in timelines include an inline composer/input near the top so the user can create their own post from the current browsing context, including attaching images.
- The composer supports multi-post/thread creation. `bsky.app` exposes this as a multi-post composer with actions such as Drafts, Post All, per-post delete, and per-post media controls.
- Bluesky posts have a 300-character limit per post, so the composer needs a clear counter and validation for each post in a thread.
- Right rail contains search, suggested/more feeds, trending topics, and footer/help links.
- The app uses wide screens mostly as gutters and rails around a narrow mobile-style timeline.

The signed-in app effectively has three navigation/menu regions:

- Left sidebar: primary app/account navigation.
- Top feed menu: active feed selection across Discover, Following, custom feeds, and mentions.
- Right sidebar: search, discovery, trending, and secondary links.

BigBSky should not copy the horizontal top feed bar. Feed selection needs to move into a more scalable desktop pattern.

BigBSky should keep the same signed-in information surfaces, but use the active Feed timeline differently:

- Keep account/nav/actions visible without giving them excessive horizontal importance.
- Preserve the left and right sidebar concepts where they help orientation.
- Replace the top horizontal feed menu with a feed selector that can scale to many feeds without horizontal scrolling.
- Make feeds easier to scan, pin, group, reorder, collapse, filter, or search.
- Treat Bluesky Feeds conceptually like topic/community destinations a user moves between, similar to how a user might browse communities elsewhere, while keeping Bluesky's naming: "Feeds", not "subreddits" or another borrowed term.
- Keep endless scrolling as a first-class interaction.
- Make posts, media, link cards, quote posts, and thread previews use wider desktop cards where it improves readability or scanning.
- Preserve and improve the inline post composer at the top of the active Feed timeline, including image attachment, multi-post/thread composition, and 300-character-per-post limit handling.
- Preserve scroll position while inspecting a post, thread, profile, image, or link card.
- Turn the right rail into useful live context instead of mostly static accessory content.
- Avoid forcing every task through one 600px vertical timeline.

## Signed-In Information Parity

For signed-in users, BigBSky should aim to expose the same categories of information and controls available on the main Bluesky site:

- Account identity and account switching.
- Home timeline.
- Discover timeline.
- Following feed.
- User-pinned and custom feeds.
- Mentions.
- Notifications. Status: partial; the route now has a browser-local inbox with All/Mentions controls, local reader/account events, and browser-local notification pins while authenticated notification reads remain pending.
- Chat entry point/status, with direct-message functionality deferred unless safe API support and privacy posture are clear.
- Feed directory and feed suggestions.
- Lists. Status: partial; the route now has browser-local list workspaces with create/delete, post membership from loaded reader cards, local list timelines, and empty states, while authenticated Bluesky list sync/timelines remain pending.
- Saved posts.
- Profile view and self-profile link.
- Settings entry point or local settings, depending on which settings can be safely represented through APIs.
- Search.
- Trending topics.
- Composer for new posts.
- Inline composer/input at the top of the active Feed timeline.
- Image attachment in the composer.
- Multi-post/thread composer.
- Per-post media controls.
- Drafts and Post All flow.
- 300-character composer counter and disabled/error state per post when over limit.
- Composer controls for interaction permissions, GIFs, emoji, and language where supported.
- Post actions: reply, repost/quote, like, save, share, more/options. Status: partial; post cards now include local save, local list membership, thread open, and a client-side Share action that uses Web Share when available and falls back to copying the Bluesky post URL. Authenticated like/repost/reply/quote writes remain pending.
- Link cards, image/video embeds, alt text affordances, quote posts, and thread previews. Status: improved; link previews, image alt badges/viewer alt text, quote posts, thread previews, and video/GIF cards render from loaded AppView data, with native controls for playable video playlists plus thumbnail/open-media fallbacks. Post body text now renders Bluesky rich-text facets (byte-offset aware): inline URLs become clickable external links, @mentions open the mentioned profile in-app, and #hashtags open an in-app post search (wired through a lightweight TagSearchContext so the post-card tree does not need a new callback prop at every call site). Quoted-post body text now uses the same facet renderer, so links/mentions/hashtags inside quote cards are clickable too.

Parity does not mean copying the same layout. The goal is to provide the same functional awareness and navigation options while making the active endless-scroll Feed timeline itself better on desktop.

## Signed-In Menu Inventory

Observed signed-in `bsky.app` menu destinations and what they contain:

- Home: active Feed timeline with feed choices such as Discover, Following, pinned/custom Feeds, inline composer, image attachment shortcut, post cards, replies, reposts, likes, saved-post action, share, post options, right-rail search, More feeds, trending topics, and footer/help links.
- Explore: search for posts/users/Feeds, user interest controls, trending topics with categories/status, Discover new Feeds, suggested Feed cards, Pin feed actions, suggested accounts, and load-more discovery.
- Notifications: All and Mentions tabs, notification settings, follower notifications with Follow back, likes/replies/reposts/mentions, and notification items linked back to users/posts.
- Chat: Requests, chat settings, New chat, inbox state, and message list/empty state. Direct-message content should remain a later/sensitive feature unless the API and privacy posture are clearly handled.
- Feeds: My Feeds, Edit My Feeds, saved/pinned Feed list, Discover New Feeds, search Feeds, community Feed cards, Pin feed actions, liker counts, descriptions, and Feed discovery.
- Lists: list index, New list action, and empty/help state explaining lists as content from favorite people.
- Saved: saved posts timeline, empty state, and Go home action.
- Profile: own profile header, edit profile, more options, follower/following counts, bio/posts count, suggested accounts, profile tabs for Posts, Replies, Media, Videos, Likes, Feeds, Starter Packs, and Lists, plus Write a post.
- Settings: account switch/add account, Account, Privacy and security, Moderation and content filters, Notifications, Content and media, Appearance, Accessibility, Languages, Help, About, and Sign out.

BigBSky should map these menu destinations to desktop-friendly views. The goal is not to duplicate every settings subpage on day one, but the information architecture should leave obvious places for each surface.

## Additional Surface Findings

More detailed signed-in surfaces to account for:

- Feed detail page: a Feed destination has a header with Feed name, creator/handle, like/user count, and Feed options. Below that, it behaves like the active Feed timeline, including the inline composer, image shortcut, post cards, and normal post actions.
- Feed directory page: My Feeds are listed separately from Discover New Feeds. Saved Feeds include direct links and an Edit My Feeds action. Discovery Feed cards include creator, description, liked-by count, and Pin feed action.
- Post/thread page: the thread view shows the original post, author follow control, thread options, reply permissions such as "Everybody can reply", timestamp, repost/quote/like/save counts, links to reposted-by/quotes/liked-by pages, Write your reply composer, and replies below.
- Search results: search has a query field, clear-query action, language selector, and result tabs/filters such as Top, Latest, People, and Feeds. Results can include posts, users, Feeds, videos/GIFs, content labels, hashtags, and media controls.
- Other-user profile: public profiles expose Follow, More options, follower/following counts, external/profile links, suggested related accounts, and profile tabs for Posts, Replies, Media, and Videos. Self-profile additionally includes Edit Profile, Likes, Feeds, Starter Packs, Lists, and Write a post.
- Lists: the list index has New list and an empty/help state when no lists exist. Lists should be treated as another timeline/source type, similar to Feeds but based on selected people rather than topic/community algorithms.
- Media/content labels: post cards and search results can include image alt affordances, video controls, GIF controls, and content labels such as adult/non-sexual nudity warnings with Show/Learn more actions.

These surfaces reinforce the core model: Feed/timeline reading is central, but every destination should preserve the user's place and avoid forcing narrow mobile-style page transitions when desktop space can keep context visible.

## Wide-Screen Design Opportunities

BigBSky should make the active Feed timeline feel native to desktop monitors without turning the default view into a cluttered dashboard.

- Content-first width allocation: extra desktop width belongs to the active Feed timeline and content presentation first. Left and right bars can remain narrow; sidebars should stay compact and useful.
- Wide post cards with structured zones: use extra width for author/meta, content, media, stats, and actions instead of simply stretching post text.
- Media-aware layout: render image/video-heavy posts with larger previews, better side-by-side image grids, clear alt-text affordances, and less wasted vertical scrolling.
- Inline thread expansion: allow a post/thread to expand inline or in an adjacent context area while preserving the active Feed scroll position.
- Feed selector drawer: replace the horizontal top Feed bar with a grouped, searchable Feed selector for pinned Feeds, recent Feeds, Discover, Following, Mentions, topic groups, and Feed search.
- Reading density modes: support Comfortable, Compact, and Media-heavy modes so users can choose between readable full-width cards, faster two-column scanning for rich posts, and visual browsing.
- Sticky active Feed header: show current Feed name, creator, description/count, sort/filter controls, and composer access without consuming too much vertical space.
- Contextual right rail: adapt the right rail to the current Feed or selected post, showing Feed info, related Feeds, trending topics, author previews, thread summaries, or search/discovery.
- Preview side panel: link cards and image details can preview without full navigation. Note (user direction): the right sidebar is for search/feed-suggestions/trending/discovery/secondary context, not for author/profile or thread previews triggered from posts. Authors open via the profile route; threads open by opening the post. Always confirm with the operator before adding anything new to a sidebar.
- Optional multi-column mode: allow power users to pin a second Feed, notifications, or search results beside the active Feed, but do not make multi-column dashboards the default requirement.

The biggest design win is to make the active Feed timeline a desktop reading surface, not a phone-width column surrounded by empty space.

## Novel Desktop Ideas

Useful creative ideas that fit the Feed-first product direction:

- Feed magazine mode: keep the endless Feed, but give media/link-heavy Feeds a more editorial layout with larger lead media, compact text-only posts, and stronger visual grouping. Static path: compute layout in the browser from currently loaded Feed items and local display preferences.
- Per-Feed layout memory: remember layout/density preferences per Feed, such as media-heavy for design/art Feeds, compact for fast rich-post scanning, and comfortable for readable full-width Following. Static path: store browser-locally by Feed URI. Defer cross-device sync.
- Author/profile preview in the right rail: selecting an author can show profile details, follow controls, recent posts, and related Feeds without leaving the active Feed. Static path: fetch live profile and author-feed data on demand, then cache locally.
- Link preview reader: expand Bluesky-provided link-card metadata into a side panel with source, title, thumbnail, description, and source-post actions. Do not crawl third-party pages or summarize related discussion.
- Feed map: show saved/pinned Feeds grouped by topic/community-style categories while still calling them Feeds. Static path: use user-created browser-local groups plus client-side grouping from Feed names/descriptions. Defer shared/global Feed taxonomy.
- Session history trail: keep a small recent trail of viewed Feeds, profiles, posts, and searches so desktop browsing has better wayfinding. Static path: browser-local recent history only.
- Context-preserving profile peek: open profile previews in-place first, with full profile navigation only when the user chooses it. Static path: live API fetch on demand and browser-local cache.

Highest-priority creative ideas:

- Per-Feed layout memory.
- Feed map.

Remove or defer if stateless implementation is not enough:

- Shared Feed maps or public topic taxonomies requiring our backend.
- Engagement labels, topic labels, smart grouping, local scoring, or generated summaries that reinterpret Bluesky posts.
- Cross-device BigBSky preference sync.
- Article extraction/summarization requiring our server to fetch third-party pages.
- Analytics-driven recommendations based on server-side behavior tracking.

## Technical Architecture

### Frontend

- Static SPA hosted on Cloudflare Pages.
- Recommended stack: Vite + React + TypeScript.
- Styling: CSS modules, Tailwind, or a small design-system layer. Choose one and keep it restrained.
- State: lightweight client state library if needed, such as Zustand, or framework-native state until complexity demands more.
- Data fetching: query/cache layer such as TanStack Query is likely useful for timelines, pagination, and stale data handling.

### Performance Architecture

Performance should be treated as part of the product design, not a late build step. BigBSky's main advantage over `bsky.app` is the desktop reader surface, so the app should feel immediate while scrolling, switching Feeds, opening previews, and returning to prior context.

Core performance rules:

- Render one primary live timeline by default. Context panels should reuse entities from that timeline before they make their own request.
- Virtualize timeline rows from the start. Endless scroll should not mean endless DOM growth. Status: first pass implemented with measured row windowing, top/bottom spacers, and rendered-row reporting in the development inspector.
- Keep post cards height-stable. Reserve space for media, link cards, labels, and action rows so images and embeds do not cause major layout shifts as they load.
- Decode and load media lazily. Feed cards should use Bluesky-provided thumbnails/previews first, with full media loaded only when visible or opened.
- Avoid masonry layouts for the default Feed timeline. Use predictable rows or bounded media grids so virtualization, keyboard navigation, scroll restoration, and context previews remain reliable.
- Use CSS containment where practical for post cards, media grids, and side panels so rendering changes do not invalidate the whole shell.
- Keep the left rail, Feed selector, right rail, and active timeline mounted across normal navigation. Swap source state inside the shell instead of remounting the whole app.
- Split rarely used authenticated/write-heavy surfaces away from the first reader bundle if they materially increase startup size. Composer internals, account action menus, settings subpanels, and OAuth callback helpers are good candidates after the first app shell is interactive.
- Keep icons local and tree-shaken. Do not import an entire icon package if only a small set is needed.
- Avoid runtime theme libraries, animation frameworks, markdown renderers, rich text editors, or date libraries unless the product surface clearly needs them. Prefer platform APIs and small local helpers for v1.
- Store feed layout preferences locally and apply them before the first timeline render to avoid a visible density/layout jump.
- Make scroll restoration explicit per source. Switching from a Feed to a profile/thread preview and back should restore both loaded items and scroll offset without refetching the visible page.
- Use `IntersectionObserver` for pagination, media loading, and delayed detail fetches. Avoid scroll event loops for core feed behavior. Status: implemented for feed, profile, post-search, and people-search pagination with visible load-more fallback controls. A failed pagination request now keeps the already-loaded results and shows an inline retry instead of replacing the whole view with an error, and the auto-loader stops firing after a failure (manual Retry only) so it does not hammer a rate-limited or unreachable endpoint. Fix (2026-06-09): the auto-load `IntersectionObserver` used `root: null` (the viewport), but the timeline scrolls inside an internal overflow container (`.timeline`); with a clipped internal scroller the 640px `rootMargin` could not preload early and auto-load effectively waited until the sentinel reached the true viewport bottom. The observer now uses the nearest scrollable ancestor as its `root` (a `findScrollParent` walk, falling back to the viewport when nothing scrolls), so the 640px margin preloads the next page before the user reaches the end — seamless endless scroll. Verified: build passes and the `findScrollParent` walk resolves to `.timeline` for the load-more sentinel; live IntersectionObserver firing cannot be exercised in the headless Claude preview (IO callbacks do not run there for either the old or new code — confirmed the manual "Load more" fallback works), so seamless auto-scroll should be confirmed on the deployed origin in a real browser.
- Debounce search and Feed selector filtering locally. Do not issue network requests on every keystroke.
- Abort stale requests when the user changes Feed/source, search query, or active preview before the prior request finishes.
- Surface rate limits and offline states without retry storms. Retries should use bounded exponential backoff and stop when the user changes source. Status: improved; network failures (`fetch` `TypeError`/"Failed to fetch", including rate-limited responses returned without CORS headers) now surface a clear message, a failed "load more" keeps loaded content and requires an explicit Retry click, and the IntersectionObserver auto-loader pauses on error so it no longer retries in a tight loop.

Initial performance budgets:

- First reader shell JavaScript should target less than 250 kB gzip before OAuth/write-heavy chunks. If the OAuth SDK makes this impossible, isolate it behind the sign-in path where practical.
- Initial CSS should target less than 50 kB gzip.
- Initial signed-out public Feed render should target one Feed/profile API request group, not a cascade of post-detail requests.
- Opening a profile preview from a visible post should render immediately from embedded author data, then make at most one full-profile request if the preview remains open.
- Opening a thread preview from a visible post should render the known post immediately, then fetch the full thread only after explicit open or clear dwell intent.
- Timeline scrolling should keep the rendered DOM bounded to the viewport plus overscan, not all loaded posts.

### Hosting

- Cloudflare Pages static deployment.
- Production domain: `bigbsky.com`, with nameservers pointed to Cloudflare.
- Cloudflare zone status: `bigbsky.com` is active in Cloudflare.
- Cloudflare Pages project: `bigbsky`.
- Cloudflare Pages default hostname: `https://bigbsky.pages.dev`.
- Cloudflare Pages custom domain: `bigbsky.com` is attached; current status is `pending`, with verification and validation also `pending`.
- GitHub production repository: `https://github.com/radialmonster/bigbsky`.
- Local git `origin` is set to `https://github.com/radialmonster/bigbsky.git`.
- GitHub production branch: `main` exists and tracks local `main`.
- Cloudflare Pages Git integration is connected to `radialmonster/bigbsky`.
- Cloudflare Pages production branch: `main`.
- Cloudflare Pages automatic deployments: enabled.
- Default deployment workflow: update GitHub `main`; Cloudflare Pages builds and deploys automatically from the connected repository.
- Cloudflare Pages build command: `npm run build`.
- Cloudflare Pages build output directory: `dist`.
- Cloudflare Pages root directory: repository root.
- Cloudflare Pages build comments: enabled.
- Cloudflare Pages build cache: enabled.
- Cloudflare Pages build system version: `3`.
- Cloudflare Pages build watch include paths: `*`.
- Cloudflare Pages deploy hooks: none.
- Cloudflare Pages variables/secrets: none currently required.
- Cloudflare Pages bindings: none; do not add bindings for v1 static hosting.
- Cloudflare Pages preview deployments are public by default.
- Target Cloudflare Pages Free compatibility for v1.
- Root Vite/React/TypeScript app is scaffolded at the repository root, so Cloudflare can run `npm run build` and publish `dist`.
- Current root app includes a desktop reader shell, grouped/filterable/collapsible Feed selector, browser-local pinned Feed shortcuts, right context rail, browser-local recent trail, local composer UI with 300-character validation, per-feed density preferences, local feed-width preferences, direct public Bluesky feed-generator loading for Home, direct public Feed Generator metadata loading for active Feed detail/header context, direct public author-feed loading for `/profile/:handleOrDid`, standalone post-thread route loading, public post and people search at `/search?q=...`, local Feed search over known static Feed destinations, a browser-only OAuth SDK scaffold with signed-out account controls, static service worker/app-shell caching, a development inspector for source/request/cache/static-runtime posture, static `_headers`, static `_redirects`, and a build-output audit for forbidden server/runtime artifacts.
- Latest local production build passed with `npm run build`; audit result: static-only `dist` output. Local preview returned `200` for `/`, `/settings`, `/profile/bsky.app`, `/sw.js`, and `/oauth-client-metadata.json`. Browser-plugin visual verification was attempted on 2026-06-08 but the in-app browser backend was unavailable in this session; fallback Puppeteer smoke testing verified the built `/settings` account controls, confirmed a cold signed-out Settings visit loads only the main JS/CSS plus favicon, and verified Home feed scroll stayed at `1200px` after a pause instead of snapping upward.
- Default visual theme is dark, using Bluesky brand colors as anchors: Blue `#0560FF`, Light Blue `#75AFFF`, Dark Gray `#232E3E`, and Light Gray `#F9FAFB`.
- `https://bigbsky.pages.dev/` and `https://bigbsky.com/` are serving the static app. Clean profile routes such as `https://bigbsky.com/profile/radialmonster.com` return the SPA shell through static fallback.
- Signed-out Home feed has been tested working against public feed-generator sources. Current default sources intentionally avoid official feed generators that returned `502` signed out, and avoid `What's Hot Classic` because it surfaced NSFW content despite returning `200`.
- Signed-out profile routes are implemented for Bluesky-style URLs such as `/profile/radialmonster.com`, `/profile/edutopia.org`, `/profile/standardissuecomputing.blog`, `/profile/foxes.hourly.media`, and `/profile/nsiabblog.bsky.social`; these use `app.bsky.actor.getProfile` plus `app.bsky.feed.getAuthorFeed` directly from the browser.
- Signed-out post/thread routes are clickable from feed/search cards and direct-load through `/profile/:handleOrDid/post/:rkey`. Verified example: `/profile/suewho82.bsky.social/post/3mnpjvwbxq22b` rendered the root post plus nested replies through the static app shell.
- Signed-out public search is implemented at `/search?q=...`, including Posts/People/Feeds tabs, Top/Latest post sort, post language filtering, post-card results, public actor search results, local Feed destination results, pagination where supported, profile links, thread links, and browser-local recent search entries. Search typing does not issue a request until the form is submitted.
- Feed selector filtering is implemented as local browser filtering over known feed sources; it does not make network requests per keystroke.
- Per-feed density memory is implemented in localStorage under `bigbsky:density-by-context`, and per-feed width-mode memory under `bigbsky:width-by-context` (migrating the old single `bigbsky:workspace-width` value into its `default` slot); recent feed/profile/thread/search trail is implemented in localStorage under `bigbsky:recent`.
- Feed image cards use Bluesky `thumb` URLs, display without cropping or forced aspect ratios, and constrain only to container width and viewport height. Clicking an image opens the Bluesky `fullsize` URL in an in-app viewer constrained to the viewport.
- Multi-image posts support image-viewer navigation with left/right arrow keys, on-screen arrow buttons, and clicking the left/right side of the overlay.
- The first fixed-height virtual window was removed after natural-height images caused scroll jumps. Current Phase 1 renders loaded posts directly; measured-row virtualization should be added later before large-feed/power-user polish.
- Treat "Cloudflare Pages Free" as "static assets only." Avoid anything that turns normal app traffic into Pages Function or Worker traffic.
- Required public files:
  - OAuth client metadata JSON.
  - App icon/logo assets referenced by OAuth metadata.
  - Static app bundle.
- Avoid server-side rendering for v1.
- Avoid Cloudflare D1, KV, R2, Durable Objects, Workers, and Pages Functions for v1 unless browser-only OAuth proves impossible. Any backend addition must be justified against the stateless rules.
- Do not proxy Bluesky API calls, images, embeds, link previews, media, OAuth callbacks, or analytics through Cloudflare Functions/Workers. The browser should talk directly to Bluesky/AT Protocol services.
- Use static `_headers` and `_redirects` files only if needed. Do not replace simple static routing/header needs with a Function.
- Keep the deploy output free of `functions/`, `_worker.js`, framework server bundles, edge runtime files, or adapter output that could register Function routes by accident.
- Prefer a pure static Vite build over framework modes that generate SSR, API routes, middleware, loaders, or server actions.
- Treat any Cloudflare service binding, environment secret, database binding, KV namespace, queue, analytics engine, image resizing, or Turnstile verification endpoint as a backend feature requiring explicit approval.
- Keep repository config free of accidental Cloudflare backend activation: no `functions/` source directory, no Worker entrypoint, no Pages Functions plugin, no framework adapter that emits server code, and no `wrangler.toml` bindings unless a future backend exception is approved.
- Do not add a Cloudflare Access, Turnstile, Zaraz, Web Analytics, Image Resizing, Pages Plugin, or middleware-based feature to v1. These are backend or request-processing features for this project, even if they look small in configuration.

Quota-trigger rule:

- Unlimited/static path: Cloudflare serves `index.html`, hashed assets, icons, manifest, OAuth metadata, `_headers`, and `_redirects`.
- Quota-triggering path: a request invokes a Pages Function, Worker, SSR route, middleware, API route, edge runtime, image optimizer, or server-side redirect handler.
- Static Pages hits are acceptable and should be optimized for performance, not treated as the paid quota problem. Paid/quota-triggering compute paths are the hard-zero target.
- If a feature can be implemented either way, choose the unlimited/static path unless the static version is impossible or materially unsafe.
- If a Worker/Function becomes unavoidable, isolate it behind a path that normal reader usage never touches and define a per-feature request budget before implementation.
- Any quota-triggering path must be opt-in by explicit user action and must never run during first load, repeat load, route fallback, OAuth callback display, sign-out, feed scrolling, profile/thread preview, search typing, or passive background refresh.

### Authentication

Use AT Protocol OAuth as the intended auth path.

Browser-app implications:

- The app is a public OAuth client.
- No client secret.
- Publish OAuth client metadata at a stable HTTPS URL under `bigbsky.com`.
- Use PKCE, PAR, and DPoP as required by AT Protocol OAuth.
- Store DPoP key material and OAuth session state locally in the browser, preferably IndexedDB.
- Treat browser storage as user-controlled local state, not our service storing user data.
- Persist OAuth refresh/session material for as long as the AT Protocol authorization server and SDK safely allow so users do not have to re-authenticate on every visit.
- Use refresh-token grant support in the public OAuth client metadata. Let the SDK rotate/refresh tokens instead of starting a new browser authorization flow when a stored session can be refreshed.
- Do not promise permanent login for the static public-client version. AT Protocol session lifetime is controlled by the user's authorization server and public clients may have shorter maximum lifetimes than confidential/server-backed clients.
- If the product later requires very long sessions beyond public-client limits, evaluate a confidential-client/BFF design explicitly. That would add backend responsibility and should not be part of static v1 unless the static constraint changes.

Important constraint: OAuth implementation is non-trivial. Prefer an official or widely used AT Protocol client/OAuth SDK instead of hand-rolling the protocol.

### Sign-Out

Users must always have a visible, reliable way to sign out.

User-facing requirements:

- Show Sign out in the account/profile menu and Settings.
- Keep Sign out available even if API calls are failing or the app is offline.
- Confirm only if there are local unsent drafts; otherwise sign out immediately.
- After sign-out, return the app to signed-out reader mode without a full page reload when possible.
- Show clear signed-out identity state: no active account, no authenticated actions, and sign-in control visible.

Local data cleared on sign-out:

- OAuth session state.
- Access tokens and refresh tokens stored by the OAuth client.
- DPoP key material associated with that session.
- Session-specific in-memory entity cache.
- User-specific IndexedDB/localStorage entries such as layout preferences tied to the account, recent account history, and local drafts if the user chooses to discard them.

OAuth/session behavior:

- Use the OAuth SDK revoke/sign-out path where supported.
- If remote revoke fails, still clear local browser session state and show a warning that remote revocation could not be confirmed.
- Do not call a BigBSky backend to sign out. Sign-out is local browser cleanup plus direct OAuth revocation when available.
- Keep public/static app cache intact. Signing out should not delete the service worker app shell or static assets; it should only remove account/session data.
- Signing out should not consume Pages Function/Worker requests because v1 has no BigBSky server-side session.

### API Usage

Public reads:

- Use Bluesky public AppView endpoints where possible.
- Good initial areas:
  - Profile lookup.
  - Author feeds.
  - Feed generator output.
  - Post/thread lookup.
  - Search, if public endpoint behavior is acceptable.
- Search endpoint finding: `https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts` returned `403 Forbidden` during browser/static testing, while `https://api.bsky.app/xrpc/app.bsky.feed.searchPosts` returned CORS-enabled public results. Current app keeps feed/profile/thread/feed-metadata/profile-search reads on `public.api.bsky.app` and uses `api.bsky.app` only for public post search.

Authenticated reads/actions:

- Resolve the user's PDS during OAuth.
- Route authenticated `app.bsky.*` requests through the user's PDS/proxy as expected by the AT Protocol client.
- Match the signed-in information categories available on `bsky.app` where the public AT Protocol/Bluesky APIs allow it.
- Add write/actions only after read experience is stable:
  - Like/unlike.
  - Repost/unrepost.
  - Follow/unfollow.
  - Save/unsave posts, if exposed through supported APIs.
  - Mute/block controls.
  - Compose/reply/quote.

Do not ask for broad scopes before the app needs them. Start with the minimum useful scopes and add progressive scope requests later if supported cleanly.

## Project File Layout

Recommended v1 structure for a static Vite + React + TypeScript app:

```text
bigbsky/
  docs/
    PLAN.md
  public/
    _headers
    _redirects
    oauth-client-metadata.json
    icon.svg
    favicon.ico
    manifest.webmanifest
  src/
    app/
      App.tsx
      routes.tsx
      routeState.ts
      shellState.ts
      providers.tsx
      config.ts
      startup.ts
    api/
      atprotoClient.ts
      publicBsky.ts
      authBsky.ts
      feeds.ts
      timelines.ts
      posts.ts
      profiles.ts
      search.ts
      notifications.ts
      lists.ts
      saved.ts
      media.ts
      errors.ts
    auth/
      oauthClient.ts
      oauthCallback.ts
      sessionRestore.ts
      sessionStore.ts
      signOut.ts
      dpopKeys.ts
      scopes.ts
      oauthMetadata.ts
    storage/
      localDb.ts
      preferencesStore.ts
      accountDataStore.ts
      draftStore.ts
      recentHistoryStore.ts
      feedLayoutStore.ts
      cacheStore.ts
      cachePolicy.ts
      clearAccountData.ts
    cache/
      entityCache.ts
      queryClient.ts
      timelineCache.ts
      cacheKeys.ts
    serviceWorker/
      registerServiceWorker.ts
      appShellCache.ts
      staticAssetManifest.ts
    layout/
      DesktopShell.tsx
      LeftRail.tsx
      RightRail.tsx
      FeedSelector.tsx
      ActiveFeedHeader.tsx
      ContextPanel.tsx
      ResizeRules.ts
    features/
      feed/
        ActiveFeedTimeline.tsx
        FeedPage.tsx
        FeedCard.tsx
        FeedMap.tsx
        FeedSelectorDrawer.tsx
        FeedGrouping.ts
        useFeedTimeline.ts
      post/
        PostCard.tsx
        WidePostCard.tsx
        PostActions.tsx
        PostThreadView.tsx
        QuotePost.tsx
        LinkCard.tsx
        MediaEmbed.tsx
        ContentLabel.tsx
        AltTextButton.tsx
      composer/
        InlineComposer.tsx
        ThreadComposer.tsx
        ComposerPost.tsx
        MediaAttachmentPicker.tsx
        CharacterCounter.tsx
        DraftsMenu.tsx
        composerValidation.ts
      profile/
        ProfilePage.tsx
        ProfilePreview.tsx
        ProfileTabs.tsx
        FollowButton.tsx
      search/
        SearchPage.tsx
        SearchFilters.tsx
        SearchResults.tsx
      notifications/
        NotificationsPage.tsx
        NotificationItem.tsx
      lists/
        ListsPage.tsx
        ListTimeline.tsx
      saved/
        SavedPostsPage.tsx
      settings/
        SettingsPage.tsx
        LocalSettings.tsx
      account/
        AccountMenu.tsx
        SignOutButton.tsx
        SignedOutState.tsx
      chat/
        ChatEntryPage.tsx
      rightRail/
        FeedInfoPanel.tsx
        AuthorPreviewPanel.tsx
        LinkPreviewPanel.tsx
        TrendingPanel.tsx
      novel/
        magazineMode.ts
        linkPreviewModel.ts
    components/
      Button.tsx
      IconButton.tsx
      Menu.tsx
      Modal.tsx
      Tabs.tsx
      Tooltip.tsx
      EmptyState.tsx
      LoadingState.tsx
      ErrorState.tsx
    hooks/
      useLocalPreference.ts
      useResponsiveLayout.ts
      useInfiniteFeed.ts
      usePreserveScroll.ts
    styles/
      tokens.css
      global.css
      layout.css
    types/
      atproto.ts
      bsky.ts
      app.ts
    utils/
      uri.ts
      text.ts
      dates.ts
      media.ts
      grouping.ts
  src-sw.ts
  index.html
  package.json
  tsconfig.json
  vite.config.ts
```

File layout principles:

- `public/_headers` owns static cache headers for `index.html`, hashed assets, OAuth metadata, icons, and the manifest.
- `public/_redirects` owns static SPA fallback routing to `/index.html`. It must not be replaced with a Pages Function for v1.
- `src-sw.ts` and `serviceWorker/` own app-shell/static-asset caching only. They must not store OAuth tokens, refresh tokens, DPoP keys, drafts, or account-specific API data.
- `app/routes.tsx`, `app/routeState.ts`, and `app/shellState.ts` own client-side routing and view state. Routes are shareable shell states, not separate Cloudflare-served pages.
- `app/startup.ts` owns boot order: load cached shell, initialize storage, restore OAuth session, then load the active source.
- `api/` contains direct Bluesky/AT Protocol API wrappers only. It should not know about React UI.
- `auth/` owns OAuth, DPoP, session restore, callback handling, sign-out, OAuth metadata assumptions, and scopes.
- `storage/` owns browser-local persistence only. No server persistence assumptions should leak into feature code.
- `storage/accountDataStore.ts` and `storage/clearAccountData.ts` define exactly what is removed on sign-out without deleting the static app shell cache.
- `cache/` owns in-memory and optional browser-local entity/query caches. It must support account scoping and account cache clearing.
- `layout/` owns the wide-screen shell and width allocation rules, especially keeping sidebars narrow and prioritizing the active Feed timeline.
- `features/feed/` owns Feed selection, Feed detail views, Feed maps, and the active endless-scroll Feed timeline.
- `features/post/` owns post rendering and thread/detail display.
- `features/composer/` owns inline composer, multi-post/thread composition, media attachments, drafts, and 300-character-per-post validation.
- `features/account/` owns account menu, visible Sign out, and signed-out identity state.
- `features/rightRail/` owns contextual panels that improve desktop use without widening the sidebar itself.
- `features/novel/` contains pure client-side transforms over loaded API data. Anything here must satisfy the static/stateless rules.
- `components/` contains reusable UI primitives with no Bluesky-specific API calls.
- `hooks/`, `utils/`, and `types/` stay generic and shared.

This layout keeps the project aligned with static hosting: features can use live API calls, service-worker app-shell caching, and browser-local state, but there is no backend layer, database layer, job layer, Pages Function, Worker route, API proxy, image optimizer, or server-only module in v1.

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
- Replace server-side link previews with metadata already included in Bluesky embeds.
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
- Normalize timeline responses into shared post/profile/embed entities before rendering previews or right-rail panels.
- Cache API responses in memory first, with optional short-lived IndexedDB cache for public/profile/Feed metadata.
- Keep timeline page caches scoped by active source and cursor. Route changes should retain loaded pages until the user explicitly refreshes or memory pressure requires pruning.
- Use stale-while-revalidate behavior for Feed metadata, profile previews, Feed maps, and right-rail panels.
- Fetch details on demand: author previews, link preview panels, thread expansions, and liked-by/reposted-by/quotes pages should load only when opened or visible.
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

## Few Pages, Few Calls Design

Be deliberately creative about fitting the product into as few app pages and network calls as possible.

App shape:

- One main app shell should handle almost everything: Feed browsing, profile preview, post/thread preview, search, notifications, saved posts, lists, settings, and Feed discovery.
- Prefer panels, drawers, popovers, and in-place state changes over separate full page navigations.
- Routes should be shareable deep links when explicitly opened or copied, but navigation inside the app should preserve the shell and reuse already-loaded data.
- Avoid separate "pages" for every sidebar item if the same shell can swap the active source and context panel.
- Treat Feed, List, Search, Profile, Notifications, Saved, and Thread as source types loaded into the same active content surface.
- Make "page" mean client-side view state, not a separate Cloudflare-served HTML file.
- Keep ordinary navigation in memory. Do not reload the document when switching Feeds, opening profile previews, viewing thread context, changing tabs, or opening settings.

Data shape:

- Keep a normalized client-side entity cache for posts, profiles, Feeds, lists, images, link cards, and relationships.
- When a timeline response includes embedded author/post/media/link-card data, reuse it everywhere instead of refetching details.
- Build profile previews from already-loaded post authors first; fetch full profile only when the preview opens.
- Build post/thread previews from already-loaded post cards first; fetch full thread only when expanded.
- Build standalone post pages from already-loaded post entities first when opened from inside the app. On direct open, resolve the `handleOrDid` and `rkey` in the browser, call Bluesky/AT Protocol directly for the post thread, and render the root post plus threaded replies inside the static app shell.
- Normalize every post, author, embed, media object, and reply edge returned by a thread response. Do not refetch author profiles, post records, media metadata, or link cards that are already embedded in the thread payload unless the user opens a deeper detail surface.
- Build Feed map entries from saved Feed metadata already loaded for the Feed selector.
- Build layout variants from the original loaded posts without adding local labels, scores, clusters, or summaries.

Request-saving UI patterns:

- Feed selector opens with already-known pinned/saved Feeds immediately, then refreshes metadata quietly.
- Right rail shows cached/context-derived information first, then upgrades only when visible.
- Hover/selection should use local data immediately and delay network fetch until intent is clear, such as click, dwell, or opening a panel.
- Use "load details" buttons for expensive surfaces like full thread, quotes, liked-by, reposted-by, and related posts.
- Do not prefetch all tabs in search/profile/notifications. Fetch the active tab only.
- Do not auto-load every Feed in the Feed map. Show metadata first; fetch timeline only when selected.
- Do not auto-open media/link/article details. Use the embedded card until the user requests the richer view.
- Keep composer drafts local and do not sync them.
- Use optimistic UI for likes/reposts/saves/follows, then reconcile with the API response.

Possible route model:

- `/` for the only physical app document.
- Internal shell states for normal navigation:
  - active source: Home, Discover, Following, Feed, List, Search, Notifications, Saved, Profile, Thread, Settings.
  - active context panel: profile preview, thread preview, media viewer, Feed info, composer, settings pane.
- Shareable clean paths only when needed:
  - `/feed/:actor/:rkey` or an encoded Feed URI route for copied/opened Feed links.
  - `/profile/:handleOrDid` for copied/opened profile links.
  - `/profile/:handleOrDid/post/:rkey` for copied/opened standalone post or thread links, matching the shape of `https://bsky.app/profile/suewho82.bsky.social/post/3mnpjvwbxq22b`.
  - `/search` for copied/opened search state.
- Clean paths should all be served by the same static `/index.html` shell through static Pages fallback routing.
- Consider hash URLs for non-canonical workspace state, such as selected panel, density, local Feed group, or expanded preview. Hash changes do not hit Cloudflare.
- Other sidebar destinations should remain shell states unless there is a strong reason to make them shareable direct URLs.

Standalone post route behavior:

- Direct open of `/profile/:handleOrDid/post/:rkey` should cost one static Pages document fallback plus cached/hashed assets, with zero Pages Function/Worker invocations.
- Minimum Cloudflare quota-trigger posture: zero Pages Function/Worker invocations is mandatory. A clean direct URL cannot avoid the one static Pages request for the SPA document unless the app is already running from a service-worker/PWA cache; that static request must never be implemented as a Function, Worker, SSR route, or server redirect.
- The browser constructs the post lookup from the route: resolve `handleOrDid` if it is a handle, build the post AT URI for `app.bsky.feed.post`, then call Bluesky directly for threaded post data.
- DevTools check against `https://bsky.app/profile/suewho82.bsky.social/post/3mnpjvwbxq22b` while signed in showed Bluesky using `app.bsky.unspecced.getPostThreadV2` on the authenticated AppView host with the post AT URI as `anchor`, `below` controlling reply depth, and `sort=top`.
- Default rendering should show the root post, author, embeds/media/link card, labels, counts, timestamp, reply permissions, normal available actions, and the threaded comment tree below it.
- Replies must render as a nested conversation, preserving parent/child relationships and showing replies-to-replies inline. Use indentation, thread lines, branch controls, or compact nesting so the structure remains readable on desktop.
- Initial load should make one primary thread request with a bounded depth, such as the AppView-supported `below` parameter, and render immediately from that payload.
- Choose conservative defaults for thread breadth/depth. Prefer one meaningful default response plus explicit expansion over eager loading every branch of a large conversation.
- Provide explicit "load more replies" or "load more branch" controls for truncated branches, hidden replies, or API-limited continuation. Do not auto-crawl unbounded reply trees in the background.
- Cache expanded branches by post URI during the session so collapsing/reopening a branch or navigating back to the thread does not repeat the same Bluesky request.
- Defer nonessential side-panel calls on direct thread routes. Trending topics, suggested follows, chat status, notification checks, profile sidebars, quote lists, liked-by lists, reposted-by lists, and author follows should not load before the thread is readable.
- Lazy-load avatars/media as they enter the viewport and use Bluesky CDN URLs directly. Do not proxy, transform, preload every reply avatar, or fetch full-resolution media for offscreen replies.
- When sharing from inside BigBSky, prefer keeping transient thread UI state in the URL hash after the canonical clean path. Hash updates and copied hash state do not generate Cloudflare document reloads, static asset requests, or paid/quota-triggering requests while the app is already open.
- Do not add route-specific Cloudflare redirects from `bsky.app`-style paths, vanity short links, or old URL shapes. Normalize route aliases in browser code after the static SPA fallback has loaded.
- Large threads must be virtualized or incrementally rendered so loading all available comments does not create unbounded DOM growth.
- The standalone page must not require server-rendered metadata, per-post static HTML, a BigBSky API route, or a Cloudflare Function. Social unfurls can use the generic static BigBSky document for v1.
- If the post is unavailable, deleted, blocked, labeled, or rate-limited, show a local error/state in the app shell without retry loops or backend fallback.

Request budget mindset:

- One visible source should generally mean one primary API query plus only the metadata needed to render it.
- Opening context should reuse loaded entities before making new requests.
- Extra panels and optional columns should be opt-in because each one may add live API queries.
- The default desktop view should show more content through better layout, not by fetching more sources at once.
- Reuse loaded Bluesky data before requesting more. Local UI state such as feed maps and recent history should not reinterpret post content.
- Do not let hover states become network traffic by default. Use click, keyboard focus, explicit open, or sustained dwell before fetching details.

## MVP Scope

### Phase 1: Static Reader Shell

- Create Vite/React/TypeScript app. Status: implemented.
- Build responsive desktop-first shell. Status: implemented.
- Ship one static app document plus a small number of hashed assets.
- Establish bundle budgets before adding OAuth or write-heavy features.
- Add static `_headers`/`_redirects` for cache policy and SPA fallback routing as needed. Status: implemented.
- Add a build-output quota audit that fails if `functions/`, `_worker.js`, server bundles, SSR manifests, middleware, API routes, or edge runtime artifacts are generated. Status: implemented.
- Add a manual Cloudflare verification step after deploy: normal reader browsing should show zero Pages Function/Worker invocations.
- Establish the primary layout regions: left sidebar, improved feed selector, right sidebar, and central endless-scroll feed. Status: implemented.
- Build the active Feed timeline as the central product surface. Status: implemented.
- Implement timeline virtualization before large-feed polish so card/layout choices are tested against the real scrolling model. Status: implemented and guarded by `npm run build`; Feed/profile timelines use measured row windowing, density-aware estimated heights, top/bottom spacers, rendered-row reporting, and scroll compensation when measured rows above the viewport change height.
- Reserve stable media/embed dimensions in post cards to reduce layout shift during image, video, GIF, and link-card loading. Status: implemented for current AppView media/link surfaces and guarded by `npm run build`; image/video cards apply Bluesky aspect-ratio metadata, rich posts reserve stable embed space, media density reserves larger media regions, and link-card sizing is stable. Richer GIF/video playback controls remain pending.
- Include the signed-in inline composer/input at the top of the active Feed timeline. Status: implemented as a placeholder composer that now only renders when a session is restored (signed-out visitors see the timeline start directly with posts); authenticated posting remains pending.
- Include composer image attachment UI and upload/posting flow. Status: partial; client-only image attachment placeholders are available per draft post, with actual upload/posting deferred until OAuth and write APIs are added.
- Include multi-post/thread composer UI. Status: first pass implemented as a client-only thread composer with add/remove draft posts, Drafts/Post All controls, and per-post validation.
- Include per-post media attachment UI and upload/posting flow. Status: partial; each draft post supports up to four local media placeholders, with actual upload/posting deferred until OAuth and write APIs are added.
- Include 300-character counter and validation per post in composer UI. Status: implemented for the current placeholder composer and each draft in the thread composer.
- Experiment with wider post/card formats for text, media, link cards, quote posts, and threads. Status: implemented as first pass; quote-post cards, quoted media/link/video previews, alt badges, and content-label chips now render from loaded post data.
- Add public timeline/feed/profile/thread data loading. Status: implemented.
- Add standalone post-thread data loading for `/profile/:handleOrDid/post/:rkey`, including direct-open support for Bluesky-style copied post URLs. Status: implemented.
- Render standalone post routes as full threaded conversation pages: root post first, then nested replies/comments, with branch expansion for additional replies when Bluesky truncates the initial thread response. Status: improved; standalone threads now preserve the AppView parent chain, render parent/reply context above the opened post, render nested replies, let loaded reply branches expand/collapse locally, and can explicitly fetch a deeper branch from Bluesky by post URI with a session cache. More complete continuation handling for alternate thread APIs remains pending.
- Add normalized in-memory entities for loaded posts, authors, embeds, and Feed metadata before building right-rail previews. Status: first pass implemented for loaded posts, author profiles, active Feed Generator metadata, link URLs, media previews, and local smart-group summaries.
- Add request cancellation and source-level cache retention so switching Feeds or previews does not produce stale renders or repeated first-page fetches. Status: implemented for feed/profile/search/thread first-page loads with session cache and route scroll restoration.
- Support client-side URL routes served by the single static app shell:
  - `/` Status: implemented.
  - `/profile/:handleOrDid` Status: implemented.
  - `/profile/:handleOrDid/post/:rkey` Status: implemented.
  - `/feed/:uri` Status: implemented for known Feed source IDs, matching Feed URIs, any public `at://` Feed generator URI through a synthetic Feed source (so discovered Feeds open in-app and load their metadata in the right rail), and now `at://` `app.bsky.graph.list` URIs, which the feed loader reads as a list timeline via `app.bsky.feed.getListFeed` with list metadata in the right-rail context panel.
  - `/search` Status: implemented with `q` query parameter for post search.
  - `/explore` Status: improved; the static SPA Explore surface now loads live "Trending Topics" from the public `app.bsky.unspecced.getTrendingTopics` endpoint (topic chips open an in-app post search) and a live "Discover New Feeds" section from the public `app.bsky.unspecced.getPopularFeedGenerators` endpoint (now with a submit-only search box that re-queries the endpoint by topic without fetching per keystroke), rendering Feed cards (avatar, name, creator, description, like count) that open in-app without signing in, expose a local Pin/Unpin action that persists discovered-Feed metadata so the pin survives reloads and appears in the selector's Pinned group, and link out to Bluesky, alongside the public search doorway.
  - `/feeds` Status: implemented as a static SPA surface with a local known-Feed directory that opens Feed destinations without a document reload.
- Add loading, empty, error, and rate-limit states. Status: implemented for current public feed/search surfaces and standalone thread branches; unavailable thread nodes now distinguish blocked, deleted, not-found, generic unavailable, and rate-limited states with local copy and alert styling. Feed-generator outages are now surfaced distinctly: when the AppView returns 502/503/504 `UpstreamFailure` ("feed unavailable") — i.e. the third-party feed provider is down/removed, not our app or the viewer's network — the feed shows "This feed's provider isn't responding right now — the feed may be down or removed. Try again later, or pick another feed." (`isUpstreamFailure`), and `getJson` now reads the AppView error body so the underlying message is captured on the public path too. Verified live against a real 502 feed. Additional authenticated moderation edge cases remain pending.
- Add local layout preferences. Status: implemented for density and feed-width mode.
- Apply local density/layout preferences before initial timeline paint. Status: implemented for per-feed/default density and local feed-width mode.
- Add service worker/app-shell caching once the shell stabilizes. Status: implemented as a static `public/sw.js` app-shell cache for `/`, `/index.html`, and hashed assets; `/sw.js` is served with must-revalidate caching.
- Verify repeat visits and in-app navigation do not depend on Cloudflare document reloads or paid/quota-triggering Cloudflare requests. Static asset update checks are allowed only as deliberate background checks. Status: improved and locally verified; the static service worker now serves cached app-shell navigations first and refreshes the shell in the background, with local preview confirming service-worker registration plus cached `/` and `/index.html`. Production Cloudflare dashboard verification remains pending.
- Verify DOM size remains bounded after scrolling multiple timeline pages. Status: verified (several-page stress test, 2026-06-09). Loaded 8 pages of a high-volume profile feed (`/profile/foxes.hourly.media`) via the manual "Load more" control while the development inspector reported Pages 3→8; the `.virtual-list` grew from ~19,000px to 65,535px, yet the rendered DOM stayed bounded at 6 `.post-card` rows the entire time (inspector "Rows 6") — at the bottom and again after scrolling back to the middle. Measured-row windowing therefore keeps the DOM bounded to viewport+overscan independent of loaded page count/list height. Note: in the headless preview the IntersectionObserver auto-loader did not fire on programmatic instant `scrollTop` jumps (real pointer scrolling triggers it; the manual "Load more profile posts" fallback worked every time).
- Verify all clean routes and OAuth callback routes are served by static SPA fallback, not by server-side handlers. Status: local preview verified `/`, `/search`, `/explore`, `/feeds`, `/oauth/callback?code=test&state=test`, and `/profile/suewho82.bsky.social/post/3mnpjvwbxq22b` return the static SPA shell.
- Verify a direct standalone post route such as `/profile/suewho82.bsky.social/post/3mnpjvwbxq22b` renders through the static SPA shell, makes only direct Bluesky/AT Protocol data calls after load, shows the root post plus threaded replies/comments, and triggers zero Pages Function/Worker invocations. Status: local static-shell/thread rendering verified; Cloudflare dashboard zero-invocation verification still pending.

### Phase 2: OAuth Login

> Operator-confirmed (production): sign-in and app authorization work on the deployed `bigbsky.com` origin — the user can sign in and authorize the app successfully. The "partial / verification pending" wording on individual items below predates that confirmation; treat the core production OAuth login + callback + authorize flow as verified. Note: OAuth cannot be exercised in the localhost-only Claude preview, so authenticated flows must be tested on the deployed origin, not the in-editor preview.

- Add AT Protocol OAuth client metadata. Status: first static public-client metadata document implemented at `/oauth-client-metadata.json` for the `https://bigbsky.com/oauth-client-metadata.json` client ID, including HTTPS callbacks, refresh-token grant declaration, `atproto transition:generic` scope, and DPoP-bound tokens.
- Serve OAuth client metadata, icons, and callback shell as static assets only. Status: implemented for v1 static assets; `/oauth-client-metadata.json`, `/icon.svg`, `/site.webmanifest`, and the SPA callback shell are all static files, and the build audit now requires the icon, manifest, callback metadata, and OAuth `logo_uri`.
- Add static OAuth callback route/surface through the SPA shell. Status: partial; `/oauth/callback` is served by the static SPA and now invokes the browser OAuth SDK callback/restore path, then returns to Settings when a callback session is restored. Loopback development OAuth now builds its client ID from the root path so signing in from `/settings` does not create an invalid path-bearing localhost client ID. Live production callback verification remains pending.
- Implement sign-in with handle input. Status: first pass implemented in the right-rail account panel and Settings account panel; handle/DID/PDS input validates locally and starts the AT Protocol browser OAuth SDK redirect flow on explicit submit.
- Complete callback handling. Status: done (operator-verified in production); callback detection and SDK `init()` handling are wired and the deployed sign-in/authorize/callback flow works. Error-state polish can still improve.
- Handle OAuth callback parsing, state validation, token exchange, session restore, and refresh in browser code or the OAuth SDK without a BigBSky backend. Status: partial; the app lazy-loads `@atproto/oauth-client-browser` for known stored sessions, callbacks, sign-in, and sign-out, and avoids loading OAuth chunks on cold signed-out reader visits. End-to-end production token exchange still needs verification.
- Persist session locally. Status: partial; the SDK-managed IndexedDB store is used and BigBSky records the active DID/handle in `bigbsky:auth:*` local keys for restore. Reload and multi-tab verification remain pending.
- Show signed-in account identity. Status: first pass implemented after SDK restore/callback by fetching the signed-in profile through `@atproto/api` and showing handle/display name/avatar in the left rail, right-rail account panel, self-profile surface, and Settings.
- Add visible sign-out in account/profile menu and Settings. Status: partial; right-rail account panel, Settings account panel, signed-in left rail, and signed-in Profile surface expose sign-out when a session is present. Rich account switcher placement remains pending.
- Sign-out must clear local OAuth session state, account-specific cache, and account-specific browser-local data without needing a BigBSky backend. Status: partial; sign-out now clears `bigbsky:auth:*` keys and the SDK OAuth IndexedDB store after attempting revocation, and Settings local data cleanup also clears browser reader/auth state while reporting local BigBSky key counts. Account-scoped query cache clearing will expand with signed-in reads.
- Sign-out should attempt OAuth revocation where supported, but local sign-out must still work if revocation fails. Status: first pass implemented with SDK `revoke()` attempt and local cleanup fallback.
- Verify reload persistence and multi-tab behavior.

### Phase 3: Signed-In Reader

- Home timeline.
- Discover timeline.
- Following feed. Status: implemented; when signed in, a "Following" source appears at the top of the selector's Core group and loads the authenticated reverse-chronological home timeline via `app.bsky.feed.getTimeline` (`getFollowingTimeline` in auth.ts, reusing the retained OAuth session), with the same pagination/caching/virtualization as public feeds. Hidden when signed out. Signed-out behavior verified (no Following source, clean no-op) and the build passes; the authenticated load needs a live signed-in check on the deployed origin (cannot run in the localhost-only preview).
- Pinned/custom feeds in a scalable feed selector. Status: improved; known public Feeds and discovered public Feeds (arbitrary `at://` Feed generator URIs surfaced from Explore) can be pinned/unpinned locally in the browser, appear in a Pinned group at the top of the selector, persist their metadata across reloads under `bigbsky:pinned-feed-meta`, and are counted/clearable through Settings. Signed-in subscribed-feed loading is now implemented: when a session is restored, `getSubscribedFeeds()` (auth.ts) reads the user's AT Protocol preferences (`app.bsky.actor.getPreferences`, supporting `savedFeedsPrefV2` and legacy `savedFeedsPref`), resolves feed-generator metadata via `app.bsky.feed.getFeedGenerators`, and surfaces them in a "My Feeds" group shown right below Pinned in the selector so the user can select them; they open via the existing `/feed/:uri` synthetic-source path and clear on sign-out. Feed loading is now authenticated when signed in: `loadFeed` routes feed-generator reads through `getFeedAuthed` (the user's OAuth session/agent) instead of the public AppView, so personalized/auth-required feeds such as a "mentions" or "only-posts" generator — which returned "Unable to load" on the public endpoint — now load. Signed-out visitors still use the public `getFeed`. Note: signed-out behavior is verified (no "My Feeds" group, clean no-op) and the code builds. Production OAuth sign-in/authorize is operator-verified on the deployed origin, and the authenticated "My Feeds" group is now operator-confirmed populating in production (the user sees their subscribed feed list after signing in). It cannot be exercised in the localhost-only Claude preview, which OAuth rejects. Manual feed reorder/pin still uses the local store, not yet write-back to account preferences.
- No horizontal feed-tab scrolling for normal feed selection. Status: done; feed selection uses a grouped, vertically-scrolling selector column (`.feed-group` list) rather than a horizontal tab strip. Verified live at 2560px that the selector column has no horizontal overflow (`scrollWidth === clientWidth`).
- Feed organization that supports topic/community-style browsing while retaining Bluesky terminology.
- Notifications. Status: partial; local inbox UI now renders account/session state, saved-post count, pinned Feed/search count, local list count, and a mention-search entry point. Authenticated notification reads remain pending.
- Personal feeds/lists. Note: public profiles now surface an account's published Feeds and Lists (read-only discovery), and curated Lists open their timeline in-app through `app.bsky.feed.getListFeed` (the feed loader detects `app.bsky.graph.list` URIs and the right-rail context panel shows list metadata from `app.bsky.graph.getList`). Pinning a list stores it like a pinned Feed so it reopens its timeline. Authenticated/own-list management remains pending.
- Saved posts. Status: first pass implemented as a browser-local saved timeline under `/saved`; post cards can save/remove loaded public posts locally without a backend or account write.
- Search and trending topics. Status: improved; public post/profile/Feed search is implemented, current searches can be pinned locally, and both the Explore surface and the right-rail Trending panel now load live "Trending Topics" from the public `app.bsky.unspecced.getTrendingTopics` endpoint (each topic opens an in-app post search). The right-rail panel fetches once for the session (the rail is mounted once) and falls back to loaded-post hashtag trends, then static topics, if the live fetch is empty or fails.
- Profile/self-profile surfaces. Status: expanded; signed-in Profile now renders the restored OAuth identity, account stats, local sign-out, disabled edit-profile affordance, actions into the public profile reader, and account-section cards for Posts, Replies, Media, Likes, Feeds, Starter Packs, and Lists. Posts/Replies/Media use the public profile reader path now, while Likes, Starter Packs, and account-backed Feed/List sync remain pending authenticated reads/APIs.
- Account switcher placeholder and sign-out. Status: partial; signed-in identity now appears in the left rail with profile access and visible sign-out, plus right-rail and Settings account controls.
- Inline composer/input at the top of the active Feed timeline. Status: implemented as a local composer placeholder with autosaved browser-local draft state. It is now collapsed by default into a single "Add New Post" banner to keep the top of the feed clean; clicking the banner expands the full composer box, and a collapse control returns it to the banner. It auto-expands if a local draft is already in progress (so a saved draft is never hidden) and shows a "Draft saved" hint on the collapsed banner. (Signed-in only; verify the collapse/expand on the deployed origin — the composer does not render in the localhost-only preview.)
- Image attachment support for the inline composer. Status: first pass implemented with per-post local media placeholders capped at four images while authenticated upload remains pending.
- Multi-post/thread composition from the inline composer. Status: implemented locally with add/remove post controls and per-post validation.
- Drafts and Post All support where feasible. Status: partial; composer drafts autosave locally and can be cleared, while authenticated Drafts/Post All write behavior remains disabled until OAuth posting is implemented.
- 300-character-per-post limit counter and validation. Status: implemented for each local composer post and reply draft.
- Menu destination views for Explore, Notifications, Feeds, Lists, Saved, Profile, and Settings. Status: expanded; static SPA routes exist for Explore, Feeds, Notifications, Chat, Lists, Saved, Profile, and Settings. Notifications now has a local inbox surface, Lists now supports browser-local list workspaces with create/delete controls, post membership, and local timelines, Explore links into public search and now lists live popular public Feeds for discovery, and Settings has local appearance/data/account panels.
- Chat entry point and empty/message-list state, with full DM behavior deferred until privacy/API handling is clear. Status: first pass implemented as a static SPA placeholder route that explicitly defers DM behavior.
- Feed detail header with Feed name, creator, count, options, and active Feed timeline below. Status: revised; the in-timeline Feed header was removed after UX review because it consumed reader space, and the useful Feed metadata/actions now live in the right-rail Feed context panel with local Pin/Unpin feed, Copy URI, and Open on Bluesky controls.
- Post/thread detail view with reply composer, stats, repost/quote/like/save links, and reply permissions. Status: improved; standalone threads now show conversation metadata, reply/repost/quote/like counts, timestamp, reply-permission text, local save actions, and a browser-local 300-character reply draft per thread. The Reposts/Quotes/Likes counts are now clickable and open an on-demand engagement panel that fetches the public `app.bsky.feed.getRepostedBy`, `app.bsky.feed.getQuotes`, and `app.bsky.feed.getLikes` lists only when expanded (reposted-by/liked-by render as profile cards that open the profile; quotes render as cards that open the quote post). Authenticated reply/write actions remain pending.
- Search result view with query, clear action, language selector, and Top/Latest/People/Feeds filters. Status: improved; query form, clear-query button, Posts/People/Feeds tabs, Top/Latest post results, language selector for post search, and public actor search for People are implemented, and the Feeds tab now shows both local Feed destinations and live public Feed results from `app.bsky.unspecced.getPopularFeedGenerators` (queried with the committed search term, opened in-app via the synthetic Feed source, cached per query, with loading/empty/error/rate-limit states). The live Feed search runs only after explicit `/search?q=` navigation, not per keystroke.
- Profile view variants for self-profile and other-user profiles. Status: expanded; public other-user profile routes now render a profile-specific header with stats, disabled follow/action controls, Open on Bluesky/Copy link actions, local Posts/Replies/Media/Videos tabs over loaded public posts, a live Feeds tab that loads the account's published Feeds from the public `app.bsky.feed.getActorFeeds` endpoint (rendered as reusable discover-Feed cards that open in-app and support local Pin/Unpin), and a live Lists tab that loads the account's public Lists from `app.bsky.graph.getLists` (cards show name, list type, member count, and description; curated lists now open their timeline in-app via `app.bsky.feed.getListFeed` while moderation lists keep the Open-on-Bluesky link). Self-profile now uses the restored OAuth identity for display/stats/sign-out, can open the signed-in user's public profile reader, and exposes account-section cards for Posts, Replies, Media, Likes, Feeds, Starter Packs, and Lists with local counts and clear OAuth/API pending states.
- Media, GIF/video, alt text, and content-label rendering states. Status: improved; posts render up to 10 images (Bluesky's current per-post limit, raised from 4 — `maxPostImages` constant covers the feed image grid, quoted-post images, image-viewer navigation, and the composer attachment cap), with an overflow image-count badge only if more than 10 are present, plus image alt badges, image-viewer alt text, normalized content-label chips, AppView record-with-media quote/image cards, and AppView video/GIF cards now render from loaded data. Adult/graphic media is hidden behind a click-to-reveal content warning before any thumbnail loads — for both top-level post media and quoted-post media (via a shared SensitiveMediaGate) — and a Settings "Content & Media" toggle (browser-local, hidden by default for all users) can switch to always showing labeled media. Video/GIF cards use native browser controls for playable playlist URLs, keep thumbnail/open-media fallbacks, and expose alt text without BigBSky media proxying; richer cross-browser HLS playback remains deferred unless a small client library is justified.
- Muted/blocked content handling as exposed by APIs. Status: partial; post cards now surface AppView viewer flags such as muted threads, limited replies, embedding-disabled state, and sensitive labels in a local moderation notice. The Settings "Content & Media" toggle (`bigbsky:show-nsfw`) defaults to hidden. When hidden: adult/graphic-labeled posts (adult/nudity/porn/sexual/graphic/gore/violence, spam excluded — checked on both the post and the author/account labels) are now removed from feed and profile timelines entirely (filtered in `VirtualPostList` via `isAdultPost`, reusing the media-gate label set), so a post the user does not want to see does not appear at all; on surfaces not yet covered by that filter (search results, standalone thread, quoted posts) their images/video remain gated behind a click-to-reveal "Sensitive content — Show" warning (with a Hide control after reveal). When the toggle is on: those posts are shown and their media is ungated. Standalone thread branches also render typed blocked/deleted/not-found/rate-limited/unavailable alerts from AppView thread nodes. Filtering search/thread/quoted posts when hidden, and richer authenticated moderation states, remain pending.
- Account-aware post rendering. Status: first pass implemented; signed-in users see browser-local "Your post" context on loaded posts authored by the restored account DID, while authenticated relationship/action state remains pending.
- Wider active Feed timeline formatting while preserving endless-scroll behavior. Status: improved; the reader is widened by a single fluid `1fr` content column with fixed narrow rails, so the content column always absorbs remaining width and is the widest column at every screen size without any per-screen-size grid breakpoints. Post content (prose, header, badges, action row, media) fills the full card width — per explicit user direction the content is not capped to a narrow measure inside the wide column. Verified live at 2560px: content column 1876px, card 1809px, header/text/actions all 1775px. Endless-scroll virtualization is unchanged.
- Preserve feed scroll position when opening post/thread/profile/media context. Status: improved; feed/profile scroll offsets are cached locally for shell navigation and in browser session storage for reload recovery, cached and freshly loaded feed/profile states restore their prior offsets, feed selector switching no longer forces the timeline back to the top, and browser-local Saved/List timelines restore route-specific scroll offsets when revisited in the SPA or after a browser reload. Live reload verification remains useful.

### Phase 4: Account Actions

- Like/unlike.
- Repost/unrepost.
- Save/unsave posts.
- Follow/unfollow.
- Basic compose/reply/quote.
- Image attachment for new posts where supported.
- Multi-post/thread composition where supported.
- Per-post image attachment where supported.
- 300-character-per-post limit enforcement for post composition.
- Share menu.
- Post options menu where supported.
- Progressive scopes if required.

### Phase 5: Desktop Power Features

- Configurable feed width and density. Status: improved; the density (Comfortable/Compact/Media) and width (Balanced/Wide/Focus) segmented controls were moved out of the workspace header into the Settings → Appearance panel (`/settings`), because on mobile the header control bar sat sticky at the top of the reader and was intrusive (operator direction). Both controls now live as `.settings-control-group` button rows in Settings; changing them writes the `default` preference slot (via the existing `updateDensity`/`updateWorkspaceWidth`, which always set both the active context and `default`), so the choice applies across the reader. The workspace header now shows only the active Feed label/title. Dead `.header-controls`/`.compact-segmented` CSS was removed (`.segmented` is still used by the search tabs). Verified live: Settings renders both control rows, density selection updates and persists to `bigbsky:density-by-context.default`, and the mobile reader no longer shows the control bar. Build passes. Underlying mechanics unchanged: browser-local Balanced, Wide, and Focus width modes plus existing density modes, both still remembered per feed/context (width under `bigbsky:width-by-context`, density under `bigbsky:density-by-context`). Removed the per-screen-size grid breakpoints (the old `@media (min-width: 1900px)` `.app-shell` override and a short-lived 2560px tier) in favor of one fluid approach: fixed narrow rails plus a `1fr` content column. This also fixes the prior widescreen bug where the 1900px override beat `.width-wide`/`.width-focus` (so they had no effect on large monitors and Focus left an empty right-rail gutter) — width modes now simply adjust rail widths and the content column grows fluidly at all sizes.
- Optional multiple timelines side by side for users who want it, not as the default requirement. Status: deferred; the right-rail secondary reader was removed after UX review because it duplicated the primary Feed browser and made the context rail less focused.
- Pinned feeds/profiles/searches/notifications. Status: partial; known Feeds, discovered public Feeds (arbitrary `at://` URIs from Explore), public profiles, searches, and local notification cards can be pinned locally in the browser, with pinned profile/search shortcuts shown in the right rail and pin counts shown in Settings/Notifications. Account-backed notification pins remain pending.
- Feed grouping, filtering, ordering, and quick switching. Status: improved; the selector supports grouped browsing, local filtering, group collapse/expand state, local Pinned shortcuts, and one-click switching without a horizontal tab strip. Pinned feeds can now be manually reordered locally with per-row Move up/Move down controls (shown only in the Pinned group when unfiltered); the new order persists in `bigbsky:pinned-feeds` and survives reload. Verified live: moving the first pinned feed down reordered both the selector DOM and the persisted id array. Account-backed ordering sync remains pending.
- Wide post-card layout variants. Status: first pass implemented; post cards are classified as text-only, media, link, or quote variants. Post content fills the full width of the wide content column (no narrow content cap, per explicit user direction). Comfortable keeps rich posts in a full-width flow; Compact splits media/link/quote embeds beside author/text/action context on wide desktop viewports (two-zone layout preserved). Single-media posts (a `count-1` image grid or a single video card) are now centered within the wide card instead of hugging the left edge: a single moderate-size image previously left a large lopsided void to its right in the ~1775px content column (verified live: left gap ~0px, right gap ~980px), and centering balances the negative space symmetrically (verified live: left/right gap ~490px each) so the card reads as intentional. Text/header/actions stay full-width left-aligned per the operator's no-narrow-cap direction; only the standalone media is centered. Multi-image grids still fill the width via the 2-up grid and are unchanged. Build (including the layout-behavior verification) passes. Refinement: the single-media centering is scoped to top-level feed media only — a single image nested inside a quoted post (`.image-grid.quote-images.count-1`) now left-aligns with the quoted text instead of centering, because in a quote card centering left it floating with large gaps on both sides (verified live: quoted image left gap went 686px→0; top-level single images still center 718/718).

  Link-card embeds were also rebalanced for the wide column: the thumbnail was a fixed 148px, which left external link cards as a thin, near-empty stretched strip across the full ~1775px content width (verified live: a 1775×112px card with a 148px thumb and the title/description stretched across, Preview button floating at the far right). The thumbnail is now a bounded proportional panel (`clamp(220px, 24%, 440px)`, ~398px in the wide column) with more card height (`min-height: 168px`) and gap, so the card reads as a substantial banner that fills the width with a real image rather than an empty strip; the title still left-anchors beside it (short titles leave trailing space, consistent with short post text). On the ≤720px mobile breakpoint the card stacks vertically (full-width 16/9 thumbnail on top, text below) so the larger thumbnail does not cramp text. Link-card text was also enlarged to read with the post body (per operator direction): the title now matches post text at 17px (was 16px) and the description is one step smaller at 16px (was the 13px browser `small` default), replacing the cramped defaults. Build passes.
- Media-heavy and compact reading modes. Status: first pass implemented; density modes persist per Feed/surface, compact cards use denser text styling, compact text-only posts use a two-zone desktop layout, compact rich posts use a two-column desktop layout (text/author/stats left, media right), and media mode gives image/video posts larger stable media space. Compact uses the same text sizes as Comfortable (post text 17px, author name 16px, @handle 13px, stats 14px) per user direction — it differs only in card padding and the two-zone (text left, media right) layout, not font size (verified live that both density modes report identical font sizes).
- Sticky active Feed header. Status: removed after UX review; Feed metadata and local Feed actions were moved to the right-rail Feed context panel so the active timeline starts with composer/feed content instead of a sticky or non-sticky metadata card.
- Contextual right rail and preview side panel. Status: partial; the right rail adapts between Feed/profile context, link previews, recent history, Feed Map, local pinned searches, and loaded-post hashtag trends. Note: the right sidebar is reserved for search/feed-suggestion/trending/discovery/secondary context — it is NOT used to pop up author/profile or thread previews triggered from posts (an author-peek-in-rail experiment was removed per user direction). Authors are opened via the profile route; threads via opening the post. Do not add anything new to a sidebar without confirming with the operator first.
- Thread reader with parent/reply context. Status: implemented for standalone post routes; AppView parent nodes now render as a compact ancestor chain above the opened post, while replies remain nested below with branch controls.
- Media lightbox. Status: first pass implemented; image posts open in an in-app viewer with viewport-constrained fullsize media, keyboard/onscreen navigation for multi-image posts, thumbnail selection, alt text display, and an open-original action.
- Saved local workspaces. Status: partial; browser-local saved posts, recent trail, per-feed density preferences, composer drafts, reply drafts, local list workspaces with post membership, pinned Feeds, pinned searches, pinned notifications, and width preferences are stored under `bigbsky:*` and clearable from Settings.
- Per-column source selection: Home, Discover, Following, feed, list, search, profile, mentions, notifications, saved. Status: deferred; the right-rail secondary Feed browser was removed after UX review because it duplicated the main reader. Future adjacent context should stay contextual rather than becoming a second timeline selector.
- Per-Feed layout memory. Status: implemented for both density mode and width mode. Width mode is now remembered per context (keyed like density: `feed:<id>` or route kind) in `bigbsky:width-by-context`, with a `default` fallback and one-time migration of the previous single global `bigbsky:workspace-width` value into `default`. Verified live: setting Discover to Wide and Bluesky Team to Focus kept each feed's width independent on switch-back and persisted across reload.
- Feed map grouped by topic/community-style categories. Status: first pass implemented from the local Feed source groups with left-panel group counts and a right-rail Feed Map summary.
- Link preview reader. Status: first pass implemented as a right-rail preview panel from loaded Bluesky external embed metadata, with source-post and external-link actions; no related-discussion summaries, third-party crawling, or BigBSky backend is used.
- Session history trail. Status: implemented as a browser-local recent trail for feeds, profiles, threads, and searches.
- Performance inspector for development builds showing active source, loaded pages, rendered rows, API requests, cache hits, and service-worker state. Status: implemented as a development-only right-rail inspector showing source, rendered rows, Bluesky API request count, session cache hits, and service-worker state.
- Quota inspector for development builds showing Cloudflare document/static asset requests separately from Bluesky API requests, with a warning if any Pages Function/Worker route is detected. Status: first pass implemented in the development inspector by counting same-origin static resource entries separately from Bluesky API events and warning on `/api/`, `/functions/`, or `_worker` resource paths.

## UX Requirements

- Desktop layout must use the available width instead of centering a narrow mobile column.
- At 1920px width, the active Feed timeline should visibly benefit from the extra width.
- At 2560px and up, the feed can become wider, richer, denser, or optionally gain adjacent context.
- The main feed should not be hard-capped to a lonely 600px mobile column on desktop.
- Extra width must show more content or richer content. It should not be absorbed mostly by wider left/right sidebars, wider gutters, or decorative whitespace.
- Sidebars should be narrow by default, have practical max widths, and remain secondary to the active Feed timeline.
- Endless scroll is acceptable and should remain natural. Status: a "Back to top" affordance now appears in the active feed/profile reader after scrolling past a threshold and returns to the top (smooth) without a route change; it is pinned to the bottom-right of the reader column so it never overlaps the right rail.
- A selected post should not destroy the user's timeline position.
- Signed-in users should see their main Bluesky navigation surfaces without hunting through menus.
- Feed selection should not depend on a horizontally scrolling top tab strip.
- Avoid horizontal scrolling as a core interaction pattern. It should not be required for Feed selection, reading posts, accessing actions, or navigating major surfaces. Status: fixed a mobile regression where the left nav rail (rendered as a horizontal top icon bar on `≤720px`) overflowed — the BigBSky logo plus 9 nav icons did not fit 375px, so Profile/Settings were pushed off the right edge behind a non-obvious horizontal auto-scroll. The mobile bar now hides the redundant logo (Home is its own icon), distributes the 9 icons across the full width (`space-around`, no scroll), and shrinks the icon buttons to 38×40 so all are visible (verified live: icons span x=7–367 in a 375px viewport, `scrollWidth === clientWidth`).
- The primary nav icon bar is hidden by default and revealed with a hamburger (☰) control placed at the right of the feed-title header (operator direction). `navOpen` state toggles a `nav-hidden`/`nav-open` class on `.app-shell`. When hidden, the left-rail's grid track is dropped so the remaining columns realign (`nav-hidden` variants for default/wide/focus width modes); when open, the 76px rail returns. On mobile the top icon bar is hidden by default and shown on tap. The feed-title header was also slimmed per operator direction: the "Active Feed"/"Thread"/etc. label line was removed (kept only the feed title), the title shrank 25px→17px, and the header height 86px→52px. Verified live on desktop (1440px) and mobile (375px): default hidden, hamburger reveals/hides the rail, build passes.
- Feed selection should move to a better desktop pattern, such as a grouped feed drawer, left-rail section, command/menu picker, compact dropdown, or right-side feed panel.
- Feeds should feel like organized destinations/topics, but UI language should continue to call them Feeds.
- The layout regions should be clear: left sidebar for app/account navigation, a scalable Feed selector for Feed switching, right sidebar for search/discovery/trending, and the active endless-scroll Feed timeline for reading.
- Keep post text readable; do not over-densify the main reading column.
- Keep controls compact and familiar.
- Provide clear signed-out vs signed-in capabilities.
- Avoid storing drafts remotely unless the user explicitly posts.

## Risks And Open Questions

- Browser-only AT Protocol OAuth may have SDK limitations or edge cases. Validate early with a proof of concept.
- Static-only hosting may conflict with OAuth or API limitations. If so, decide explicitly whether to add a minimal Worker or cut the feature.
- Framework adapters may silently create serverless routes, middleware, or SSR bundles. The build audit must catch this before deployment.
- Dynamic per-post/profile metadata would likely require server rendering or prerender generation. Defer it unless a fully static approach is sufficient.
- OAuth metadata URL stability matters. Production OAuth testing should use the configured `bigbsky.com` domain.
- Rate limits and public API behavior may affect anonymous browsing.
- Some Bluesky features may require authenticated requests even for read-like behavior.
- CORS behavior must be verified against the exact endpoints and SDK path we choose.
- Direct messages should be out of scope for v1 because they change the privacy and security posture.
- Search behavior may differ between public and authenticated contexts.
- Creative features must remain client-side over loaded data. Global clustering, shared Feed maps, cross-device preference sync, server analytics, and article extraction are out of v1 unless the static-hosting constraint changes.

## Validation Checklist

- Cloudflare Pages project `bigbsky` exists.
- Cloudflare Pages default hostname `https://bigbsky.pages.dev` exists.
- Cloudflare Pages custom domain `bigbsky.com` is attached and reaches `active` status before final production OAuth testing.
- Static app deploys successfully to Cloudflare Pages.
- App works without D1, KV, R2, Durable Objects, Workers, Pages Functions, or a custom backend.
- Pages Function/Worker request count remains zero during normal v1 usage.
- Build output contains no `functions/`, `_worker.js`, SSR server chunks, middleware, API routes, or edge runtime artifacts. Status: verified locally by `npm run build` static-output audit on 2026-06-08 after the static OAuth icon/service-worker changes, again after local share/video/moderation-card updates, again after the reader-behavior verification guard, and again after the layout/performance verification guard. The audit requires `index.html`, `_redirects`, `/oauth-client-metadata.json`, `/sw.js`, `/icon.svg`, `/site.webmanifest`, SPA fallback routing, OAuth callback metadata/logo URI, and initial JS/CSS gzip budget compliance.
- Cloudflare project has no Worker routes, Pages Functions, Pages Plugins, service bindings, KV/D1/R2/Durable Object bindings, queues, scheduled jobs, Web Analytics/Zaraz, Image Resizing/Images, or server-side redirect rules enabled for v1 normal traffic.
- Cloudflare dashboard shows zero Pages Function/Worker invocations while testing first load, in-app navigation, Feed scrolling, profile previews, thread previews, search, OAuth callback, and sign-out.
- App ships as one static document plus a small number of cached hashed assets. Status: local `dist` contains `index.html`, `sw.js`, `_headers`, `_redirects`, `oauth-client-metadata.json`, `icon.svg`, `site.webmanifest`, one main JS/CSS asset pair, and lazy OAuth/API chunks that are not loaded on cold signed-out Settings smoke tests.
- Initial reader bundle stays within the agreed JS/CSS gzip budgets or has an explicit exception. Status: local production build on 2026-06-08 passed the audit with 84 kB gzip initial JS and 7 kB gzip CSS against the local 100 kB JS / 20 kB CSS audit budgets; OAuth/API chunks remain lazy.
- Service worker serves repeat app-shell visits from browser cache. Status: locally verified; static service worker registration is implemented, `/sw.js` is served by local preview, cached navigations now return the cached shell first with a background refresh, and browser preview confirmed the `bigbsky-shell-v1` cache contains `/` and `/index.html`.
- In-app navigation does not reload the document or request new HTML from Cloudflare.
- Shared deep links are served by static SPA fallback routing, not a Function.
- OAuth callback is served by the static SPA fallback and handled browser-side. Status: partial; SDK callback handling is wired in the SPA, with live production callback verification pending.
- No server-side analytics, logging, redirects, image optimization, link previews, remote config, feature flags, or health checks are deployed.
- OAuth client metadata is reachable at its final HTTPS URL. Status: local static asset implemented and verified at `/oauth-client-metadata.json`; production `https://bigbsky.com/oauth-client-metadata.json` verification remains pending after deploy.
- User can sign in with a Bluesky handle. Status: done (operator-verified in production); explicit handle/DID/PDS input plus browser OAuth SDK redirect, and sign-in/authorize works on the deployed `bigbsky.com` origin.
- Session survives refresh without our backend. Status: partial; SDK local restore path and active DID marker are wired, with reload and multi-tab verification pending.
- Sign-out is always visible to signed-in users. Status: improved; visible in the right-rail account panel, Settings, signed-in left rail, signed-in Profile surface, and a compact left-rail account switcher after session restore. The switcher exposes identity, profile/settings actions, sign-out, and an add/switch OAuth form, while account-backed multi-account sync remains pending.
- Sign-out clears local auth state and account-specific browser-local data without a BigBSky backend. Status: partial; sign-out clears `bigbsky:auth:*` and the SDK OAuth IndexedDB store after a best-effort revocation attempt.
- Sign-out does not clear static app-shell/service-worker cache unless the user explicitly clears site data.
- Public profile/thread/feed pages work while signed out.
- Home timeline and notifications work while signed in.
- Signed-in layout exposes the same core surfaces as `bsky.app`: Home, Explore/Discover, Following, Notifications, Chat entry point, Feeds, Lists, Saved, Profile, Settings, Search, Trending, Composer, and pinned/custom feeds. Status: partial; primary rail controls now open Home, Explore/Search, Feeds focus, a local Notifications inbox, local Lists workspaces, Saved posts, Profile, and Settings.
- At 1920px, the active endless-scroll Feed timeline uses width better than `bsky.app`'s narrow mobile column. Status: locally guarded by `npm run build`; width modes let the reader claim more desktop width while preserving compact rails, and the guard rejects narrow mobile-column caps on timelines/post cards.
- At 2560px, the feed presentation becomes richer or more useful instead of expanding empty gutters. Status: locally guarded by `npm run build`; rails are fixed-width and the content column is `1fr`, so all extra width at 2560px (and beyond) flows into the reader column rather than the gutters, with no ultrawide-specific breakpoint needed. The =1900px breakpoint still turns compact rich post cards into two-zone desktop cards.
- No user data is sent to a backend we control.
- Browser-local preferences/drafts/history can be cleared locally and are not persisted on our infrastructure. Status: implemented for density preferences, recent trail, saved posts, composer draft, reply drafts, local list workspaces/post membership, pinned Feeds/searches/profiles/notifications, and OAuth/local auth markers through the Settings clear-data control; Settings now reports the `bigbsky:*` local key count and OAuth IndexedDB storage scope.
- Desktop screenshot at 1920x1080 shows the intended wide layout. Status: fallback Puppeteer screenshot captured on 2026-06-08 after the auto-pagination/trending/pinned-search changes; wide rails, active timeline, right context, composer, and loaded-data trending panel rendered correctly.
- Mobile viewport remains usable enough, even though desktop is the priority. Status: improved; fixed a mobile horizontal-overflow defect where the `@media (max-width: 720px)` single column used a bare `1fr` track (which keeps a min-content floor), so wide post content held the column open at ~543px in a 375px viewport and clipped the right edge. Changed it to `minmax(0, 1fr)` (and `.post-header` to `46px minmax(0, 1fr) 36px`); verified live at 375px that the column/card now fit (timeline 375px, card 347px, `document.scrollWidth === clientWidth`), with the very-wide desktop layout unchanged.
- Scrolling a long Feed keeps DOM node count bounded and does not degrade after several loaded pages. Status: locally guarded by `npm run build`; measured-row virtualization for Feed/profile timelines exposes total/rendered row counts, uses spacers instead of mounting every loaded row, and reports rendered rows to the development inspector. Live several-page browser stress testing remains useful before release.
- Media-heavy Feed cards avoid visible layout jumps by reserving stable image/video/link-card space. Status: locally guarded by `npm run build`; image/video aspect ratios, rich-card minimum embed space, link-card grid sizing, and media-density minimum heights are enforced. Browser-level cumulative layout-shift measurement remains useful before release.
- Opening profile and thread previews reuses already-loaded post/author data before making detail requests.
- Switching between Feeds restores cached pages and scroll position without refetching the visible page from scratch. Status: locally verified by the `npm run build` reader-behavior guard on 2026-06-08; feed selector switching now preserves cached offsets instead of forcing `top: 0`, and cached Feed/Profile states restore from browser memory before requesting again.
- Search and Feed selector input do not send a network request for every keystroke. Status: locally verified by the `npm run build` reader-behavior guard on 2026-06-08; Feed filtering is derived from local `feedSources`, search text edits only draft query state, and Bluesky search requests run only after explicit `/search?q=` navigation.

## Reference Sources

- AT Protocol source / lexicons (canonical XRPC methods, types, lexicons): https://github.com/bluesky-social/atproto
- Bluesky HTTP API reference (all XRPC endpoints, params, responses): https://docs.bsky.app/docs/category/http-reference
- Bluesky API docs: https://docs.bsky.app/
- Bluesky API hosts and auth guide: https://docs.bsky.app/docs/advanced-guides/api-directory
- Bluesky OAuth client implementation guide: https://docs.bsky.app/docs/advanced-guides/oauth-client
- AT Protocol OAuth patterns: https://atproto.com/guides/oauth-patterns
- Cloudflare Pages docs: https://developers.cloudflare.com/pages/
