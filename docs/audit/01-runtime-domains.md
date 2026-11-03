# Runtime Domains & Routing

## What exists now
| Host | Purpose | Notes |
| --- | --- | --- |
| `elyra-core.app` | Marketing + entry point | `fish-delish-site/` contains a Next.js marketing/workspace app; DNS likely points to Pages or CDN outside this repo.
| `app.elyra-core.app` | Workspace entry | `DASHBOARD_URL` in `worker/wrangler.toml` routes OAuth redirects here, so the Next app is the business workspace surface.
| `api.elyra-core.app` | Cloudflare Worker API | The worker exposed at `worker/src/index.ts` handles `/assistant`, `/email`, `/calendar`, `/drive`, `/knowledge`, `/memo`, `/notion`, OAuth, and session cookies.
| `workers.dev` | Preview + tooling | `workers_dev = true` in the worker configs means `mira-assistant.<account>.workers.dev` exists for instant preview and `wrangler dev` uses `personal-assistant-dev` variant.
| `pages.dev` | Static previews | The static shell/site can be previewed via Cloudflare Pages when uploading `mira-app/` or `fish-delish-site/` builds, so `*.pages.dev` origins must be allowed in CORS.

## Where in code
The worker wiring lives in `worker/wrangler.toml`, which pins `mira-assistant`, scopes, `DASHBOARD_URL`, and the `ASSISTANT_KV` namespace used by auth/session flows.

```toml
[vars]
GOOGLE_REDIRECT_URI = "https://api.elyra-core.app/api/google/callback"
DEFAULT_USER_KEY = "paul"
MAILCHANNELS_DOMAIN = "elyra-core.app"
MAIL_FROM = "assistant@elyra-core.app"
DASHBOARD_URL = "https://app.elyra-core.app"
```

The `worker/src/index.ts` fetch handler enforces authentication for `/assistant/*` and proxies requests to `Merlin` modules, while `mira-app/index.html` (served from `/mira-app/`) is the shell that speaks to the API host.

## How to verify
1. `curl -I https://elyra-core.app` (`server` header reveals CDN/Pages backend).
2. `curl -I https://app.elyra-core.app` (should return `200` and credit the Next workspace).
3. `curl https://api.elyra-core.app/assistant/auth/whoami` (401 when unauthenticated).
4. `wrangler whoami` + `wrangler tail` against the deployed worker to confirm `workers.dev` route is live, and check Cloudflare Workers > Routes to see `api.elyra-core.app/*` mapped to `mira-assistant`.

## Known gaps
- The repo does not document which Cloudflare Pages or DNS records feed `elyra-core.app` and `app.elyra-core.app`, so humans must inspect the dashboard for explicit mappings.
- `fish-delish-site/` sits next to `mira-app/`, but no workflow in this repo builds or publishes it, so `app.elyra-core.app` hosting is managed elsewhere (risk of drift).
- `pages.dev` preview origins must stay whitelisted manually because the CORS allow list in `worker/src/index.ts` does not auto-sync with every Pages deployment.
