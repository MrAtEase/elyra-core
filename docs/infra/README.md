# Infra Reference

This directory tracks the pieces that keep the Fish Delish workspace grounded:

- `elyra-core.app` is the marketing landing and login call-to-action (`fish-delish-site/`).
- `app.elyra-core.app` is the Merlin workspace UI built inside `fish-delish-site/app/` (Next.js + `MerlinLayout`).
- `api.elyra-core.app` is the MERLIN API and OAuth gatekeeper (`worker/`), serving `/assistant/*`, `/email/*`, `/calendar/*`, `/drive/*`, `/memo/*`, and OAuth redirects.
- `mira-assistant.elyra-core.app` is the static M.I.R.A shell served via Cloudflare Pages (`mira-app/`) that wires the MERLIN client and dashboard modules to `https://api.elyra-core.app`.
- `pitchdeck.elyra-core.app` is reserved for investor facing slides / pitchdeck UI; no asset exists yet (post-MVP).

## Folder meaning

- `worker/` – Cloudflare Worker implementation of the MERLIN API, auth gate, Gmail/Drive/Calendar integrations, and the scheduled jobs. Deployed via `.github/workflows/deploy-worker.yml`.
- `mira-os/` – Shared engines, runners, and integrations that power MIRA OS features (email, calendar, knowledge, automation) which the web-facing shells rely on.
- `fish-delish-site/` – Marketing landing page plus the Next.js workspace (`app/`, `components/merlin`). The Next workspace renders `/workspace` → `/merlin` and expects `NEXT_PUBLIC_API_URL` in production.
- `mira-app/` – Static HTML/CSS/JS shell for the MERLIN assistant; imports `js/mira.js`, `js/merlin-client.js`, and `modules/*`. Published via Cloudflare Pages workflows (`deploy-mira.yml` / `deploy-site.yml`).
- `merlin-vscode/` – VS Code extension that connects to the local MERLIN dev agent (`worker/dist/apiServer.js`), mostly for local debugging and autopilot sessions.
