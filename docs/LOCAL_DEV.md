# Local Development (canonical reference)

This is the single source of truth for running the worker and frontend locally.

## Quick-start commands (from the `mira-stack` root)

- `npm run dev:worker` → starts the Cloudflare Worker with the local config.
- `npm run dev:site` → starts the Next.js app in `fish-delish-site`.
- `npm run dev:all` → runs both worker and site in parallel (`concurrently`).

## Worker (http://localhost:8787)

### What actually runs
- `npm run dev:worker` executes `scripts/run-worker-dev.mjs`, which:
  - verifies you are in the repo root and that `worker/` plus `wrangler.personal-assistant-dev..toml` exist.
  - switches to `worker/` and runs `npx wrangler dev --config ../wrangler.personal-assistant-dev..toml`.
  - prints a summary of the bindings that are declared in that config (`ASSISTANT_KV` and `ASSISTANT_DB`).
  - forwards all CLI flags you pass (e.g., `npm run dev:worker -- --inspect`).
- The dev config (`wrangler.personal-assistant-dev..toml`) wires:
  - `ASSISTANT_KV` (temporary preview namespace provided automatically for `wrangler dev`).
  - `ASSISTANT_DB` (D1 database that backs onboarding/session state).
  - OAuth variables/redirects that point to `http://localhost:8787/assistant/oauth/google/callback`.
- The same config, plus `worker/.dev.vars`, provide:
  - `GOOGLE_*` secrets, `OPENAI_API_KEY`, `NOTION_TOKEN`, `DEFAULT_USER_KEY`, `DASHBOARD_URL`, etc.
  - `ENVIRONMENT=local` and `ALLOW_DANGEROUS_ADMIN=true` so the runtime knows it is in local mode.
  - `mf-s` cookie attributes are logged at startup so you can see the `Secure`, `SameSite`, and `SameSite=None` settings.
- `worker/.dev.vars` is gitignored; keep secrets there or in your environment rather than committing them.

### D1 migrations
- Before you exercise onboarding or workspace migrations, sync the local D1 schema:
  ```bash
  cd worker
  npx wrangler d1 migrations apply ASSISTANT_DB --local
  ```
- Run this whenever you change the SQL files in `worker/migrations/` so the local database matches production.

### Smoke test
- `node scripts/dev-smoke-test.mjs` is a lightweight script that:
  1. Confirms `/assistant/auth/whoami` returns `401 AUTH_REQUIRED`.
  2. Validates `/assistant/oauth/google/start/` returns a `302` redirect to Google.
  3. Optionally re-checks `/assistant/auth/whoami` with an `mf-s` cookie (pass `--cookie <value>` or set `MF_S_COOKIE` in your shell).
- The script inherits `WORKER_API_ORIGIN`/`WORKER_BASE` so you can target a different host if necessary.

## Frontend (http://localhost:3000)

- `npm run dev:site` runs the Next.js app that lives in `fish-delish-site`.
- The frontend automatically calls `http://localhost:8787/assistant/*` when:
  - You open `http://localhost:3000` and leave `localStorage.miraApiOrigin` set to `http://localhost:8787`, or
  - You use the UI from `fish-delish-site`, which already defaults to that origin.
- The worker responds with CORS headers that allow `http://localhost:3000` + credentials, so the `mf-s` cookie can be sent back and forth.
- If you want to test the combined experience simply run `npm run dev:all`.

## OAuth redirect & Cookies

- Google is configured to redirect to `http://localhost:8787/assistant/oauth/google/callback` when running locally (`GOOGLE_REDIRECT_URI` from `.dev.vars` and `wrangler.personal-assistant-dev..toml`).
- After authentication the worker sets the `mf-s` cookie for `localhost` so the site and worker share the session.
- Use the smoke test script or your browser devtools to capture the cookie value for manual requests (`MF_S_COOKIE=<value> node scripts/dev-smoke-test.mjs --cookie <value>`).

## Workspace & Email health helpers

- To drop any stored workspace selection for a user identity, run this in your browser console, then refresh:

  ```js
  Object.keys(localStorage)
    .filter((key) => key.startsWith("active_workspace::"))
    .forEach((key) => localStorage.removeItem(key));
  ```

- Hit `GET http://localhost:3000/api/dev/email-io-health` to see if `EMAIL_IO_BASE_URL` is reachable; append `?force=1` to re-run the HEAD check on demand. The route logs the status under `[email-io] health check` and surfaces the last result.

## Notes

- Always start the worker via `npm run dev:worker` so the helper script ensures the correct config is loaded; running `npx wrangler dev` from the wrong directory will miss bindings and fail CORS.
- This is the only LOCAL_DEV guide—remove other duplicated instructions to keep the workflow consistent.
