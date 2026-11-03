# Phase 4 Baseline Snapshot

## Git state

- **Branch**: `fix/login-gate`
- **HEAD**: `f22f656bfabe0dd5bb19dd9f897e73a0cfb56394`

## Domains and headers

Each domain was queried with `curl -I` to capture HTTP headers before any rename/alias work begins.

### `elyra-core.app`
```
HTTP/2 200

date: Mon, 15 Dec 2025 15:34:21 GMT
content-type: text/html; charset=utf-8
access-control-allow-origin: *
cache-control: public, max-age=0, must-revalidate
cf-cache-status: DYNAMIC
referrer-policy: strict-origin-when-cross-origin
x-content-type-options: nosniff
vary: accept-encoding
report-to: {"group":"cf-nel","max_age":604800,"endpoints":[{"url":"https://a.nel.cloudflare.com/report/v4?s=5tkOimuF6qXVI54Lfz0I1tqtUBo%2FqNHk8ayiSoI3p6H1gvTqWuz0DoJP87FezWChaAarrTBECZv8QEpbzKoZ8%2BIg%2FNJxRkXrdXsDIA%3D%3D"}]}
nel: {"report_to":"cf-nel","success_fraction":0.0,"max_age":604800}
server: cloudflare
cf-ray: 9ae701301f6f2f61-LIS
alt-svc: h3=":443"; ma=86400
```

### `app.elyra-core.app`
```
HTTP/2 200

date: Mon, 15 Dec 2025 15:34:28 GMT
content-type: text/html; charset=utf-8
access-control-allow-origin: *
cache-control: public, max-age=0, must-revalidate
cf-cache-status: DYNAMIC
referrer-policy: strict-origin-when-cross-origin
x-content-type-options: nosniff
vary: accept-encoding
report-to: {"group":"cf-nel","max_age":604800,"endpoints":[{"url":"https://a.nel.cloudflare.com/report/v4?s=ylOBQ2RjEY%2Fz6lCOkevC59Pym9vDTJJjqXe4Qnp4fJqvcWa3fyEa4RjM3YUACLHLBSarNmVSJFaOC8OzJQYtg8XSf2IwpPiMd8lcXSEkUk8%3D"}]}
nel: {"report_to":"cf-nel","success_fraction":0.0,"max_age":604800}
server: cloudflare
cf-ray: 9ae7015bfb706938-LIS
alt-svc: h3=":443"; ma=86400
```

### `mira-assistant.elyra-core.app`
```
HTTP/2 522

date: Mon, 15 Dec 2025 15:34:33 GMT
content-type: text/plain; charset=UTF-8
content-length: 15
cache-control: private, max-age=0, no-store, no-cache, must-revalidate, post-check=0, pre-check=0
expires: Thu, 01 Jan 1970 00:00:01 GMT
referrer-policy: same-origin
x-frame-options: SAMEORIGIN
server: cloudflare
cf-ray: 9ae7017b8f132f61-LIS
alt-svc: h3=":443"; ma=86400
```

### `api.elyra-core.app`
```
HTTP/2 200

date: Mon, 15 Dec 2025 15:34:37 GMT
content-type: text/html; charset=utf-8
access-control-allow-origin: *
access-control-allow-headers: Content-Type, Authorization, x-internal-api-key, X-Requested-With
access-control-allow-methods: GET,POST,PUT,PATCH,DELETE,OPTIONS
vary: accept-encoding
report-to: {"group":"cf-nel","max_age":604800,"endpoints":[{"url":"https://a.nel.cloudflare.com/report/v4?s=3%2FpoDLrzYsyW4uWoMMW7gSAKfXmYdnHs35f8vDZGySfQtgMMQbAtfB4vDb2xo0tWUY50vFe2hpAxc3S5Ax5FiubEI5Ub%2Bog75923az3cYgU%3D"}]}
nel: {"report_to":"cf-nel","success_fraction":0.0,"max_age":604800}
server: cloudflare
cf-ray: 9ae701914a33785c-LIS
alt-svc: h3=":443"; ma=86400
```

## Worker, Pages, and routes

- **Primary worker name**: `mira-assistant` (defined in `worker/wrangler.toml`).
- **Dev worker name**: `personal-assistant-dev` (defined in `wrangler.personal-assistant-dev..toml`).
- **Cloudflare Pages project**: `mira-assistant` (both `.github/workflows/deploy-mira.yml` and `deploy-site.yml` publish `./mira-app`).
- **Known production routes** (dashboard-only details live in the Cloudflare dashboard):
  - `api.elyra-core.app/*` → Cloudflare Worker (`worker/src/index.ts`, `worker/wrangler.toml`).
  - `mira-assistant.elyra-core.app` → Cloudflare Pages project named `mira-assistant` (`.github/workflows`); the project must be adjusted manually in the dashboard if the folder name changes.
  - `elyra-core.app` → marketing shell (`fish-delish-site/index.html`); DNS/Pages mapping is defined outside this repo.
  - `app.elyra-core.app` → expected workspace app; hosting details remain external to the repo.

## CI workflows

- `.github/workflows/deploy-mira.yml` – builds/publishes `./mira-app` to Cloudflare Pages.
- `.github/workflows/deploy-site.yml` – nearly identical Pages workflow targeting the same `mira-assistant` project (also publishing `./mira-app`); consider consolidation in a later phase.
- `.github/workflows/deploy-worker.yml` – sets up Node/Wrangler and deploys the Worker from `worker/`.
