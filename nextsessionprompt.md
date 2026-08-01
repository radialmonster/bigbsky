

read the open GitHub issues (gh issue list --repo radialmonster/bigbsky) and proceed to work on a task and implement.  add any follow ups as new GitHub issues for any issue you see that can be improved or fixed also.  if your task is fully complete, you may close its issue. make a commit to main when done.  you have browser access and may have oauth already.  kill any running servers you started for testing or verification.

ISSUE CLAIMING (always):
- Claim an issue with the `claimed` label as soon as you start working on it: `gh issue edit <N> --repo radialmonster/bigbsky --add-label claimed`
- Do NOT start work on any issue that already has the `claimed` label (someone else — or a prior parallel session — is on it). Check labels before picking: `gh issue list --repo radialmonster/bigbsky --state open --json number,title,labels`
- Remove the `claimed` label when you finish (task done/closed, or you stop working on it): `gh issue edit <N> --repo radialmonster/bigbsky --remove-label claimed`
- Claim one issue at a time; if you delegate to sub-agents, each sub-agent must claim its issue the same way so parallel sessions never collide.

SHIPPING (when an issue's fix is verified):
- Do NOT open a PR. Commit to main and push directly — that's the deploy path.
- Pushing to main is what deploys: Cloudflare Pages auto-builds/deploys from the main branch. So after `git push origin main`, the fix goes live on the deployed origin automatically.
- Finish flow per issue: remove the `claimed` label, close the issue (`gh issue close <N> --repo radialmonster/bigbsky`), then commit + push to main.
- Verify a build/test/`check` gate is green before pushing (never push a known-red state; a broken main auto-deploys a broken site).

WHAT TO WORK ON THIS SESSION (forward-looking; use your judgement, keep rotating areas, batch small fixes):
- Pick from the open GitHub issues (currently #1–#22). Skip any that already carry the `claimed` label. Highlights:
  - Bookmarks scroll-restore (#8) — hard; anchor to content (top-visible post URI), not raw pixel offset. Full root-cause + CDP repro in the issue. A time-budget widening was tried and reverted; don't re-try that.
  - App.tsx decomposition (#18) — component/CSS co-location into src/features/**; cache layer with the loaders. All pure `read*`/`safe*`/scroll/feed-order helpers are already extracted to src/lib with vitest suites — the remaining work is components + the mega-stylesheet.
  - Replace regex source-text tests (#19), CSS dead-selector sweep (#20), and the CSS-token investigation (#7) are good low-risk batching with the decomposition.
  - Composer GIFs/quote/video (#10), saved-feed-order cross-client confirm (#16), report/security-posture doc (#15), and the oEmbed/Firehose/Service-Auth scoping writeups (#11/#12/#14) are investigate-and-decide items.
  - #5/#6/#22 are open-ended improvement/triage items.
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

## Watchdog loop note (shared)

This repo is driven by `run-prompt.bat` -> `run-prompt.ps1`, a loop that spawns `opencode run --auto` on this prompt file, then waits before the next session. The `.ps1` (shared verbatim across all projects) wraps the session in a watchdog: it kills the opencode process tree if there is no output for `IdleKillMinutes` (default 15), enforces a hard per-session cap (`HardTimeoutMinutes`, default 120), reaps orphan child processes (e.g. dev servers that would hold the stdout pipe open), and writes heartbeats to `run.log`. Watchdog kills are recorded in `.loop-tmp/last-killed.txt` and surfaced at the start of the next iteration. `run.log`, `run.log.*`, and `.loop-tmp/` are gitignored. Stop cleanly by dropping a file at `.loop-tmp/stop-after.flag` or pressing Q in the loop window. Tune with `-IdleKillMinutes`/`-HardTimeoutMinutes`/`-DelayMinutes` on the bat command line.
