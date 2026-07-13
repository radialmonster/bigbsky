# Todo

This is the single source of truth for BigBsky's open work. `docs/plan.md` keeps
the project's design context + historical changelog but no longer tracks open
tasks — it points here.

## Migrated from docs/plan.md (2026-07-02 reconcile)

- [ ] **Consent UX (BLOCKED on upstream — revisit when atproto permission sets
  stabilize).** Goal: replace the raw ~25-token consent list with friendly
  capability summaries via an `include:<nsid>?aud=…` permission set.
  **Investigated 2026-06-10:** permission sets are now *spec-finalized*
  (`/specs/permission`: named bundles published as Lexicon schemas, resolved by
  the auth server, with user-meaningful titles/summaries on the consent screen)
  — BUT not production-ready. Bluesky's official `app.bsky.*` sets are published
  yet *"still problematic"* as of Apr 2026 (`inheritAud: true` issues forcing
  per-method `aud=*` workarounds; lexicon resolution + PDS caching still
  maturing — atproto discussions #4437/#4118). Do NOT adopt yet: (a) it would
  force *another* full re-consent for every user on top of the notifications/
  mute/bookmark batches; (b) it's an OAuth-mechanism change verifiable only by
  the operator on the deployed origin (we can't test sign-in locally) and a
  resolution failure breaks sign-in for everyone; (c) authoring our own set
  needs a DNS-controlled NSID + a published lexicon record, awkward for a static
  no-backend app. **Revisit trigger:** Bluesky announces stable official
  `app.bsky` permission sets (or `inheritAud` is fixed). Then prefer adopting
  the official reader/posting set over authoring our own, and batch the
  re-consent with the "Permissions updated" prompt. Not blocking; trust/clarity
  polish only.
- [ ] **Runtime-verify the 2026-06-10 bug-fix + cleanup pass (partially confirmed
  2026-07-03 in an authed localhost session).** Confirmed via CDP against a real
  signed-in session on `http://127.0.0.1:5173/` (@radialmonster.com): (a) the Like
  control renders a heart (`lucide-heart`, label "Like"), not a bell, and
  like/unlike works — liked own post 8→9 (title flips to "Unlike", persists across
  reload), unliked back to 8; (b) viewer **follow/block** state renders correctly
  (@bsky.app profile shows "Following"/"Block"), and like state renders (filled/
  title-flip on the liked post). Viewer **bookmark** state also confirmed
  2026-07-03: bookmarking 3 feed posts flipped their buttons to "Remove bookmark"
  and all 3 appeared on `/bookmarks`; removing them returned the page to "No
  bookmarks yet". (Test bookmarks added then removed — account restored to zero
  bookmarks.) The **stale liked/bookmarked-clears-after-sign-out** auth-change
  cache invalidation is also **CONFIRMED 2026-07-03**: liked + bookmarked a post
  while signed in (visible "Unlike"/"Remove bookmark" state), then clicked Sign
  out — the `bigbsky:auth:active-did/-handle` hints cleared to null, the view
  dropped to the signed-out "Sign in" state, and **no stale liked/bookmarked state
  persisted** (0 "Unlike"/"Remove bookmark" buttons in the post-sign-out view, and
  the post's permalink loaded clean signed-out). On re-auth the real records
  correctly reappeared; removed them afterward to restore the account to baseline.
  (c) **CONFIRMED 2026-07-03** — a 10-image post
  (`/profile/80east.bsky.social/post/3mpongcafhc2y`) renders **all 10** images,
  every one visible (881×1107, distinct alt text), via the `.image-masonry`
  row-grouped gallery. Note: the grid class is `count-${Math.min(images.length,4)}`
  (App.tsx:8509), so a 10-image post gets `count-4` — but that's inert: only
  `.image-grid.count-1` is ever styled; for the masonry (2+) the layout comes
  entirely from `.image-row`/`.image-row-solo`, so `count-2/3/4` are dead class
  values, not a bug. The full-screen `.image-viewer` lightbox opens on a real
  pointer click and shows "1 / 10" — all 10 images navigable. (A programmatic
  `.click()` was a no-op because the viewer opens on pointerdown/mousedown, not
  the React onClick — a CDP synthetic-event quirk, not a defect.)
  (d) Scroll restoration on revisit — **updated 2026-07-03 with a real signed-in
  CDP test.** Feed back-navigation restores correctly: on `/feed/following`
  (populated, virtualized) scrolling to 1587, opening a thread, and going back
  restored to exactly 1587. **Bookmarks scroll-restore is CONFIRMED BROKEN**,
  though — see the "Integrate scroll restoration with the `VirtualPostList`
  measurement pass" item below for the full root-cause writeup. In short: with
  ~10 test bookmarks (added then fully removed, account back to zero), a real
  wheel-scroll to 2698 was saved correctly (`surface:bookmarks` = 2698) but on
  return the page landed at **96** (near top). Cause: on the bookmarks surface the
  restore's own `scrollOffsetTo(target)` jump fires while VirtualPostList still
  has most rows at their (too-tall) height estimate; the jump forces those rows to
  mount + measure shorter, `totalHeight` shrinks, and `scrollTop` clamps back to
  ~96 — the restore fights the measurement compensation and can't win. Following
  works only because its rows were already measured on back-nav. A time-budget
  widening (aligning the 500ms re-apply loop to the 2000ms suppression guard) was
  tried and **reverted** — it does not help, since the problem is the estimate→
  measure shrink, not the loop giving up early. Real fix is the measurement-pass
  integration item. Lists scroll-restore still unverifiable: operator has **zero
  Bluesky lists** ("No lists yet"), and creating account-level lists just to test
  isn't warranted — revisit if the operator ever has a long list.

## Code review findings (2026-07-02)

From the full code review of `src/App.tsx`, `src/auth.ts`, `src/api.ts`, `src/richtext.ts`, `src/router.ts`, `src/lib/*`. Baseline was healthy: `tsc -b` clean, 177/177 tests pass. Items below are real bugs / silent failures, ordered by severity.

### MEDIUM

- [ ] **M2. Centralized revoked/deleted-session handling. (IMPLEMENTED 2026-07-02 — remaining: signed-in confirmation only.)**
  - Done (2026-07-02): wired the OAuth client's `onDelete` hook so a session
    deleted out from under us (server-side token revocation via Bluesky's
    account UI, a failed refresh, an invalid/expired session, or a sign-out in
    another tab) is handled centrally, regardless of which authed read/write
    triggered the refresh — instead of letting a raw "session deleted" error
    propagate while `activeSession` stayed cached.
    - `src/auth.ts`: `BrowserOAuthClient.load({ … onDelete })` now points at a
      new `handleSessionInvalidated(did)` that drops BigBsky's cached pointers
      (`activeSession`, `restorePromise`, and the `activeDidKey`/`activeHandleKey`
      localStorage hints) and notifies the app. It deliberately does **not**
      `deleteDatabase` (the library already removed the session from its own
      IndexedDB store; DB teardown remains sign-out's job), ignores deletes for a
      non-active DID (stale cross-tab events), and is suppressed during our own
      intentional `signOut()`/`clearOAuthLocalSession()` via a `teardownInProgress`
      flag (both wrapped in try/finally) so the reactive handler doesn't race the
      explicit sign-out state reset. Verified against the library source that
      `onDelete` fires from `SessionGetter.delStored` on revoke/refresh-failure/
      invalid-session/cross-tab-delete (`@atproto/oauth-client` session-getter.js).
    - `src/auth.ts`: new `setSessionInvalidatedListener(listener)` export.
    - `src/App.tsx`: a dedicated effect registers the listener; on invalidation it
      sets `authState` to `status: "error"` with an actionable message ("Your
      Bluesky session ended … Sign in again to continue.") — but leaves an
      in-flight local `signed-out`/`signing-out` alone so it can't clobber an
      intentional sign-out. Dropping `session`/`signedInDid` cascades through the
      existing effects that clear subscribed feeds etc. The pre-existing
      `isDeletedSessionError` check in `initAuthSession` (cold-start init failure)
      is a separate path and stays.
    - Verified: `tsc -b` clean; `npx vitest run` green (185 tests / 11 files);
      `npm run build` green (vite, audit initial JS 151 kB gzip, reader + layout +
      rich-text verifiers). Confirmed localhost still typechecks/builds; the app
      loads unchanged for signed-out readers (init returns early before the client
      loads).
  - Remaining: confirm in a real **signed-in** session that revoking BigBsky's
    authorization from Bluesky's account UI (or letting the refresh token expire)
    drops the reader to the signed-out/error state with the message and no console
    spew, and that a normal local Sign out is unaffected (no double banner). Not
    exercisable locally (no OAuth session on the localhost origin) and destructive
    to trigger against the operator's live session, so deferred to a deliberate
    signed-in check — same auth-gated limitation as the composer/follow items.

### LOW

- [ ] **L5. `auth.ts:117-120` — `looksLikeOAuthCallback` also scans `location.hash`**; a stray `#state=…&error=…` fragment falsely triggers the callback view. Restrict to `location.search`. **Deferred 2026-07-02:** atproto's own `readCallbackParams` chooses hash vs. search by `responseMode` (`docs/atproto/.../browser-oauth-client.ts:390`), so restricting to `location.search` would break a fragment-mode client. Confirm BigBsky's `responseMode` before touching this; not worth the risk without an OAuth test path.

### Verified correct (cleared during review)

- `richtext.ts` UTF-8 byte-offset facet slicing (no UTF-16/UTF-8 bug).
- `lib/threads.ts` cycle protection and NaN-safe stable sort.
- Optimistic like/bookmark/block + revert logic.
- `startThreadLoad` prior-controller abort; `VideoEmbedCard` HLS cleanup; `MeasuredPostRow`/`AutoLoadMoreButton` observer disconnects.
- Composer unmount cleanup uses `imagesRef.current` (avoids the documented leak).
- OAuth callback effect `cancelled` guard + DID-guarded profile merge.

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
  - **Now backed by a concrete reproduction (2026-07-03, signed-in CDP).** On
    `/bookmarks` with ~10 bookmarks, a real wheel-scroll to 2698 saved correctly
    (`surface:bookmarks` = 2698) but the return navigation restored to **96** (near
    top). The restore's `scrollOffsetTo(target)` jump is itself a programmatic
    scroll that forces VirtualPostList to mount rows near the target using the
    (too-tall) `defaultRowHeight` estimate; those rows then measure shorter, the
    `ResizeObserver` compensation shrinks `totalHeight`, and `scrollTop` clamps
    back to ~96. The rAF loop re-asserts the target every frame but each assertion
    re-triggers the same shrink, so it never converges — the restore *fights* the
    measurement compensation. This reproduces cleanly with real wheel events (not a
    CDP synthetic-event artifact); a plain programmatic `scrollTop = N` shows the
    same shrink (2200 → 529). Feed back-navigation (`/feed/following`) restores
    fine (1587 → 1587) only because its rows were already measured. A time-budget
    widening (500ms re-apply → 2000ms, matching the suppression guard) was tried
    and reverted: it doesn't help because the failure is the shrink, not an
    early-give-up. **The real fix must anchor to content, not a raw pixel offset**
    — e.g. save the top-visible post URI (+ intra-post offset) and scroll that
    element into view once it renders, and/or drive the restore from a
    VirtualPostList "measurement settled / totalHeight stable" signal and clamp
    against the live `totalHeight`. Lowering `defaultRowHeight` closer to real row
    heights would only reduce the shrink magnitude, not eliminate the race.
  - `restoreScrollOffset` currently re-asserts the target on a fixed ~500ms (30-frame) rAF budget. In the virtualized feed this races `VirtualPostList`'s row measurement: rows start at the estimated `defaultRowHeight`, then `ResizeObserver` measures real heights and compensates `scrollTop`, and on a fresh/reload load the content can keep growing past the 30-frame window — so the restore can land short or at 0.
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
- [ ] Document report-handling process + do a local-data security-posture review (follow-up from Developer Guidelines audit).
  - **Contact email question — RESOLVED (2026-07-02):** operator declined to publish a
    dedicated email. Decision: BigBsky hosts none of its own content, so content/abuse
    reports route to **Bluesky's** moderation (already wired in `InfoPage.tsx` — links
    Bluesky's report flow + community guidelines). Problems with the BigBsky site itself
    go to the operator's **Bluesky profile `@radialmonster.com`** (plus GitHub Issues),
    which the Contact panel already lists. Do NOT paste Bluesky's abuse email as BigBsky's
    contact (misdirects reports, implies BigBsky monitors that inbox). No page change
    needed for contact routing.
  - Still open: document an explicit process for how reports are tracked/responded to and
    how content-deletion requests are handled (even a short stated turnaround), and do a
    dedicated security-posture review of local OAuth/session data, browser-local
    preferences, drafts, pins, and collections.
  - Relevant files/functions found:
    - `src/InfoPage.tsx`: "Reporting content & abuse" + "Contact" panels.
    - `README.md`: "Reporting content & abuse" section + Links list.
- [ ] Confirm saved-feed-order account sync — cross-client half still open (follow-up).
  - Confirmed 2026-07-03 in an authed localhost session (@radialmonster.com, CDP):
    reordering feeds on `/feeds` (Move up/down) works, writes the explicit order to
    `bigbsky:feed-order`, and fires `syncSavedFeedsOrder` with **no console error**;
    moving a feed and moving it back restored the exact original order. Restored the
    operator's state afterward (moved back + cleared `bigbsky:feed-order` to its
    original null; the account order it synced back is identical to the original).
  - Still open: confirm (a) reloading BigBsky in a **fresh browser/profile** (empty
    `bigbsky:feed-order`) shows the account-synced order, and (b) the official
    **bsky.app** client reflects the same saved-feed order (true cross-client sync)
    with pinned state + Following timeline + saved lists unchanged. (a)/(b) weren't
    exercised because the test restored the original order rather than leaving a
    changed order to observe cross-client.
  - Optional: surface a subtle "saving…/synced" affordance on `/feeds` so the user knows the order is account-synced, and consider a manual retry if the sync fails.
  - Relevant files/functions found:
    - `src/auth.ts`: `syncSavedFeedsOrder`.
    - `src/App.tsx`: `persistFeedOrder`.

## From the 2026-06-30 thread code review

- [ ] Bug 4 — combined reply-count math assumes a linear chain (`src/App.tsx`:
  `CombinedThreadCard` + `CombinedThreadCardCompact`: `Σ replyCount − (posts.length
  − 1)`). Re-examined 2026-06-30: the over-count is **real** — a forked self-thread
  (author replies to one part more than once) leaves the extra fork(s) counted, so
  the chip reads slightly high. **Not fixable precisely at this call site**: the
  feed combined cards take a `ThreadedFeedItem` (`{ root, replies }`) whose items
  carry only each post's aggregate `replyCount` *integer*, not the reply trees
  needed to tell a fork from an external reply. The `−(posts.length−1)` term
  removes exactly the linear continuation hops we *do* know about; it can never
  over-subtract and hide real replies, so the error is bounded by the fork count
  (rare) and always in the safe (over-count) direction. Left as-is by design;
  the caveat is now documented inline at both sites. Only worth a real fix if we
  start plumbing per-part reply trees into the feed combined card.

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
  - Progress (2026-07-03): **slice 8 — the last App-type-coupled `read*` object-blob
    parsers extracted + tested.** Added `parseObjectMap<T>(raw)` (JSON.parse with a
    `typeof === "object"` guard, no per-value validation — preserves the originals'
    guard, including the array-passthrough quirk `readCollapsedFeedGroups` relied on)
    and `parseColumnVisibility(raw)` (primary `{feeds,right}` blob → resolved
    visibility, or `null` so the caller can fall back to its legacy width migration)
    to `src/lib/preferences.ts`. Rewired three App.tsx readers to delegate and read
    through `safeLocalStorageGet` (throw-safe): `readDensityPreferences` →
    `parseObjectMap<DensityMode>`, `readCollapsedFeedGroups` → `parseObjectMap<boolean>`,
    and `readColumnPreferences` → `parseColumnVisibility` for the primary blob with
    the legacy per-context/single-value width migration kept inline. Behavior
    preserved for every realistic path (absent / valid object / valid non-object /
    array). Two documented, effectively-unreachable edge changes: (a)
    `readDensityPreferences` gains a defensive non-object→`{}` guard it lacked (it
    previously returned the raw parse of any JSON — only matters for corrupted data,
    which the app never writes); (b) a *corrupted* (unparseable) columns blob now
    falls through to the legacy width migration instead of short-circuiting to the
    default — only observable if the columns JSON is corrupt AND a legacy `focus`
    width pref exists simultaneously. Added 6 tests to `src/lib/preferences.test.ts`.
    `npm test` green (198 tests / 12 files); `npm run build` green (tsc, vite, audit
    initial JS 151 kB gzip, reader + layout + rich-text verifiers). Live-smoke via
    CDP on the signed-in dev server: `/feed/following` renders, density class applied,
    columns default — no console errors. **All inline `read*` blob parsers are now
    extracted** — remaining decomposition work is component/CSS co-location and the
    cache-layer slice, not helper parsers.
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
    - Progress (2026-07-03): **slice 8 — `parseObjectMap` + `parseColumnVisibility`** extracted to `src/lib/preferences.ts` (+6 tests). `readDensityPreferences`, `readCollapsedFeedGroups`, and `readColumnPreferences` now delegate. `npm test` green (198 tests / 12 files). All inline object-blob `read*` parsers are now extracted.
    - Still open: keep porting the remaining regex assertions to real tests and delete each as it gains behavioral coverage. The `readPinnedFeed*` / `readHomeSourceId` readers stay inline (they depend on `feedSources`/`isListUri` and return App-local `FeedSource`, so they belong with a components/feed-source slice rather than the pure-parser lib).
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
- [ ] CSS dead-selector sweep (co-locate with component extraction).
  - Severity: low. `src/styles.css` (5,116 lines) likely has orphaned rules after
    the Save→Bookmark rename and removed panels, but several classes are applied
    via dynamically-built names so a blind strip is unsafe. Do it with a real
    usage cross-check alongside the App.tsx component extraction, co-locating
    each component's styles. (Already flagged in `docs/plan.md`; tracked here.)
  - Relevant files/functions found:
    - `src/styles.css`.

## Code review findings (2026-07-03)

Full-codebase review (baseline green: tsc -b clean, 191/191 vitest tests pass).
Scope: src/App.tsx, src/auth.ts, src/api.ts, src/lib/\*, src/main.tsx,
public/sw.js, index.html, vite.config.ts, tsconfig.json, scripts/\*.mjs.
Items below are real bugs / silent failures / hardening gaps, ordered by
severity; line numbers current as of this commit. Candidate findings checked
and dropped as non-bugs are noted at the end so a future pass doesn't re-flag
them.

### HIGH

- [ ] **H1 follow-up (top-level boundary DONE 2026-07-03; narrower subtree
  boundary still open).** Shipped `src/ErrorBoundary.tsx` (class component,
  getDerivedStateFromError + componentDidCatch, self-contained inline-styled
  fallback with Reload + Try-again, optional `label`/`fallback` props) and
  wrapped `<App />` in it in `src/main.tsx` — a render error now shows the
  fallback instead of whitescreening #root. Verified: tsc/vitest/build green;
  reloaded the signed-in dev app via CDP — 6 posts render, no `[role=alert]`
  fallback, no console errors. Remaining (optional, lower value now the
  whitescreen is handled): add a *narrower* boundary around the timeline/
  post-rendering subtree (or per-PostCard) so one malformed record degrades a
  single row instead of the feed. The ErrorBoundary already renders children
  with no wrapper DOM in the happy path, so wrapping rows is measurement-safe.

### MEDIUM

- [x] **M3. src/api.ts:191 — success-path response.json() is unguarded, unlike
  the error path. (DONE 2026-07-06.)** `getJson`'s 2xx path now wraps
  `response.json()` in try/catch and throws `new ApiError(response.status,
  "Malformed response body")` on a decode failure, so callers see the same
  `ApiError` shape for an empty/truncated 2xx body as for an error body instead of
  a raw SyntaxError. Added a behavioral test in `src/api.test.ts` (a 2xx whose
  `json()` throws → `resolveHandle` rejects with an `ApiError` and caches nothing,
  so a retry re-fetches). `tsc -b`, vitest (201), and `npm run build` all green.
- [ ] **M4. src/auth.ts:1496-1502 — clearOAuthSessionStorage resolves success
  after onblocked, contradicting its own warning comment.** The 3s fallback
  setTimeout(done) fires when deleteDatabase is blocked, even though the
  preceding comment explicitly says resolving here "would report success while a
  signed-out OAuth session lingers on disk, letting a later init() resurrect
  it." signOut then nulls clientPromise, so the next getClient() can re-open and
  re-read the same DB before the pending delete completes — a real (if rare)
  resurrection race. The fallback exists to avoid a hang, but it should not look
  like clean success. Fix: resolve with a distinct "blocked/timed-out" outcome
  (or reject with a typed error) so callers can warn the user / retry instead of
  reporting a clean sign-out.
- [x] **M5. src/auth.ts:257 — initAuthSession uses raw localStorage.getItem
  while the rest of the module uses safeLocalStorageGet. (DONE 2026-07-06.)**
  Swapped the raw `localStorage.getItem(activeDidKey)` for the throw-safe
  `safeLocalStorageGet(activeDidKey)` (already imported and used elsewhere in the
  module), so a private-mode / storage-disabled context now falls through to the
  signed-out view instead of the "error" view with a SecurityError message.
  `tsc -b` + vitest + build green.
- [ ] **M6. src/auth.ts:400-403 — disposeCachedClient returns silently when
  Symbol.asyncDispose is missing.** If the symbol isn't polyfilled at runtime
  (core-js import tree-shaken or a future build change), the client's IndexedDB
  handle stays open, so the subsequent deleteDatabase hits the onblocked path
  from M4. Currently believed-polyfilled by the library's core-js import, but
  nothing observes the early-return. Fix: at minimum log when the early return
  is taken so this is observable; ideally fall back to an explicit close.
- [x] **M7. src/App.tsx:5871-5891 — AuthedNotifications.load has no abort /
  generation guard (retry race). (DONE 2026-07-06.)** `getNotifications` takes no
  abort signal (it builds an atproto `Agent` internally), so rather than widen the
  auth API surface, added a `loadGenerationRef` counter to `AuthedNotifications`:
  each `load()` bumps the id, and both the `.then` and `.catch` bail early if
  `loadGenerationRef.current !== generation`. A Retry click while a prior
  `getNotifications()` is in flight now discards the stale resolution instead of
  letting it overwrite the newer `setItems`/`setStatus`/`setNeedsReauth`. This
  fully fixes the observable bug (stale response clobbering newer state); the older
  network request still completes but its result is ignored. `tsc -b` + vitest +
  build green. (A true abort would need threading a `signal` into
  `getNotifications` → the agent's `listNotifications` call options — a larger
  change deferred unless we also want to cancel the in-flight request.)
- [x] **M8. src/App.tsx:6264-6268 — BlueskyListCard local block/mute state never
  re-syncs from props. (DONE 2026-07-06.)** Added a `useEffect` keyed on
  `list.uri` / `list.viewer?.blocked` / `list.viewer?.muted` that re-seeds the
  local block-list subscription URI and mute boolean whenever a refreshed list
  card arrives. This mirrors the profile header's viewer-state re-sync, so a
  `ListsSurface` refresh, list creation reload, or cross-tab state change can no
  longer leave the block/mute buttons stale. The reader verifier now guards this
  effect; `npm run build` green.
- [x] **M10. src/App.tsx — PostComposer.insertAtCaret used a stale draftText
  closure. (DONE 2026-07-13.)** `insertAtCaret` now reads the live textarea
  `el.value` / `el.selectionStart` / `el.selectionEnd` and splices against that
  instead of the `draftText` render closure, so a stale `insertAtCaret` reference
  (or a rapid second emoji insert) can no longer slice against a pre-insert
  snapshot and drop the first insertion. The `!textareaRef.current` fallback still
  appends to `draftText` (best effort when the field isn't mounted). `tsc -b`,
  vitest (201), and `npm run build` all green.
- [ ] **M11. src/App.tsx:3302-3333 — loadMore (profile/search) passes undefined
  signal; late pages can't be aborted.** The manual loadMore calls
  loadSearch / loadActorSearch / loadProfileFeed / loadFeed with no signal on the
  cursor path. Initial-load effects use controllers; pagination does not, so an
  in-flight "load more" on profile A can resolve after navigating to profile B
  and append rows to the wrong feed. Fix: thread an AbortController (a ref
  replaced on route change) through loadMore. (Same class of race as M12.)
- [ ] **M12. src/App.tsx:3334-3340 — reloadCurrentProfile fetches with no
  AbortController.** Called from handleOwnPostPublished after posting a reply; if
  the user navigates away right after, the profile refetch can resolve after the
  route changed and overwrite the new route's feed state. Fix: track a
  controller, or guard the setFeedState with a route-kind/actor check.
- [ ] **M14. src/App.tsx:1608-1631 — toggleFollowFeed swallows follow/unfollow
  failures (console.error only, no user feedback).** The catch only logs; the
  button gives no error state, so a failed follow/unfollow silently does nothing
  visible. Fix: surface the error (banner or button error state) like the list
  subscribe path already does (subError in BlueskyListCard).

### LOW

- [ ] **L8. src/App.tsx — readCollapsedFeedGroups returns non-boolean values
  verbatim (ACCEPTED BY DESIGN — do not "fix" without checking the consumer).**
  It delegates to `parseObjectMap<boolean>`, which does a top-level object check
  only, so a historically-stored `{"g":"yes","h":1}` comes back as-is (the
  sibling `parseBooleanRecord` would drop these). This passthrough was
  *deliberately preserved* by slice 8 to match the original inline reader's
  behavior verbatim (the array-passthrough quirk). It only matters for corrupted
  data the app never writes. Left as-is intentionally; if ever changed, verify
  the collapsed-group consumers first. (L6 and L7 from this batch are resolved:
  L6 — the three read\* callers ARE wired to the validators now, docstrings
  accurate; L7 — `parseColumnVisibility` now has the `!Array.isArray` guard.)
- [ ] **L10. src/lib/scroll.ts:88,134-153 — armScrollRestore's 2000 ms
  suppression window can lapse mid-restore on a backgrounded tab.** The apply
  rAF loop (up to 30 frames) only re-asserts the scroll offset; it doesn't
  re-arm the suppression guard. rAF throttles to ~1 Hz when backgrounded, so 30
  frames can exceed 2 s; after expiry a save-on-scroll handler can persist a
  transient near-zero offset, clobbering the value being restored. Fix: re-arm /
  extend the guard each frame while the restore is ongoing, or tie suppression
  to the token being active rather than a wall-clock deadline.
- [x] **L11. src/App.tsx — ImageViewer preloaded new Image() onload could
  setState after unmount. (DONE 2026-07-13.)** `preloadOriginal` now registers
  each pending preload `Image` in a `preloadImagesRef` set (and removes it in its
  own onload), and a mount-scoped cleanup effect nulls every pending `img.onload`
  and clears the set on unmount. A viewer closed mid-preload therefore no longer
  fires `setLoadedOriginals` on the unmounted component or pins it in memory until
  the image finishes loading. `tsc -b` + vitest + `npm run build` green.
- [x] **L12. src/App.tsx — ListMemberManager.handleRemove had no busy guard
  (unlike handleAdd). (DONE 2026-07-13.)** Added `if (busy) return;` at the top of
  `handleRemove`, mirroring `handleAdd`, so a rapid double-click before the button
  re-renders as `disabled={busy}` can no longer fire two concurrent
  `removeListItem` calls. `tsc -b` + vitest + `npm run build` green.
- [x] **L13. src/App.tsx — BackToTopButton container listener never attached if
  the ref was null on mount. (DONE 2026-07-13.)** The effect now attaches the
  window listener immediately, and if `containerRef.current` is null at mount
  (feed still loading) it polls a bounded 120 rAF frames for the container to
  appear, then attaches the element `scroll` listener via `attachEl`. The rAF is
  cancelled in cleanup and the (possibly-later-assigned) `el` is detached. So on
  desktop, where the container (not the window) scrolls, the button now becomes
  visible even when the scroll container mounts after the button. `tsc -b` +
  vitest + `npm run build` green.
- [ ] **L14. src/App.tsx:11068-11078 — TrendingPanel swallows network errors;
  user always sees the static fallback with no indication.** Every non-"ready"
  status (loading/error/empty) renders the hardcoded fallback list; users can't
  tell "trending API is down" from "these are real trends." Fix: surface a
  subtle "showing defaults" note or an error state.
- [ ] **L17. src/main.tsx:11 + public/sw.js — service worker uses hardcoded
  root paths; dev install can cache the dev shell under the prod cache key.**
  register("/sw.js") and sw.js's SHELL_URLS = ["/","/index.html"] /
  url.pathname.startsWith("/assets/") are root-anchored, so any future
  base/subdirectory deploy breaks offline caching invisibly. Separately, in
  local dev the SW can cache the dev HTML (with /src/main.tsx) under
  bigbsky-shell-v5 and a dev->prod switch then serves the stale dev shell until
  CACHE_NAME is bumped. Fix: derive paths from import.meta.env.BASE_URL and gate
  SW registration behind import.meta.env.PROD (or bump CACHE_NAME per
  environment).
- [ ] **L18. No CSP anywhere (index.html / public/_headers).** _headers sets
  X-Content-Type-Options / Referrer-Policy / Permissions-Policy but no
  Content-Security-Policy. For a static SPA that renders third-party rich-text,
  mentions, links, and media, a CSP would meaningfully reduce XSS blast radius.
  Hardening gap, not a strict bug. Fix: add a CSP via _headers (allow atproto/CDN
  image hosts, connect-src to the PDS/AppView/PLC/handle resolvers).
- [ ] **L19. index.html:18 — no noscript / no JS-load failure placeholder in
  #root.** If the bundle fails to load (network, bad deploy, CSP block), the
  user sees a blank page forever. Combined with H1, the failure UX is uniformly
  "blank page." Fix: add a noscript message and a minimal loading/error
  placeholder inside #root.
- [x] **L20. scripts/verify-layout-behavior.mjs:3-4 and
  verify-reader-behavior.mjs:3-5 use pathless readFileSync("src/App.tsx", ...)
  — break under non-root CWD. (DONE 2026-07-06.)** Both scripts now derive a
  `repoRoot` from `dirname(fileURLToPath(import.meta.url))` + `..` and resolve
  their source paths against it (mirroring `verify-richtext.mjs`), so they run
  from any CWD instead of throwing ENOENT under a "verification failed" framing.
  Verified by running both from `C:\` — both pass; `npm run build` (which runs
  them from repo root) still green.
- [ ] **L21. tsconfig.json:6,21 — scripts/audit-build.mjs is in include but
  allowJs: false, so it's silently not type-checked.** Misleading: implies
  coverage that doesn't happen; the other .mjs scripts aren't included at all.
  Fix: drop the entry (no-op) or add a separate tsconfig.scripts.json.

### Verified correct / dropped (checked, not bugs)

- **Profile tab to server filter mapping is correct** (profileFeedFilterForTab,
  App.tsx:600). "posts" -> posts_no_replies and visibleProfileItems returns
  feedState.items unfiltered (server already excluded replies); the
  "replies"/fallback branch maps to posts_with_replies and client-filters to
  self-thread replies. Initially flagged as a HIGH mismatch; re-verified against
  the atproto getAuthorFeed filter semantics — not a bug.
- src/richtext.ts UTF-8 byte-offset facet slicing and multi-feature fallback
  (still correct; re-confirmed this pass).
- lib/threads.ts cycle protection, hardSplitIndex always advances >=1 on both
  grapheme and byte axes, splitTextForThread limit < 1 guard.
- BookmarksView initial load + loadMore both use AbortController with
  signal.aborted guards; ThreadEngagementPanel aborts on uri/kind change;
  PostLanguagePicker / EmojiPicker outside-click/Escape listeners are cleaned
  up.
- lib/storage.ts, lib/time.ts (postSortAt / postSortTime NaN + skew handling),
  lib/url.ts (safeHttpUrl scheme rejection), lib/feed-meta.ts, lib/feed-order.ts
  (stable sort + unknown-rank fallback) — clean.
- tsconfig.json strict settings (strict, noUnusedLocals, noUnusedParameters,
  forceConsistentCasingInFileNames) are appropriately tight; .gitignore
  correctly ignores logs / .env\* / dist/ / node_modules/ / .vite/ /
  tsconfig.tsbuildinfo — no sensitive files tracked.
