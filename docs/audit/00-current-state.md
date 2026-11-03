# Current State Report

## What exists now
- **Backend**: The Cloudflare Worker (`worker/src/index.ts`) owns OAuth (mf-s cookie), `/assistant`, `/email`, `/calendar`, `/drive`, `/knowledge`, `/memo`, `/notion`, and scheduled cron work, and gets deployed via the GitHub Action in `.github/workflows/deploy-worker.yml`.
- **Shell**: `mira-app/` renders the static M.I.R.A OS shell (`index.html`, `css/`, `js/mira.js`, plus `modules/`), while `fish-delish-site/` contains a Next-powered workspace that is referenced by the worker via `DASHBOARD_URL` but is not yet wired into CI.
- **Docs**: Existing audit docs (e.g., `docs/audit/01-repo-map.md`, `docs/audit/05-api-worker-analysis.md`) catalog the current flow – the new audit files listed below extend that sectioned inventory.

## Where in code
- The worker configuration is pointer-authenticated via `worker/wrangler.toml`, which names the `mira-assistant` worker, binds `ASSISTANT_KV`, declares the OAuth scopes, and publishes the cron:

```toml
name = "mira-assistant"
main = "src/index.ts"
compatibility_date = "2025-11-05"
workers_dev = true

[vars]
GOOGLE_SCOPES = "openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/presentations https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly"
DASHBOARD_URL = "https://app.elyra-core.app"
[[kv_namespaces]]
binding = "ASSISTANT_KV"
id = "f941315e760f46a494dd17e1f9d967e2"
```

- UI bootstraps from `mira-app/index.html` and `mira-app/js/mira.js`, and the Next workspace lives under `fish-delish-site/` (see `fish-delish-site/package.json`).
- CI/CD automation lives in `.github/workflows/deploy-worker.yml` and builds/deploys the worker after `npm ci && npm run build` inside `worker/`.

## How to verify
1. `npm test` (runs `TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test mira-os/tests/**/*.test.ts`).
2. `curl -i -X POST https://api.elyra-core.app/assistant/auth/logout` to confirm `mf-s` clears and `Domain=.elyra-core.app` is set.
3. `curl -i https://api.elyra-core.app/assistant/auth/whoami` returns `401 AUTH_REQUIRED` when unauthenticated.
4. `curl -iL "https://api.elyra-core.app/assistant/oauth/google/start?next=https%3A%2F%2Fapp.elyra-core.app%2Fworkspace"` redirects to Google.

## Known gaps
- The Next workspace is present in the repo but not wired into any deploy automation or documented hosting pipeline, so `app.elyra-core.app` routing must be confirmed outside the repo.
- Existing docs describe auth and stack state, yet no `docs/phase1/` or `docs/design/` log existed until now; this report converts that knowledge into actionable references.
- Design system, theme switching, and a shell v2 experience are not yet implemented (this round lays the groundwork).

## Audit inventory (newly added this round)
- `docs/audit/01-runtime-domains.md`
- `docs/audit/02-auth-session-cors.md`
- `docs/audit/03-ui-architecture.md`
- `docs/audit/04-modules-inventory.md`
- `docs/audit/05-deploy-ci-cd.md`
- `docs/audit/06-risk-register.md`
