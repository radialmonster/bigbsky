

read the open GitHub issues (gh issue list --repo radialmonster/bigbsky) and proceed to work on a task and implement.  add any follow ups as new GitHub issues for any issue you see that can be improved or fixed also.  if your task is fully complete, you may close its issue. make a commit to main when done.  you have browser access and may have oauth already.  kill any running servers you started for testing or verification.

ISSUE CLAIMING (always):
- Claim an issue with the `claimed` label as soon as you start working on it: `gh issue edit <N> --repo radialmonster/bigbsky --add-label claimed`
- Do NOT start work on any issue that already has the `claimed` label (someone else — or a prior parallel session — is on it). Check labels before picking: `gh issue list --repo radialmonster/bigbsky --state open --json number,title,labels`
- Remove the `claimed` label when you finish (task done/closed, or you stop working on it): `gh issue edit <N> --repo radialmonster/bigbsky --remove-label claimed`
- Claim one issue at a time; if you delegate to sub-agents, each sub-agent must claim its issue the same way so parallel sessions never collide.

ISSUE STRUCTURE (GitHub-native, honor it): BigBsky issues use GitHub's native task/sub-issue and dependency features. Use them to organize work; honor them when picking and working:
- **Sub-issues / tasks:** a parent issue can have sub-issues (its task breakdown; parent shows a progress tracker). E.g. #18 (App.tsx decomposition) has #7, #19, #20 as sub-issues. When work naturally decomposes into a parent + pieces, create the parent and attach sub-issues: `echo '{"sub_issue_id": <numeric id>}' | gh api --method POST repos/radialmonster/bigbsky/issues/<PARENT>/sub_issues --input -` (numeric id, NOT the #number — get it via `gh api repos/radialmonster/bigbsky/issues/<N> --jq .id`). List them: `gh api repos/radialmonster/bigbsky/issues/<N>/sub_issues`.
- **Dependencies (blocked by / blocking):** an issue can be formally blocked by another (e.g. #18 is blocked by #19). Record real ordering constraints instead of prose notes: `echo '{"issue_id": <numeric id>}' | gh api --method POST repos/radialmonster/bigbsky/issues/<N>/dependencies/blocked_by --input -`. View: `gh issue view <N> --json blockedBy,blocking`.
- **Picking work — honor the structure:** prefer issues that are NOT blocked (no unresolved `blockedBy`) and whose parent is claimed/started over ones that depend on unstarted work. Do not start a parent issue as if its sub-issues don't exist — a parent with sub-issues is a tracking/task-list issue, so work its sub-issues instead (claim + finish each), and only close the parent when all sub-issues are closed.
- **Working — honor the structure:** when you finish an issue that blocks others (or is a sub-issue), update its dependents/parent: remove now-satisfied `blocked_by` links (`DELETE /repos/{owner}/{repo}/issues/<N>/dependencies/blocked_by/<blockingId>`) and re-check whether the parent can be closed. When an issue turns out to be bigger than a single task, create sub-issues under it rather than leaving it sprawled.
- Task-list checkboxes in an issue body (`- [ ]`) are also fine for lightweight intra-issue tracking; keep them checked as you go.

GITHUB MARKDOWN SAFETY ON POWERSHELL (mandatory):
- Never build an issue/comment body containing Markdown backticks with a double-quoted PowerShell string or `@"..."@` here-string. PowerShell treats backticks as escapes (`b` = backspace, `f` = form feed, `n` = newline, `v` = vertical tab, etc.); a preceding backslash does not protect them and will corrupt the GitHub body with control characters.
- Build Markdown bodies with a literal single-quoted here-string (`@'` ... `'@`), write them with `Set-Content -Encoding utf8`, and pass the file using `gh issue create --body-file <file>` / `gh issue edit --body-file <file>`. Plain single-quoted strings are also safe when practical.
- Before submitting, reject accidental control characters other than tab/newline/carriage return: `if ($body -match '[\x00-\x08\x0B\x0C\x0E-\x1F]') { throw 'GitHub body contains control characters' }`. Preview the body file once with `Get-Content -Raw`.

SHIPPING (when an issue's fix is verified):
- Do NOT open a PR. Commit to main and push directly — that's the deploy path.
- Pushing to main is what deploys: Cloudflare Pages auto-builds/deploys from the main branch. So after `git push origin main`, the fix goes live on the deployed origin automatically.
- Finish flow per issue: remove the `claimed` label, close the issue (`gh issue close <N> --repo radialmonster/bigbsky`), then commit + push to main.
- Verify a build/test/`check` gate is green before pushing (never push a known-red state; a broken main auto-deploys a broken site).

WHAT TO WORK ON THIS SESSION (forward-looking; use your judgement, keep rotating areas, batch small fixes):
- Pick from the open GitHub issues (currently #1–#27). Skip any that already carry the `claimed` label (check `--json number,title,labels`). Highlights:
  - #8 (Bookmarks scroll-restore) is CLOSED — the content-anchored restore shipped. Don't reopen; #24 (mobile touch-viewport confirmation of the anchored restore) is open but needs a healthy deploy + signed-in CDP — the origin is stale (#23), so it's low-priority until the operator relinks Cloudflare.
  - App.tsx decomposition (#18) — components moved so far into src/features/**: feed cluster (AutoLoadMoreButton/PostRowFallback/findScrollParent/BackToTopButton/HomeSourcePicker/DiscoverFeedCard), common cluster (Avatar/State/MediaGate/ToastHost/useResetTimeout/useDismissMenu/useCursorPaged), rightRail (ProfileContextPanel/RecentPanel/FeedContextPanel/TrendingPanel/PinnedSearchesPanel/PinnedProfilesPanel/DevInspector), post leaves + cluster (ReplyLimitedNotice, RichText renderRichText, ExternalLinkCard, UnsupportedEmbedNotice, useReplyGate, ThreadEngagementPanel, ImageViewer + ImageViewerState/ImageViewerImage types; postBskyUrl -> src/lib/url), profile (ProfileDetailHeader + profileTabs/ProfileTab, ProfileFeedsTab, ProfileListsTab + listPurposeLabel), explore (ExploreTrendingTopics, ExploreDiscoverFeeds — new `src/features/explore/`), and the FULL composer cluster (PostComposer + PostLanguagePicker + EmojiPicker + the post-language helpers/POST_LANGUAGE_OPTIONS/languageDisplayName/readReplyDefaultLanguage/ComposerImageState → src/features/composer/PostComposer.tsx; App re-imports PostComposer/POST_LANGUAGE_OPTIONS/languageDisplayName/composerDraftStorageKey/PostRefValue). The nine `useRef<Record>` loader caches are DONE (slice 15 → `src/lib/cache.ts`; see lesson below); the residual cache work (scroll-cache migration + clear-all centralization + loader extraction) is tracked in #27. Remaining: the ThreadView cluster + the PostCard/media cluster (BOTH blocked until #7 — see lesson below), and the mega-stylesheet split.
  - Replace regex source-text tests (#19) — reader script is at 52 assertions, layout script still 44. Continue retiring reader regexes as components move; the layout-script App.tsx regexes (VirtualPostList measurement + the media aspectRatio/videoFrameStyle pins) can only be swapped once #7 lands.
  - CSS dead-selector sweep (#20) + CSS-token investigation (#7) — #7 is claimed; do NOT touch `src/styles.css` or `scripts/verify-layout-behavior.mjs` until it lands.
  - Composer GIFs/quote/video (#10), saved-feed-order cross-client confirm (#16), report/security-posture doc (#15), and the oEmbed/Firehose/Service-Auth scoping writeups (#11/#12/#14) are investigate-and-decide items.
  - #5/#6/#22 are open-ended improvement/triage items. IMPORTANT: #23 reports the deployed origin is STALE (pushes since ~07-02 not deploying; no Cloudflare check-runs/webhooks) — operator/infra work (no CLOUDFLARE_API_TOKEN in this env); surface it and move on, don't burn the session.
  - RECOMMENDED NEXT BATCH (in rough priority):
    (a) #18 — the cache layer is DONE (slice 15, `src/lib/cache.ts`, 391 tests). The `ThreadView`/`renderThreadNode` + `CombinedThreadViewCard`/`LongThreadCard` cluster is the next natural target BUT it depends on `PostCard`/`PostEmbeds` (the #7-blocked media cluster), so it stays put until #7 lands — do NOT attempt it (circular import). The genuinely extractable next slice is **#27 item 2**: centralize the three duplicated nine-cache `clear()` sequences in App.tsx (auth-wipe effect, `handleSignOut`, `removePostFromState`) into one `clearAllDataCaches()` — small, feasible now, touches no verify scripts. Bigger #27 items (scroll-cache migration, loader extraction) need #19 regex swaps first.
    (b) #19 continues alongside every extraction (52 reader + 44 layout regexes left). #26 is CLOSED (useCursorPaged dedup shipped).
    (c) after #7 lands (claimed-check first): #20 dead-selector sweep + co-locate each extracted component's CSS slice, AND finally extract the ThreadView + PostCard/media cluster (PostCard/PostEmbeds/QuotedPostCard/PostImageVideoMedia/VideoEmbedCard/MediaOnlyPostCard) by swapping the layout-script media regexes for RTL tests.
    (d) investigate-and-decide: #10, #16, #15, #11/#12/#14.
  - Leave #5/#6/#22 open-ended; file a new GitHub issue for anything you notice but defer (e.g. the media-cluster blocking constraint is already documented on #18 — don't duplicate it).
- NEW on the deployed origin once Cloudflare rebuilds — verify the shipped hardening: (a) the Content-Security-Policy header from public/_headers is actually served and the live site still works (app boots, feed/trending render, engagement panels load, no CSP violations in the console — validated locally by serving the production bundle under the exact CSP, but the live origin is the real gate); (b) the service worker derives paths from its registration scope and registration is gated behind PROD (dev no longer registers one — expected now); (c) the boot failure-detector lives in public/boot-error.js (external, defer) instead of an inline script.
- Anything on the deployed origin that needs auth (OAuth writes, moderation, composer) still requires commit + push + operator sign-in; never promise local auth verification.
- Leave the worktree with no unrelated revert; keep changes scoped; file a follow-up GitHub issue for anything you notice but defer.



Run all shell commands with:

workdir: N:\Projects\bigbsky

login: false



Required startup reads:

1. Get-Content -LiteralPath docs\PLAN.md
2. git status --short --branch
3. rg --files
4. gh issue list --repo radialmonster/bigbsky --state open --json number,title,labels



Command retry rules:

\- If any required startup read fails for any reason, retry the failed command once before stopping or diagnosing.

\- If multiple startup reads fail in a parallel batch, retry the failed startup reads once.

\- Do not retry indefinitely.



Important sandbox case:

If any shell command fails before PowerShell starts with:

windows sandbox: runner error: CreateProcessAsUserW failed: 5



treat it as a transient Codex command-runner/process-launch failure first. Retry all required startup reads once in the same session with the same workdir/login settings.



If the retry also fails with the same pre-PowerShell error, report blocked for that turn. However, if the environment is later relaunched, permissions change to unrestricted/disabled, or the user asks to continue, run the required startup reads again and continue the automation. Do not treat the earlier blocked result as final after the environment changes.



Do not diagnose this as a repo path, PowerShell, npm, or git problem unless PowerShell actually starts and the command itself fails after the retry.



After reading:

\- Use the open GitHub issues and docs\PLAN.md as the source of truth for what has been done and what is next; there is no separate memory.md file.

\- Inspect docs\PLAN.md for the next unfinished item that is feasible in the static SPA.

\- Prefer items that can be implemented, verified, documented in the plan, committed, and pushed in one run.

\- Avoid duplicating the most recent completed work.

\- If the worktree has unrelated user changes, do not revert them.



Implementation rules:

\- Read the relevant source before editing.

\- Use apply_patch for manual repo edits.

\- Keep changes scoped to the selected plan item.

\- Update docs\PLAN.md to mark the completed or newly improved status.

\- Run npm run build.

\- If npm run build fails, retry it once after checking whether the failure was transient.

\- If build still fails, fix what is in scope and rerun.

\- If still blocked, record the failure clearly.



Before finishing:

\- Record the run in the project's tracking files (GitHub issues / docs\PLAN.md status lines) with what changed, what was verified, commit hash if one was created, whether push succeeded, current run time, and useful notes for the next run.

\- Return a short summary with files changed, verification result, and commit/push status.

powershell can take some time to start so check again in 10 seconds. if it doesn twork, try again. you keep saying it doesnt work, you need unrestricted access.  all i do is say try again and you try again and you say oh you fixed it.  i didn't do shit.



If the session did not direct you what to work on, then check for open issues on github (gh issue list --repo radialmonster/bigbsky --state open --json number,title,labels), skip any with the `claimed` label, and work on some issues.  If there are no open issues, then take this opportunity to perform a code review, pick a random function in our project and deep dive it to find bugs, issues, deduplication, simplification, enhance security, etc, and create an issue for each thing found to do that in a future session.

You are encouraged to delegate tasks to agents to work on individual tasks, this will save tokens on this main session. Your job would be to coordinate those agents, verify their work, you can also send their returned work out to another agent and instruct that agent to 'roast' and code review what the other agent did.  Your goal is to manage these tasks and keep this project moving forward.  Minimize (eliminate if possible) blockers requiring a human to answer a question or make a decision.  You are the ai coder, there will be no human ai coder to check anything behind you, you are encouraged to check yourself depending on what this particular project is about, for example by opening the site, spin up a dev server and check there. you can use Node to open chrome in debug mode and remote control it for example.  If during this session you do start a server or process or something, and it was just temporary, ensure you terminate that process at session end. ensure temporary working folders or files you created are removed. 

at this session end update nextsessionprompt.md with any corrections about how to work on our project effectively, use this session as lessons learned type of thing.  add also to give a clue to the next session on what it should work on.  do not be super specific, you can give it general goal, issue numbers, tasks to do.  give it a batch, and also leave it open ended to use its judgement for improvements also.  note nextsessionprompt.md is not a changelog, do not put in there what you did work on, only have forward looking items.  The next session will start with only 'read nextsessionprompt.md and proceed' so put in there useful guidance for it to do that.

## General session-end rule: commit and push (shared baseline)

This is the shared baseline for all projects; where the project-specific instructions above are more detailed (branch/PR workflow, multi-repo, worktree isolation, GitHub-native issue tracking, deploy path), follow those specifics on top of this.

**BigBsky override (project-specific):** there is NO PR/branch workflow — commit to `main` and push directly. Pushing to `main` is what deploys: Cloudflare Pages auto-builds/deploys from `main`, so a pushed fix goes live automatically. Because of that, pushing is the expected/required end of every completed task (not just "when safe"), and the verification gate MUST be green first — a red push auto-deploys a broken site. This override applies to the "only when safe and expected" language in step 4 below: here it is always expected (the deploy), so treat step 4 as "push the green commit to main; only hold if the gate is red or secrets are involved."

At the end of every session, before wrapping up:

1. **Commit if this directory is a Git repository.** Run `git status --short --branch` and review the diff. Stage only your own intended changes — never unrelated user changes, generated/build output, logs, temp files, or anything containing credentials, secrets, or tokens.
2. **Verify before committing.** Run this project's verification gate (its build/test/lint/`check` command) and only commit when it passes. Do not commit a known-red state.
3. **Keep commits clean and scoped.** Use a concise message describing what and why ("fix:", "feat:", "docs:"). One logical unit per commit; don't bundle unrelated work. Never force-push, amend shared history, or skip hooks.
4. **Push to GitHub only when it is safe and expected.** If this repo has an `origin` remote and the project normally shares work there, push the verified commit — but only when safe: no secrets staged, no force-push required, the branch isn't diverged in a way that would clobber others, and the work is at a coherent, complete checkpoint. If anything is ambiguous or risky, commit locally and say in your summary that you did not push and why.
5. **Record the run.** Update the project's handoff file (GitHub issues / docs/PLAN.md status lines, docs/notes.md, automation memory, etc.) with what changed, what was verified, the commit hash, push status, and current run time. (Do not recreate memory.md — it was removed to save startup tokens; keep handoff notes in the project's existing tracking files.)
6. **Refresh nextsessionprompt.md** with any durable lesson and a forward-looking hint for the next session — not a changelog of what you did.
7. **Clean up.** Terminate any servers, dev processes, or verification browsers you started, and remove temporary folders/files you created. Confirm with `git status` that no strays were left.

## Windows shell note: launching npm (shared)

On Windows, `npm` is a `.cmd` shim, not a real executable. `Start-Process -FilePath "npm" ...` fails with "%1 is not a valid Win32 application." Use `npm.cmd` (or invoke through `cmd /c`) instead:

- `Start-Process -FilePath "npm.cmd" -ArgumentList "run","dev" -WorkingDirectory "N:\Projects\bigbsky" -PassThru`
- or `& npm.cmd run dev`

The same applies to `npx` (use `npx.cmd`) and any other `.cmd`-shimmed CLI when launching via `Start-Process`/CreateProcess.

## Local browser + dev-server tooling

- To start the local BigBsky dev server, run `npm run dev` (or `npm.cmd run dev`) from the repo root. Vite serves it at `http://127.0.0.1:5173/` by default.
- For browser checks, first see whether Chrome dev mode is already running on port 9222. Check processes for `chrome.exe` with `--remote-debugging-port=9222`, then verify `http://127.0.0.1:9222/json/version`. If it is running, use that browser instead of starting another one. If it is not running, start Chrome with:
  `Start-Process "C:\Program Files\Google\Chrome\Application\chrome.exe" -ArgumentList "--remote-debugging-port=9222 --user-data-dir=$env:LOCALAPPDATA\Codex\ChromeProfiles\fb-tools-test --start-maximized --auto-open-devtools-for-tabs --disable-first-run-ui --no-first-run about:blank" -WindowStyle Hidden`

## Watchdog loop note (shared)

This repo is driven by `loop.bat` -> `loop.ps1`, a loop that spawns `opencode run --auto` on this prompt file, then waits before the next session. The `.ps1` (shared verbatim across all projects) wraps the session in a watchdog: it kills the opencode process tree if there is no output for `IdleKillMinutes` (default 15), enforces a hard per-session cap (`HardTimeoutMinutes`, default 120), reaps orphan child processes (e.g. dev servers that would hold the stdout pipe open), and writes heartbeats to `run.log`. Watchdog kills are recorded in `.loop-tmp/last-killed.txt` and surfaced at the start of the next iteration. `run.log`, `run.log.*`, and `.loop-tmp/` are gitignored. Stop cleanly by dropping a file at `.loop-tmp/stop-after.flag` or pressing Q in the loop window. Tune with `-IdleKillMinutes`/`-HardTimeoutMinutes`/`-DelayMinutes` on the bat command line.

## Lessons learned / forward-looking guidance (2026-08-01 session)

- **Local live verification works well for scroll/reader features.** `npm run dev` serves on `127.0.0.1:5173`; the already-running Chrome on `--remote-debugging-port=9222` can be driven with `node scripts/cdp.mjs eval ...` (open a new tab first via `Invoke-RestMethod -Method Put 'http://127.0.0.1:9222/json/new?<url>'`, and remember `scripts/cdp.mjs` only talks to an http(s) page target — `about:blank` tabs are ignored). Kill the dev server by finding the port 5173 listener's OwningProcess and `Stop-Process` it (note: `$PID` is read-only in PowerShell — use another variable name). A quick smoke loop that works: open a tab at the dev server, wait a few seconds, `eval` a summary (`{bootError, .state.error count, .post-card count, .avatar count}`), then `console 6` to confirm zero errors.
- **Content-anchored scroll restore is now the model for fixing scroll fights.** Root cause of #8: pixel-offset restore re-asserts a stale target, which re-mounts rows at the too-tall default estimate → they measure shorter → totalHeight shrinks → scrollTop clamps back. The fix anchors to the top-visible post URI (+ intra-row offset), recomputes the target from the live measured row layout each frame, and clamps against the live totalHeight. If any future scroll bug shows a "restore never converges / lands near top" symptom, apply this pattern — do NOT just widen the rAF time budget (that was tried and reverted).
- **The worktree can carry unrelated user changes** (e.g. `src/styles.css` + `scripts/verify-layout-behavior.mjs` still carry in-flight #7 CSS-token edits — do NOT touch or stage those two files until #7 lands). Stage only your own files with explicit `git add <file>` paths and never `git add -A`. A user change to a verify script can make the build fail for reasons outside your scope — read the failing guardrail before touching it, and update guardrails only when your change legitimately supersedes what they assert.
- **Deploy is stale (#23) — don't trust the live origin until the operator relinks Cloudflare Pages.** Local `npm run build` + `dist/` inspection + CDP on the dev server are the reliable verification gates in the meantime. Verify scroll/reader/anchor behavior locally and note that the origin will be stale until the Cloudflare integration is fixed.
- **The component-extraction pattern for #18 is proven and scaling.** Five slices landed: `src/features/feed/AutoLoadMoreButton.tsx` (AutoLoadMoreButton + PostRowFallback + findScrollParent), the leaf/state cluster (`Avatar`, `LoadingState`, `ErrorState`, `SensitiveMediaGate`, `MediaHiddenButton`, `ReplyLimitedNotice`) into `src/features/common/*` + `src/features/post/`, the small presentational cluster (`BackToTopButton` → `src/features/feed/`, `ToastHost` + its `ToastKind`/`ToastMessage` types → `src/features/common/`, `ProfileContextPanel` → `src/features/rightRail/`, `RateLimitState`/`EmptyState`/`EndOfFeedCard` appended to `src/features/common/State.tsx`), the post-card leaf utilities (RichText/ExternalLinkCard/UnsupportedEmbedNotice/useReplyGate/postBskyUrl), and the right-rail + last small presentational cluster (`RecentPanel`+`RecentItem`, `FeedContextPanel`+`EntityCache`, `TrendingPanel`, `PinnedSearchesPanel`, `PinnedProfilesPanel` → `src/features/rightRail/`, `HomeSourcePicker`+`HomeOption`, `DiscoverFeedCard` → `src/features/feed/`, `ProfileDetailHeader`+`profileTabs`/`ProfileTab` → `src/features/profile/`). Each component gets a co-located RTL suite (`src/**/*.test.tsx`, jsdom env already configured; `@testing-library/react` is a devDependency). CRITICAL gotcha: `npm run build` runs `scripts/verify-reader-behavior.mjs`/`verify-layout-behavior.mjs`, whose regexes match App.tsx source text — when you move a component out of App.tsx, check those scripts for regexes matching its moved source and delete/swap them in the same commit or the build fails. IMPORTANT caveat: not every extraction needs a regex swap — check `rg "<ComponentName|className" scripts/verify-*.mjs` before assuming; this slice retired the `TrendingPanel` getTrendingTopics definition and both `profileTabs` source pins, but the other moved components had none. Also: jsdom's a11y tree hides `alt=""` (decorative) images from `getByRole("img")` — query `container.querySelector("img.avatar")` instead. Drop now-unused imports at the extraction site (e.g. App's `Check` lucide import became unused after HomeSourcePicker moved out). When a moved component's types are shared with App (RecentItem/EntityCache/HomeOption/profileTabs/ProfileTab), export them from the new module and re-import into App rather than leaving them behind. Shared hooks used by both App and extracted components (`useResetTimeout`) hoist to `src/features/common/`. CSS co-location stays deferred (the mega-stylesheet split is the big remaining #18 risk) — `src/styles.css` is untouched until #7 lands.
- **jsdom test gotchas to remember:** `Element.prototype.scrollIntoView` is not implemented — stub it in a `beforeAll` (HomeSourcePicker suite) or tests fail with `node?.scrollIntoView is not a function`. `screen.getByText("Following")` can match both a group heading and an option label — scope with `within(listbox)` or `container.querySelector(".home-picker-group")` when asserting group sections. A component that fetches on mount (TrendingPanel) needs `waitFor` for the post-rejection error state, not a synchronous assertion. Mock api functions with `vi.mock("../../api", ...)` + `vi.hoisted` when the component triggers network calls.
- **vitest `globals: true` is now on in vite.config.ts** (2026-08-01) so `@testing-library/react` registers its `afterEach` cleanup — without it, RTL suites silently accumulate rendered DOM between tests in a file and multi-render tests fail with "Found multiple elements". Keep it on; don't rely on per-test `screen` state carrying over between `it()` blocks.
- **The layout verifier pins the media cluster to App.tsx until #7 lands — that's the current hard boundary for #18.** `scripts/verify-layout-behavior.mjs` (which carries the in-flight #7 CSS-token edits, so it's off-limits) asserts App.tsx source for `image.aspectRatio?.width` / `video.aspectRatio?.width` / `const videoFrameStyle` — i.e. `PostImageVideoMedia`, `MediaOnlyPostCard`, `QuotedPostCard`, `VideoEmbedCard`, and transitively `PostEmbeds`/`PostCard` cannot be extracted (and importing them back from App would be a circular dep). Leaf components that trip NO layout regex (`ExternalLinkCard`, `UnsupportedEmbedNotice`, `useReplyGate`, `renderRichText`, `postBskyUrl`) moved fine. Plan: after #7 lands, extract the media cluster and swap the layout regexes for RTL tests (that also advances #19). Meanwhile extract only components that trip reader-script regexes (safe to retire) or none at all.
- **Housekeeping: #17 and #21 are CLOSED as accepted-by-design records** (reply-count math caveat and readCollapsedFeedGroups passthrough, both documented inline). Don't reopen unless their call sites change. #25 is CLOSED (useDismissMenu hook shipped). #19 stays open (52 regex assertions in `verify-reader-behavior.mjs` + 44 in `verify-layout-behavior.mjs`; the latest slice retired 12 Explore/profile-tab defs+pins with the four co-located suites covering them) — continue the migration as you extract each component.
- **Rich-text rendering is now a single extracted module with a test suite.** `renderRichText` lives in `src/features/post/RichText.tsx` (segment selection stays pure in `src/richtext.ts`); `ExternalLinkCard`/`UnsupportedEmbedNotice`/`useReplyGate`/`postBskyUrl` are also in `src/features/post/` + `src/lib/url.ts`. When you add a new render surface that needs facets, import `renderRichText` from `./features/post/RichText` — don't reintroduce an inline copy. Note the useReplyGate reset is keyed to `post.uri` (a changed URI clears a stale limited-notice); tests must vary the rkey when testing that reset.
- **Bigger presentational components are now extractable — slice 13 (2026-08-01) moved `ThreadEngagementPanel` → `src/features/post/`, `DevInspector` → `src/features/rightRail/`, and `ImageViewer` + its shared `ImageViewerState`/`ImageViewerImage` types → `src/features/post/`.** Three reusable moves to repeat: (1) When a component imports App-local error/status helpers (`isRateLimit`/`rateLimitMessage`), hoist them to `src/api.ts` (error-classification over `ApiError` status belongs there) and import back into App — drop App's local copies. (2) For a very large component (~560-line ImageViewer), splice it out with a tiny Node script (read `src/App.tsx`, slice by 1-indexed line range, write the new file, then join-remove the range) rather than hand-copying — but verify the slice boundaries with `rg`/`read` before/after and run `tsc` immediately. (3) Shared types used at many App call sites should MOVE with the component and be re-exported (`export type` in the new module, `import ... type` back in App) — don't leave a copy behind. Also drop now-unused App imports after the move (this slice: `ApiError`, `Info`, `ReactPointerEvent`, `useLayoutEffect`, and `getLikes`/`getRepostedBy`/`getQuotes`). jsdom gotcha this slice: `window.matchMedia` is not implemented — stub it in a `beforeAll` for the ImageViewer suite (the component reads it to decide whether the info footer starts visible). Watch for a subtle PowerShell/Node gotcha when splicing large files: a bad `edit` that replaces a function body can leave a dangling fragment (this session left a stray `function threadDepthStyle... {` line at EOF) — always `tsc` right after a splice and `tail` the file.
- **The composer cluster extraction (slice 7, 2026-08-01) is the current model for stateful controlled-component suites.** `PostComposer` → `src/features/composer/PostComposer.tsx` along with its whole language/emoji support cluster (`PostLanguagePicker`, `EmojiPicker`, `POST_LANGUAGE_OPTIONS`, `languageDisplayName`, `readDefaultPostLanguage`, `readReplyDefaultLanguage`, `ComposerImageState`, the `bigbsky:post-language*` keys). App re-imports `PostComposer`, `POST_LANGUAGE_OPTIONS` + `languageDisplayName` (the Settings content-language selector uses them), `composerDraftStorageKey` (`readComposerDraft`), and the `PostRefValue` type — move those shared bits to the module and import back rather than leaving duplicates. Three App-local copies were removed (`PostRefValue`, `composerDraftStorageKey`, `replyDraftPrefix`). No reader/layout regexes matched the composer cluster (`rg "composer|language|emoji|draft|postLang" scripts/verify-*.mjs` came back clean) so none were retired this slice — check before assuming a swap is needed. **CRITICAL jsdom lesson for controlled components:** the new-post draft is lifted to App via `onDraftChange`, so a test that renders `PostComposer` with a stub `onDraftChange={vi.fn()}` never updates `hasContent` — disabled/publish assertions silently fail (the Post button stays disabled because the controlled draft never changes). Wrap it in a small stateful `Harness` component (`const [draft, setDraft] = useState(initial); <PostComposer draft={draft} onDraftChange={setDraft} .../>`) for any interaction test. Also stub `window.requestAnimationFrame` (the `insertAtCaret` emoji path restores caret via rAF) and `URL.createObjectURL`/`revokeObjectURL` (image attachment) in a `beforeAll`. PostComposer is signed-in gated so it does not render in the localhost preview — the composer surface can only be live-verified after deploy.
- **Recommended next batch (in rough priority):** (a) #18 — `PostComposer` is DONE (slice 7, ~803 lines moved); the `ExploreTrendingTopics`/`ExploreDiscoverFeeds`/`ProfileFeedsTab`/`ProfileListsTab` surfaces are DONE (slice 14, 28 tests, 12 reader regexes retired, reader script now 52); the `useRef<Record>` cache layer is DONE (slice 15, `src/lib/cache.ts`, 9 tests). The `ThreadView`/`renderThreadNode`+`CombinedThreadViewCard`/`LongThreadCard` cluster is the tempting next target but it depends on `PostCard`/`PostEmbeds` (the #7-blocked media cluster — importing them back would be a circular dep), so it MUST wait for #7. Next feasible slice: **#27 item 2 — centralize the three duplicated nine-cache `clear()` sequences** in App.tsx (auth-wipe effect, `handleSignOut`, `removePostFromState`) into one `clearAllDataCaches()` declared ABOVE the loader effects (keeps the ORDERING CONTRACT). (b) #19 continues alongside every extraction (52 reader + 44 layout regexes left). (c) after #7 lands (claimed-check first): #20 dead-selector sweep + CSS co-location + the media-cluster + ThreadView extraction with layout-regex swaps. (d) investigate-and-decide: #10 composer GIFs/quote/video, #16 saved-feed-order cross-client, #15 report/security doc, #11/#12/#14 oEmbed/Firehose/Service-Auth writeups. (e) #24 mobile touch-viewport confirmation of the anchored scroll restore — needs a healthy deploy + signed-in CDP; origin still stale per #23, so don't burn the session on it. Leave #5/#6/#22 open-ended and file a GitHub issue for anything you notice but defer.
- **Cache-layer pattern (slice 15, 2026-08-01) — reusable for any future keyed data cache.** `src/lib/cache.ts` exposes `Cache<T>` (`get`/`set`/`has`/`delete`/`clear`/`keys`/`entries`/`size`), `createCache<T>(entries?)` (Map-backed factory), and `useCache<T>(initializer?)` — a stable per-component-instance cache created once in a ref, so effect/callback reads don't retrigger renders (same semantics as the old mutable `useRef<Record<K,V>>`). Migrating a raw `useRef<Record<...>>` is mechanical: `ref.current[k] = v` → `cache.set(k, v)`, `ref.current[k]` → `cache.get(k)`, `delete ref.current[k]` → `cache.delete(k)`, `ref.current = {}` → `cache.clear()`, `Object.keys(ref.current)` → `cache.keys()`. The nine loader caches are migrated; `scrollCacheRef`/`scrollAnchorCacheRef` were deliberately left as refs because `scripts/verify-reader-behavior.mjs` pins `scrollCacheRef.current[...]` source text AND they are sessionStorage write-through mirrors — only migrate them after swapping those regexes (see #27). The App auth-wipe effect's ORDERING CONTRACT comment (cache keys carry no viewer DID; wipe must be declared above the loaders) is load-bearing — preserve it. Test the hook's stability with a re-rendering Harness (`fireEvent.click` a counter button, assert the same instance across renders); test per-instance isolation by rendering two seeds and asserting each starts empty.
- **Cursor-pagination dedup (2026-08-01, #26 closed): use `useCursorPaged<T>(loadPage)` for any future fetch-on-mount + load-more surface.** `src/features/common/useCursorPaged.ts` implements the whole state machine (first-page load + reset when `loadPage` identity changes — so an actor/query change recreating `loadPage` via `useCallback([actor])` auto-refetches; abort-on-teardown; load-more re-entrancy guard; load-more error retention with cursor kept for retry; explicit `reset()` via a tick). `loadPage` returns `{ items, cursor }`; the component renders `state.items`. Don't hand-roll `loadMoreBusyRef`/`loadMoreControllerRef` again — this hook owns them. Tests: render a Harness exposing status/items/cursor/error/loadMoreError testids + more/reset buttons; mock `isRateLimit`/`rateLimitMessage` from `../../api` via `vi.mock` + `vi.hoisted`, and `mockReset()` them in `beforeEach`.
- **Live-smoke gotcha: the profile tab buttons are NOT `.profile-tab`.** The container is `div.profile-tabs` and each tab is a plain `<button>` child (no per-button class) — select via `[...document.querySelector('.profile-tabs').children].find(b => b.textContent.trim().toLowerCase() === 'feeds')`. Also the left-rail **nav** item labeled "Feeds" navigates to the `/feeds` ExploreDiscoverFeeds route — don't confuse a nav click with switching the profile Feeds tab. Profile tab surfaces render `.discover-feeds` with aria-labels "Feeds created by this account"/"Lists created by this account".
- **`gh issue close` takes `--comment <string>`, not `--comment-file`.** To close with a Markdown body containing backticks from PowerShell, write the text to a file, read it into a variable (`$c = Get-Content -Raw -LiteralPath <file>`), and pass `--comment $c` — a variable value is not re-parsed, so backticks survive. (A double-quoted string containing a backtick trips PowerShell's `\`u` unicode-escape parser and kills the whole command line at parse time.)
- **The data-surface extraction pattern (slice 14, 2026-08-01) for fetch-on-mount + cursor-pagination components.** `ExploreTrendingTopics`/`ExploreDiscoverFeeds` moved into a new `src/features/explore/`; `ProfileFeedsTab`/`ProfileListsTab` (+ shared `listPurposeLabel`, re-imported by App for `BlueskyListCard`) moved into `src/features/profile/`. Three reusable moves: (1) Splice the region out with a tiny Node script (read `src/App.tsx`, slice by 1-indexed line range, write the new files, join-remove the range, add `export` + import headers) — this guarantees verbatim bodies; verify boundaries with `read`/`rg` before/after and run `tsc` immediately. (2) Retire the matching reader regexes in `scripts/verify-reader-behavior.mjs` in the SAME commit — but keep the App call-site pins (`profileTab === "feeds"/"lists"`) and api-export checks that still match; this slice retired 12 regexes (defs + loadPage/loadMore/refetch pins + `isCurateList`) and kept the tab-switch pins. (3) When a helper is shared between an extracted component and one left in App (`listPurposeLabel` used by `ProfileListsTab` AND `BlueskyListCard`), move it with the component, `export` it, and re-import into App — don't duplicate. **jsdom gotchas this slice:** vitest mocks accumulate call counts across `it()` blocks in a file (add `beforeEach(() => mocks.fn.mockReset())`) and a `getByText("User list · 12 members")` fails because that text lives in one `<small>` node (assert `body.textContent` on the `.discover-feed-body` container instead). Also: the reader verifier counts went 64 → 52 (12 retired); `getPopularFeedGenerators` stayed imported by App because `loadFeedSearch` still uses it (don't assume a moved component's only importer).
- **#25 shipped (2026-08-01): the outside-click/Escape dismiss pattern is now a shared `useDismissMenu` hook.** `useDismissMenu(rootRef, open, onClose, onEscape?)` in `src/features/common/useDismissMenu.ts` replaced triplicated document-listener wiring in `PostLanguagePicker`, `EmojiPicker`, and `HomeSourcePicker`. Pattern to reuse: keep callbacks in refs (the effect stays keyed on `open` exactly like the originals, so inline lambdas are safe), call `event.preventDefault()` on Escape, and expose `onEscape` for extra reset state (e.g. PostLanguagePicker's `showAll`). Test file must be `.tsx` (it renders a Harness). Any future menu/popover that needs dismiss-on-outside/Escape should use this hook, not re-add listeners.

