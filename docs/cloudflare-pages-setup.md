# Cloudflare Pages API Setup

This project is intended to run as a static Cloudflare Pages app on `bigbsky.com`.

## Required API Token

Create a Cloudflare API token with these minimum permissions:

- Account: Cloudflare Pages: Edit
- Zone: Zone: Read

Scope it to the Cloudflare account that owns the `bigbsky.com` zone. The setup script discovers the account from the zone, so `CLOUDFLARE_ACCOUNT_ID` is optional unless the token can see multiple matching resources.

## Run Setup

From PowerShell:

```powershell
$env:CLOUDFLARE_API_TOKEN = "your-token"
.\scripts\setup-cloudflare-pages.ps1
```

To attach both the apex and `www` host:

```powershell
$env:CLOUDFLARE_API_TOKEN = "your-token"
.\scripts\setup-cloudflare-pages.ps1 -IncludeWww
```

The script will:

- Find the `bigbsky.com` zone.
- Create or reuse a Pages project named `bigbsky`.
- Configure the default build as `npm run build` with `dist` output.
- Attach `bigbsky.com` as a Pages custom domain.
- Optionally attach `www.bigbsky.com`.

## Notes

- Cloudflare's Pages API creates projects with `POST /accounts/{account_id}/pages/projects`.
- Cloudflare's Pages custom domain API attaches domains with `POST /accounts/{account_id}/pages/projects/{project_name}/domains`.
- For an apex custom domain, Cloudflare requires the domain to be a zone in the same account. Since `bigbsky.com` nameservers are pointed to Cloudflare, Cloudflare should handle the required DNS record during custom domain activation.
- This script does not add Workers, Pages Functions, KV, D1, R2, service bindings, analytics, or backend routes.
- Deployment is separate. Once the app exists, deploy only static build output.
