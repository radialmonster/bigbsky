

read todo.md and proceed to work on a task and implement.  add   any follow ups to todo.md as new tasks any issue you see that can be improved or fixed also.  if your task is fully complete, you may remove it from todo completely. make a commit to main when done.  you have browser access and may have oauth already.  kill any running servers you started for testing or verification.

WHAT TO WORK ON THIS SESSION (forward-looking; use your judgement, keep rotating areas, batch small fixes):
- Concrete in-repo items (see todo.md for full details):
  - Bookmarks scroll-restore — hard; anchor to content (top-visible post URI), not raw pixel offset. Full root-cause + CDP repro in todo.md ("Integrate scroll restoration with the VirtualPostList measurement pass"). A time-budget widening was tried and reverted; don't re-try that.
  - Load-more pagination for the remaining paged surfaces: profile Feeds/Lists tabs (getActorFeeds/getActorLists) + the in-app list timeline (getListFeed). Cursors exist. The engagement panels (getLikes/getRepostedBy/getQuotes) got this pattern on 2026-08-01 — mirror it (append-and-advance, single-in-flight, AutoLoadMoreButton + loadMoreError, abort on uri/kind change). Mind the nested-loader pitfall (tab-level loader vs. the feed's own AutoLoadMoreButton).
  - Search results / standalone-thread / quoted-post NSFW filtering parity (feed/profile timelines already drop isAdultPost rows when the NSFW toggle is hidden; these surfaces only gate media behind the reveal warning today).
  - Continue the App.tsx decomposition (component/CSS co-location into src/features/**; cache layer with the loaders). All pure `read*`/`safe*`/scroll/feed-order helpers are already extracted to src/lib with vitest suites — the remaining work is components + the mega-stylesheet.
  - Reuse the shared toast primitive (ToastContext + ToastHost in src/App.tsx) for other console.error-only catch paths (e.g. toggleBlock, list ops) instead of adding per-button error props.
- NEW this session (2026-08-01) — verify the shipped hardening on the deployed origin once Cloudflare rebuilds: (a) the new Content-Security-Policy header from public/_headers is actually served and the live site still works (app boots, feed/trending render, engagement panels load, no CSP violations in the console — I validated locally by serving the production bundle under the exact CSP, but the live origin is the real gate); (b) the service worker now derives paths from its registration scope and registration is gated behind PROD (dev no longer registers one — if a dev server seems to have no SW, that's expected now); (c) the boot failure-detector now lives in public/boot-error.js (external, defer) instead of an inline script.
- Anything on the deployed origin that needs auth (OAuth writes, moderation, composer) still requires commit + push + operator sign-in; never promise local auth verification.
- Leave the worktree with no unrelated revert; keep changes scoped; add a follow-up item to todo.md for anything you notice but defer.



Run all shell commands with:

workdir: N:\Projects\bigbsky

login: false



Required startup reads:

1. Get-Content -LiteralPath memory.md (in-repo run memory; updated at session end)
2. Get-Content -LiteralPath docs\PLAN.md
3. git status --short --branch
4. rg --files



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

\- Respect any useful notes in memory, especially recent completed work.

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

\- Update the memory file with:

  \- what changed

  \- what was verified

  \- commit hash if one was created

  \- whether push succeeded

  \- current run time

  \- useful notes for the next run

\- Return a short summary with files changed, verification result, and commit/push status.

powershell can take some time to start so check again in 10 seconds. if it doesn twork, try again. you keep saying it doesnt work, you need unrestricted access.  all i do is say try again and you try again and you say oh you fixed it.  i didn't do shit.



If the session did not direct you what to work on, then check for open issues on github, or in todo.md or whatever tracking process this project uses and work on some issues.  If there are no open issues, then take this opportunity to perform a code review, pick a random function in our project and deep dive it to find bugs, issues, deduplication, simplification, enhance security, etc, and create an issue or task for each thing found to do that in a future session.

You are encouraged to delegate tasks to agents to work on individual tasks, this will save tokens on this main session. Your job would be to coordinate those agents, verify their work, you can also send their returned work out to another agent and instruct that agent to 'roast' and code review what the other agent did.  Your goal is to manage these tasks and keep this project moving forward.  Minimize (eliminate if possible) blockers requiring a human to answer a question or make a decision.  You are the ai coder, there will be no human ai coder to check anything behind you, you are encouraged to check yourself depending on what this particular project is about, for example by opening the site, spin up a dev server and check there. you can use Node to open chrome in debug mode and remote control it for example.  If during this session you do start a server or process or something, and it was just temporary, ensure you terminate that process at session end. ensure temporary working folders or files you created are removed. 

at this session end update nextsessionprompt.md with any corrections about how to work on our project effectively, use this session as lessons learned type of thing.  add also to give a clue to the next session on what it should work on.  do not be super specific, you can give it general goal, issue numbers, tasks to do.  give it a batch, and also leave it open ended to use its judgement for improvements also.  note nextsessionprompt.md is not a changelog, do not put in there what you did work on, only have forward looking items.  The next session will start with only 'read nextsessionprompt.md and proceed' so put in there useful guidance for it to do that.
