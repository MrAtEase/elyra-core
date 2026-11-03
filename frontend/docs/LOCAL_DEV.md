# Local Development

Phase A needs a working local assistant and site pairing. Follow the two-terminal flow below (install dependencies once with `npm install` in each folder if needed).

## Terminal 1 (worker)
1. `cd worker`
2. `npx wrangler dev --local`

## Terminal 2 (site)
3. `cd fish-delish-site`
4. `cp .env.example .env.local` (set `NEXT_PUBLIC_ASSISTANT_API_BASE` to the Cloudflare Worker URL you want `/assistant/*` to hit—`http://localhost:8787` for local testing, `https://api.elyra-core.app` in production). The helper accepts `NEXT_PUBLIC_ASSISTANT_API_BASE` or the legacy `NEXT_PUBLIC_API_ORIGIN` / `NEXT_PUBLIC_API_URL`. If none are valid, the UI logs a warning in development and shows an “API base not configured” banner on `/signin`. Production falls back to `https://api.elyra-core.app`.
5. `npm run dev`

_The Next.js dev server starts regardless of `NEXT_PUBLIC_ASSISTANT_API_BASE`, but every helper that builds `/assistant/*` endpoints now checks the env var at runtime and warns if it cannot resolve a safe base origin. There is no silent fallback in development, so set one of the accepted env keys explicitly._

Keep both terminals alive: the worker serves the API with credentials, while the Next.js site proxies `/assistant/*` through the dev server. If you ever change the rewrites in `next.config.js`, stop and restart `npm run dev` because those rules are not picked up automatically.

| Component | Origin Source | Override Allowed |
| --- | --- | --- |
| fish-delish-site (Next.js) | `NEXT_PUBLIC_ASSISTANT_API_BASE` (or `NEXT_PUBLIC_API_ORIGIN` / `NEXT_PUBLIC_API_URL`) from `.env.local` or your deployment config | No |
| mira-app (static shell) | `window.__MIRA_API_ORIGIN__`/LocalStorage or the built-in `https://api.elyra-core.app` fallback | Yes |
| Worker (personal-assistant) | `wrangler`/env-configured host (no UI overrides) | No |

## User settings endpoint

The worker now exposes `POST /assistant/user-settings`. It accepts `{ defaultWorkspaceId, alwaysPersonalOnLogin }`, persists them in both `user_settings` and the `users.default_workspace_id`, and returns an updated whoami payload. Use this during local testing to programmatically set the workspace defaults and the “always open personal workspace” flag.

## Login / Logout Runbook

### Local

- Ensure `NEXT_PUBLIC_ASSISTANT_API_BASE=http://localhost:8787` in `.env.local`, start the worker (`npx wrangler dev`) and the site (`npm run dev`). Both terminals must stay alive during the test.
- Navigate to `http://localhost:3000/workspace`. The new header/CTA should show a “Sign in” action that redirects to `/assistant/oauth/google/start` on `http://localhost:8787`.
- After completing the OAuth flow, confirm the header shows the avatar + “Logout” action and the workspace section renders the `whoami.workspaces` list with the active workspace selected.
- Clicking “Logout” triggers `POST /assistant/auth/logout` (with `credentials: include`), clears the `mf-s` cookie, reloads `/workspace`, and surfaces the “Sign in” CTA again.

### Production

- Deploy the worker so `https://api.elyra-core.app` serves the assistant API and point `NEXT_PUBLIC_ASSISTANT_API_BASE=https://api.elyra-core.app` in the site environment.
- Visit `https://app.elyra-core.app/workspace`. The “Sign in” CTA should redirect to `https://api.elyra-core.app/assistant/oauth/google/start` when not authenticated.
- After login, the header displays “Logout” and the workspace switcher populated by `whoami.workspaces`; the workspace page sections should show the workspace options.
- Trigger logout to hit `POST https://api.elyra-core.app/assistant/auth/logout`, verify the `mf-s` cookie is cleared (`SameSite=Lax`, `Secure`, `HttpOnly`), and confirm the UI falls back to the “Sign in” state.

## Playwright smoke tests

- `tests/utils/app.ts` builds `/workspace/` based on `FDL_APP_URL` (defaulting to `http://localhost:3000`) so you can point the smoke tests at any host. The helper also appends `?e2e=1` when the tests pass `e2e: true`, so the same URLs work for both manual browsing and Playwright-driven checks.
- Local browsers can never receive the `.elyra-core.app` `mf-s` cookie (it is scoped to that domain), so `/assistant/auth/whoami` returns `401 AUTH_REQUIRED` unless the cookie is present. The smoke tests stub those 401 responses or a fetch rejection, assert that the “Ready to sign in?” panel + Google CTA are rendered, and only show the authenticated UI once a typed `WhoamiResponse` fixture (including at least one “Personal Workspace”) is returned.
- Run the stable suite while pointing at your dev server, e.g. `FDL_APP_URL=http://localhost:3000 npx playwright test tests/auth-smoke.spec.ts tests/oauth.spec.ts`, and make sure the worker/site pairing described above is running before you execute the tests.

## Manual Mail smoke checklist

1. Start the worker (`npx wrangler dev`) plus the Next.js site (`npm run dev`) so `/assistant/*` hits `http://localhost:8787`.
2. Visit `http://localhost:3000/workspace/work/mail`, open the “Mail verbinden” CTA and complete the Google OAuth flow (it will redirect back to `/workspace/work/mail` once done).
3. Once connected, confirm the status pill says “Mail verbunden”, an inbox list appears, and you can open an entry to see its details on the right.
4. Use the composer drawer: fill “An”, “Betreff” und “Nachricht”, then click “Ask Merlin to write this” or “Senden vorbereiten” and wait for a pending proposal card to appear below the detail pane.
5. In that proposal card, hit “Senden” to confirm and make sure Merlin reports the send confirmation, or click “Ändern” to ask for another draft, verifying the helper re-opens the proposal workflow.
