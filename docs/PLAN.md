# BigBSky Plan

## TODO (open tasks)

**Open work now lives in GitHub Issues on `radialmonster/bigbsky` (the single
source of truth).** This file keeps BigBsky's design context and the historical
changelog of completed passes (below), plus the reference cautions on OAuth
scope maintenance; it no longer tracks open tasks. List: `gh issue list
--repo radialmonster/bigbsky --state open`. (Reconciled 2026-07-02: the
previously-open items here were either done — "User-sortable feed order" — or
migrated to `todo.md` — the upstream-blocked "Consent UX", the 2026-06-10
runtime-verify note, and the CSS dead-selector sweep. **2026-08-01:** all open
items were migrated from `todo.md` to GitHub issues, and `todo.md` was then
deleted — session workflow (issue claiming, shipping/deploy flow, dev tooling)
now lives in `nextsessionprompt.md`.)

The scope-maintenance cautions below remain relevant reference material for any
future authenticated AppView method.

**Re-consent needed (one-time):** the scope batch below added `notification.listNotifications`/`getUnreadCount`/`updateSeen`, `graph.muteActorList`/`unmuteActorList`, and (2026-06-10) `bookmark.getBookmarks`/`createBookmark`/`deleteBookmark` to `public/oauth-client-metadata.json`. Existing signed-in users keep their old grant until they re-authorize — the "Permissions updated" banner detects this and offers one-click re-auth. New sign-ins get the full scope immediately.
**Scope maintenance caution:** because we enumerate `rpc:` methods instead of using `rpc:*`, any NEW authenticated AppView method (notifications, mutes, future reads) must be added to the `scope` string in `public/oauth-client-metadata.json`, and existing signed-in users must re-authorize before it works. Plan scope-adds in batches to minimize re-consents, and pair them with the "Permissions updated" re-auth prompt above.

## Section Index

The sections below moved to their own files so each area can be worked on independently:

- `docs/HISTORY.md` - changelog of completed passes (2026-06-10 onward; kept because it predates GitHub-issues tracking)
- `docs/research-findings.md` - `bsky.app` layout / signed-in parity / menu findings, wide-screen + novel desktop ideas
- `docs/architecture.md` - Technical Architecture, Project File Layout
- `docs/constraints.md` - Data Storage Policy, Static/Stateless Constraints
- `docs/oauth-proof.md` - Static And OAuth Proof Log, Request And Quota Strategy
- `docs/design-spec.md` - Few Pages Few Calls Design, MVP Scope, UX Requirements
- `docs/ops.md` - Validation Checklist, Dev Tooling (CDP), Reference Sources

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
- **Keep OAuth scopes minimal and reader-first; delegate non-reader writes to bsky.app.** `public/oauth-client-metadata.json` is the single source of truth for the requested `scope` (`src/scopes.ts` imports it and re-exports `OAUTH_SCOPE`, so the two cannot drift). Currently granted writes: post/reply, like, follow accounts, block accounts, build/subscribe block lists, and image upload — everything else is read through the AppView `rpc:*?aud=did:web:api.bsky.app%23bsky_appview` scope (which also covers `putPreferences` and `mute`). Do not add a scope until the matching UI is actually built. Features we intentionally DELEGATE to Bluesky rather than build — and whose UI must **link out in a new tab, not implement** — include: direct messages / chat (→ `https://bsky.app/messages`), profile editing (→ `https://bsky.app/profile/<handle>`), reposts, reply-gates/thread-gates, video posting, and account/email/handle changes. If a surface for one of these exists, it opens the equivalent Bluesky page. (Done so far: the Chat surface now delegates to Bluesky messages; the self-profile "Edit profile" control links to the user's Bluesky profile.)

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


## Risks And Open Questions

- Browser-only AT Protocol OAuth may have SDK limitations or edge cases. Validate early with a proof of concept.
- Static-only hosting may conflict with OAuth or API limitations. If so, decide explicitly whether to add a minimal Worker or cut the feature.
- Framework adapters may silently create serverless routes, middleware, or SSR bundles. The build audit must catch this before deployment.
- Dynamic per-post/profile metadata would likely require server rendering or prerender generation. Defer it unless a fully static approach is sufficient.
- OAuth metadata URL stability matters. Production OAuth testing should use the configured `bigbsky.com` domain.

### How to test OAuth / sign-in (MANDATORY PROCESS — do not relearn this the hard way)

Context: an assistant burned a long session trying to drive OAuth sign-in through the local preview and the Claude-in-Chrome dev-tools browser. It does not work, for concrete, repeatable reasons. Follow this instead.

Hard constraints (verified 2026-06-09):
- The Claude **preview** server (`Claude_Preview`) is **localhost-only**. It cannot complete OAuth.
- atproto loopback OAuth **requires the `127.0.0.1` origin**: `@atproto/oauth-client-browser`'s `fixLocation()` force-redirects `localhost` → `127.0.0.1`, and the loopback `redirect_uri` is the IP form. So any sign-in started on `localhost` bounces to `127.0.0.1` first.
- The **Claude-in-Chrome MCP browser is a SEPARATE Chrome instance** from the user's visible Chrome and from the host shell. It can reach the **public internet** (e.g. `example.com`, `https://bigbsky.com`) but **cannot reach the host's `localhost:5173` dev server** (host `curl` gets 200; the MCP browser gets a Chrome error page). It only controls its own tab group; it cannot see the user's other tabs. The user generally **cannot see** its window, and you cannot reliably foreground it.
- **computer-use grants browsers "read" tier only** — you can screenshot the user's Chrome but cannot click or type into it. So you cannot drive the user's visible browser.
- Net effect: **local OAuth sign-in cannot be tested by the assistant** via preview, MCP browser, or computer-use. Stop trying.

Correct procedure:
1. **Code/typecheck locally** (`npx tsc --noEmit`) — that is the limit of what the assistant can self-verify for auth.
2. **Read-only inspection** of the deployed site is fine and useful: the Claude-in-Chrome MCP browser CAN load `https://bigbsky.com` / `https://bigbsky.pages.dev` and `read_page` it.
3. **Actual sign-in is operator-driven on the DEPLOYED origin.** The assistant must not type the user's password (prohibited) and cannot reach local OAuth anyway. Deploy first, then the operator signs in on `bigbsky.com`/`pages.dev` and reports what Bluesky's consent screen shows.
4. When a scope/auth change needs verification, the deliverable is: commit → deploy → operator confirms the consent screen + a signed-in read/write. Do not promise local verification.

Behavioral rule: when the operator states an environment constraint ("preview only supports localhost", "I can't see it"), **believe it immediately** and change approach — do not keep retrying the same blocked path.
- Rate limits and public API behavior may affect anonymous browsing.
- Some Bluesky features may require authenticated requests even for read-like behavior.
- CORS behavior must be verified against the exact endpoints and SDK path we choose.
- Direct messages should be out of scope for v1 because they change the privacy and security posture. (The Chat surface now links out to `https://bsky.app/messages` instead of staging an in-app DM shell.)
- oEmbed / Post Embed Widget (2026-08-01, #11 CLOSED no-action): Bluesky already provides a first-party oEmbed endpoint (`https://embed.bsky.app/oembed`, registered oEmbed provider, discovery via `<link rel="oembed">` on bsky.app post pages). BigBsky should not add its own oEmbed provider — the static SPA has no clean per-post embed surface, and `postBskyUrl` (`src/lib/url.ts`) already emits the canonical `https://bsky.app/profile/<handle>/post/<rkey>` link, which is already embeddable in third-party composers. BigBsky also should not consume the embed widget internally (it renders posts natively). Same out-link pattern as Chat.
- Firehose vs JetStream (2026-08-01, #12 CLOSED no-action): BigBsky is an AppView/API-driven reader using REST-style XRPC calls — not a live sync consumer, feed generator, labeler, bot, or search indexer. Verified: no app firehose, `com.atproto.sync.subscribeRepos`, JetStream, relay, or production WebSocket usage in `src/`/`public/` (the only WebSocket is `scripts/cdp.mjs`, local CDP automation). No backend exists to consume an event stream. If live updates are ever needed, evaluate **JetStream first** (simpler JSON events, limited collections like `app.bsky.feed.post`); only use Sync 1.1 relay endpoints (`wss://relay*.bsky.network/xrpc/com.atproto.sync.subscribeRepos`) for full-repo sync (with CBOR decoding, event scheduling, reconnect/backfill, auth). Do not add firehose scope/architecture without a concrete feature (live timeline, notification streaming, moderation/indexing, or a backend worker).
- Service Auth (2026-08-01, #14 CLOSED no-action): BigBsky uses browser OAuth/client-server auth with audience-scoped AppView RPC permissions (`public/oauth-client-metadata.json` scopes all carry `aud=did:web:api.bsky.app#bsky_appview`, enforced in `src/scopes.ts` as `APPVIEW_AUD`), not PDS-to-service JWTs. Verified: no `@atproto/xrpc-server`, `createServiceJwt`, `verifyServiceJwt`, service JWT, or service-to-service auth path in `src/`/`public/`. Keep Service Auth out of the browser app; only revisit if BigBsky adds its own backend service/AppView, feed generator, labeler, or indexing worker — then verify service JWT `aud` strictly and resolve signing keys through DID documents as the docs require.
- OAuth consent UX (check later): the granular scope list (ten `rpc:`/`repo:`/`blob:` tokens) renders as a raw token list on Bluesky's consent screen with no friendly labels, and the permission spec warns such lists are "unlikely to be reviewed carefully." Revisit once Permission Sets mature — adopt an official `app.bsky` Permission Set if Bluesky publishes one, or author our own `include:` set, so the consent screen reads as meaningful capability summaries ("read + basic posting") rather than a token dump. Not blocking; trust/clarity polish.
- Search behavior may differ between public and authenticated contexts.
- Creative features must remain client-side over loaded data. Global clustering, shared Feed maps, cross-device preference sync, server analytics, and article extraction are out of v1 unless the static-hosting constraint changes.

