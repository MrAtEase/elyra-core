# Phase 5 Rename Scan

## Search commands executed
- `rg -n "mira-assistant" .`
- `rg -n "mira-assistant/" .`
- `find . -maxdepth 4 \( -name "*.yml" -o -name "*.yaml" -o -name "*.md" -o -name "*.toml" -o -name "*.ts" -o -name "*.js" -o -name "*.html" \)`

## Results by category

> Historical capture: sections 1–4 catalog existing mira-assistant mentions tied to runtime resources (Worker artifacts, docs, and domains that must stay named mira-assistant).  
> Current capture: section 5 confirms the repository path strings now live under mira-app/ after the rename.

### 1. CI / GitHub workflows
```
.github/workflows/deploy-mira.yml:7:      - 'mira-app/**'
.github/workflows/deploy-mira.yml:29:          projectName: mira-assistant
.github/workflows/deploy-mira.yml:30:          directory: ./mira-app
.github/workflows/deploy-site.yml:8:      - "mira-app/**"
.github/workflows/deploy-site.yml:23:          projectName: "mira-assistant"
.github/workflows/deploy-site.yml:24:          directory: "mira-app"
```
Each workflow now publishes `./mira-app` to the `mira-assistant` Pages project and watches that folder for changes, so the rename is complete without touching any runtime identifiers; only documentation and manual Cloudflare steps still mention the legacy name.

Runtime identifiers remain `mira-assistant` (Worker name, Pages project name, shell domain) even though the folder is now `mira-app/`.

### 2. Cloudflare / Wrangler configuration
```
worker/src/index.ts:670:  'https://mira-assistant.elyra-core.app',
worker/wrangler.toml:2:name = "mira-assistant"
```
The worker source pins the legacy shell domain for CORS/redirect flows, and the `wrangler.toml` worker name is `mira-assistant`, so Cloudflare routes and Worker metadata (custom domains, `api.elyra-core.app` binding) must be preserved/aliased during the rename.

### 3. Docs
```
docs/audit/08-backlog-epics-stories.md:10:  - Files/commands: `fish-delish-site/index.html` (update Login CTA to `https://api.elyra-core.app/assistant/oauth/google/start?next=https://app.elyra-core.app/workspace`), `mira-assistant/js/mira.js` (render a blocking login overlay when `auth:required` fires), and `mira-assistant/js/merlin-client.js` (log origin and surface redirect URLs). Run `npm run build` (if using bundler) and manually load `mira-assistant/index.html` to confirm the banner displays.
docs/audit/08-backlog-epics-stories.md:16:  - Files/commands: `mira-assistant/os/workspaceDefaults.js`, `os/stateFabric.js` (ensure workspace definitions include `company` vs `personal` metadata), `mira-assistant/js/stateActions.js` (populate navigation). Run `npm run miraos:test-workspace` (mentioned in root scripts) to validate state.
docs/audit/08-backlog-epics-stories.md:18:  - Dependencies & risks: Need persisted definitions in `mira-assistant/os/workspaceDefaults.js`; inconsistent IDs will break task seeds keyed by `${workspaceId}` in `worker/src/index.ts:717-756`.
docs/audit/08-backlog-epics-stories.md:20:  - Files/commands: `mira-assistant/js/merlin-client.js` (pass `workspaceId` through `DEFAULT_CONTEXT`), `fish-delish-site/components/merlin/MerlinLayout.tsx` (route the sidebar to the selected workspace context).
docs/audit/08-backlog-epics-stories.md:30:  - Files/commands: `mira-assistant/js/mira.js` (hook the Task card to call `/assistant/email/createTasks`), `worker/src/index.ts` (the endpoint already exists but may need real Notion integration adjustments), `mira-assistant/js/apiOrigin.js`. Test by sending `curl -X POST https://api.elyra-core.app/assistant/email/createTasks -d '{"email":{"id":"demo-1"}}'`.
docs/audit/08-backlog-epics-stories.md:36:  - Files/commands: `worker/src/index.ts` (`resolveCalendarContext`, `googleListEvents`, `googleCreateEvent`), `mira-assistant/modules/calendar.js` (if it exists) or `fish-delish-site/components` to surface events. Run `curl` against `/assistant/calendar/events` to verify date range filtering.
docs/audit/08-backlog-epics-stories.md:40:  - Files/commands: `worker/src/index.ts` (`driveListFiles`, `driveCreateDeckFile`, `createSlideDeck`, `updateSlideDeck`), `mira-assistant/js/documents.js` or planner modules (point them to `/assistant/drive/files`). Build and load `mira-assistant/index.html` to confirm the UI can list slides.
docs/audit/08-backlog-epics-stories.md:46:  - Files/commands: `worker/src/index.ts` (slides helpers), `mira-assistant/modules/dashboard.js` (triggers `os.action.pitchdeck.start`, `mira-assistant/js/merlin-client.js` to call `/assistant/slides/create`). Run `npm run miraos:test-documents` to validate the slider path.
docs/audit/08-backlog-epics-stories.md:50:  - Files/commands: New Pages/worker route that fetches `/assistant/slides/list` and renders the deck (could reuse `mira-assistant` or `fish-delish-site/`). Update `worker/src/index.ts` to inject `DASHBOARD_URL` where needed.
docs/audit/08-backlog-epics-stories.md:60:  - Files/commands: Extend `worker/src/index.ts` to provide `/assistant/ops/metrics` returning worker uptime, queue depth, Google token freshness, and optionally `env.DEFAULT_WORKSPACE_ID`. Use this endpoint from `mira-assistant/js/mira.js` dev status bar.
docs/audit/08-backlog-epics-stories.md:66:  - Files/commands: `mira-assistant/index.html` (insert consent banner), `mira-assistant/js/mira.js` (persist consent flag in localStorage, block certain actions until accepted). Document the consent text and which data is shared with OpenAI/Google/Notion.
docs/audit/01-repo-map.md:7:- `mira-assistant/` is the static M.I.R.A OS shell served from Cloudflare Pages; `mira-assistant/index.html` and its `js/mira.js` bundle render the assistant UI, `js/merlin-client.js` targets `https://api.elyra-core.app`, and the `modules/` folder holds the interactive dashboards and dev workspace helpers invoked by the shell.
docs/audit/01-repo-map.md:31:- **`worker/wrangler.toml`** defines the production worker `mira-assistant` (`main = "src/index.ts"`, `compatibility_date = "2025-11-05"`, `workers_dev = true`), environment `vars` (`GOOGLE_SCOPES`, `GOOGLE_REDIRECT_URI`, `DEFAULT_USER_KEY`, `MAILCHANNELS_DOMAIN`, `MAIL_FROM`, `MIRA_TASKS_DB_ID`, `MIRA_ROOT_PAGE_ID`, `OPENAI_CHAT_MODEL`, `DASHBOARD_URL`), KV binding `ASSISTANT_KV` (`id = f9413...`), cron `*/10 * * * *`, and observability logs (`enabled = true`, `head_sampling_rate = 1`, `invocation_logs = true`, `persist = true`) as seen in `worker/wrangler.toml:2-33`.
docs/audit/01-repo-map.md:35:- `.github/workflows/deploy-mira.yml` (Cloudflare Pages) runs on `push` to `main` affecting `mira-assistant/**` and can be triggered manually; it publishes the `./mira-assistant` directory to the `mira-assistant` Pages project using `cloudflare/pages-action@v1` with secrets `CF_API_TOKEN`/`CF_ACCOUNT_ID` (`.github/workflows/deploy-mira.yml`).
docs/audit/01-repo-map.md:36:- `.github/workflows/deploy-site.yml` is a near-duplicate Pages workflow (also publishing `./mira-assistant`) that relies on `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` and is triggered by `push` to `main` or manual dispatch (`.github/workflows/deploy-site.yml`).
docs/audit/01-repo-map.md:41:- **M.I.R.A OS Shell (`mira-assistant`)**: A static HTML/CSS/JS bundle rooted at `mira-assistant/index.html` that imports `js/mira.js`, `js/merlin-client.js`, and other modules; the UI is wired to `https://api.elyra-core.app` via `mira-assistant/js/apiOrigin.js` and exposes dashboard/planner/knowledge panels and the command palette (`mira-assistant/index.html:1-200`).
docs/audit/04-app-stack-identification.md:9:## `mira-assistant.elyra-core.app` (M.I.R.A OS shell)
docs/audit/04-app-stack-identification.md:10:- **Place in tree**: Static assets live in `mira-assistant/`. The root HTML shell (`mira-assistant/index.html:1-200`) imports CSS tokens and `js/mira.js`, renders the holographic UI, and defines the nav wheel plus command palette.
docs/audit/04-app-stack-identification.md:11:- **Tech Stack**: Plain HTML + vanilla JS modules (`js/mira.js`, `js/merlin-client.js`, `js/apiOrigin.js`), with JSON state and custom modules under `modules/`, `os/`, and `css/`. `merlin-client` targets `https://api.elyra-core.app` for `/assistant/*` calls and exposes the `auth:required` event handler that drives the login banner (`mira-assistant/js/mira.js:5146-5160`).
docs/audit/04-app-stack-identification.md:12:- **Build/deploy**: The Pages workflows (`.github/workflows/deploy-mira.yml` and `deploy-site.yml`) both publish `./mira-assistant` to the Cloudflare Pages project named `mira-assistant`, so the static shell is deployed as-is (no bundler).
docs/audit/11-6-8-weeks-roadmap.md:10:- Deliverables: Marketing `Login` CTA and MIRA overlay point to the new login endpoint; Next workspace gating (middleware or worker-facing) ensures `app.elyra-core.app` cannot render without a session (`fish-delish-site/index.html`, `mira-assistant/js/mira.js`, `fish-delish-site/app/*`).
docs/audit/11-6-8-weeks-roadmap.md:15:- Deliverables: Planner panel calls `/assistant/tasks/list` and `/create`, plus email-driven task creation via `/assistant/email/createTasks`; add consent gating for task automation if required (`MerlinLayout`, `mira-assistant/js/mira.js`).
docs/audit/11-6-8-weeks-roadmap.md:20:- Deliverables: Calendar events display (GET `/assistant/calendar/events`), creation/update flows hit Google Calendar, Drive list + upload works, slides are persisted via `/assistant/slides/*`, and the pitchdeck viewer pulls data from `/assistant/slide/list`. Capture these flows in both `mira-assistant` and `fish-delish-site` where relevant.
docs/audit/11-6-8-weeks-roadmap.md:30:- Deliverables: Consent banner + storage control in the UI (`mira-assistant/index.html`, `mira-assistant/js/mira.js`), plus a deletion endpoint that purges `google_tokens:*`, `slides:*`, `knowledge:*`, and `reminder:*`. Update the investor demo script (`09-investor-demo-script.md`) to reflect the finished flow.
docs/audit/07-risk-register.md:4:1. **Unauthenticated access to `app.elyra-core.app` and API** — `worker/src/index.ts` never returns `401`, so `mira-assistant/js/merlin-client.js` never fires `auth:required` despite relying on access tokens, and `fish-delish-site/index.html` exposes the workspace link to anyone. Impact: public access to calendar/email data. Mitigation: implement the auth gate described in `03-auth-login-flow.md` so `/assistant/*` endpoints reject missing sessions and the marketing CTA cannot reach the app without a valid cookie.
docs/audit/07-risk-register.md:6:3. **Page deployment duplication and missing workspace deployment** — Two nearly identical workflows (`deploy-mira.yml`/`deploy-site.yml`) target the same `mira-assistant` Pages project, yet there is no workflow for `fish-delish-site`. Impact: confusion, redundant builds, and no automation for the workspace app. Mitigation: consolidate Pages workflows and add a new workflow that builds/deploys `fish-delish-site` (e.g., via Cloudflare Pages or another host).
docs/phase4/00-baseline.md:50:### `mira-assistant.elyra-core.app`
docs/phase4/00-baseline.md:85:- **Primary worker name**: `mira-assistant` (defined in `worker/wrangler.toml`).
docs/phase4/00-baseline.md:87:- **Cloudflare Pages project**: `mira-assistant` (both `.github/workflows/deploy-mira.yml` and `deploy-site.yml` publish `./mira-assistant`).
docs/phase4/00-baseline.md:90:  - `mira-assistant.elyra-core.app` → Cloudflare Pages project named `mira-assistant` (`.github/workflows`); the project must be adjusted manually in the dashboard if the folder name changes.
docs/phase4/00-baseline.md:96:- `.github/workflows/deploy-mira.yml` – builds/publishes `./mira-assistant` to Cloudflare Pages.
docs/phase4/00-baseline.md:97:- `.github/workflows/deploy-site.yml` – nearly identical Pages workflow targeting the same `mira-assistant` project; consider consolidation in a later phase.
docs/audit/05-api-worker-analysis.md:13:- CORS only allows `https://app.elyra-core.app`, `https://pitchdeck.elyra-core.app`, and `https://personal-assistant.fish-delish.workers.dev` (`worker/src/index.ts:667-693`). The helper `allowCorsResponse` attaches the guard and sets `Access-Control-Allow-Credentials`, matching the SPA’s `fetch(..., { credentials: "include" })` in `mira-assistant/js/merlin-client.js`.
docs/audit/05-api-worker-analysis.md:38:- No HTTP 401 is currently emitted, so `mira-assistant/js/mira.js`'s `auth:required` event never fires—this makes the worker incorrectly allow unauthenticated API calls. Adding a gate (see Auth doc) is urgent in production.
docs/phase3/01-inventory.md:13:- `mira-assistant/` — Static MIRA shell tied to MERLIN/marketing. **Category**: Assistant (MERLIN UI). Legacy name should be `merlin-shell` or `merlin-ui` under platform core.
docs/phase3/01-inventory.md:24:- **Assistant (MERLIN)**: `mira-assistant/`, `merlin/`, `merlin-vscode/`, `mira-os/` (many modules reference MERLIN). Need clearer separation so assistant pages and helper apps reuse platform branding.
docs/phase3/01-inventory.md:29:- `mira-assistant/` uses the product name “MIRA” for a single domain; rename to `merlin-shell` or `mira-shell` but decoupled from `fish-delish` branding.
docs/audit/03-auth-login-flow.md:4:- The MIRA UI (`mira-assistant/js/mira.js:5146-5160`) listens for the `auth:required` event and shows a reconnect banner when the backend emits `401`/`AUTH_REQUIRED`. The client (`mira-assistant/js/merlin-client.js:12-66`) uses the default context `userKey: "paul"` and `credentials: "include"`, so it relies on cookies/session state from `https://api.elyra-core.app` to stay logged in.
docs/audit/03-auth-login-flow.md:6:- The marketing entry point (`fish-delish-site/index.html:1-50`) already points users to `https://mira-assistant.elyra-core.app` via the top-right Login link, so the desired flow is: marketing → login → `app.elyra-core.app`. Right now there is no enforced gate between the login click and the workspace assets.
docs/audit/03-auth-login-flow.md:26:   - CORS already allows `https://app.elyra-core.app`/`https://mira-assistant.elyra-core.app` (`worker/src/index.ts:667-693`), so once the cookie is issued on `api.elyra-core.app`, the SPA can hit `/assistant/*` with credentials.
docs/audit/03-auth-login-flow.md:41:   - Downside: `mira-assistant` (Pages shell) bypasses the middleware, so you would still need the worker gate for that origin or rely entirely on Option A. Limit Option B to the `app` domain if you choose this path.
docs/audit/03-auth-login-flow.md:43:## Option C: SPA router + session check on load (`mira-assistant/js/mira.js`, `fish-delish-site/app/layout.tsx`)
docs/audit/03-auth-login-flow.md:55:Option A is the most resilient: the worker already understands Google OAuth (`worker/src/index.ts:2006-2052`), stores tokens in `ASSISTANT_KV` (`worker/src/index.ts:1-33`), and is capable of issuing JSON-native `401` responses via `buildJsonResponse`. Adding a cookie-based gate there means both `app.elyra-core.app` and `mira-assistant.elyra-core.app` share a single auth source and we can rely on the worker to answer `auth:required` whenever the session is missing. This keeps the API reachability consistent, leverages the existing `GOOGLE_REDIRECT_URI`, and avoids the need for a separate Next middleware or SPA-only checks. After implementing the gate, update the marketing `Login` CTA (`fish-delish-site/index.html:20-40`) and the `Merlin` banner (`mira-assistant/js/mira.js:5146-5160`) to point at `/assistant/oauth/google/start?next=` before shipping.
docs/phase4/04-worker-rename-plan.md:4:- `mira-assistant` remains the worker bound to `api.elyra-core.app`. The existing `worker/wrangler.toml` and `.github/workflows/deploy-worker.yml` keep operating without change, ensuring zero downtime.
docs/phase4/04-worker-rename-plan.md:11:4. Once the alias proves stable, gradually update Cloudflare Workers > Routes to map `api.elyra-core.app/*` to both `mira-assistant` and `merlin-api`, then retire the old route after testing.
docs/phase4/04-worker-rename-plan.md:14:- [ ] Create/use `merlin-api` worker in the dashboard and configure bindings/vars identical to `mira-assistant`.
docs/phase4/04-worker-rename-plan.md:15:- [ ] Add the alias `api.elyra-core.app/*` route for `merlin-api` (Cloudflare Workers > Routes) while keeping the existing route for `mira-assistant` active.
docs/phase4/04-worker-rename-plan.md:20:- If any alias deployment causes issues, revert to the previous alias-free state by removing the `merlin-api` route and re-running `wrangler publish` for `mira-assistant`.
docs/phase4/02-alias-plan.md:4:- `worker/src/index.ts` now keeps its original allowlist entries (`app.elyra-core.app`, `pitchdeck.elyra-core.app`, the Workers.dev preview) and adds the MERLIN shell domain (`mira-assistant.elyra-core.app`).
docs/audit/02-runtime-domains-routing.md:5:| `elyra-core.app` (marketing landing) | Static HTML (see `fish-delish-site/index.html` for hero/CTA and the `Login` link to `https://mira-assistant.elyra-core.app`) | Repository file under `fish-delish-site/index.html:1-50`. No Cloudflare project referenced in repo; the exact Pages/DNS mapping must be verified manually. | Production | Secrets: not in repo. Verify via Cloudflare Pages/DNS (check the `elyra-core.app` record in Cloudflare DNS and any Pages project that publishes this `index.html`). If you cannot find it there, run `curl -I https://elyra-core.app` and inspect the headers to identify the hosting service.
docs/audit/02-runtime-domains-routing.md:6:| `mira-assistant.elyra-core.app` (M.I.R.A OS shell) | Cloudflare Pages job that publishes `./mira-assistant` (static `index.html` + `js/mira.js` driving the assistant). | `.github/workflows/deploy-mira.yml` and `deploy-site.yml` both push `./mira-assistant` to the `mira-assistant` Pages project using `CF_API_TOKEN` / `CLOUDFLARE_API_TOKEN` (see workflows). | Production | Cloudflare Pages custom domain entry should point to this project. Secrets: `CF_API_TOKEN` / `CLOUDFLARE_API_TOKEN`, plus `CF_ACCOUNT_ID`. Verify by opening the Pages project in the Cloudflare dashboard, checking `Custom domains`, and ensuring `mira-assistant.elyra-core.app` is listed.
docs/audit/02-runtime-domains-routing.md:8:| `api.elyra-core.app` (backend worker) | Cloudflare Worker defined in `worker/src/index.ts`; handles `/assistant`, `/email`, `/calendar`, `/drive`, `/knowledge`, `/memo`, `/notion`, and OAuth routes. | `worker/wrangler.toml` (name `mira-assistant`, `main = "src/index.ts"`, KV/vars/cron) and `wrangler.personal-assistant-dev..toml` (dev variant). The repo does not include the actual `Routes` entry for `api.elyra-core.app`; assume it is configured in the Cloudflare Workers dashboard. | Production + workers_dev preview | Environment vars listed in `worker/wrangler.toml` (`GOOGLE_SCOPES`, `GOOGLE_REDIRECT_URI`, `DEFAULT_USER_KEY`, `MAILCHANNELS_DOMAIN`, `MAIL_FROM`, `MIRA_TASKS_DB_ID`, `MIRA_ROOT_PAGE_ID`, `OPENAI_CHAT_MODEL`, `DASHBOARD_URL`). Secrets also include `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `OPENAI_API_KEY`, `NOTION_TOKEN`, etc., managed outside the repo. Verify the route by checking Cloudflare Workers > `Routes` for `api.elyra-core.app/*` or by running `wrangler tail` against the deployed worker.
docs/audit/02-runtime-domains-routing.md:17:- **DNS / Pages mappings**: Use the Cloudflare dashboard (Workers > `Routes`, Pages > `Custom domains`) to confirm where `elyra-core.app`, `app.elyra-core.app`, and `mira-assistant.elyra-core.app` are pointed. If the dashboard is unavailable, run `curl -I https://<domain>` and inspect the `server` header to infer the provider.
docs/phase4/03-folder-rename-decision.md:4:- The `mira-assistant/` directory currently powers the Cloudflare Pages jobs (`deploy-mira.yml` and `deploy-site.yml`). Renaming it right now would require manual changes in the Cloudflare dashboard (project name and publish directory) and risks breaking the existing workflow during the transition.
docs/phase4/99-verification.md:7:3. `curl -I https://mira-assistant.elyra-core.app`
docs/phase4/99-verification.md:13:- Visit `https://elyra-core.app` and click the “Login” CTA; ensure it points at `https://mira-assistant.elyra-core.app` without opening a broken link.
docs/phase4/99-verification.md:14:- Open `https://mira-assistant.elyra-core.app` (expect a 522 until the shell is fully healthy) and verify the console still references `https://api.elyra-core.app` for MERLIN API calls.
docs/phase4/99-verification.md:21:3. In Cloudflare, undo any route/worker alias edits and rerun `wrangler deploy` for the original `mira-assistant` worker.
docs/phase3/05-migration-strategy.md:7:  - Rename `mira-assistant/` references in docs/workflows to `merlin-shell/` (aliasing via symlink if necessary) as long as build/deploy workflows still point to the old folder for now.
docs/phase3/05-migration-strategy.md:10:  - Switch the actual folder names (`fish-delish-site` → `workspaces/fish-delish-site`, `mira-assistant` → `merlin-shell`, `worker` → `merlin-api`) once consumers (CI, deploy scripts) are updated and there is capacity to handle the rename downtime (update `wrangler` configs, Cloudflare routes, etc.).
docs/phase3/05-migration-strategy.md:16:  - Do not change runtime identifiers (e.g., `mira-assistant` worker name, `projectName: mira-assistant` in workflows) until verified with Cloudflare to avoid downtime.
docs/phase3/02-naming-plan.md:8:| `mira-assistant/` | `merlin-shell/` | Clarifies that this folder hosts the MERLIN UI shell; decouples from legacy MIRA branding while still hinting at the holographic environment. |
docs/phase3/02-naming-plan.md:14:| `mira-assistant.elyra-core.app` | `merlin.mira.os` (M.E.R.L.I.N shell) | Aligns assistant domain with new brand and explicit assistant name.
docs/phase4/05-multitenant-extraction.md:5:- `mira-assistant/` assets (HTML/JS/modules) target `fish-delish` domains and text, which also drives Google OAuth helpers via the worker.
docs/phase4/05-multitenant-extraction.md:15:2. Move domain references (`app.elyra-core.app`, `mira-assistant.elyra-core.app`, `api.elyra-core.app`) into tenant metadata so we can add `app.mira.os`, `merlin.mira.os`, `api.mira.os` later.
docs/phase4/05-multitenant-extraction.md:17:4. Keep UI templates branded per tenant by parameterizing `mira-assistant/index.html`/`fish-delish-site/index.html` with the tenant’s brand name and copy.
docs/phase4/05-multitenant-extraction.md:25:- `rg -n "fish-delish" worker/src/index.ts mira-assistant/js/apiOrigin.js fish-delish-site/index.html`
docs/miraos-phase1-contract.md:13:- Approved writers are facades defined in `mira-assistant/os/` (`layoutFacade`, `features`, `facades`, `lifecycles`, etc.) and `stateActions` helpers.
docs/phase4/01-names-glossary.md:4:- **M.E.R.L.I.N** – the assistant/orchestrator that sits behind every workspace. When we speak about actions, automations, or the persona that interacts with data, we refer to M.E.R.L.I.N. The Cloudflare Worker APIs and the MERLIN shell (currently `mira-assistant`) should emphasize this name.
docs/phase4/01-names-glossary.md:5:- **MIRA OS** – the platform experience that brings together the MERLIN assistant, dashboards, workspace configuration, and orchestrated tooling. The holographic shell (`mira-assistant`) and the emerging `mira-os/` modules all contribute to MIRA OS.
docs/panels-lifecycle-audit.md:4:- Each `mira-assistant/modules/*-panel.js` imports the panel registry (`registerPanel`, `mountLegacyModule`, `attachOsListeners`) and publishes a normalized config (`mount`, `unmount`, optional metadata). Native modules explicitly register before any UI rendering.
docs/panels-lifecycle-audit.md:8:- The new contract lives in `mira-assistant/os/panels.js` and exposes `MiraOS.panels.register`, `mount`, `unmount`, `refresh`, and `getState`. Module wrappers keep importing `registerPanel`, which delegates to the same shared registry so module metadata stays centralized.
docs/audit/00-exec-summary.md:2:- **What exists**: The repo stitches together a fish-delish marketing page (`fish-delish-site/index.html`), a Next.js workspace (`fish-delish-site/app/*`), a static M.I.R.A shell (`mira-assistant/index.html`, `js/mira.js`, `js/merlin-client.js`), and a rich Cloudflare Worker API (`worker/src/index.ts`). The worker owns Google OAuth (see `worker/wrangler.toml`), Gmail/Drive/Calendar/OpenAI integrations, and the scheduled reminder cron; its deployment is automated via `deploy-worker.yml`.
docs/audit/00-exec-summary.md:3:- **Major gaps**: There is no enforced login gate (the worker never returns 401) despite the heavy Gmail/Calendar access, and the workspace app isn’t deployed from this repo (CI only touches the `mira-assistant` Pages project). Additionally, the worker workflow runs `wrangler deploy` without `npm ci` so a clean build will fail. These risks are detailed in `docs/audit/03-auth-login-flow.md`, `docs/audit/06-ci-cd-analysis.md`, and `docs/audit/07-risk-register.md`.
docs/audit/09-investor-demo-script.md:5:   - Load `fish-delish-site/index.html` (local file mirrors the marketing hero and the top-right `Login` link to `https://mira-assistant.elyra-core.app`). Point out the story: the restaurant brand (“Taste of Croatia in Portugal”) funnels executives to the AI workspace.
docs/audit/09-investor-demo-script.md:9:   - Click “Login” and walk through the Google consent screen (explain that `GOOGLE_SCOPES`/`GOOGLE_REDIRECT_URI` are defined in `worker/wrangler.toml:9-18`). After redirect, show the MIRA shell (`mira-assistant/index.html`) with the holographic header and the nav wheel (`mira-assistant/js/mira.js` renders the dashboard/tasks/calendar icons).
docs/audit/09-investor-demo-script.md:10:   - If Google tokens aren’t configured, mention the fallback: the worker returns a 401 with `{ code: "AUTH_REQUIRED" }`, the banner in `mira-assistant/js/mira.js:5146-5160` shows “Reconnect required,” and you can demonstrate this by hitting `curl https://api.elyra-core.app/assistant/dashboard/summary` without a session.
docs/audit/09-investor-demo-script.md:13:   - Show the `Merlin` panel from `components/merlin/MerlinLayout.tsx` (workspace, planner, dev, knowledge, etc.). Click “Planner,” “Dev,” and “Knowledge” to highlight the structure, referencing the placeholders and the `Merlin` nav labels in `mira-assistant/index.html:22-145`.
docs/audit/09-investor-demo-script.md:26:   - Close with the platform pitch: the same worker+Mira shell can be re-skinned for any vertical because `worker/src/index.ts` already exposes REST endpoints, `mira-assistant/js/merlin-client.js` abstracts the API origin, and `fish-delish-site/app` can become the next configurable workspace.
docs/infra/README.md:8:- `mira-assistant.elyra-core.app` is the static M.I.R.A shell served via Cloudflare Pages (`mira-assistant/`) that wires the MERLIN client and dashboard modules to `https://api.elyra-core.app`.
docs/infra/README.md:16:- `mira-assistant/` – Static HTML/CSS/JS shell for the MERLIN assistant; imports `js/mira.js`, `js/merlin-client.js`, and `modules/*`. Published via Cloudflare Pages workflows (`deploy-mira.yml` / `deploy-site.yml`).
docs/infra/app-owner-assessment.md:5:- **`mira-assistant/` static shell**: This folder contains the HTML/CSS/JS bundle (`index.html`, `js/mira.js`, `js/merlin-client.js`, `js/apiOrigin.js`, and `modules/*`) that is currently published to `mira-assistant.elyra-core.app` via Cloudflare Pages workflows. Its scripts resolve the API origin through `window.__MIRA_API_ORIGIN__` or the hardcoded `https://api.elyra-core.app`, and each module calls `MerlinClient` before reaching `/assistant/*` on the worker. The static shell is not the primary candidate for `app.elyra-core.app` because it already owns a dedicated `mira-assistant` domain and exposes a broader MIRA OS dashboard.
docs/infra/app-owner-assessment.md:8:- **MIRA Pages (`mira-assistant/`)**: There are workflow triggers that watch `mira-assistant/**` (`deploy-mira.yml` and `deploy-site.yml`) and publish to the `mira-assistant` Pages project via `cloudflare/pages-action@v1`. Those workflows depend on Cloudflare secrets (`CF_API_TOKEN`, `CF_ACCOUNT_ID` or the equivalent) and keep the shell in sync with main.
docs/infra/app-owner-assessment.md:12:`app.elyra-core.app` is best matched to the Next workspace in `fish-delish-site/` (with `components/merlin` and the `app` router) even though the repo doesn’t provide a pipeline for it. `mira-assistant/` keeps running on its own domain through the Cloudflare Pages workflows listed above.
docs/infra/scan-results.md:16:- `mira-assistant/modules/settings.js:39` – `baseUrl: "http://127.0.0.1:5050",` – The UI’s dev agent defaults use loopback; autopilot only works when the agent is running locally.
docs/infra/scan-results.md:17:- `mira-assistant/modules/devAgentConfig.js:2` – `baseUrl: "http://127.0.0.1:5050",` – Primary dev agent endpoint in the shared config; production shells should.override this before shipping.
docs/infra/scan-results.md:18:- `mira-assistant/modules/devAgentConfig.js:7` – `baseUrl: "http://127.0.0.1:5050",` – `DEV_AGENT_DEFAULTS` reiterates the local agent base; safe for development.
docs/infra/scan-results.md:19:- `mira-app/tests/documents-no-backend-smoke-test.mjs:221` – `location: { origin: "http://localhost:3000" }` – Smoke test assumes a local dev host.
docs/infra/scan-results.md:20:- `mira-app/tests/documents-no-backend-smoke-test.mjs:254` – `assert.strictEqual(state.auth?.lastBaseOrigin, "http://localhost:3000");` – Test ensures the client records the dev host origin; not used in prod.
docs/infra/scan-results.md:26:- `mira-assistant/modules/email.js:4` – `import MerlinClient from "../js/merlin-client.js";` – The email module wires `MerlinClient` for `/assistant` calls.
docs/infra/scan-results.md:29:- `mira-assistant/modules/slides.js:1` – `import MerlinClient from "../js/merlin-client.js";` – Slides automation calls the worker via `MerlinClient`.
docs/infra/scan-results.md:30:- `mira-assistant/modules/settings.js:1958` – `(typeof window !== "undefined" && window.MERLIN_API_BASE) ||` – Settings UI reads any live override before falling back to `apiOrigin.js`.
docs/infra/scan-results.md:35:- `mira-assistant/modules/calendar.js:1` – `import MerlinClient from "../js/merlin-client.js";` – Calendar module relies on the helper to reach `/assistant/calendar` endpoints.
docs/infra/scan-results.md:36:- `mira-assistant/modules/dashboard.js:1` – `import MerlinClient from "../js/merlin-client.js";` – Dashboard module likewise calls the worker.
docs/infra/scan-results.md:37:- `mira-assistant/modules/tasks.js:1` – `import MerlinClient from "../js/merlin-client.js";` – Tasks module uses the shared API client.
docs/infra/scan-results.md:38:- `mira-assistant/modules/featurePlanner.js:3` – `import MerlinClient from "../js/merlin-client.js";` – Feature planning UI uses the worker client.
docs/infra/scan-results.md:39:- `mira-assistant/modules/documents.js:3` – `import MerlinClient from "../js/merlin-client.js";` – Documents inspector depends on the API.
docs/infra/scan-results.md:40:- `mira-assistant/js/merlin-client.js:1` – `// mira-assistant/js/merlin-client.js` – Header comment marks this module as the worker-facing client.
docs/infra/scan-results.md:41:- `mira-assistant/js/merlin-client.js:132` – `// mira-assistant/js/merlin-client.js` – Footer reference around the exported helpers.
docs/infra/scan-results.md:42:- `mira-assistant/js/apiOrigin.js:1` – `const API_ORIGIN_OVERRIDE_KEY = "miraApiOrigin";` – Defines the storage key for overriding the API origin.
docs/infra/scan-results.md:43:- `mira-assistant/js/apiOrigin.js:2` – `const DEFAULT_API_ORIGIN = "https://api.elyra-core.app";` – Default production origin for the MERLIN client.
docs/infra/scan-results.md:44:- `mira-assistant/js/apiOrigin.js:37` – `normalizeOriginCandidate(win.__MIRA_API_ORIGIN__) ||` – Looks at a global override first (useful for staging).
docs/infra/scan-results.md:45:- `mira-assistant/js/apiOrigin.js:38` – `normalizeOriginCandidate(safelyReadLocalStorage(API_ORIGIN_OVERRIDE_KEY));` – Falls back to the stored override in localStorage.
docs/infra/scan-results.md:46:- `mira-assistant/js/apiOrigin.js:45` – `return DEFAULT_API_ORIGIN;` – Otherwise, the helper stabilizes on `https://api.elyra-core.app`.
docs/infra/scan-results.md:47:- `mira-assistant/js/apiOrigin.js:58` – `const baseOrigin = overrideOrigin || DEFAULT_API_ORIGIN;` – Helper used by `buildAssistantRequestUrl` to keep URLs consistent.
docs/infra/scan-results.md:48:- `mira-assistant/js/mira.js:35` – `import MerlinClient from "./merlin-client.js";` – The shell entrypoint imports the API client.
docs/infra/scan-results.md:49:- `mira-assistant/js/mira.js:53` – `const OVERRIDDEN_API_ORIGIN = getApiOriginOverride();` – Captures runtime overrides before modules start.
docs/infra/scan-results.md:50:- `mira-assistant/js/mira.js:1148` – `apiBase: OVERRIDDEN_API_ORIGIN || null,` – Passes the resolved API base down to modules.
docs/infra/scan-results.md:51:- `mira-app/tests/dashboard-summary-post-test.mjs:41` – `const { default: MerlinClient } = await import("../js/merlin-client.js");` – Test harness explicitly imports the same client for verification.
docs/infra/scan-results.md:62:- `docs/audit/03-auth-login-flow.md:26` – Notes that CORS already allows `https://app.elyra-core.app` and `https://mira-assistant.elyra-core.app` so the API can be called with credentials.
docs/infra/scan-results.md:69:- `docs/audit/01-repo-map.md:7` – Notes that the `mira-assistant` shell and its JS bundles target `https://api.elyra-core.app` via `js/apiOrigin.js` and `js/merlin-client.js`.
docs/infra/scan-results.md:70:- `docs/audit/01-repo-map.md:41` – Reiterates that the shell is wired to the worker origin through `mira-assistant/js/apiOrigin.js`.
docs/infra/scan-results.md:74:- `docs/audit/08-backlog-epics-stories.md:10` – Points at `fish-delish-site/index.html`, `mira-assistant/js/mira.js`, and `merlin-client` when updating the Login CTA to hit the worker.
docs/infra/scan-results.md:78:- `docs/audit/08-backlog-epics-stories.md:30` – Task entry mentions using `mira-assistant/js/apiOrigin.js` while hitting `/assistant/email/createTasks`.
docs/infra/scan-results.md:84:- `docs/audit/09-investor-demo-script.md:26` – Emphasizes the worker+MIRA shell powering `app.elyra-core.app` and `mira-assistant` via the shared API origin.
docs/infra/scan-results.md:88:- `docs/phase4/04-worker-rename-plan.md:4` – Explains that `mira-assistant` stays bound to `api.elyra-core.app` while renaming efforts proceed.
docs/infra/domains.md:5:| `elyra-core.app` | Workspace marketing + login landing | `fish-delish-site/index.html` | Static marketing page linking guests to the MIRA shell (`mira-assistant.elyra-core.app`).
```

### 4. Frontend code (links, assets, modules)
```
mira-assistant/modules/devworkspace.js:23:  { path: "mira-assistant/css/mira.css", label: "MIRA styles" },
mira-assistant/modules/devworkspace.js:25:  { path: "mira-assistant/js/mira.js", label: "OS shell" },
mira-assistant/modules/devworkspace.js:32:  "mira-assistant/css/mira.css": "/* Theme tokens */\n:root { --theme-accent: #7ea4ff; }",
mira-assistant/modules/devworkspace.js:34:  "mira-assistant/js/mira.js": "// MERLIN shell behavior\nconsole.log(\"Merlin initialized\");",
mira-assistant/index.html:246:                  <div class="dev-tree-section">/mira-assistant</div>
mira-assistant/js/merlin-client.js:1:// mira-assistant/js/merlin-client.js
mira-assistant/js/merlin-client.js:132:// mira-assistant/js/merlin-client.js
mira-assistant/js/mira.js:3732:// mira-assistant/js/mira.js
fish-delish-site/mira-autoplaner-mock.html:1251:        files: ["mira-assistant/index.html", "mira-assistant/js/mira.js"],
fish-delish-site/index.html:27:      <a href="https://mira-assistant.elyra-core.app" style="font-weight:600">Login</a>
```
The shell’s own source files and the marketing site directly reference `mira-assistant`. Any internal links (dev tree, login CTA) and asset pipelines (module registry, devworkspace map) must continue to work after the folder rename and may need redirects or aliasing.

### 5. Scripts / Tooling references (current capture – repo paths)
```
package.json:5:    "miraos:test-theme": "node mira-app/tests/miraos-theme-health-test.mjs",
package.json:6:    "miraos:test-theme-contrast": "node mira-app/tests/theme-contrast-test.mjs && node mira-app/tests/theme-contrast-smoke-test.mjs",
package.json:7:    "miraos:test-lifecycle": "node mira-app/tests/lifecycle-test.mjs",
package.json:8:    "miraos:test-diagnostics": "node mira-app/tests/diagnostics-test.mjs",
package.json:9:    "miraos:test-panels": "node mira-app/tests/panels-lifecycle-test.mjs",
package.json:10:    "miraos:test-onboarding": "node mira-app/tests/onboarding-state-test.mjs && node mira-app/tests/onboarding-commands-test.mjs",
package.json:11:    "miraos:test-workspace": "node mira-app/tests/workspace-state-test.mjs && node mira-app/tests/workspace-commands-test.mjs",
package.json:12:    "miraos:test-commands": "node mira-app/tests/commands-basic-test.mjs && node mira-app/tests/commands-integration-test.mjs",
package.json:13:    "miraos:test-settings-deeplink": "node mira-app/tests/settings-deeplink-test.mjs",
package.json:14:    "miraos:test-windows": "node mira-app/tests/windows-basic-test.mjs",
package.json:15:    "miraos:test-windows-remap": "node mira-app/tests/windows-remap-test.mjs",
package.json:16:    "miraos:test-windows-overlay": "node mira-app/tests/windows-overlay-exclusive-test.mjs",
package.json:17:    "miraos:test-dashboard-summary": "node mira-app/tests/dashboard-summary-post-test.mjs",
package.json:18:    "miraos:test-capabilities": "node mira-app/tests/capabilities-test.mjs",
package.json:19:    "miraos:test-documents": "node mira-app/tests/documents-basic-test.mjs && node mira-app/tests/documents-auth-state-test.mjs && node mira-app/tests/documents-merlin-context-test.mjs && node mira-app/tests/documents-panel-command-test.mjs && node mira-app/tests/documents-no-backend-smoke-test.mjs",
package.json:20:    "miraos:test-devworkspace": "node mira-app/tests/devworkspace-basic-test.mjs",
```
The npm test scripts now run files under `mira-app/tests/`, so these repo path strings are already current while the runtime references collected earlier retain `mira-assistant`.

### Path reference spotlight (mira-app/)
- scans enumerate mira-app/.
- npm tests run under mira-app/tests/.
- remaining mira-assistant mentions point to historical/runtime identifiers (worker name, Pages project, shell domain) that must keep the legacy branding.
