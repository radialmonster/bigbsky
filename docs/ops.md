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
- No server-side analytics, logging, redirects, image optimization, URL metadata generation, remote config, feature flags, or health checks are deployed.
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
- Cloudflare hosts the static app and may process ordinary web delivery, security, and aggregate/anonymized analytics data for hosting, but BigBSky must not add its own user database, server-side tracking, or adult-content preference storage.
- Browser-local preferences/drafts/history can be cleared locally and are not persisted on our infrastructure. Status: implemented for density preferences, recent trail, saved posts, composer draft, reply drafts, local list workspaces/post membership, pinned Feeds/searches/profiles/notifications, and OAuth/local auth markers through the Settings clear-data control; Settings now reports the `bigbsky:*` local key count and OAuth IndexedDB storage scope.
- Desktop screenshot at 1920x1080 shows the intended wide layout. Status: fallback Puppeteer screenshot captured on 2026-06-08 after the auto-pagination/trending/pinned-search changes; wide rails, active timeline, right context, composer, and loaded-data trending panel rendered correctly.
- Mobile viewport remains usable enough, even though desktop is the priority. Status: improved; fixed a mobile horizontal-overflow defect where the `@media (max-width: 720px)` single column used a bare `1fr` track (which keeps a min-content floor), so wide post content held the column open at ~543px in a 375px viewport and clipped the right edge. Changed it to `minmax(0, 1fr)` (and `.post-header` to `46px minmax(0, 1fr) 36px`); verified live at 375px that the column/card now fit (timeline 375px, card 347px, `document.scrollWidth === clientWidth`), with the very-wide desktop layout unchanged.
- Scrolling a long Feed keeps DOM node count bounded and does not degrade after several loaded pages. Status: locally guarded by `npm run build`; measured-row virtualization for Feed/profile timelines exposes total/rendered row counts, uses spacers instead of mounting every loaded row, and reports rendered rows to the development inspector. Live several-page browser stress testing remains useful before release.
- Media-heavy Feed cards avoid visible layout jumps by reserving stable image/video/link-card space. Status: locally guarded by `npm run build`; image/video aspect ratios, rich-card minimum embed space, link-card grid sizing, and media-density minimum heights are enforced. Browser-level cumulative layout-shift measurement remains useful before release.
- Opening profile and thread previews reuses already-loaded post/author data before making detail requests.
- Switching between Feeds restores cached pages and scroll position without refetching the visible page from scratch. Status: locally verified by the `npm run build` reader-behavior guard on 2026-06-08; feed selector switching now preserves cached offsets instead of forcing `top: 0`, and cached Feed/Profile states restore from browser memory before requesting again.
- Search and Feed selector input do not send a network request for every keystroke. Status: locally verified by the `npm run build` reader-behavior guard on 2026-06-08; Feed filtering is derived from local `feedSources`, search text edits only draft query state, and Bluesky search requests run only after explicit `/search?q=` navigation.

## Dev Tooling: Live Browser Inspection (CDP)

Claude can connect to a running Chrome and inspect the live app over the Chrome
DevTools Protocol (CDP). This works and is the agreed way to share a browser
session, since the agent cannot see the operator's normal browser. **Confirmed
working 2026-06-09** (eval, screenshot, and console capture all verified against
the running app tab).

### One-time launch (operator or agent)

Start Chrome with remote debugging on a dedicated profile so it doesn't collide
with the operator's normal Chrome windows:

```
& "C:\Program Files\Google\Chrome\Application\chrome.exe" `
  --remote-debugging-port=9222 `
  --user-data-dir=$env:LOCALAPPDATA\Codex\ChromeProfiles\fb-tools-test `
  --auto-open-devtools-for-tabs `
  http://127.0.0.1:5173/
```

Verify the CDP endpoint is up: `http://127.0.0.1:9222/json/version` returns JSON.
(`--auto-open-devtools-for-tabs` creates an extra `devtools://` page target; the
helper below filters those out and selects the real `http://` app tab, preferring
the one on `127.0.0.1:5173`.)

### Helper: `scripts/cdp.mjs`

No-dependency Node CDP client (uses Node's global `WebSocket`, Node 24+). Commands:

```
node scripts/cdp.mjs eval "<js expr>"     # evaluate JS in the page, prints JSON result
node scripts/cdp.mjs screenshot <path>    # save a PNG screenshot of the page
node scripts/cdp.mjs html                 # print document.body.outerHTML
node scripts/cdp.mjs console <secs>       # stream console logs, exceptions, >=400 responses
```

Examples:

```
node scripts/cdp.mjs eval "({title: document.title, url: location.href})"
node scripts/cdp.mjs screenshot $env:TEMP\bigbsky.png
node scripts/cdp.mjs console 8
```

The agent uses this loop: edit code → Vite hot-reloads the open tab → `eval`/
`screenshot`/`console` to observe the result, with the operator driving anything
that needs real interaction (e.g. OAuth sign-in, which still can't be automated).

### Testing the deployed origin (OAuth / signed-in features)

OAuth only works on the deployed origin (`https://bigbsky.com`), not the
localhost Vite preview — see the OAuth-testing memory. So any feature gated on
sign-in (Block/unblock, Like/Follow writes, authed viewer-state, the composer
writes) must be verified against the live site after the Cloudflare build, not
against `localhost:5173`.

Workflow:

1. **Push first, then wait for the Cloudflare build.** Git push to `main`
   auto-builds Pages; the build takes ~1-3 min. The site keeps serving the old
   hashed bundle until the new deploy goes live.
2. **Launch Chrome at the deployed origin** (same flags, just the prod URL):

   ```
   & "C:\Program Files\Google\Chrome\Application\chrome.exe" `
     --remote-debugging-port=9222 `
     --user-data-dir=$env:LOCALAPPDATA\Codex\ChromeProfiles\fb-tools-test `
     https://bigbsky.com/
   ```

   The dedicated `--user-data-dir` profile (same path as the local-launch command
   above, so the OAuth session carries over) persists the session between
   launches, so the operator usually only has to sign in once.
3. **Confirm the new code actually shipped** before testing behavior — fetch the
   page HTML, extract the hashed `assets/index-*.js` name, fetch it, and grep for
   a string unique to the change (e.g. a new button label or confirm-copy
   substring). If the grep misses, the deploy hasn't finished — wait and re-check.
   One-liner via the helper:

   ```
   node scripts/cdp.mjs eval "(async()=>{const h=await (await fetch(location.href)).text();const p=[...new Set(h.match(/assets\/index-[^\"']+\.js/g))];const out={};for(const f of p){const t=await (await fetch('/'+f)).text();out[f]={hasMyString:t.includes('Blocking')};}return out;})()"
   ```

4. **Operator signs in** (Claude never types the password; CDP only reads/clicks
   after the operator authenticates).
5. **Drive the check** with `eval`/`screenshot` — navigate to the surface
   (e.g. `location.href='https://bigbsky.com/profile/<handle>'`), then assert the
   expected control/state is present (e.g. a `.block` button, or `viewer.like`
   seeding a liked state). The signed-in-only controls won't render when signed
   out, so step 4 is required for moderation/write verification.

## Reference Sources

- AT Protocol source / lexicons (canonical XRPC methods, types, lexicons): https://github.com/bluesky-social/atproto
- Bluesky HTTP API reference (all XRPC endpoints, params, responses): https://docs.bsky.app/docs/category/http-reference
- Bluesky API docs: https://docs.bsky.app/
- Bluesky API hosts and auth guide: https://docs.bsky.app/docs/advanced-guides/api-directory
- Bluesky OAuth client implementation guide: https://docs.bsky.app/docs/advanced-guides/oauth-client
- AT Protocol OAuth patterns: https://atproto.com/guides/oauth-patterns
- Cloudflare Pages docs: https://developers.cloudflare.com/pages/
