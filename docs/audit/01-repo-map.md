# Repository Map

## Top-level directories & purpose
- `docs/` stores operational artifacts; the existing `docs/miraos-phase1-contract.md` and `docs/panels-lifecycle-audit.md` describe roadmap commitments for the MIRA OS (see the two files in `docs/`).
- `email-provider/` isolates provider adapters; for example `email-provider/gmail-provider.ts`, `email-provider/local-provider.ts`, and `email-provider/outlook-provider.ts` implement the interfaces defined in `email-provider/email-provider-types.ts`.
- `fish-delish-site/` houses the Next.js workspace app: `fish-delish-site/app/page.tsx` redirects to `/workspace`, `app/layout.tsx` now frames the single V1 shell with base styling, and `app/workspace/page.tsx` plus `app/merlin/page.tsx` render the workspace and Merlin dashboard (`fish-delish-site/components/MerlinDashboard.tsx`).
- `mira-app/` is the static M.I.R.A OS shell served from Cloudflare Pages; `mira-app/index.html` and its `js/mira.js` bundle render the assistant UI, `js/merlin-client.js` targets `https://api.elyra-core.app`, and the `modules/` folder holds the interactive dashboards and dev workspace helpers invoked by the shell.
- `mira-os/` contains the core OS runtimes (e.g., `mira-os/calendar-runner.ts`, `mira-os/workspace-runner.ts`, `mira-os/tasks-runner.ts`, and the `providers/` directory) that power the intelligence engines mounted by `services/api-gateway/server.js`.
- `merlin/` contains the reasoning engines referenced by the API gateway; `services/api-gateway/server.js` imports `merlin/dev-agent-runner.ts`, `merlin/slides-runner.ts`, and various `merlin/engines` modules to orchestrate the AI CTO flows.
- `worker/` is the Cloudflare Worker backend: `worker/src/index.ts` defines the HTTP/middle-tier handling, `/tasks`, `/assistant`, `/email`, `/calendar`, `/drive`, and `/knowledge` endpoints, with runtime helpers under `worker/src/*` plus TypeScript config and `wrangler.toml` for deployment.
- `services/api-gateway/` contains `server.js`, a local Express gateway that assembles `merlin` and `mira-os` runners for testing and exports `/assistant` summary endpoints plus planner tooling (see `services/api-gateway/server.js:1-80`).
- `tests/` holds standalone scripts like `tests/calendar-create-event-test.mjs` to validate specific flows outside the production worker.
- `merlin-vscode/`implements a VS Code dev bridge (see `merlin-vscode/package.json` for compile/watch/package scripts). It is a companion tool for local agent workflows.

## package.json inventory (excluding `node_modules`)
1. **Root (`package.json`)**
   - Scripts: `build` (`cd worker && npm run build`), `dev-agent:api`, a large suite of `miraos:test-*` helpers, and `test` that runs `ts-node` tests in `mira-os/tests` (see `package.json`, especially lines 2-32).
   - Dependencies: `express`, `node-fetch`, `googleapis`, `ts-node` (root script ties to `services/api-gateway` and worker build).
   - DevDependencies: `serve` only.
2. **fish-delish-site (`fish-delish-site/package.json`)**
   - Scripts: `dev` (`next dev`), `build` (`next build`), `start` (`next start`), plus the default failing `test` placeholder (lines 21-31).
   - Dependencies: `next`, `react`, `react-dom`; DevDependencies: TypeScript plus React/Node typings (lines 12-20).
   - Build entry: `next build` via `build` script, tail pointing to the `app/` directory (`fish-delish-site/app/page.tsx:1-4`).
3. **worker (`worker/package.json`)**
   - Scripts: `build` (`tsc -p tsconfig.json`), `dev-agent` (runs `dist/apiServer.js`), `dev-agent:watch`, plus a placeholder `test` (lines 11-31).
   - Dependencies: `@types/node`, `ts-node`, `typescript`, matching the TypeScript worker output at `worker/dist`.
4. **merlin-vscode (`merlin-vscode/package.json`)**
   - Scripts: `compile` (`tsc -p ./`), `watch`, `package` (`vsce package`); dependencies: `ws` plus TypeScript/VSC tooling in devDependencies (lines 1-31).

## Cloudflare configuration files
- **`worker/wrangler.toml`** defines the production worker `mira-assistant` (`main = "src/index.ts"`, `compatibility_date = "2025-11-05"`, `workers_dev = true`), environment `vars` (`GOOGLE_SCOPES`, `GOOGLE_REDIRECT_URI`, `DEFAULT_USER_KEY`, `MAILCHANNELS_DOMAIN`, `MAIL_FROM`, `MIRA_TASKS_DB_ID`, `MIRA_ROOT_PAGE_ID`, `OPENAI_CHAT_MODEL`, `DASHBOARD_URL`), KV binding `ASSISTANT_KV` (`id = f9413...`), cron `*/10 * * * *`, and observability logs (`enabled = true`, `head_sampling_rate = 1`, `invocation_logs = true`, `persist = true`) as seen in `worker/wrangler.toml:2-33`.
- **`wrangler.personal-assistant-dev..toml`** mirrors the same runtime but points `main = "worker/src/index.ts"` for the dev CLI flow (same env vars, KV namespace, and cron) (`wrangler.personal-assistant-dev..toml:1-33`).

## CI/CD configurations
- `.github/workflows/deploy-mira.yml` (Cloudflare Pages) runs on `push` to `main` affecting `mira-app/**` and can be triggered manually; it publishes the `./mira-app` directory to the `mira-assistant` Pages project using `cloudflare/pages-action@v1` with secrets `CF_API_TOKEN`/`CF_ACCOUNT_ID` (`.github/workflows/deploy-mira.yml`).
- `.github/workflows/deploy-site.yml` is a near-duplicate Pages workflow (also publishing `./mira-app`) that relies on `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` and is triggered by `push` to `main` or manual dispatch (`.github/workflows/deploy-site.yml`).
- `.github/workflows/deploy-worker.yml` deploys the Cloudflare Worker when files under `worker/**` change: it installs Node 20, installs `wrangler`, and runs `wrangler deploy` inside `worker/` with the same `CLOUDFLARE_*` secrets (`.github/workflows/deploy-worker.yml:1-27`).

## Application entry points
- **Workspace App (`app.elyra-core.app` candidate)**: `fish-delish-site/app/page.tsx` redirects to `/workspace`, `app/layout.tsx` frames the V1 shell with the new global rhythm, and `app/workspace/page.tsx` renders a landing card linking to `/merlin`; `components/MerlinDashboard.tsx` and `components/merlin/MerlinLayout.tsx` now deliver the single Merlin SPA experience (`fish-delish-site/app/*`).
- **M.I.R.A OS Shell (`mira-assistant`)**: A static HTML/CSS/JS bundle rooted at `mira-app/index.html` that imports `js/mira.js`, `js/merlin-client.js`, and other modules; the UI is wired to `https://api.elyra-core.app` via `mira-app/js/apiOrigin.js` and exposes dashboard/planner/knowledge panels and the command palette (`mira-app/index.html:1-200`).
- **API surface layer**: The Cloudflare Worker entry point is `worker/src/index.ts`, which defines the `/assistant/*`, `/email/*`, `/calendar/*`, `/drive/*`, `/knowledge/*`, `/memo/*`, `/notion/*`, and `/auth/google` routes plus the scheduled cron (`worker/src/index.ts`).
- **Local dev gateway**: `services/api-gateway/server.js` wires Express to `merlin`/`mira-os` runners for local testing (see imports at `services/api-gateway/server.js:1-40`).
