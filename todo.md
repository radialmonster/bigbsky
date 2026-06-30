# Todo

## Working Rules

- If a task needs an answer from the human, do not skip or abandon the task. Ask the specific question needed, then continue once answered.
- If there is no human reply after 10 minutes, update this todo with the unanswered question(s) needed for next time, then move to a different task.
- For browser checks, first see whether Chrome dev mode is already running on port 9222. Check processes for `chrome.exe` with `--remote-debugging-port=9222`, then verify `http://127.0.0.1:9222/json/version`. If it is running, use that browser instead of starting another one. If it is not running, start Chrome with:
  `Start-Process "C:\Program Files\Google\Chrome\Application\chrome.exe" -ArgumentList "--remote-debugging-port=9222 --user-data-dir=$env:LOCALAPPDATA\Codex\ChromeProfiles\fb-tools-test --start-maximized --auto-open-devtools-for-tabs --disable-first-run-ui --no-first-run about:blank" -WindowStyle Hidden`
- To start the local BigBsky dev server, run `npm run dev` from the repo root. Vite serves it at `http://127.0.0.1:5173/` by default.

- [ ] Define the next BigBsky viewer/reader improvements.
  - Relevant files/functions found:
    - `README.md`: product scope and positioning for BigBsky as a desktop-focused Bluesky reader.
    - `docs/plan.md`: planning context if this is kept current.
    - `src/App.tsx`: main reader shell in `App`, plus route-specific UI surfaces.
    - `src/sources.ts`: built-in feed/navigation source definitions.
- [ ] Capture known bugs or rough edges.
  - Relevant files/functions found:
    - `scripts/verify-reader-behavior.mjs`: existing reader behavior verification.
    - `scripts/verify-layout-behavior.mjs`: existing layout verification.
    - `scripts/audit-build.mjs`: build audit step.
    - `src/App.tsx`: `DevInspector` surfaces runtime route/service-worker/cache metrics.
- [ ] Investigate layout-specific CSS tokens and visual-regression coverage.
  - Follow-up from the `src/styles.css` consistency pass. The safe tokenization work covered shared spacing, radius, panel padding, grid gaps, and common controls. Do **not** blindly normalize the remaining layout-specific values; many encode behavior and need browser verification.
  - Risky areas to audit deliberately:
    - App shell columns and responsive breakpoints: `.app-shell` grid tracks (`76px`, `288px`, `320px`, `640px`) plus `1323px`, `1003px`, `720px`, and `1900px` media queries.
    - Mobile top bar/rail offsets: `.left-rail`, `.workspace-header`, `.workspace` mobile `55px` heights and padding offsets, tied to hide-on-scroll behavior.
    - Timeline/thread geometry: `.timeline` padding, `.thread-node` / `.thread-alert` depth math (`--thread-depth * 22px`), branch dividers, and thread context connectors.
    - Virtualized feed/media sizing: `VirtualPostList` measurement assumptions, post/card margins, image/video min heights, link-card thumbnail `clamp(...)`, compact/media-only layouts, and wide-desktop embed columns.
    - Surface grids: card min widths (`280px`, `340px`, `360px`, `400px`) that determine wrapping and density on desktop/tablet/mobile.
  - Safer first step: introduce semantic tokens with identical values only (for example `--rail-width`, `--feed-map-width`, `--right-rail-width`, `--content-min-width`, `--mobile-header-height`, `--thread-indent`, `--timeline-padding-inline`) and verify no visual or scroll behavior change.
  - Verification needed before value changes: desktop/wide/mobile screenshots, horizontal-overflow checks, mobile header hide/reveal check, scroll-restoration smoke test, media/link-card framing review, and `npm run build` including layout verifier.
  - Relevant files/functions found:
    - `src/styles.css`: `.app-shell`, responsive media queries, `.workspace-header`, `.timeline`, `.thread-view`, `.thread-node`, `.link-card`, `.image-grid`, `.video-card`, compact/media-only rules.
    - `src/App.tsx`: `VirtualPostList`, scroll helpers/restoration, `BackToTopButton`.
    - `scripts/verify-layout-behavior.mjs`: current static layout guardrails to preserve or replace with visual/behavioral checks.
- [ ] Integrate scroll restoration with the `VirtualPostList` measurement pass (follow-up).
  - From the real-browser confirmation above. `restoreScrollOffset` currently re-asserts the target on a fixed ~500ms (30-frame) rAF budget. In the virtualized feed this races `VirtualPostList`'s row measurement: rows start at the estimated `defaultRowHeight`, then `ResizeObserver` measures real heights and compensates `scrollTop`, and on a fresh/reload load the content can keep growing past the 30-frame window — so the restore can land short or at 0.
  - Better approach: drive the restore from the measurement cycle. E.g. have `VirtualPostList` expose a "first full measurement pass complete" signal (or a settled `totalHeight`), and (re)apply the saved offset when row heights stabilize rather than purely on a frame budget; clamp-aware against the live `totalHeight`. Keep the rAF path as the visible-tab fallback.
  - Also worth confirming once on a real touch device: mobile document-scroll restore + the smooth Back-to-top scroll (both also rAF-driven, so both need a visible page).
  - Relevant files/functions found:
    - `src/App.tsx`: `restoreScrollOffset`, `VirtualPostList` (`rowHeights`, `totalHeight`, `defaultRowHeight`, the `ResizeObserver` measure at `onMeasured`/`container.scrollTop += height - previousHeight`), `BackToTopButton`.
- [ ] Prioritize the first small fix to ship.
  - Relevant files/functions found:
    - `package.json`: `npm run build` runs TypeScript, Vite build, audit, reader verification, and layout verification.
    - `src/App.tsx`: focused changes are likely easiest around isolated components such as `FeedDensityControl`, `Composer`, or `ReplyComposer`.
- [ ] Investigate editing a post or reply. (BLOCKED — wait for native Bluesky support.)
  - Desired behavior: let signed-in users correct their own posts and replies from the reader.
  - Decision (2026-06-14): **Do not implement until Bluesky supports post editing natively.** Research confirmed there is no native edit in the atproto lexicon / AppView as of mid-2026 — `app.bsky.feed.post` has no edit/update path; Bluesky's product team only began *discussing* an edit feature (with a ~5-minute edit window) in May 2026, with no lexicon changes published yet. The only workaround is a third-party delete-and-repost ("atomic swap"), which is destructive: it loses likes/reposts/replies (or orphans child replies) and changes the post identity. That is not an acceptable "edit" for a reader, so BigBsky will not ship a delete-and-repost or quote/correction stand-in. Revisit and implement the real edit flow once Bluesky ships a native lexicon for it.
  - Relevant files/functions found:
    - `src/App.tsx`: `PostCard` renders post actions and ownership-specific delete menu behavior.
    - `src/App.tsx`: `DeletePostContext`, `handleDeletePost`, and `deletePostContextValue` manage deleting own posts.
    - `src/App.tsx`: `Composer` creates new posts/threads; `ReplyComposer` creates replies.
    - `src/auth.ts`: `publishPost` creates posts/replies and `deletePost` deletes posts by URI.
    - No edit-specific helper found yet; likely needs API research before UI design.
- [ ] Standardize composer controls for posts and replies.
  - Current behavior: replies are text-only and composer controls are not shared consistently between posts and replies.
  - Desired behavior: the bottom of both the post composer and reply composer has a consistent bsky.app-style control row.
  - Include controls for adding pictures, adding GIFs, adding emoji, and selecting the post language.
  - Verify bsky.app's current behavior and API calls before implementation, especially media upload, GIF embeds, emoji handling, and language metadata.
  - Progress (2026-06-14): brought the reply composer to parity for **pictures** and fixed a **char-count bug**.
    - Added image attachment to `ReplyComposer` in `src/App.tsx`, mirroring the post `Composer`: `images` state (`ComposerImageState[]`, single-post so a flat array), a hidden `accept="image/*"` file input, attach/remove/alt handlers (capped at `MAX_POST_IMAGES`), an attached-image preview grid (reusing the global `.composer-media-*` styles) with per-image alt-text inputs, and object-URL revocation on unmount/send/clear. Images flow through the existing `publishPost({ images })` path (`src/auth.ts` already supported it). Replies can now be image-only (Reply enables when there is text *or* an image).
    - Bug fix: the reply char counter used `300 - replyText.length` (UTF-16 code units). Bluesky's 300 limit counts **graphemes**, so emoji/multibyte replies overcounted. Now uses `POST_GRAPHEME_LIMIT - graphemeLength(replyText)`, matching the post composer. Added an `over-limit` class on the count when negative.
    - Added an attach button to the reply `.composer-actions` row (`Image` icon, disabled when at the image cap / signed out / posting), so the reply control row now starts to mirror the post composer's row.
    - Added a `.reply-composer .composer-media-grid` style override in `src/styles.css` (zero horizontal padding, since the reply composer already pads its body) so previews align with the textarea.
    - Verified: `npm run build` passes (tsc, vite, audit initial JS 114 kB gzip, reader + layout + rich-text verifiers all green). Drove the running dev server via `scripts/cdp.mjs` on the example thread `/profile/monriatitans.bsky.social/post/3mo7bk477bs2m`: opening Reply renders the "Attach image" button + hidden `image/*` file input and a "300" count; typing a single emoji (`😀`, 2 UTF-16 code units) shows remaining **299** (1 grapheme), confirming the fix; no console errors. (Image *upload* itself needs an authenticated send, not exercised in the read-only CDP check.)
  - Progress (2026-06-14, second pass): added a **post-language selector** to both composers.
    - Added shared language metadata in `src/App.tsx`: `postLanguageStorageKey` (`bigbsky:post-language`), a curated `POST_LANGUAGE_OPTIONS` list of 21 common BCP-47 base codes (label in native script), `readDefaultPostLanguage()` (last-used choice → normalized `navigator.language`/`languages` base code → `en`), and a reusable `PostLanguageSelect` component (Globe icon + "Language" label + `<select>`).
    - `Composer`: added `postLang` state (initialized from `readDefaultPostLanguage`), rendered `PostLanguageSelect` in the `.composer-actions` row, and now passes `langs` through `publishThread(postsToPublish, postLang ? [postLang] : undefined)`.
    - `publishThread` in `src/auth.ts` now accepts an optional `langs?: string[]` and forwards it to each `publishPost` (thread shares one language). `publishPost` already accepted `langs`.
    - `ReplyComposer`: added matching `postLang` state + `PostLanguageSelect` in its `.composer-actions` row, and passes `langs: [postLang]` to `publishPost`. Both composers persist the last-used language to `bigbsky:post-language` on change, so the choice is shared/sticky.
    - Added `.composer-language` / `.composer-language-label` / select styles in `src/styles.css` (label hidden under 720px to stay compact on mobile).
    - Verified: `npm run build` passes (tsc, vite, audit initial JS 115 kB gzip, reader + layout + rich-text verifiers all green). Drove the signed-in dev server via `scripts/cdp.mjs`: the reply composer renders the language `<select>` (21 options, default `en`); changing it to `ja` persisted `bigbsky:post-language=ja`; the post composer (opened via the rail compose button → self-profile) then read `ja` as its default, confirming the shared sticky preference; no console errors. Cleared the test `bigbsky:post-language` artifact from the operator session afterward. (The actual `langs` write needs an authenticated send, not exercised in the read-only check, but the value flows through `publishPost`'s existing `langs` path which was already validated.)
    - Native-way verification (2026-06-14): confirmed against the docs and the live bsky.app composer that this matches Bluesky's model. The post record field is the native BCP-47 `langs` array (`app.bsky.feed.post`; docs allow multiple values, e.g. `["th","en-US"]`) — which BigBsky writes via `publishPost`/`publishThread`. Inspected bsky.app's running storage via CDP: the default post language is **not** an atproto account/profile preference — bsky keeps it device-local in `BSKY_STORAGE.languagePrefs` (`postLanguage`, plus `primaryLanguage`/`contentLanguages`/`postLanguageHistory`/`appLanguage`, all client-side), initialized from the device locale. So there is no account-synced default to read; BigBsky's browser-local default (navigator locale → saved choice) mirrors bsky exactly. bsky's composer uses a `selectLangBtn` showing the language name ("English"), same concept as `PostLanguageSelect`.
  - Progress (2026-06-14, third pass): added an **emoji picker** to both composers.
    - Added a reusable `EmojiPicker` component in `src/App.tsx` (Smile icon button + popover) modeled on `PostLanguagePicker`'s open/outside-click/Escape pattern. It renders a scrollable grid of ~196 curated emoji grouped into 7 categories (`EMOJI_GROUPS`: Smileys, Gestures, Hearts, Animals & Nature, Food & Drink, Activities & Objects, Symbols). Emoji are plain Unicode text — no API/upload involved.
    - Wired it into the `.composer-tools` row of both `Composer` (new post) and `ReplyComposer`, next to the Add-image button, disabled while posting / signed-out.
    - Each composer got a `textareaRef` + an `insertAtCaret(snippet)` helper that inserts the emoji at the textarea selection (replacing any selection) and restores focus/caret-after-emoji via `requestAnimationFrame` (mirrors the existing rAF pattern). Falls back to append when the ref is unavailable.
    - Added `.composer-emoji*` styles in `src/styles.css` (popover opens *upward* — `bottom: calc(100% + 8px)` — since the action row sits at the composer bottom; 8-column emoji grid, grouped labels, mobile width clamp).
    - Verified: `npm run build` passes (tsc, vite, audit initial JS 117 kB gzip, reader + layout + rich-text verifiers all green). Drove the signed-in dev server via `scripts/cdp.mjs` on the example thread: opening Reply → emoji button renders; opening the picker shows 196 options across the 7 group labels; with reply text `"ab"` and the caret at offset 1, clicking 😀 produced `"a😀b"` and closed the menu (caret-restore runs in rAF, which doesn't fire in headless CDP — same documented limitation as the scroll-restore work; insertion itself verified). Cleared the seeded reply-draft localStorage artifact from the operator session afterward.
  - Remaining (still open under this task): **GIFs** (Tenor embed flow) — not added yet, on either composer. Larger (Tenor API integration, picker UI) and should verify bsky.app's exact API calls / embed shape first. Captured as the next step here. (Best done *after* — or as part of — the composer-unification task below, so it lands once instead of twice.)
  - Optional language follow-ups (to fully match bsky's native model): support **multiple** post languages (bsky's `langs` array + multi-select, since docs allow multiple values) and a **recent-languages history** (bsky's `postLanguageHistory`) surfaced at the top of the picker. Current BigBsky picker is single-select, which covers the common case.
  - Relevant files/functions found:
    - `src/App.tsx`: `Composer` already supports image attachment, previews, alt text, and sends images through `publishThread`.
    - `src/App.tsx`: `ReplyComposer` currently publishes replies through `publishPost` with only text and reply refs.
    - `src/auth.ts`: `publishPost` already accepts `reply`, `langs`, and `images`; `publishThread` accepts images for composer posts.
    - `src/auth.ts`: `ComposerImage`, `MAX_POST_IMAGES`, and image embed/upload helpers cover picture upload.
    - `src/styles.css`: existing composer image styles use `.composer-media-*`; reply composer styles use `.reply-composer`.
- [ ] Composer follow-ups now that post + reply are unified in `PostComposer`.
  - These all now land **once** in `PostComposer` (`src/App.tsx`) instead of twice:
    - **GIFs** (Tenor embed flow) — still open from the "standardize composer controls" task; verify bsky.app's exact Tenor API calls / embed shape first.
    - **Quote mode**: add an optional `quote?` (like bsky's `ComposerOpts.quote`) so quote-posting reuses the same composer.
    - **Video** attachment (bsky's `videoUri`) if/when BigBsky supports uploading video.
  - Done (2026-06-14): **Reply-target preview** — the reply skeleton now renders the parent author (avatar + display name + handle) and a 2-line-clamped snippet of the parent post text at the top of `PostComposer`'s reply branch, above the textarea (mirrors bsky's reply composer; previously it relied only on rendering directly beneath the post).
    - `src/App.tsx`: in the `if (isReply && replyTo)` branch, added a `.reply-target-preview` block (`<Avatar profile={replyTo.parent.author} />` + `.reply-target-name`/`.reply-target-handle`/`.reply-target-text` from `replyTo.parent.record.text`). Text is omitted when the parent has no text (e.g. media-only).
    - `src/styles.css`: added `.reply-target-preview` (flex row, bottom divider), `.reply-target-preview .avatar` (28px), `.reply-target-body`/`-meta`/`-name`/`-handle`/`-text` (the snippet uses a 2-line `-webkit-line-clamp`).
    - Verified: `npm run build` passes (tsc, vite, audit initial JS 116 kB gzip, reader + layout + rich-text verifiers all green). Drove the signed-in dev server via `scripts/cdp.mjs` on `/profile/monriatitans.bsky.social/post/3mo7bk477bs2m`: opening Reply renders the preview with name `MonriaTitans`, handle `@monriatitans.bsky.social`, the 294-char parent snippet (clamped to 2 lines), and the avatar; screenshot confirmed the divider + tool row layout. No console errors; no draft artifacts left behind.
  - Relevant files/functions found:
    - `src/App.tsx`: `PostComposer` (`replyTo`, `isReply`, `toolsAndMeta`, `handleSubmit`, reply-target preview), `EmojiPicker`, `PostLanguagePicker`, `Avatar`.
    - `src/auth.ts`: `publishPost`, `publishThread`, `buildImageEmbed`, `MAX_POST_IMAGES`.
- [ ] Investigate Bluesky oEmbed / Post Embed Widget usage.
  - Source: https://docs.bsky.app/docs/advanced-guides/oembed
  - NOTE (2026-06-14): a "Copy embed code" action was built and then **reverted at the operator's request**. It copied the oEmbed snippet via the Clipboard API, which triggered a browser permission popup. Do NOT re-add a clipboard-based embed-copy action. If revisited, deliver the snippet without the Clipboard API (e.g. an inline read-only, pre-selected text field) and only if the operator wants the feature at all.
  - Current finding: no existing `embed.bsky.app/oembed`, post embed widget iframe, copied blockquote snippet, or `embed.bsky.app` integration was found in the BigBsky source.
  - Current behavior: BigBsky renders posts itself from AppView data, including `app.bsky.embed` images/gallery/video/external/record embeds.
  - Check whether any feature should use official oEmbed instead of local rendering, especially when showing external Bluesky post links or generating share/embed HTML.
  - If adding an "Embed Post" or "Copy embed HTML" action, use `https://embed.bsky.app/oembed?url=...` with supported bsky.app post URLs, respect `maxwidth` range `220`-`600`, and expect `height: null`.
  - Preserve the docs' public-content behavior when relying on official embeds: adult-only content, deleted posts/accounts, and "no unauthenticated viewers" should be enforced by the official widget/API.
  - Relevant files/functions found:
    - `src/App.tsx`: `postBskyUrl` builds bsky.app post URLs for sharing/opening.
    - `src/App.tsx`: `ExternalLinkCard`, `QuoteCard`, `PostCard`, and `PostImageVideoMedia` render local embed views from AppView data.
    - `src/api.ts`: `getExternalEmbed`, `getRecordEmbed`, `getEmbedImages`, and `getVideoEmbed` normalize local embed rendering data.
    - `src/styles.css`: quote/link/embed rendering styles include `.quote-card`, `.quote-link-card`, and link-card/media styles.
- [ ] Investigate whether BigBsky should use Firehose or JetStream.
  - Source: https://docs.bsky.app/docs/advanced-guides/firehose
  - Current finding: no app firehose, `com.atproto.sync.subscribeRepos`, JetStream, relay, or production WebSocket usage was found; the only WebSocket reference is `scripts/cdp.mjs` for local Chrome DevTools Protocol automation.
  - Current architecture: BigBsky is currently an AppView/API-driven reader using REST-style XRPC calls, not a live sync consumer, feed generator, labeler, bot, or search indexer.
  - If live updates are needed later, evaluate JetStream first for simpler JSON events and limited collections like `app.bsky.feed.post`.
  - If full repository sync is needed later, use Sync 1.1 relay endpoints such as `wss://relay1.us-east.bsky.network/xrpc/com.atproto.sync.subscribeRepos`, and account for CBOR decoding, event scheduling, reconnect/backfill, and auth.
  - Avoid adding firehose scope/architecture unless there is a concrete feature such as live timeline updates, notification streaming, moderation/indexing, or a backend worker.
  - Relevant files/functions found:
    - `src/api.ts`: current public AppView XRPC reads.
    - `src/auth.ts`: current authenticated AppView/PDS reads and writes.
    - `src/App.tsx`: feed, profile, search, notification, and thread loaders currently fetch/paginate instead of streaming.
    - `scripts/cdp.mjs`: unrelated local WebSocket use for browser automation only.
- [ ] Optional read-after-write follow-up: refresh own content in custom feeds (captured from the read-after-write audit).
  - `invalidateOwnContentCaches` deliberately only drops the **Following** timeline cache (`feed:following`), not custom-feed caches (`feed:<id>`). atproto read-after-write smoothing is applied by the user's PDS for AppView-proxied reads, but custom feeds are served by **external feed-generator services** whose ranking/indexing the PDS does not munge, so dropping their cache wouldn't reliably surface a brand-new post any sooner and would just cost a refetch. If a concrete need arises (e.g. a self-authored post not appearing in a chronological custom feed the user just opened after posting), revisit whether to also invalidate the active custom feed's cache.
  - Relevant files/functions found:
    - `src/App.tsx`: `invalidateOwnContentCaches`, `loadFeed`, `feedCacheRef`.
- [ ] Confirm Service Auth is out of scope for the current browser client.
  - Source: https://docs.bsky.app/docs/advanced-guides/service-auth
  - Current finding: no `@atproto/xrpc-server`, `createServiceJwt`, `verifyServiceJwt`, service JWT, or service-to-service auth path was found.
  - Current architecture: BigBsky uses browser OAuth/client-server auth and audience-scoped AppView RPC permissions, not PDS-to-service JWTs.
  - Keep Service Auth out of the browser app; only revisit if BigBsky adds its own backend service/AppView, feed generator, labeler, or indexing worker.
  - If a backend service is added later, verify service JWT `aud` strictly and resolve signing keys through DID documents as the docs require.
  - Relevant files/functions found:
    - `public/oauth-client-metadata.json`: browser OAuth scopes with AppView `aud=did:web:api.bsky.app#bsky_appview`.
    - `src/auth.ts`: OAuth session restoration and AppView proxy usage.
    - `src/scopes.ts`: `APPVIEW_AUD` and scope comments for client-server AppView RPC calls.
- [ ] Publish a monitored contact email + document reports/deletion handling (follow-up from Developer Guidelines audit).
  - Bluesky's developer guidelines suggest a regularly monitored **email address**, not only a Bluesky profile / GitHub Issues link. BigBsky currently exposes the Bluesky profile and GitHub Issues (both added in the audit above) but no email.
  - **Question for operator:** which email address should BigBsky publish for content/abuse reports and contact? Once provided, add it to the "Reporting content & abuse" + "Contact" panels in `src/InfoPage.tsx` and the README Links/Reporting sections.
  - Also document an explicit process for how reports are tracked/responded to and how content-deletion requests are handled (even a short stated turnaround), and do a dedicated security-posture review of local OAuth/session data, browser-local preferences, drafts, pins, and collections.
  - Relevant files/functions found:
    - `src/InfoPage.tsx`: "Reporting content & abuse" + "Contact" panels.
    - `README.md`: "Reporting content & abuse" section + Links list.
- [ ] Confirm saved-feed-order account sync in a real signed-in session (follow-up).
  - Follow-up from the saved-feed-order sync work above. The `syncSavedFeedsOrder` account write only runs on an authenticated reorder and couldn't be exercised read-only.
  - In a real signed-in session: reorder feeds on `/feeds`, then confirm (a) no console error from the background sync, (b) reloading BigBsky in a fresh browser/profile (empty `bigbsky:feed-order`) shows the new order, and (c) the official bsky.app client reflects the same saved-feed order (cross-client sync) and that pinned state + the Following timeline + saved lists are unchanged.
  - Optional: surface a subtle "saving…/synced" affordance on `/feeds` so the user knows the order is account-synced, and consider a manual retry if the sync fails.
  - Relevant files/functions found:
    - `src/auth.ts`: `syncSavedFeedsOrder`.
    - `src/App.tsx`: `persistFeedOrder`.

## From the 2026-06-30 thread code review

- [x] Bug 1 — feed combined card dropped non-media embeds (link cards, quotes). Fixed
  2026-06-30. `ThreadedPostCard` (`src/App.tsx`) now renders each self-thread part
  with `PostEmbeds` (passing `onOpenPost`/`onOpenProfile`) instead of
  `PostImageVideoMedia`, mirroring the thread-view `CombinedThreadViewCard`. Also
  added the `hasEmbeds` check so a part with neither text nor embeds is skipped
  (no more spurious "Post N has no plain text." on a link-card-only part).
  Remaining: confirm visually in a signed-in deployed session with a self-thread
  that carries a link card or quote (not reproducible on the local origin without
  OAuth; logic is a faithful mirror of the verified thread-view path).
- [x] Bug 2 — long threads opened mid-chain never hydrated their tail. Fixed
  2026-06-30. `hydrateThreadContinuations` (`src/App.tsx`) now derives the marker
  total from `buildAnchoredThreadParts(hydrated)` (walks UP the `.parent` chain to
  the true root so the 1/N marker is read from the root) instead of
  `buildThreadParts` (which started at the anchor's 3/N marker and aborted
  hydration). Root-anchored callers are unaffected (no ancestors → identical
  result). Added a `expectedThreadMarkerTotal` test for the mid-chain anchor case
  in `src/lib/threads.test.ts`.
- [x] Bug 3 — `splitTextForThread` could infinite-loop when `graphemeLimit === 0`.
  Fixed 2026-06-30. Added a `limit < 1` guard in `src/lib/threads.ts` that bails to
  a single trimmed post (latent — no call site passes < 1). Added a regression test.
- [x] Bug A — ancestor parts in `LongThreadCard` (Separated mode) rendered dead
  reply buttons. Fixed 2026-06-30. When you open a mid-chain self-thread post and
  switch to Separated mode, `buildAnchoredThreadParts` produces ancestor parts whose
  `replies` is forced to `[]` (the AppView only hydrates the anchor subtree —
  `src/lib/threads.ts:168`), but the per-part `commentCount` still read
  `post.replyCount`, so the button showed a non-zero count whose click was swallowed
  (`if (part.replies.length > 0)`). `LongThreadCard` (`src/App.tsx`) now, when a part
  has no inline replies but `commentCount > 0`, falls through to
  `handlers.onOpenPost(post)` (opens that post in its own thread view where its
  replies hydrate) instead of doing nothing; the `commentTitle` reflects the
  open-thread affordance. Descendant parts (replies hydrated) toggle inline as before.
- [x] Bug B — `MediaOnlyPostCard` ignored thread markers. Fixed 2026-06-30. A
  standalone self-thread root shown in media density (ungrouped — e.g. search
  results, or where `hydrateProfileSelfThreads` didn't run) displayed the raw
  "1/N 🧵" text with no way to open the thread. `MediaOnlyPostCard` (`src/App.tsx`)
  now computes `threadMarkerMatch(text)` and renders the same `.thread-open-chip`
  "Open Thread i/N" button as `PostCard` (`src/App.tsx:9035`) in its expanded
  details, wired to `onOpenPost(post)`.
- [ ] Bug 4 — combined reply-count math assumes a linear chain (`src/App.tsx:8674`,
  `:7936`: `Σ replyCount − (posts.length − 1)`). Cosmetic; forked self-replies
  slightly inflate the external-reply total. Matches the documented approximation —
  left as-is unless it becomes a real annoyance.

## From the 2026-06-26 code review

(This was an in-session review; `docs/code-review.md` was never committed — only
`docs/plan.md` and `docs/cloudflare-pages-setup.md` exist under `docs/`.)

- [ ] Decompose the `src/App.tsx` monolith (dominant structural issue).
  - Severity: critical. `src/App.tsx` is 10,283 lines, 176 functions, ~60 React
    components, 244 hook calls; the single `App()` (`src/App.tsx:1424`–`~3960`)
    holds 60+ `useState` and 13 `useRef` caches. `src/styles.css` is 5,116 lines.
    Impacts reviewability, merge-conflict rate, re-render blast radius, feature
    tree-shaking (notifications/lists/composer/image-viewer/dev-inspector are all
    statically fused into the entry chunk), and edit-loop/compile time.
    `docs/plan.md` already specifies the target layout (`features/feed`,
    `features/post`, `features/composer`, `auth/`, `storage/`, …).
  - Progress (2026-06-26): **slice 1 started** — extracted the pure timestamp
    cluster (`postSortAt`/`postSortTime`/`parseTimestamp`/`CLOCK_SKEW_WINDOW_MS`)
    into `src/lib/time.ts` with a real Vitest suite (`src/lib/time.test.ts`,
    15 tests). This is the first of the "extract pure helpers into `src/lib/`"
    slice below and proves the tests-first path. Build + tests green. Continue the
    slice with the remaining `read*`/`safe*`/scroll-math/feed-order helpers.
  - Progress (2026-06-30): **slice 2** — extracted the scroll-math /
    scroll-restoration cluster into `src/lib/scroll.ts` with a 13-test behavioral
    suite (`src/lib/scroll.test.ts`) and retired the now-redundant scroll-function
    source-regex guardrails. See the "Replace the regex source-text tests" task
    below for details. Build + tests green. Remaining helper slices: `read*`/`safe*`
    storage readers, `resolveHandle` cache, feed-order sort.
  - Progress (2026-06-30): **slice 3 — feed-order sort extracted + tested.**
    Pulled the inline `orderedSubscribedFeeds` useMemo body out of `src/App.tsx`
    into a pure generic helper `orderBySavedOrder<T extends { uri: string }>(feeds,
    order)` in `src/lib/feed-order.ts`; the useMemo now just calls it (deps
    unchanged). Behavior preserved verbatim: empty order returns the input
    reference unchanged; ranked feeds sort by saved position; unranked (newly
    subscribed) feeds fall back to the end keeping original relative order (stable
    sort); saved URIs not currently subscribed are ignored. Added
    `src/lib/feed-order.test.ts` — 8 tests (no-order identity, reorder, no-mutation,
    fallback-to-end, stable unranked order, ignore-unknown-uri, empty list, realistic
    mix). `npm test` green (106 tests / 6 files); `npm run build` green (tsc, vite,
    audit initial JS 121 kB gzip, reader + layout + rich-text verifiers).
    Remaining helper slices: `read*`/`safe*` storage readers, `resolveHandle` cache.
  - Progress (2026-06-30): **slice 4 — pinned-feed-meta validator extracted +
    tested.** Pulled the pure `isPinnedFeedMeta(value): value is FeedSource`
    type-guard out of `src/App.tsx` into `src/lib/feed-meta.ts` (App.tsx imports
    it; `readPinnedFeedMeta` still filters with it at its call site, so the
    `verify-reader-behavior.mjs` wiring regex still matches). Logic preserved
    verbatim: non-null object; `id` string starting `at://`; `uri`/`label`/
    `description` strings; `group` ∈ {Core, Official, Discovered, Project (legacy
    alias)}. Added `src/lib/feed-meta.test.ts` — 9 tests (well-formed record, every
    persisted group incl. legacy Project, rejects My Feeds / unknown / missing
    group, non-object + array rejection, `at://`-prefixed id requirement, string
    requirements for each field, empty-string fields still valid). `npm test` green
    (115 tests / 7 files); `npm run build` green (tsc, vite, audit initial JS
    121 kB gzip, reader + layout + rich-text verifiers).
    Remaining helper slices: `read*`/`safe*` storage readers, `resolveHandle` cache.
  - Progress (2026-06-30): **slice 5 — safe storage/URL guards extracted, tested,
    and de-duplicated across modules.** Pulled the best-effort Web Storage helpers
    (`safeLocalStorageGet`/`safeLocalStorageSet`/`safeLocalStorageRemove`/
    `safeSessionStorageRemove`) into `src/lib/storage.ts` and the http(s) URL guard
    into `src/lib/url.ts` (`safeHttpUrl`). These were previously **triplicated**:
    `src/App.tsx` had all five, `src/auth.ts` carried its own copies of the three
    localStorage helpers (returning void instead of boolean), and `src/richtext.ts`
    had a private `safeHttpUri` clone. All three now import the shared helpers, so
    the guard logic lives once. Behavior preserved: auth.ts's call sites ignore the
    return value, so importing the boolean-returning variants is a no-op for them;
    richtext's `safeHttpUri(...)` call became `safeHttpUrl(...)` (identical logic).
    - `resolveHandle` cache: already lives in `src/api.ts` with behavioral tests
      (`src/api.test.ts`), so the remaining-slices note above was stale on that
      point — only the `read*`/`safe*` storage readers were left, and the `safe*`
      half is now done. The higher-level `read*` preference parsers
      (`readDensityPreferences`, `readColumnPreferences`, `readComposerDraft`, …)
      remain inline in App.tsx for a future slice.
    - Added `src/lib/storage.test.ts` (8 tests: round-trip, missing-key null,
      remove, and the throw-safety of each op via a mocked `Storage.prototype`
      throwing getItem/setItem/removeItem) and `src/lib/url.test.ts` (5 tests:
      nullish/empty → undefined, https/http pass-through normalized to href,
      non-web schemes rejected incl. `javascript:`/`data:`/`file:`/`mailto:`/`at:`/
      `did:`, unparseable/relative rejected).
    - Upgraded `scripts/verify-richtext.mjs` from esbuild `transform` (single-file
      data: module) to esbuild `build` with `bundle: true`, since richtext.ts now
      has a runtime `./lib/url` import the old transpile couldn't resolve. Bundling
      inlines the real `safeHttpUrl` and drops the type-only `./api` import, so the
      harness still exercises the real shipped module graph.
    - `npm test` green (128 tests / 9 files); `npm run build` green (tsc, vite,
      audit initial JS 121 kB gzip, reader + layout + rich-text verifiers).
    Remaining helper slices: the `read*` preference parsers in App.tsx.
  - Progress (2026-06-30): **slice 6 — `read*` preference JSON parsers extracted +
    tested.** Pulled the pure parse/validate cores of the storage-blob readers out
    of `src/App.tsx` into `src/lib/preferences.ts` as four storage-agnostic helpers
    that take the raw stored string (or `null`) and never throw: `parseStringArray`
    (string[], optional cap, no trimming), `parseNonEmptyStringArray` (drops
    blank/whitespace-only, keeps the original untrimmed value, optional cap),
    `parseBooleanRecord` (string→boolean map, drops non-boolean values), and
    `parseFiniteNumberRecord` (string→finite-number map, drops non-finite/non-number
    values). Refactored five App.tsx readers to thin wrappers over them, each now
    `parse…(safeLocalStorageGet(key))`: `readFeedOrder` → parseStringArray,
    `readPinnedSearches`(cap 12) / `readPinnedNotifications`(cap 20) →
    parseNonEmptyStringArray, `readShowMediaPreferences` → parseBooleanRecord, and
    `readTimelineScrollCache` → parseFiniteNumberRecord. Behavior preserved verbatim
    (missing key, malformed JSON, wrong top-level type, and per-entry type filtering
    all degrade to the same empty defaults; getItem-throw safety now comes from
    `safeLocalStorageGet`/the new `safeSessionStorageGet`).
    - Added `safeSessionStorageGet` to `src/lib/storage.ts` (mirrors
      `safeLocalStorageGet`) so `readTimelineScrollCache` reads sessionStorage
      through the shared throw-safe guard instead of an inline try/catch.
    - Added `src/lib/preferences.test.ts` (15 tests across the four parsers:
      null/malformed/non-array-or-object inputs, string filtering, blank-string
      handling for both array variants, limit application, boolean/number value
      filtering, negative/fractional offsets) and extended `src/lib/storage.test.ts`
      (+2 for `safeSessionStorageGet` round-trip + throw-safety).
    - `npm test` green (145 tests / 10 files); `npm run build` green (tsc, vite,
      audit initial JS 121 kB gzip, reader + layout + rich-text verifiers).
    Remaining inline `read*` parsers (still in App.tsx, coupled to App-local types
    — a future slice): `readDensityPreferences` (DensityMode),
    `readColumnPreferences` (ColumnVisibility + legacy migration),
    `readCollapsedFeedGroups` (returns the object verbatim, incl. arrays — preserve
    that quirk), and the `readPinnedFeed*` / `readHomeSourceId` readers (FeedSource,
    depend on `feedSources`/`isListUri`).
  - Progress (2026-06-30): **slice 7 — object-array `read*` parsers extracted +
    tested.** Added a generic `parseObjectArray<T>(raw, predicate, limit?)` and a
    `parseComposerDraft(raw)` to `src/lib/preferences.ts` (both pure, storage-
    agnostic, never throw). Refactored four App.tsx readers to delegate, each now
    reading through `safeLocalStorageGet` instead of raw `localStorage.getItem`
    (throw-safe): `readRecentItems` (permissive `() => true` predicate + cap 8,
    verbatim — no historical per-entry validation), `readLocalLists` (id/name
    string guard, then the existing posts-clamp `.map` + cap 20),
    `readPinnedProfiles` (did/handle string guard + cap 16), and `readComposerDraft`
    (joins string posts into one combined draft, degrades to `[""]`). The
    App-type-coupled element predicates stay in App.tsx; only the shared
    JSON.parse / Array-check / filter / cap core moved. Behavior preserved verbatim
    (no verifier source-regex coupled to these readers). Added 8 tests to
    `src/lib/preferences.test.ts` (parseObjectArray: null/malformed/non-array,
    predicate filtering, limit-after-filter, permissive predicate; parseComposerDraft:
    empty/malformed/missing → `[""]`, multi-post join, non-string drop, single-post
    passthrough). `npm test` green (153 tests / 10 files); `npm run build` green
    (tsc, vite, audit initial JS 121 kB gzip, reader + layout + rich-text verifiers).
  - Suggested lowest-risk first slices, each independently shippable:
    1. Extract pure helpers (the `read*`/`safe*`/`readScrollOffset`/
       `scrollOffsetTo`/`restoreScrollOffset`/`postSortAt` cluster) into
       `src/lib/` — no JSX, zero behavior risk, immediately unit-testable.
       (`postSortAt` cluster done → `src/lib/time.ts`.)
    2. Move leaf/presentational components (`Avatar`, `LoadingState`,
       `ErrorState`, `SensitiveMediaGate`, `ExternalLinkCard`, `PostCard`,
       `PostComposer`, `ImageViewer`, `ThreadView`, `DevInspector`…) into
       `src/features/**`, co-locating their CSS slices out of the mega-stylesheet.
    3. Pull the `useRef<Record>` caches + their loaders into a real cache layer
       (plan name-checks TanStack Query; current manual invalidation re-
       implements it imperfectly).
  - Relevant files/functions found:
    - `src/App.tsx`: `App` (`:1424`), `VirtualPostList` (`:3960`), `PostComposer`
      (`:7185`), `PostCard` (`:9158`), `ThreadView` (`:9581`), `ImageViewer`
      (`:9980`), and the cache refs (`:1493`–`:1502`).
    - `src/styles.css`: single 5,116-line stylesheet.
    - `docs/plan.md`: "Project File Layout" already specifies the modular target.
- [ ] Replace the regex source-text "tests" with behavioral tests; add Vitest.
  - Progress (2026-06-26): **Vitest is now installed and wired up** — the test net the App.tsx decomposition needs before it starts.
    - Added `vitest@^3` + `jsdom@^25` devDeps; `test` (`vitest run`) and `test:watch` scripts in `package.json`; a `test` block in `vite.config.ts` (jsdom env, `src/**/*.{test,spec}.{ts,tsx}` include).
    - First real behavioral suite shipped alongside the first decomposition slice: extracted the pure timestamp cluster (`CLOCK_SKEW_WINDOW_MS`, `parseTimestamp`, `postSortAt`, `postSortTime`) from `src/App.tsx` into `src/lib/time.ts` (App.tsx now imports it; all `postSortAt`/`postSortTime` call sites unchanged), and added `src/lib/time.test.ts` — 15 tests over the docs' edge cases (spoofable future-dated `createdAt`, exact clock-skew-window edge, missing/unparseable `indexedAt`, ordering). `npm test` green; `npm run build` still green (tsc, audit, reader + layout + rich-text verifiers).
    - Progress (2026-06-30): **slice 2 — scroll math extracted + tested.** Moved the scroll-geometry / scroll-restoration cluster (`MOBILE_SCROLL_QUERY`, `readScrollOffset`, `scrollElementTo`, `scrollOffsetTo`, `scrollFeedToTop`, the `scrollRestoreGuard`/`scrollRestoreToken` state, `armScrollRestore`, `shouldSuppressScrollSave`, `SCROLL_RESTORE_*` frame budgets, and `restoreScrollOffset`) out of `src/App.tsx` into `src/lib/scroll.ts`. App.tsx now imports the public surface (`MOBILE_SCROLL_QUERY`, `armScrollRestore`, `readScrollOffset`, `restoreScrollOffset`, `scrollFeedToTop`, `shouldSuppressScrollSave`); `scrollOffsetTo`/`scrollElementTo`/`nowMs` are module-internal. All call sites unchanged.
      - Added `src/lib/scroll.test.ts` — 13 behavioral tests (jsdom): multi-scroller `readScrollOffset` max (window vs timeline, zero/null), the save-suppression guard state machine (arm/release/time-window-expiry, ≤0 arm ignored), and `restoreScrollOffset`'s rAF loop (no-op for ≤0, drives the scroller to target and settles, re-resolves the live element from the ref each frame, and a newer restore supersedes an in-flight one). Tests pin jsdom's document scrollers to a constant 0 (they otherwise persist `scrollTop` writes and would mask the fake timeline) and add `__resetScrollRestoreStateForTests()` to clear the module's restore state between tests.
      - Retired the three now-redundant source-regex guardrails in `verify-reader-behavior.mjs` (the `readScrollOffset`/`scrollOffsetTo`/`scrollFeedToTop` *definition* asserts) since `scroll.test.ts` covers that behavior; the App.tsx *call-site* asserts (`shouldSuppressScrollSave(offset)`, `restoreScrollOffset(...)`, per-key caching) stay.
      - `npm test` green (98 tests / 5 files); `npm run build` green (tsc, vite, audit initial JS 121 kB gzip, reader + layout + rich-text verifiers).
    - Progress (2026-06-30): **slice 3 — feed-order sort** extracted to `src/lib/feed-order.ts` (`orderBySavedOrder`) with `src/lib/feed-order.test.ts` (8 tests). Covers the `orderedSubscribedFeeds` ordering behavior. `npm test` green (106 tests / 6 files).
    - Progress (2026-06-30): **slice 4 — `isPinnedFeedMeta` validator** extracted to `src/lib/feed-meta.ts` with `src/lib/feed-meta.test.ts` (9 tests). `npm test` green (115 tests / 7 files).
    - Progress (2026-06-30): **slice 5 — safe storage/URL guards** extracted to `src/lib/storage.ts` + `src/lib/url.ts` (de-duplicating triplicated copies across App.tsx/auth.ts/richtext.ts) with `src/lib/storage.test.ts` (8 tests) + `src/lib/url.test.ts` (5 tests). Upgraded `verify-richtext.mjs` to esbuild bundling so richtext's new `./lib/url` import resolves. `npm test` green (128 tests / 9 files). `resolveHandle` cache was already extracted to `src/api.ts` with `src/api.test.ts`.
    - Progress (2026-06-30): **slice 6 — `read*` preference JSON parsers** extracted to `src/lib/preferences.ts` (`parseStringArray`, `parseNonEmptyStringArray`, `parseBooleanRecord`, `parseFiniteNumberRecord`) with `src/lib/preferences.test.ts` (15 tests); added `safeSessionStorageGet` to `src/lib/storage.ts` (+2 tests). Five App.tsx readers now delegate (`readFeedOrder`, `readPinnedSearches`, `readPinnedNotifications`, `readShowMediaPreferences`, `readTimelineScrollCache`). `npm test` green (145 tests / 10 files).
    - Progress (2026-06-30): **slice 7 — object-array `read*` parsers** extracted to `src/lib/preferences.ts` (`parseObjectArray`, `parseComposerDraft`) with +8 tests in `src/lib/preferences.test.ts`. Four App.tsx readers now delegate (`readRecentItems`, `readLocalLists`, `readPinnedProfiles`, `readComposerDraft`) and read through `safeLocalStorageGet`. `npm test` green (153 tests / 10 files).
    - Still open: keep porting the remaining regex assertions to real tests and delete each as it gains behavioral coverage. Next helper extractions to cover: the remaining App-type-coupled `read*` preference parsers (`readDensityPreferences`, `readColumnPreferences`, `readCollapsedFeedGroups`, the `readPinnedFeed*`/`readHomeSourceId` readers) still inline in App.tsx.
  - Severity: high. `scripts/verify-reader-behavior.mjs` and
    `scripts/verify-layout-behavior.mjs` are 100% `readFileSync` + regex (e.g.
    `verify-layout-behavior.mjs:29` asserts a specific scroll-compensation
    expression verbatim). They fail on any harmless refactor (renaming,
    reordering a `useMemo` body) and pass while behavior is broken, as long as
    the literal string exists. They will actively block the App.tsx decomposition.
    Only `scripts/verify-richtext.mjs` actually executes code — it's the model.
    No `test` script in `package.json`; no test framework in devDependencies.
  - Plan: add Vitest (already on Vite). Write real unit tests for the pure
    helpers slated for extraction (scroll math, `resolveHandle` cache,
    `readPinnedFeedMeta` validators, feed-order sort), then React Testing
    Library smoke tests for extracted components. Keep the regex verifiers only
    as migration guardrails and delete each as it gains a real test.
  - Relevant files/functions found:
    - `scripts/verify-reader-behavior.mjs`, `scripts/verify-layout-behavior.mjs`
      (static-source regex checks).
    - `scripts/verify-richtext.mjs` (executable esbuild-transpiled harness).
    - `package.json`: `build` script; no `test` script, no vitest/jest/RTL.
- [ ] Harden the `signOut` SDK-disposal workaround against version drift.
  - Severity: medium. `src/auth.ts:191-214`. The `Symbol.asyncDispose` cast
    works around an `@atproto/oauth-client-browser` bug (sync `dispose()` calls
    undefined `Symbol.dispose`). Well documented, but coupled to a specific
    library version's internals — an SDK upgrade could silently re-break sign-out.
    Pin the version and add a regression check.
  - Relevant files/functions found:
    - `src/auth.ts`: `signOut`, `clearOAuthLocalSession`.
- [ ] Service worker: evict stale hashed `/assets/*` across deploys.
  - Severity: low. `public/sw.js:51` caches `/assets/*` cache-first with no
    per-entry eviction; only a whole `CACHE_NAME` bump (`bigbsky-shell-v5`)
    cleans stale assets. Make the per-release `CACHE_NAME` bump explicit as
    load-bearing for storage hygiene, or add an LRU/sweep pass in `activate`.
  - Relevant files/functions found:
    - `public/sw.js`: `CACHE_NAME`, the `/assets/*` fetch handler, `activate`.
- [ ] Reconcile `docs/plan.md` and `todo.md` (single source of truth).
  - Severity: low. The two already drift — e.g. `docs/plan.md` still lists
    "User-sortable feed order" as open, while `todo.md` shows it done. Pick one
    source of truth for open work (recommend `todo.md`) and have the other
    reference it.
  - Relevant files/functions found:
    - `docs/plan.md`: "TODO (open tasks)".
    - `todo.md`.
- [ ] CSS dead-selector sweep (co-locate with component extraction).
  - Severity: low. `src/styles.css` (5,116 lines) likely has orphaned rules after
    the Save→Bookmark rename and removed panels, but several classes are applied
    via dynamically-built names so a blind strip is unsafe. Do it with a real
    usage cross-check alongside the App.tsx component extraction, co-locating
    each component's styles. (Already flagged in `docs/plan.md`; tracked here.)
  - Relevant files/functions found:
    - `src/styles.css`.
- [ ] Add a Follow button to the feed-page header for unsubscribed feeds. (IMPLEMENTED 2026-06-30 — remaining: signed-in confirmation only.)
  - Done (2026-06-30): added a Follow button beside the feed title in the `.workspace-header`.
    - `src/App.tsx`: new derived `canFollowActiveFeed` = `route.kind === "feed" && signedInDid && isFeedGeneratorUri(activeSource.uri) && !followedFeedUris.has(activeSource.uri)` (so it shows only for a signed-in viewer on a custom feed generator they have not subscribed to; hidden for the Following timeline, lists, and signed-out viewers). When true, a Follow button renders between the `<h1>` title and the `.nav-toggle` in the workspace header. It reuses the existing `toggleFollowFeed(activeSource.uri, label)` handler (the same one the `/feeds` + Discover surfaces use — no duplicated logic), shows a `Loader2` spinner while `followBusyUri === activeSource.uri`, and disables during the write. Per the spec, when already subscribed the button simply does not render (no Following/Unfollow state in the header — that lives on `/feeds`).
    - Styling reuses the `/feeds`/Discover Follow class `discover-feed-follow` (blue pill + `Plus` icon + "Follow"), plus a `workspace-header-follow` class with `flex: 0 0 auto` in `src/styles.css` so it doesn't shrink in the header flex row.
    - `src/api.ts`: added `isFeedGeneratorUri(uri)` helper (mirrors `isListUri`), imported in `src/App.tsx`.
    - Verified: `npm run build` passes (tsc, vite, audit initial JS 121 kB gzip, reader + layout + rich-text verifiers all green). Drove the dev server via `scripts/cdp.mjs` on `/feed/at://…/app.bsky.feed.generator/aaacqpx6p7n7i` ("Graphic Design on bsky"): signed-out → feed title renders and the Follow button is correctly **absent**, no console errors. Injecting the exact `discover-feed-follow workspace-header-follow` markup into the live header confirmed it renders as a blue pill cleanly to the right of the title (visually consistent with `/feeds`). Killed the dev server afterward.
  - Remaining: confirm in a real **signed-in** session that the button (a) appears for an unsubscribed feed generator, (b) follows the feed on click (subscribes via `followFeed`, optimistic list update), (c) disappears once subscribed, and (d) the saved feed shows up in `/feeds` + the official bsky.app client. This is the same authenticated-write limitation as prior composer/follow work — not exercisable on the local origin (no OAuth session present), needs the deployed origin with the operator signed in.
  - Relevant files/functions found:
    - `src/App.tsx`: `.workspace-header` render (`canFollowActiveFeed`, `toggleFollowFeed`, `followedFeedUris`, `followBusyUri`), `activeSource`.
    - `src/api.ts`: `isFeedGeneratorUri`, `isListUri`.
    - `src/auth.ts`: `followFeed`, `unfollowFeed`, `getSubscribedFeeds` (saved-feeds preference read/write).
- [ ] Investigate feeds loading pre-scrolled when clicked from the feed column.
  - Reported: clicking a feed in the feed-selector column sometimes opens the feed already scrolled down partway (not at top). The trigger pattern is not yet identified — happens intermittently, not on every click.
  - Likely suspects (from the existing scroll-restoration work — this looks like a symptom of restore-on-navigate landing on the wrong surface or restoring a stale offset):
    - `restoreScrollOffset` / `rememberScroll` / the `feedCacheRef` scroll cache restoring the *previous* feed's saved offset onto the *new* feed when the route changes faster than the cache key rotates, or when the `.timeline` ref hasn't remounted yet.
    - The scroll-restore-suppression guard (`armScrollRestore` / `shouldSuppressScrollSave`) and the multi-frame apply loop (`SCROLL_RESTORE_MAX_FRAMES`) — a misfire could re-assert a stale target onto a feed that was never scrolled.
    - `VirtualPostList`'s height-compensation (`container.scrollTop += height - previousHeight`) firing during initial measurement and pushing `scrollTop` past 0 on a freshly-loaded feed.
    - The restore-suppression guard arming off a persisted offset for the clicked feed from a prior visit (intended), but applying it to the same feed you're navigating away from / back to in a way that looks "pre-scrolled".
  - Reproduce first: drive the dev server via `scripts/cdp.mjs`, click several feeds in the column (incl. revisiting one you previously scrolled), and log `readScrollOffset(timeline)` + the active scroll key at click time vs. after load settles. Find the pattern (which feeds, first-visit vs. revisit, signed-in vs. out, virtualized-row-count differences) before changing anything.
  - Relevant files/functions found:
    - `src/App.tsx`: `restoreScrollOffset`, `rememberScroll`, `armScrollRestore`/`shouldSuppressScrollSave`, `readScrollOffset`/`scrollOffsetTo`, the scroll-remember `useEffect` and the `surface:` restore `useEffect`, `feedCacheRef`, `VirtualPostList` (`container.scrollTop += height - previousHeight`).
    - `scripts/cdp.mjs`: for reproducing against the running dev server.
