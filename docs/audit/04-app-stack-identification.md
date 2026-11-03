# App Stack Identification

## `app.elyra-core.app` (workspace)
- **Place in tree**: Implementation lives in `fish-delish-site/` which is a Next.js 14+ App Router project (`fish-delish-site/package.json` declares `next`, `react`, `react-dom` and scripts `dev`, `build`, `start`).
- **Entry points**: `fish-delish-site/app/page.tsx` redirects to `/workspace`, `app/workspace/page.tsx` renders the workspace home with a card to `/merlin`, and `/app/merlin/page.tsx` mounts `components/MerlinDashboard.tsx` → `components/merlin/MerlinLayout.tsx` for the interactive Merlin UI (see `fish-delish-site/app/*`).
- **Tech Stack**: Next.js/React + TypeScript + Tailwind-style utility classes; `app/layout.tsx:1-19` now establishes the V1 Merlin shell frame, and `components/merlin/MerlinLayout.tsx` defines the sidebar-driven layout with nav buttons, placeholder panels, planner/dev info. All frontend code compiles with `next build` via `npm run build` in `fish-delish-site/package.json:21-31`.
- **Build/Start**: Running `npm run build` (under `fish-delish-site/`) produces the Next `.next` output; `npm start` would serve the app behind a Node server if needed. However, there is no workflow that deploys `fish-delish-site`, so the actual host for `app.elyra-core.app` must be defined outside this repo (verify by checking Cloudflare Pages/Vercel/Hosts).

## `mira-assistant.elyra-core.app` (M.I.R.A OS shell)
- **Place in tree**: Static assets live in `mira-app/`. The root HTML shell (`mira-app/index.html:1-200`) imports CSS tokens and `js/mira.js`, renders the holographic UI, and defines the nav wheel plus command palette.
- **Tech Stack**: Plain HTML + vanilla JS modules (`js/mira.js`, `js/merlin-client.js`, `js/apiOrigin.js`), with JSON state and custom modules under `modules/`, `os/`, and `css/`. `merlin-client` targets `https://api.elyra-core.app` for `/assistant/*` calls and exposes the `auth:required` event handler that drives the login banner (`mira-app/js/mira.js:5146-5160`).
- **Build/deploy**: The Pages workflows (`.github/workflows/deploy-mira.yml` and `deploy-site.yml`) both publish `./mira-app` to the Cloudflare Pages project named `mira-assistant`, so the static shell is deployed as-is (no bundler).
- **Interactions**: The static shell talks to the worker backend via `js/merlin-client.js` (default user key `paul`, `credentials: "include"`) and emits `auth:required` when the worker returns `401` or `AUTH_REQUIRED` (lines 30-60 of that file).

## API layer (`api.elyra-core.app`, Cloudflare Worker)
- **Stack**: TypeScript TypeScript target (runtime `worker`). `worker/package.json` declares `ts-node`/`typescript`; `tsc -p tsconfig.json` builds the `worker/dist` bundle. Entry is `worker/src/index.ts`, compiled to `dist/apiServer.js` for production (see `worker/package.json:11-31`).
- **Routes**: `/assistant/*`, `/email/*`, `/calendar/*`, `/drive/*`, `/knowledge/*`, `/memo/*`, `/notion/*`, `/mail/test`, `/status`, `/health`, OAuth endpoints (`/api/google/auth`, `/assistant/oauth/google/*`), plus helper endpoints for tasks, slides, and reminders (see `worker/src/index.ts` from around 3230 to the bottom). The worker also runs a scheduled cron (`[triggers].crons = ["*/2 * * * *"]` in `worker/wrangler.toml:25-27`).
- **Auth/state**: Tokens live in the `ASSISTANT_KV` namespace (`worker/wrangler.toml:20-23`) and are accessed via `loadGoogleTokens`/`saveGoogleTokens` wrapping `google_tokens:${userKey}` (`worker/src/index.ts:10-33`). The worker refreshes Google tokens before each Calendar/Drive/Gmail call and uses `DASHBOARD_URL` (`worker/wrangler.toml:18`) as the default redirect target.
- **External deps**: Calls to Google APIs (`calendar/v3`, `drive/v3`, `gmail/v1`), OpenAI (`chat/completions`), Notion (`pages`), and Slack? (none). It also references `MailChannels` settings and `NOTION_TOKEN`, `MIRA_TASKS_DB_ID`, and `MIRA_ROOT_PAGE_ID` environment variables.
- **Deploy**: `.github/workflows/deploy-worker.yml` installs `wrangler` globally and runs `wrangler deploy` inside `worker/` with `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` (lines 1-26 of that workflow).

## Local API gateway (development only)
- `services/api-gateway/server.js` boots an Express server that imports `merlin` and `mira-os` runners (`services/api-gateway/server.js:1-40`). It exposes endpoints for planner/workspace intelligence, uses `express.json`, and cross-calls the same OS modules, meaning it is a standalone local dev harness for features before they are pushed into the Cloudflare Worker.

## Supporting stacks
- `mira-os/` provides runners such as `calendar-runner.ts`, `dashboard-runner.ts`, and `workspace-runner.ts`, while `merlin/` contains inference engines (`core`, `engines`, `slides-runner.ts`). These directories are referenced by `services/api-gateway/server.js` and form the brains behind both the worker and the Pages shell.
- `email-provider/` and `tests/` contain helper adapters and fixtures used by OS runners and CLI tooling; `email-provider/gmail-provider.ts` defines Gmail integrations.
