# Backlog Epics → Stories
Each epic targets 6–8 week MVP scope. Every story lists the files/commands to touch, the acceptance criteria, and dependencies/risks.

## Epic: Auth Gate + Login Flow
- **Story 1 – Worker session gate + cookie**
  - Files/commands: `worker/src/index.ts` (extend fetch handler with `requireSession`, store `mira_session` cookie, reuse `loadGoogleTokens`/`saveGoogleTokens`), `worker/package-lock.json` (via `npm run build` to regenerate artifacts), `worker/wrangler.toml` (document new `SESSION_COOKIE_NAME`), and `wrangler.personal-assistant-dev..toml` for local testing.
  - Acceptance = Worker returns `401 + { code: "AUTH_REQUIRED" }` when the cookie/key is missing, sets `Set-Cookie` after `/assistant/oauth/google/callback`, and `/assistant/*` endpoints read the validated session before executing any Google call (test with `curl -i https://api.elyra-core.app/assistant/dashboard/summary`).
  - Dependencies & risks: Requires `GOOGLE_CLIENT_ID/SECRET` in secrets; misconfigured cookie SameSite can break the SPA (verify with `merlin-client` requests).
- **Story 2 – UI login CTA + banner**
  - Files/commands: `fish-delish-site/index.html` (update Login CTA to `https://api.elyra-core.app/assistant/oauth/google/start?next=https://app.elyra-core.app/workspace`), `mira-app/js/mira.js` (render a blocking login overlay when `auth:required` fires), and `mira-app/js/merlin-client.js` (log origin and surface redirect URLs). Run `npm run build` (if using bundler) and manually load `mira-app/index.html` to confirm the banner displays.
  - Acceptance = clicking “Login” from the marketing page lands the user on Google consent and redirects back with the session cookie; the MIRA shell shows a reconnect overlay instead of letting unauthenticated interactions proceed.
  - Dependencies & risks: Browser may block third-party cookies; ensure the worker issues the cookie on the `api.elyra-core.app` domain with `SameSite=None`.

## Epic: Workspaces (Personal vs Company)
- **Story 1 – Workspace catalog view**
  - Files/commands: `mira-app/os/workspaceDefaults.js`, `os/stateFabric.js` (ensure workspace definitions include `company` vs `personal` metadata), `mira-app/js/stateActions.js` (populate navigation). Run `npm run miraos:test-workspace` (mentioned in root scripts) to validate state.
  - Acceptance = The MIRA shell lists both the personal workspace (`workspace-fish-delish`) and any company workspace, showing distinct owner/member information; commands that read `stateFabric` use the correct `workspaceId` when calling `/assistant/dashboard/summary`.
  - Dependencies & risks: Need persisted definitions in `mira-app/os/workspaceDefaults.js`; inconsistent IDs will break task seeds keyed by `${workspaceId}` in `worker/src/index.ts:717-756`.
- **Story 2 – Per-workspace context routing**
  - Files/commands: `mira-app/js/merlin-client.js` (pass `workspaceId` through `DEFAULT_CONTEXT`), `fish-delish-site/components/merlin/MerlinLayout.tsx` (route the sidebar to the selected workspace context).
  - Acceptance = Selecting “Workspace” changes the `workspaceId` query param sent to `/assistant/dashboard/summary`, and the worker returns summary metadata that reflects the workspace (validate by calling `curl "https://api.elyra-core.app/assistant/dashboard/summary?workspaceId=ws-default"`).
  - Dependencies & risks: Changing the workspace will mutate `taskStore` keys, so ensure tasks aren’t shared accidentally.

## Epic: Planner & Tasks
- **Story 1 – Planner view wires to task backend**
  - Files/commands: `fish-delish-site/components/merlin/MerlinLayout.tsx`, optionally a new `MerlinPlannerPanel.tsx`, and `worker/src/index.ts` (`/assistant/tasks/list`, `/create`, `/update`). Run `npm run build` in `fish-delish-site` to regenerate the planner UI.
  - Acceptance = The Planner panel lists tasks from `/assistant/tasks/list`, allows creation/updating via `/assistant/tasks/create`/`/assistant/tasks/update`, and displays the updated list without a refresh.
  - Dependencies & risks: `taskStore` is in-memory and keyed by `${userKey}::${workspaceId}`; for production use we will need persistent storage (risk noted for future sprint).
- **Story 2 – Email-to-task automation**
  - Files/commands: `mira-app/js/mira.js` (hook the Task card to call `/assistant/email/createTasks`), `worker/src/index.ts` (the endpoint already exists but may need real Notion integration adjustments), `mira-app/js/apiOrigin.js`. Test by sending `curl -X POST https://api.elyra-core.app/assistant/email/createTasks -d '{"email":{"id":"demo-1"}}'`.
  - Acceptance = Clicking “Create tasks” from an email forges tasks via OpenAI or fallback heuristics, and the Planner panel shows them (use Chrome DevTools to verify requests/responses).
  - Dependencies & risks: Notion integration requires `NOTION_TOKEN` and `MIRA_TASKS_DB_ID`; failing credentials should still return fallback tasks.

## Epic: Google Integrations (Calendar, Drive, Slides)
- **Story 1 – Calendar sync polish**
  - Files/commands: `worker/src/index.ts` (`resolveCalendarContext`, `googleListEvents`, `googleCreateEvent`), `mira-app/modules/calendar.js` (if it exists) or `fish-delish-site/components` to surface events. Run `curl` against `/assistant/calendar/events` to verify date range filtering.
  - Acceptance = Calendar list respects `range`, `start`, `end` parameters, and event creation updates the Google calendar (test with a real OAuth account).
  - Dependencies & risks: Requires valid Google tokens (tokens stored under `google_tokens:${userKey}` in `ASSISTANT_KV`). Without tokens, the endpoint returns 500; fallback is to show “Connect Google” instructions.
- **Story 2 – Drive/Slides integration**
  - Files/commands: `worker/src/index.ts` (`driveListFiles`, `driveCreateDeckFile`, `createSlideDeck`, `updateSlideDeck`), `mira-app/js/documents.js` or planner modules (point them to `/assistant/drive/files`). Build and load `mira-app/index.html` to confirm the UI can list slides.
  - Acceptance = The UI can list Drive files, save a `.mira-deck.json`, load it, and mutate individual slides via `/assistant/slides/update`. Open the `pitchdeck.elyra-core.app` domain (if set up) to render the deck.
  - Dependencies & risks: Drive uploads fail if `env.DISABLE_DRIVE_UPLOADS=true`. Handle that flag gracefully before invoking `uploadFileToDrive`.

## Epic: Pitchdeck Generator
- **Story 1 – Slide scaffolding**
  - Files/commands: `worker/src/index.ts` (slides helpers), `mira-app/modules/dashboard.js` (triggers `os.action.pitchdeck.start`, `mira-app/js/merlin-client.js` to call `/assistant/slides/create`). Run `npm run miraos:test-documents` to validate the slider path.
  - Acceptance = Executing the pitchdeck command generates a slide deck stored under `slides:${user}:${workspace}` and returns `deck.id`, which the UI can preview through the `pitchdeck.elyra-core.app` domain (setup as CORS allowlist entry `worker/src/index.ts:667-693`).
  - Dependencies & risks: `slides` data lives in `ASSISTANT_KV`; migrating to durable storage will require cleanup scripts in the future.
- **Story 2 – Pitchdeck consumption page**
  - Files/commands: New Pages/worker route that fetches `/assistant/slides/list` and renders the deck (could reuse `mira-assistant` or `fish-delish-site/`). Update `worker/src/index.ts` to inject `DASHBOARD_URL` where needed.
  - Acceptance = Visiting `https://pitchdeck.elyra-core.app` shows the latest deck and uses the Drive/Slides backend; CORS works because the worker already whitelists that origin (`worker/src/index.ts:667-693`).
  - Dependencies & risks: Domain `pitchdeck.elyra-core.app` must exist in DNS and point to the new frontend; otherwise, only the API path is accessible.

## Epic: Observability & Logging
- **Story 1 – Structured request logging**
  - Files/commands: `worker/src/logger.ts`, `worker/src/index.ts` (wrap requests with `logger.logRequest` and `logger.logResponse`), `worker/wrangler.toml` (ensured `observability.logs.persist = true`). Run `npm run build` inside `worker/` and use `npx wrangler tail` to validate log format.
  - Acceptance = Every `/assistant/*` request logs method/path, userKey, duration, and errors, making it easy to filter in Cloudflare Logs.
  - Dependencies & risks: Logging could expose PII; strip sensitive fields (use `logger.sanitize`) before emitting.
- **Story 2 – Health/metrics endpoint**
  - Files/commands: Extend `worker/src/index.ts` to provide `/assistant/ops/metrics` returning worker uptime, queue depth, Google token freshness, and optionally `env.DEFAULT_WORKSPACE_ID`. Use this endpoint from `mira-app/js/mira.js` dev status bar.
  - Acceptance = Dev bar shows `metrics` data refreshed via `fetch('/assistant/ops/metrics')`; failing metrics triggers a visible warning.
  - Dependencies & risks: Rate-limit this endpoint to avoid hitting Google/Notion; cache summary for a short duration.

## Epic: DSGVO minimum package (consent, deletion, audit)
- **Story 1 – Consent & privacy banner**
  - Files/commands: `mira-app/index.html` (insert consent banner), `mira-app/js/mira.js` (persist consent flag in localStorage, block certain actions until accepted). Document the consent text and which data is shared with OpenAI/Google/Notion.
  - Acceptance = MIRA shell requires consent before calling `/assistant/email/*` or `/assistant/calendar/*`, and the banner disappears once `localStorage.consented = true`.
  - Dependencies & risks: Consent must be stored per user; it cannot be overwritten by future sessions.
- **Story 2 – Data deletion audit endpoint**
  - Files/commands: `worker/src/index.ts` (new `/assistant/privacy/delete` that removes `google_tokens:${userKey}`, `slides:*`, `knowledge:*`, `reminder:*`, plus the optional `REMINDER_SENT` KV), `worker/src/index.ts` (log the keys deleted). Add CLI documentation (`worker/docs/SETUP.md`) explaining how to trigger delete via `curl`.
  - Acceptance = Calling the deletion endpoint returns the list of purged keys and is audited via Cloudflare Logs; verifying the KV prefix no longer exists via `npx wrangler kv:key get` returns 404.
  - Dependencies & risks: Deletion requires authentication; re-running the endpoint after purging should still succeed but return an empty list.
