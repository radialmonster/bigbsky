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
- Use `IntersectionObserver` for pagination, media loading, and delayed detail fetches. Avoid scroll event loops for core feed behavior. Status: implemented for feed, profile, post-search, people-search, engagement-panel (likes/reposts/quotes), and profile Feeds/Lists tab pagination with visible load-more fallback controls. A failed pagination request now keeps the already-loaded results and shows an inline retry instead of replacing the whole view with an error, and the auto-loader stops firing after a failure (manual Retry only) so it does not hammer a rate-limited or unreachable endpoint. Fix (2026-06-09): the auto-load `IntersectionObserver` used `root: null` (the viewport), but the timeline scrolls inside an internal overflow container (`.timeline`); with a clipped internal scroller the 640px `rootMargin` could not preload early and auto-load effectively waited until the sentinel reached the true viewport bottom. The observer now uses the nearest scrollable ancestor as its `root` (a `findScrollParent` walk, falling back to the viewport when nothing scrolls), so the 640px margin preloads the next page before the user reaches the end — seamless endless scroll. Verified: build passes and the `findScrollParent` walk resolves to `.timeline` for the load-more sentinel; live IntersectionObserver firing cannot be exercised in the headless Claude preview (IO callbacks do not run there for either the old or new code — confirmed the manual "Load more" fallback works), so seamless auto-scroll should be confirmed on the deployed origin in a real browser.
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
- Do not proxy Bluesky API calls, images, embeds, media, OAuth callbacks, or analytics through Cloudflare Functions/Workers. The browser should talk directly to Bluesky/AT Protocol services.
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
- `features/explore/` owns the Explore/discovery surfaces (live trending topics, Discover New Feeds).
- `features/profile/` owns profile header, tabs, and the profile Feeds/Lists tab surfaces.
- `features/account/` owns account menu, visible Sign out, and signed-out identity state.
- `features/rightRail/` owns contextual panels that improve desktop use without widening the sidebar itself.
- `features/novel/` contains pure client-side transforms over loaded API data. Anything here must satisfy the static/stateless rules.
- `components/` contains reusable UI primitives with no Bluesky-specific API calls.
- `hooks/`, `utils/`, and `types/` stay generic and shared.

This layout keeps the project aligned with static hosting: features can use live API calls, service-worker app-shell caching, and browser-local state, but there is no backend layer, database layer, job layer, Pages Function, Worker route, API proxy, image optimizer, or server-only module in v1.

