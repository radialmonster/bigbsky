# BigBsky - Durable Lessons

Reusable knowledge for future sessions. NOT a changelog: no per-session history, no "what we did" notes. Append a bullet only when a future session would otherwise re-learn it. Things to DO belong in GitHub issues; things to KNOW belong here. Keep it lean - if this file starts reading like a changelog, trim it.

## Extracting code out of App.tsx (#18)
- Before moving a component/lib module out of App.tsx, grep the verifiers: `rg "<name|className" scripts/verify-*.mjs`. Retire any matching reader regex in the SAME commit or `npm run build` fails. Not every move has a regex - check first, don't assume.
- Splice large regions with a tiny Node script (read App.tsx, slice by 1-indexed line range, write new file, join-remove the range) to guarantee verbatim bodies; verify boundaries with `rg`/`read` and run `tsc` immediately after.
- Shared consts/types used by an extracted component AND by remaining App code move WITH the component and are re-exported; App re-imports them. Don't leave a copy behind.
- Drop now-unused App imports after a move, but re-grep first - a moved component may not be its only caller.

## Reusable hooks/modules (use these; don't re-hand-roll)
- `src/features/common/useDismissMenu.ts` - outside-click/Escape dismiss for menus/popovers.
- `src/features/common/useCursorPaged.ts` - fetch-on-mount + load-more state machine.
- `src/features/common/useSharePost.ts` + `shareButtonLabel` - Web Share + clipboard fallback.
- `src/features/common/useMediaReveal.ts` - media-reveal gating (ShowNsfwContext/ShowMediaContext).
- `src/features/common/useResetTimeout.ts` - transient timer state.
- `src/lib/cache.ts` (`Cache`/`createCache`/`useCache`) - any keyed data cache; the auth-wipe ORDERING CONTRACT comment is load-bearing - preserve it.
- `src/lib/loaders.ts` - data loader factories; add new loaders + tests here, not inline in App.
- `src/features/post/RichText.tsx` (`renderRichText`) - any surface needing facets imports it; no inline copies.

## Live smoke / dev loop
- `location.href` navigation is a FULL reload (cold feed, empty caches). To exercise the cache-hit/anchored-restore path use in-app navigation (click a post, then `history.back()`).
- Scroll restore: the scroller is `.timeline`; programmatic `scrollTop` gets re-adjusted by measurement, so set it, let it settle a few seconds, and assert the settled value.
- `$PID` is read-only in PowerShell - when killing the port-5173 dev server (find the listener's OwningProcess), use another variable name.

## Scroll restore (the content-anchored model)
- Pixel-offset restore fights the virtual list: it re-asserts a stale target -> rows re-mount at the too-tall default estimate -> measure shorter -> totalHeight shrinks -> scrollTop clamps back. The fix anchors to the top-visible post URI (+ intra-row offset), recomputes from live measured layout each frame, clamps to live totalHeight.
- If a future scroll bug shows "restore never converges / lands near top", apply the anchored pattern - do NOT just widen the rAF budget (tried and reverted).
- A restore path that runs BEFORE the surface finishes loading needs the anchored path, not the fixed-frame pixel loop: the pixel path's ~30-frame budget expires while async rows/images still grow, so it clamps to ~0. The cold-load feed restore now routes through `restoreScrollFor` (which falls back to the pixel path when no anchor is saved) exactly like the cache-hit and profile paths - don't add a fresh raw-pixel call site.
- Live smoke gotcha: the public Discover feed is dynamic, so a saved anchor post may not be present in the freshly-fetched rows after a cold reload; the anchored effect then falls back to the pixel offset clamped against the shorter cold-load content. Assert "restored non-zero" rather than "top-visible post URI matches the anchor" on a live feed.

## jsdom / vitest gotchas
- `Element.prototype.scrollIntoView`, `window.matchMedia`, `window.requestAnimationFrame`, `URL.createObjectURL/revokeObjectURL`, and `navigator.share`/`navigator.clipboard` are NOT implemented in jsdom - stub in `beforeAll`/`beforeEach` as needed.
- `<form>` has no implicit `role="form"` without an accessible name - submit via `container.querySelector("form")`.
- jest-dom's `toHaveValue` is NOT registered - assert `(el as HTMLInputElement).value` / `(el as HTMLSelectElement).value` directly.
- vitest mocks accumulate call counts across `it()` blocks in a file - `mockReset()` in `beforeEach`. But a describe-level reset combined with `mockImplementation(() => Promise.reject(...))` makes jsdom attribute the rejection as unhandled and fail the test even though a `.catch` consumes it - reset inside the specific test instead.
- Use RTL's `waitFor`, not `vi.waitFor` (the vitest variant does not wrap updates in `act()`, so suites fail with "not wrapped in act").
- A controlled component needs a stateful Harness in tests (a stubbed `onChange` never updates internal state, so disabled/publish assertions silently fail).
- `vitest globals: true` must stay on in vite.config.ts - RTL's `afterEach` cleanup depends on it.
- Text that lives in one node (e.g. a `<small>` holding "User list · 12 members") - assert `container.querySelector(...).textContent`, not `getByText`.

## OAuth / auth
- BigBsky uses the atproto SDK's default "fragment" response mode - callback params arrive in `location.hash`, NOT `search`. `looksLikeOAuthCallback()` reads the hash and gates on a redirect-URI pathname. Never "restrict to search" to fix a false positive.

## Markdown safety
- Backticks in double-quoted PowerShell strings corrupt GitHub/PLAN.md bodies; non-ASCII (em-dashes, arrows, ellipses) mangles through the PowerShell console. See nextsessionprompt.md "GITHUB MARKDOWN SAFETY ON POWERSHELL" for the full rules (single-quoted here-strings, body-file, Node round-trip for edits).
