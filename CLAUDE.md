# CLAUDE.md

Guidance for Claude Code sessions working in this repo.

## What this folder is

The **bigbsky** project — an alternative web client for Bluesky / the AT
Protocol — together with the loop-driven autonomous-dev scaffolding it was
seeded from. The scaffolding originated as a generic template extracted from
the `repairforge-github` project.

Targets:
- **Frontend**: SvelteKit + `@sveltejs/adapter-cloudflare`.
- **Backend**: none of our own; talks to the public Bluesky AppView / PDS
  over the AT Protocol via `@atproto/api` (browser-side).
- **Hosting**: Cloudflare Pages (free tier).
- **Repo**: `github.com/radialmonster/bigbsky-dev`.

The SvelteKit app lives under `web/` (see "Repo layout" below). The loop
infra (autonomous AI sessions + GitHub workflow lanes) sits at the repo
root and operates on the whole tree.

## Repo layout

```
bigbsky/
  CLAUDE.md, TEMPLATE.md       Docs (this file + template usage)
  template.config.json         Project values (PROJECT_NAME, GITHUB_OWNER, ...)
  init-template.ps1            Token substituter (one-shot; already run)
  loop.bat, loop.ps1,          Autonomous AI session runner
    stop-loop.bat
  github-workflow-menu.ps1     Interactive menu for GitHub workflow lanes
  prompt-*.txt                 Lane prompt templates
  prompts/github/              More prompt templates
  config/
    github-workflow-profiles.json   AI model profile presets per lane
  scripts/
    github-loop/               Per-lane helpers (issue work, PR verify, ...)
    template/                  Tooling for rebuilding the template (rarely used)
    monitor-todo.ps1           Misc helper
  git-pull.bat, git-push.bat   Convenience wrappers
  docs/
    atproto.com/               Stash for AT Protocol reference docs
    docs.bsky.app/             Stash for Bluesky API reference docs
  web/                         SvelteKit app (Cloudflare Pages target)
```

## Token system (already substituted)

`init-template.ps1` has already been run for bigbsky. The remaining tokens
in `template.config.json` are:

| Token                 | Current value      |
|-----------------------|--------------------|
| `PROJECT_NAME`        | `bigbsky`          |
| `PROJECT_NAME_PASCAL` | `Bigbsky`          |
| `PROJECT_NAME_UPPER`  | `BIGBSKY`          |
| `GITHUB_OWNER`        | `radialmonster`    |
| `GITHUB_REPO`        | `bigbsky-dev`      |

The repairforge-flavoured deploy tokens (`SSH_GIT_ALIAS`, `SSH_HOST`,
`DEPLOY_REMOTE_ROOT`, `PNPM_API_PACKAGE`, `WEB_TAR_NAME`) have been dropped
— bigbsky deploys via Cloudflare Pages, not SSH.

If you change `template.config.json` after the fact, `init-template.ps1`
won't rewrite the already-substituted text. Do a targeted Grep+Edit sweep
across the tree instead.

## Deploy (Cloudflare Pages)

Pages can deploy either from a connected git repo (push to main triggers
a build) or via `wrangler pages deploy ./web/.svelte-kit/cloudflare`. We
haven't picked one yet. The legacy SSH-to-VM deploy scripts
(`deploy_daemon.py`, `deploy_direct.py`, `sftp_upload.py`) have been
removed.

The release lane (`scripts/github-loop/release.ps1`) generates release
notes that include the wrangler deploy command. The release-deploy
prompt (`prompt-github-release-deploy.txt`) drives the deploy lane and
expects a wrangler-authenticated environment plus an existing Pages
project named `bigbsky`. The orchestrator
(`scripts/github-loop/orchestrate.ps1`) verifies a successful deploy by
reading `.loop-tmp/wrangler-deploy.last.log` for two markers:
`DEPLOY_VERIFIED_REF_MATCH=1` and `DEPLOY_VERIFIED_REF=<ref>`. The
deploy lane must write that file after a successful `wrangler pages
deploy` for `Test-VerifiedDeployEvidence` to accept it.

## Things tokens can't fix (audit before running lanes)

The token system handles names and identifiers. It does not capture
project-shape assumptions baked into the scripts. Outstanding audit
items:

- **`scripts/github-loop/` helpers**: encode repairforge-specific issue
  labels (`ai:needs-user-answer`, `ai:ready-for-release`,
  `infra-blocked`, etc.) and lane definitions. Search for `ai:` and
  `--label` to find them. Decide which conventions to adopt before
  running a menu lane.
- **`config/github-workflow-profiles.json`**: profile names
  (`codex-yolo`, `anthropic-opus`, etc.) must match what `loop.ps1`
  knows how to invoke. Don't add a profile name without also wiring it
  in.
- **`loop.ps1` watchdog hooks** at lines ~916 and ~1134 special-case
  `python deploy_direct.py` invocations to tail an extra log. The
  matching regex no longer fires (the script is deleted), so the hooks
  are dead code rather than active — fine to leave, fine to remove.

## How the loop works (orientation)

- **`loop.bat`** with no args opens `github-workflow-menu.ps1` (the
  interactive menu). With args, it forwards to `loop.ps1`.
- **`loop.ps1`** runs autonomous AI sessions in a controlled cycle: each
  iteration invokes a CLI agent (codex, claude, ollama, etc.) with a prompt
  file, optionally repeating up to `-MaxIterations`. It holds a per-repo
  mutex so two loops can't run on the same checkout, handles infra-blocked
  retries with a cooldown (`BIGBSKY_INFRA_RETRY_MINUTES`), and watches for
  the stop sentinel (`.loop-tmp/stop-after.flag`) created by
  `stop-loop.bat`.
- **`stop-loop.bat`** drops the sentinel, waits 25s for clean exit, then
  force-kills `loop.ps1` / `loop.bat` / `codex.exe` if they're still
  around.
- **Menu lanes** (`github-workflow-menu.ps1`) each map to a profile in
  `config/github-workflow-profiles.json` + a prompt file + (often) a
  helper in `scripts/github-loop/`. Lanes are GitHub-flavoured (issue
  roast, PR verify, release) but the runner itself is framework-agnostic.

## Working in this repo (for future Claude sessions)

- **No emojis in script output** — existing scripts use ASCII so Windows
  consoles render correctly. Maintain that.
- **Encoding**: scripts read/write UTF-8 without BOM. Use
  `[System.IO.File]::WriteAllText(..., [System.Text.UTF8Encoding]::new($false))`
  when modifying files programmatically, not `Out-File` (which adds BOM by
  default on Windows PowerShell).
- **The `scripts/template/` folder is intentionally excluded** from the
  init substituter (it'd otherwise corrupt its own source strings). Don't
  move it without updating the exclusion globs.
- **Before running a menu lane**, check the audit list above and confirm
  the lane's helper script and prompt don't still refer to repairforge-era
  infrastructure (SSH deploy, Prisma, pnpm filters).

## Status

- Template tokens: **substituted** with bigbsky values.
- SSH/SFTP deploy scripts: **removed** (Cloudflare Pages instead).
- SvelteKit app under `web/`: **scaffolded** with adapter-cloudflare and
  `@atproto/api`. `pnpm run build` succeeds. Initial commit pushed to
  `radialmonster/bigbsky-dev` (private).
- GitHub workflow lanes: issue triage / PR verify / release prompts and
  scripts have been rewritten for the SvelteKit + Pages flow. The deploy
  lane requires a `wrangler login` and an existing Cloudflare Pages
  project named `bigbsky` before it will work end-to-end.
- Loop runtime: **untested in this folder** — no AI CLI invocation has
  been run here yet.

## Cloudflare Pages setup (one-time, manual)

`wrangler` is installed under `web/` but isn't authenticated. To unblock
the deploy lane:

```powershell
cd web
pnpm exec wrangler login           # opens a browser; sign in to Cloudflare
pnpm exec wrangler pages project create bigbsky --production-branch main
```

After that, `pnpm exec wrangler pages deploy .svelte-kit/cloudflare
--project-name bigbsky --branch main` (run from `web/`) will push a
deploy. Alternatively, connect the repo to Pages from the Cloudflare
dashboard and let pushes to `main` trigger builds.
