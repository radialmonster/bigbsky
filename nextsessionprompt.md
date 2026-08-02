Read the open GitHub issues (gh issue list --repo radialmonster/bigbsky) and proceed to work on a task and implement. Add any follow-ups as new GitHub issues for anything you see that can be improved or fixed. If your task is fully complete, you may close its issue. Make a commit to main when done. You have browser access and may have oauth already. Kill any running servers you started for testing or verification.

ISSUE CLAIMING (always):
- Claim an issue with the `claimed` label as soon as you start working on it: `gh issue edit <N> --repo radialmonster/bigbsky --add-label claimed`
- Do NOT start work on any issue that already has the `claimed` label (someone else - or a prior parallel session - is on it). Check labels before picking: `gh issue list --repo radialmonster/bigbsky --state open --json number,title,labels`
- Remove the `claimed` label as soon as you stop working on an issue - at end of session even if the issue is NOT closed yet, and again when you close it: `gh issue edit <N> --repo radialmonster/bigbsky --remove-label claimed`. A stale `claimed` on an open issue you've left, or on a closed issue, blocks future sessions and signals a live claim that isn't there. Before finishing, sweep for stragglers: `gh issue list --repo radialmonster/bigbsky --state all --label claimed --json number,title,state` and remove `claimed` from anything that isn't an actively-worked open issue.
- Claim one issue at a time; if you delegate to sub-agents, each sub-agent must claim its issue the same way so parallel sessions never collide.

ISSUE STRUCTURE (GitHub-native, honor it): BigBsky issues use GitHub's native task/sub-issue and dependency features. Use them to organize work; honor them when picking and working:
- Sub-issues / tasks: a parent issue can have sub-issues (its task breakdown; parent shows a progress tracker). When work naturally decomposes into a parent + pieces, create the parent and attach sub-issues: `echo '{"sub_issue_id": <numeric id>}' | gh api --method POST repos/radialmonster/bigbsky/issues/<PARENT>/sub_issues --input -` (numeric id, NOT the #number - get it via `gh api repos/radialmonster/bigbsky/issues/<N> --jq .id`). List them: `gh api repos/radialmonster/bigbsky/issues/<N>/sub_issues`.
- Dependencies (blocked by / blocking): an issue can be formally blocked by another. Record real ordering constraints instead of prose notes: `echo '{"issue_id": <numeric id>}' | gh api --method POST repos/radialmonster/bigbsky/issues/<N>/dependencies/blocked_by --input -`. View: `gh issue view <N> --json blockedBy,blocking`.
- Picking work - honor the structure: prefer issues that are NOT blocked (no unresolved `blockedBy`) and whose parent is claimed/started over ones that depend on unstarted work. Do not start a parent issue as if its sub-issues don't exist - a parent with sub-issues is a tracking/task-list issue, so work its sub-issues instead (claim + finish each), and only close the parent when all sub-issues are closed.
- Working - honor the structure: when you finish an issue that blocks others (or is a sub-issue), update its dependents/parent: remove now-satisfied `blocked_by` links (`DELETE /repos/{owner}/{repo}/issues/<N>/dependencies/blocked_by/<blockingId>`) and re-check whether the parent can be closed. When an issue turns out to be bigger than a single task, create sub-issues under it rather than leaving it sprawled.
- Task-list checkboxes in an issue body (`- [ ]`) are also fine for lightweight intra-issue tracking; keep them checked as you go.

GITHUB MARKDOWN SAFETY ON POWERSHELL (mandatory):
- Never build an issue/comment body containing Markdown backticks with a double-quoted PowerShell string or `@"..."@` here-string. PowerShell treats backticks as escapes (`b` = backspace, `f` = form feed, `n` = newline, `v` = vertical tab, etc.); a preceding backslash does not protect them and will corrupt the GitHub body with control characters.
- Build Markdown bodies with a literal single-quoted here-string (`@'` ... `'@`), write them with `Set-Content -Encoding utf8`, and pass the file using `gh issue create --body-file <file>` / `gh issue edit --body-file <file>`. Plain single-quoted strings are also safe when practical.
- Before submitting, reject accidental control characters other than tab/newline/carriage return: `if ($body -match '[\x00-\x08\x0B\x0C\x0E-\x1F]') { throw 'GitHub body contains control characters' }`. Preview the body file once with `Get-Content -Raw`.
- UTF-8 characters (em-dashes, arrows, ellipses) get mangled into `????`/box-drawing garbage when a PowerShell here-string or console pipeline round-trips them. Never build a body by pasting em-dashes/arrows/ellipses through the console. Prefer plain ASCII in issue bodies (write `->` not the U+2192 arrow character, `-` not an en-dash, `...` not an ellipsis). If you must include non-ASCII (e.g. a range like `1424-3960`), read + edit the body entirely in Node so it stays UTF-8 end-to-end: fetch with `gh api repos/radialmonster/bigbsky/issues/<N> --jq .body`, modify in a Node script, `fs.writeFileSync(tmp, body, 'utf8')`, then `gh issue edit <N> --body-file <tmp>`. When appending a progress note to an existing issue body, always round-trip through Node - do NOT re-type the whole body through PowerShell (that re-mangles every special char). Verify after: `gh api ... --jq .body` should contain no `?`-runs or box-drawing chars.
- `gh issue close` takes `--comment <string>`, not `--comment-file`. To close with a Markdown body containing backticks from PowerShell, write the text to a file, read it into a variable (`$c = Get-Content -Raw -LiteralPath <file>`), and pass `--comment $c` - a variable value is not re-parsed, so backticks survive.
- docs/PLAN.md uses unicode em-dashes and arrows - append carefully. Anchor on ASCII-only text (e.g. a section heading) or round-trip through a Node script; never re-type the unicode characters through PowerShell or an edit tool unless you reproduce them exactly.

WORKTREE HYGIENE (mandatory):
- The worktree can carry unrelated user changes. Stage only your own files with explicit `git add <file>` paths, NEVER `git add -A`. Inspect `git diff` before committing.
- Current worktree state (verify again at session start): as of 2026-08-01 the tree is CLEAN and in sync with origin/main; the #7 token step (src/styles.css + scripts/verify-layout-behavior.mjs) is committed + pushed, so those two files are no longer off-limits. loop.bat/loop.ps1 are the shared watchdog loop; run.log* + .loop-tmp are gitignored. Do not revert unrelated user changes.
- A user change to a verify script can make the build fail for reasons outside your scope - read the failing guardrail before touching it, and update guardrails only when your change legitimately supersedes what they assert.
- Never commit secrets, tokens, build output, logs, temp files, or anything containing credentials.

SHIPPING (when an issue's fix is verified):
- Do NOT open a PR. Commit to main and push directly - that is the deploy path. Cloudflare Pages auto-builds/deploys from main, so a pushed fix goes live automatically.
- Finish flow per issue: remove the `claimed` label, close the issue (`gh issue close <N> --repo radialmonster/bigbsky`), then commit + push to main.
- Verify a build/test/`check` gate is green before pushing (never push a known-red state; a broken main auto-deploys a broken site). Gate: `npm run build` (runs tsc + verifiers), `npm run test`, `tsc --noEmit`.
- #23 (stale origin) is CLOSED as of 2026-08-01. Re-verify on the live origin once Cloudflare rebuilds: app boots, feed/trending render, engagement panels load, no CSP violations in the console; the service worker registers only in PROD; the boot failure-detector lives in public/boot-error.js. Anything needing auth (OAuth writes, moderation, composer) requires commit + push + operator sign-in; never promise local auth verification.

WHAT TO WORK ON THIS SESSION (forward-looking; use your judgement, keep rotating areas, batch small fixes):
- Pick from the open GitHub issues. Skip any that already carry the `claimed` label (check `--json number,title,labels`). Highlights:
  - #18/#19 (App.tsx decomposition + regex->behavioral) is the structural track, and the #7 block is GONE: #7 is CLOSED and all identical-value CSS tokenization landed (app-shell tracks, timeline/thread geometry, card min-widths, and media sizing: --media-max-height / --media-only-max-height / --video-min-height / --link-card-thumb). The media cluster is now UNBLOCKED. VideoEmbedCard is already extracted (first slice) with its video layout regexes retired; the two video aspect-ratio pins were swapped for a behavioral test. Continue the media cluster in order: PostImageVideoMedia (note: the layout verifier's image.aspectRatio pin still targets App.tsx until it moves), then MediaOnlyPostCard, PostEmbeds, PostCard, QuotedPostCard, then ThreadView/renderThreadNode + CombinedThreadViewCard/LongThreadCard (they depend on the media cluster, so move it first). Before each move, `rg "<component/classname>" scripts/verify-*.mjs` and retire any matching regex in the same commit with a behavioral test (that is the #19 pattern). Current regex tally: 43 reader + 42 layout; App.tsx ~7,038 lines.
  - #20 (CSS dead-selector sweep): partial sweep done. Re-run the zero-usage cross-check AFTER the media/ThreadView extraction (#18) - those clusters may retire more classes. Watch for dynamically-built class names (e.g. `toast-${kind}` kept `toast-error`/`toast-success`).
  - #52 (filed follow-up to #7): audit real VALUE CHANGES to media/layout geometry (mobile 55px header offsets, VirtualPostList defaultRowHeight estimates vs measured heights, media-density min heights, quote-card geometry, the 1900px two-zone card columns) - each change needs desktop/wide/mobile CDP verification (DOM metrics, not screenshots: gridTemplateColumns, scrollWidth/clientWidth overflow, computed min/max heights) plus a scroll-restore smoke. Do not change values blindly.
  - Investigate-and-decide: #30 (composer video attachment - needs blob:video scope + app.bsky.video.uploadVideo, deploy/sign-in gated), #16 (saved-feed-order cross-client confirmation - #23 is closed so re-check on a healthy origin), #24 (mobile touch-viewport confirmation of the anchored scroll restore - needs a healthy deploy + signed-in CDP).
  - #5/#6/#22 are open-ended improvement/triage items. A code-review pass over App.tsx is a proven source of shippable micro-fixes and is a good session fill - delegate the research to a sub-agent, verify findings against the source, confirm no verify-script pins match (`rg "<pattern>" scripts/verify-*.mjs`), then implement.
- Leave the worktree with no unrelated revert; keep changes scoped; file a follow-up GitHub issue for anything you notice but defer. Surface infra problems (e.g. stale deploys) as issues and move on - don't burn the session on them.

LEAN-FILE DISCIPLINE (what this file is FOR):
- This file is process + a forward-looking hint ONLY. It is NOT a changelog, NOT a lessons log, and NOT a record of what any session did.
- Split by kind: a THING TO DO / FIX / IMPROVE / DECIDE goes into a GITHUB ISSUE (a task). A LESSON / GOTCHA / PATTERN / ROOT-CAUSE INSIGHT goes into docs/LESSONS.md (a notes store). Do NOT append either here.
- Do not add per-slice history, "pattern to repeat" essays, jsdom gotchas, test counts, App.tsx line counts, commit hashes, or session summaries to this file. Those belong in docs/LESSONS.md or the relevant issue.
- At session end, ONLY update the WHAT TO WORK ON section above so it reflects the current forward-looking state (which issues are done/claimed/blocked, and the current recommended batch). Rewrite the whole section rather than appending to it - it should never grow.
- If you catch this file starting to accumulate a lesson, STOP, move it to docs/LESSONS.md (or file an issue if it's a task), and delete the draft text here.

Required startup reads:

1. Get-Content -LiteralPath docs\PLAN.md
2. Get-Content -LiteralPath docs\LESSONS.md
3. Get-Content -LiteralPath AGENTS.md
4. git status --short --branch
5. rg --files
6. gh issue list --repo radialmonster/bigbsky --state open --json number,title,labels

Command retry rules:

- If any required startup read fails for any reason, retry the failed command once before stopping or diagnosing.
- If multiple startup reads fail in a parallel batch, retry the failed startup reads once.
- Do not retry indefinitely.

Important sandbox case:

If any shell command fails before PowerShell starts with:

windows sandbox: runner error: CreateProcessAsUserW failed: 5

treat it as a transient Codex command-runner/process-launch failure first. Retry all required startup reads once in the same session with the same workdir/login settings.

If the retry also fails with the same pre-PowerShell error, report blocked for that turn. However, if the environment is later relaunched, permissions change to unrestricted/disabled, or the user asks to continue, run the required startup reads again and continue the automation. Do not treat the earlier blocked result as final after the environment changes.

Do not diagnose this as a repo path, PowerShell, npm, or git problem unless PowerShell actually starts and the command itself fails after the retry.

After reading:

- Source-of-truth roles: open GitHub issues = OPEN WORK (what is next); docs\PLAN.md = design context + history (it no longer tracks open tasks); docs\LESSONS.md = durable lessons; AGENTS.md = project notes + the vendored reference list. There is no separate memory.md file.
- OFFLINE REFERENCE DOCS: the docs/ folder vendors full copies of the upstream references (atproto, bsky-docs, atproto-website, cookbook, social-app, nextjs-oauth-tutorial, statusphere-example-app). The annotated per-repo list lives in AGENTS.md; grep a vendored clone before reaching for a network call to docs.bsky.app or the atproto lexicon.
- Pick the next item from the open GitHub issues; prefer one feasible in the static SPA.
- Prefer items that can be implemented, verified, documented in the plan, committed, and pushed in one run.
- Avoid duplicating the most recent completed work.
- If the worktree has unrelated user changes, do not revert them.

Implementation rules:

- Read the relevant source before editing.
- Use apply_patch for manual repo edits.
- Keep changes scoped to the selected plan item.
- Update docs\PLAN.md to mark the completed or newly improved status.
- Run npm run build.
- If npm run build fails, retry it once after checking whether the failure was transient.
- If build still fails, fix what is in scope and rerun.
- If still blocked, record the failure clearly.

Before finishing:

- Record the run in the project's tracking files (GitHub issues / docs\PLAN.md status lines) with what changed, what was verified, commit hash if one was created, whether push succeeded, current run time, and useful notes for the next run.
- Return a short summary with files changed, verification result, and commit/push status.

powershell can take some time to start so check again in 10 seconds. if it doesn twork, try again. you keep saying it doesnt work, you need unrestricted access.  all i do is say try again and you try again and you say oh you fixed it.  i didn't do shit.

If the session did not direct you what to work on, then check for open issues on github (gh issue list --repo radialmonster/bigbsky --state open --json number,title,labels), skip any with the `claimed` label, and work on some issues.  If there are no open issues, then take this opportunity to perform a code review, pick a random function in our project and deep dive it to find bugs, issues, deduplication, simplification, enhance security, etc, and create an issue for each thing found to do that in a future session.

You are encouraged to delegate tasks to agents to work on individual tasks, this will save tokens on this main session. Your job would be to coordinate those agents, verify their work, you can also send their returned work out to another agent and instruct that agent to 'roast' and code review what the other agent did.  Your goal is to manage these tasks and keep this project moving forward.  Minimize (eliminate if possible) blockers requiring a human to answer a question or make a decision.  You are the ai coder, there will be no human ai coder to check anything behind you, you are encouraged to check yourself depending on what this particular project is about, for example by opening the site, spin up a dev server and check there. you can use Node to open chrome in debug mode and remote control it for example.  If during this session you do start a server or process or something, and it was just temporary, ensure you terminate that process at session end. ensure temporary working folders or files you created are removed.

at this session end update nextsessionprompt.md with any corrections about how to work on our project effectively, and give a clue to the next session on what it should work on.  do not be super specific, you can give it general goal, issue numbers, tasks to do.  give it a batch, and also leave it open ended to use its judgement for improvements also.  Per the LEAN-FILE DISCIPLINE: do NOT record lessons or history in this file - durable lessons/gotchas go in docs/LESSONS.md, tasks/findings go in GitHub issues, and this file only gets the forward-looking WHAT TO WORK ON section rewritten (never appended).  note nextsessionprompt.md is not a changelog, do not put in there what you did work on, only have forward looking items.  The next session will start with only 'read nextsessionprompt.md and proceed' so put in there useful guidance for it to do that.

## General session-end rule: commit and push (shared baseline)

This is the shared baseline for all projects; where the project-specific instructions above are more detailed (branch/PR workflow, multi-repo, worktree isolation, GitHub-native issue tracking, deploy path), follow those specifics on top of this.

**BigBsky override (project-specific):** there is NO PR/branch workflow - commit to `main` and push directly. Pushing to `main` is what deploys: Cloudflare Pages auto-builds/deploys from `main`, so a pushed fix goes live automatically. Because of that, pushing is the expected/required end of every completed task (not just "when safe"), and the verification gate MUST be green first - a red push auto-deploys a broken site. This override applies to the "only when safe and expected" language in step 4 below: here it is always expected (the deploy), so treat step 4 as "push the green commit to main; only hold if the gate is red or secrets are involved."

At the end of every session, before wrapping up:

1. **Commit if this directory is a Git repository.** Run `git status --short --branch` and review the diff. Stage only your own intended changes - never unrelated user changes, generated/build output, logs, temp files, or anything containing credentials, secrets, or tokens.
2. **Verify before committing.** Run this project's verification gate (its build/test/lint/`check` command) and only commit when it passes. Do not commit a known-red state.
3. **Keep commits clean and scoped.** Use a concise message describing what and why ("fix:", "feat:", "docs:"). One logical unit per commit; don't bundle unrelated work. Never force-push, amend shared history, or skip hooks.
4. **Push to GitHub only when it is safe and expected.** If this repo has an `origin` remote and the project normally shares work there, push the verified commit - but only when safe: no secrets staged, no force-push required, the branch isn't diverged in a way that would clobber others, and the work is at a coherent, complete checkpoint. If anything is ambiguous or risky, commit locally and say in your summary that you did not push and why.
5. **Record the run.** Update the project's handoff file (GitHub issues / docs/PLAN.md status lines, docs/notes.md, automation memory, etc.) with what changed, what was verified, the commit hash, push status, and current run time. (Do not recreate memory.md - it was removed to save startup tokens; keep handoff notes in the project's existing tracking files.)
6. **Refresh nextsessionprompt.md** with a forward-looking hint for the next session - not a changelog of what you did. IMPORTANT: per the LEAN-FILE DISCIPLINE above, only rewrite the WHAT TO WORK ON section if needed; durable lessons/gotchas go in docs/LESSONS.md, and findings that are tasks go in GitHub issues - do NOT grow this file.
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
- To drive a page, `scripts/cdp.mjs` only talks to an http(s) page target - `about:blank` tabs are ignored, so open a real tab first via `Invoke-RestMethod -Method Put 'http://127.0.0.1:9222/json/new?<url>'`. Kill the dev server by finding the port 5173 listener's OwningProcess and `Stop-Process` it (use a non-`$PID` variable name - `$PID` is read-only). Full CDP reference: docs\ops.md "Dev Tooling"; browser gotchas: docs\LESSONS.md "Live smoke / dev loop".

## Watchdog loop note (shared)

This repo is driven by `loop.bat` -> `loop.ps1`, a loop that spawns `opencode run --auto` on this prompt file, then waits before the next session. The `.ps1` (shared verbatim across all projects) wraps the session in a watchdog: it kills the opencode process tree if there is no output for `IdleKillMinutes` (default 15), enforces a hard per-session cap (`HardTimeoutMinutes`, default 120), reaps orphan child processes (e.g. dev servers that would hold the stdout pipe open), and writes heartbeats to `run.log`. Watchdog kills are recorded in `.loop-tmp/last-killed.txt` and surfaced at the start of the next iteration. `run.log`, `run.log.*`, and `.loop-tmp/` are gitignored. Stop cleanly by dropping a file at `.loop-tmp/stop-after.flag` or pressing Q in the loop window. Tune with `-IdleKillMinutes`/`-HardTimeoutMinutes`/`-DelayMinutes` on the bat command line.
