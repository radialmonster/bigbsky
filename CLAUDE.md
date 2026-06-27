# Project Notes

- `todo.md` contains the current list of tasks to be done and working rules for future sessions.
- Before adding new CSS, first look for an existing component pattern, grouped selector, or reusable style in `src/styles.css`. Prefer reusing or modestly extending existing styles over adding near-duplicate rules; add new CSS only when the design need is genuinely distinct.

## Docs & references

Local project docs:
- `todo.md` — current tasks and working rules.
- `docs/plan.md` — project plan.
- `docs/cloudflare-pages-setup.md` — hosting/deploy setup.

Bluesky / atproto API reference (use these to confirm endpoints, lexicons, and types before coding against the network):
- Installed source of truth: the `@atproto/*` packages in `node_modules/@atproto/` (`api`, `oauth-client-browser`, `xrpc`, `syntax`, etc.). The full lexicon/API surface lives in `node_modules/@atproto/api/dist/client/lexicons.{js,d.ts}` — prefer this over guessing endpoint shapes.
- Local clones of the upstream repos live under `docs/` (gitignored via `docs/*/`, read-only reference — never edit; grep them instead). There are two layers, each with a *code* repo and a *docs* repo:
  - **AT Protocol layer** (the low-level protocol: repos, DIDs, lexicons, XRPC):
    - `docs/atproto/` — the atproto monorepo: TypeScript reference, lexicon definitions (`lexicons/`), and the `@atproto/*` package source. The canonical "what does this API do" source. (https://github.com/bluesky-social/atproto)
    - `docs/atproto-website/` — source of the **atproto.com** docs site; protocol specs/guides under `docs/atproto-website/docs/`. (https://github.com/bluesky-social/atproto-website)
  - **Bluesky app layer** (the `app.bsky.*` API and the client built on the protocol):
    - `docs/social-app/` — the official bsky.app client. Reference for "how does Bluesky implement X" (rendering, threads, embeds, UX). (https://github.com/bluesky-social/social-app)
    - `docs/bsky-docs/` — source of the **docs.bsky.app** site; app-developer tutorials, starter templates, and API guides under `docs/bsky-docs/docs/`. (https://github.com/bluesky-social/bsky-docs)
  - **Example apps / code** (TypeScript, useful patterns to copy from):
    - `docs/nextjs-oauth-tutorial/` — atproto OAuth tutorial, but a **server-side confidential client** (`@atproto/oauth-client-node`: JWKS keypair, DB sessions). Good for OAuth *concepts* (scopes, client metadata, callback/state), NOT the same client model as BigBsky. (https://github.com/bluesky-social/nextjs-oauth-tutorial)
    - `docs/statusphere-example-app/` — full example atproto web app (OAuth + reading/writing records). (https://github.com/bluesky-social/statusphere-example-app)
    - `docs/cookbook/` — assorted example scripts/projects for atproto dev. (https://github.com/bluesky-social/cookbook)
  - **OAuth — the reference that actually matches BigBsky.** BigBsky is a *browser public client* using `BrowserOAuthClient` from `@atproto/oauth-client-browser` (see `src/auth.ts`), no backend. The closest upstream references are inside the atproto monorepo:
    - `docs/atproto/packages/oauth/oauth-client-browser/` — source of the exact library BigBsky imports.
    - `docs/atproto/packages/oauth/oauth-client-browser-example/` — a real browser SPA using `BrowserOAuthClient` (the apples-to-apples example).
    - `docs/atproto/packages/oauth/oauth-scopes/` — scope token definitions; relevant to `src/scopes.ts` and `getMissingScopes()`.
- External (online) equivalents: protocol docs — https://atproto.com ; Bluesky app/API docs — https://docs.bsky.app ; all repos — https://github.com/bluesky-social.
- Other org repos exist but are out of scope for a TS web reader: Go infra (`indigo`, `pds`, `jetstream`, `goat`, `bigsky`), native deps (`expo-*`, `react-native-*`), moderation (`ozone`), `feed-generator` (we consume feeds, don't generate). Clone into `docs/` on demand if ever needed.

### Updating the local reference clones

These are shallow clones kept out of version control. To refresh them to the latest upstream:

```sh
# Update all reference clones (run from the repo root)
for r in atproto atproto-website social-app bsky-docs nextjs-oauth-tutorial statusphere-example-app cookbook; do git -C "docs/$r" pull --depth 1 --ff-only; done

# Or re-clone a single one from scratch
rm -rf docs/atproto && git clone --depth 1 https://github.com/bluesky-social/atproto.git docs/atproto

# Add another bluesky-social repo as reference (it'll be gitignored automatically)
git clone --depth 1 https://github.com/bluesky-social/<repo>.git docs/<repo>
```
