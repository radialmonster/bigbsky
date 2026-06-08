# Loop Template

Generic auto-dev-cycle scaffolding adapted from `repairforge-github`. Use this
folder as the starting point for any project that wants the same loop/menu
infrastructure (autonomous Claude/Codex sessions, GitHub workflow helpers,
deploy daemons, etc.).

## What's here

- `loop.bat` / `loop.ps1` / `stop-loop.bat` -- core autonomous-session runner.
- `github-workflow-menu.ps1` + `prompt-github-*.txt` -- menu-driven UX for
  GitHub-workflow lanes (issue triage, PR verify, release, etc.).
- `scripts/github-loop/` -- per-lane PowerShell helpers.
- `scripts/template/sweep-to-tokens.ps1` -- one-shot that rebuilt this template
  from the original repairforge tree. Not needed for new projects.
- `deploy_daemon.py` / `deploy_direct.py` / `sftp_upload.py` -- production
  deploy helpers (SSH/SFTP). Project-specific assumptions remain; review before
  use.
- `template.config.json` -- placeholder values you fill in.
- `init-template.ps1` -- substitutes `{{TOKEN}}` placeholders throughout the
  tree from the config file.

## Tokens

All project-specific values are stored as `{{TOKEN}}` placeholders. Required
tokens:

| Token                  | Example value                          |
|------------------------|----------------------------------------|
| `PROJECT_NAME`         | `bigbsky`                              |
| `PROJECT_NAME_PASCAL`  | `Bigbsky`                              |
| `PROJECT_NAME_UPPER`   | `BIGBSKY`                              |
| `GITHUB_OWNER`         | `dataforge`                            |
| `GITHUB_REPO`          | `bigbsky-github-workflow`              |
| `SSH_GIT_ALIAS`        | `github.com-bigbsky-workflow`          |
| `SSH_HOST`             | `bigbsky.app`                          |
| `DEPLOY_REMOTE_ROOT`   | `/opt/bigbsky`                         |
| `PNPM_API_PACKAGE`     | `@bigbsky/api`                         |
| `WEB_TAR_NAME`         | `bigbsky-web-latest.tar`               |

## Instantiating for a new project

1. Copy this entire folder to the new project's directory.
2. Edit `template.config.json` with the project's values.
3. Run:
   ```
   pwsh -NoProfile -ExecutionPolicy Bypass -File .\init-template.ps1
   ```
   (Add `-DryRun` first if you want to preview.)
4. Review and adjust any infra-specific bits the token system can't capture
   (docker compose service names, label conventions in `scripts/github-loop/`,
   deploy preflight checks, etc.).
5. Delete `TEMPLATE.md`, `template.config.json`, `init-template.ps1`, and
   `scripts/template/` once you're satisfied -- they're only needed at
   instantiation time.

## Re-running the init

`init-template.ps1` is idempotent. Already-substituted files are no-ops on
subsequent runs. If you change a value in `template.config.json`, re-running
won't fix already-substituted text -- you'd need to start from a fresh copy
of the template.
