# Task tracking — moved to GitHub Issues

Open work is tracked as GitHub issues on the `radialmonster/bigbsky` repo (22 open as of 2026-08-01; was previously this file). Full context for each issue is in its body.

- List: `gh issue list --repo radialmonster/bigbsky --state open`
- Create a follow-up: `gh issue create --repo radialmonster/bigbsky --title "..." --body-file <file>`
- Close an issue when its task is fully complete.

`docs/plan.md` keeps the project's design context + historical changelog and no longer tracks open tasks. Git history retains the full content of this file (everything below was migrated verbatim into the issues).

## Working Rules

- Claim an issue with the `claimed` label (`gh issue edit <N> --repo radialmonster/bigbsky --add-label claimed`) as soon as you start working on it, and remove it when finished. Do NOT start on any issue that already has the `claimed` label.
- Ship without PRs: commit to main and push directly — pushing to main is the deploy (Cloudflare Pages auto-builds from main). Remove the `claimed` label and close the issue when its fix is verified and pushed.
- If a task needs an answer from the human, do not skip or abandon the task. Ask the specific question needed, then continue once answered.
- If there is no human reply after 10 minutes, record the unanswered question(s) as a GitHub issue (or in the issue being worked), then move to a different task.
- For browser checks, first see whether Chrome dev mode is already running on port 9222. Check processes for `chrome.exe` with `--remote-debugging-port=9222`, then verify `http://127.0.0.1:9222/json/version`. If it is running, use that browser instead of starting another one. If it is not running, start Chrome with:
  `Start-Process "C:\Program Files\Google\Chrome\Application\chrome.exe" -ArgumentList "--remote-debugging-port=9222 --user-data-dir=$env:LOCALAPPDATA\Codex\ChromeProfiles\fb-tools-test --start-maximized --auto-open-devtools-for-tabs --disable-first-run-ui --no-first-run about:blank" -WindowStyle Hidden`
- To start the local BigBsky dev server, run `npm run dev` from the repo root. Vite serves it at `http://127.0.0.1:5173/` by default.
