# Auth Gate Verification

## Reference files
- `worker/src/index.ts` (assistant guard, session loader, and 401 payload structure that the UI relies on)
- `mira-app/js/merlin-client.js` (401 handling, loginUrl/authUrl fallbacks, and auth:required dispatch targets)
- `mira-app/js/mira.js` (banner/redirection flow, next parameter handling, and dual auth event listeners)

## Session source
- The OAuth callback now records `users`, `identities`, and `sessions` in the D1 `ASSISTANT_DB` tables while Google tokens remain protected in `ASSISTANT_KV` at `google_tokens:<userId>`. Every authenticated request presents an `mf-s` session cookie so the guard can resolve the matching session/user and look up the tokens for that `userId`.
- When D1 is not wired, the helper layer falls back to KV-backed tables so `users`, `identities`, and `sessions` still exist locally. The `mf-s` cookie is still required to authorize a request; no fallback key auto-injects a user anymore.
- Sessions live in the `sessions` table with `createdAt`, `expiresAt`, and `revokedAt`. `/assistant/auth/whoami` surfaces the `userId`, provider set, and `tokenStatus`, while `/assistant/auth/logout` clears the cookie and marks the row as revoked so the session cannot be reused. Tokens never leave the server.

The `mf-s` cookie is `HttpOnly`, `Secure`, `SameSite=Lax`, and scoped to `/` with a `Max-Age` that mirrors `SESSION_MAX_AGE_SECONDS`. It is minted after OAuth, via the dev bypass, or any response that creates/refreshes a session, and `logout` emits a `Max-Age=0` reset so the browser cannot reuse it.

## CLI verifier
- Run `npm run verify:auth-gate` from the repo root to exercise the guard without a browser. The script still targets `https://api.elyra-core.app` by default and can be pointed elsewhere via `API_ORIGIN`.
- It seeds the same `google_tokens:<userId>` blob that the worker expects so the service has tokens available once a session exists, but it no longer tries to flip the guard open—sessions now require a browser-managed `mf-s` cookie.
- Provide `CF_ACCOUNT_ID` and `CF_API_TOKEN` so the verifier can seed `ASSISTANT_KV`; it auto-detects the namespace ID from `worker/wrangler.toml` (or use `KV_NAMESPACE_ID` to override) before writing/cleaning `google_tokens:<resolution>` with a dummy blob.
- Output shows `✅` when `/assistant/auth/whoami` (with or without the seeded KV entry) still returns `401` and `❌` if any of those endpoints unexpectedly become accessible. Run the curl flows below (or a real OAuth/dev bypass session) to confirm that `whoami` eventually moves to `200` once you present a valid cookie.

## Dev bypass (debug only)
Set `ENVIRONMENT=development` (or `ALLOW_DEV_BYPASS=true` / legacy `ALLOW_DEV_BYPASS=1`) on your dev/staging worker so that `/assistant/auth/whoami?dev_user=<id>` can mint a session cookie for the requested `userId`, returning `{ devBypass: true }` plus the `mf-s` cookie that mirrors a real OAuth flow. Production environments ignore the query and return `401 AUTH_REQUIRED`, so the bypass is strictly a tooling aid.

## Curl-based sanity checks

1. Without a cookie (any request from a fresh browser or `curl`):
   ```bash
   curl -i https://api.elyra-core.app/assistant/auth/whoami
   ```
   Expect `HTTP/1.1 401` and a JSON body like `{ "ok": false, "code": "AUTH_REQUIRED", "loginUrl": ".../assistant/oauth/google/start", "authUrl": ".../assistant/oauth/google/start" }`. The payload lets the UI show a login banner, so every guarded `/assistant/*` endpoint behaves the same way.

2. `dev_user` queries no longer work in production:
   ```bash
   curl -i "https://api.elyra-core.app/assistant/auth/whoami?dev_user=test"
   ```
   Production workers respond the same `401 AUTH_REQUIRED` payload, even if you append `?dev_user=...`. Only `ENVIRONMENT=development` (or `ALLOW_DEV_BYPASS=true`) environments can honor the flag; set one of those, grab the `mf-s` cookie from the `Set-Cookie` header, and reuse it in the following steps.

3. With a valid `mf-s` cookie (`-c /tmp/mf-s.cookie` to capture it and `-b /tmp/mf-s.cookie` to replay):
   ```bash
   curl -i -b /tmp/mf-s.cookie https://api.elyra-core.app/assistant/auth/whoami
   ```
   After a successful OAuth or dev-bypass flow you now expect `200 OK` with `{ ok: true, userId, userKey, providerStatus, tokenExpiresAt, scopes, hasRefreshToken, tokenStatus: { google: { ... } } }`. Once the cookie is present, other guarded endpoints (e.g. `/assistant/dashboard/summary`) stop throwing `401`.

4. Logout exists and clears the cookie (see the dedicated verification steps below):
   ```bash
   curl -i -b /tmp/mf-s.cookie -X POST https://api.elyra-core.app/assistant/auth/logout
   ```
   The response is `200 OK` with `{ ok: true }` and a `Set-Cookie: mf-s=; Max-Age=0` header so the browser cannot reuse the session. Repeat step 1 or 3 with the same cookie jar to confirm you fall back to `401 AUTH_REQUIRED`.

5. Optional: hitting the dashboard without a session still fails:
   ```bash
   curl -i https://api.elyra-core.app/assistant/dashboard/summary
   ```
   You should see the same `401 AUTH_REQUIRED` JSON so the guard is consistent across the assistant surface.

If you prefer Node, swap in `fetch(..., { credentials: "include" })` and inspect `Set-Cookie` plus the JSON bodies when replicating the scenarios above.

## Browser verification steps
1. Open the Shell (`mira-app`) so that it can call `/assistant/dashboard/summary`.
2. Trigger an assistant call before logging in; the worker should return `401`, `code: "AUTH_REQUIRED"`, `loginUrl`, and the client should emit `auth:required` both through `window.MiraOS` and the DOM so the shell can show the banner.
3. The overlay/banner appears with “Login required” and a Login button that points to `loginUrl`. The shell should append `next=<current shell URL>` exactly once (no duplicate `next` query keys) and it must not reopen the banner if you are already on `/assistant/oauth/...`.
4. Click Login, complete the OAuth flow, and confirm the shell returns.
5. After returning, call `GET /assistant/auth/whoami` (e.g., via devtools or another fetch) and verify a `200` response with `{ ok: true, ... }`.

## Marketing login verification
1. Open https://elyra-core.app and click the “Login” CTA in the header.
2. Confirm the browser lands on `https://api.elyra-core.app/assistant/oauth/google/start?next=...` where the `next` value is URL-encoded (ideally `https://app.elyra-core.app/workspace` or your intended entry path).
3. Complete Google OAuth and verify the final redirect goes to `https://app.elyra-core.app/workspace` (or the allowed `next` you encoded).
4. Return to the Shell/Module view and ensure the auth banner is gone, no 401 loop occurs, and `/assistant/*` calls now succeed.
5. Optionally inspect the redirect URL to ensure the marketing CTA did not point directly to the Shell (`/assistant/...`) but to the worker start endpoint instead.

## Static app note

- `curl -I https://app.elyra-core.app/workspace` can still return `200` because Cloudflare Pages (and similar static hosts) continue to serve the built bundle before any client-side guard runs.
- The relevant gate is implemented inside the `mira-app` bundle: it calls `https://api.elyra-core.app/assistant/auth/whoami` with `credentials: "include"` and, on `401` or any fetch failure, performs a redirect to `https://api.elyra-core.app/assistant/oauth/google/start?next=<encoded current URL>`.
- Verification therefore belongs in the browser (watch the `whoami` network call or observe the automatic redirect) instead of relying solely on `curl -I`, which can only inspect the static asset server response.

## End-to-End Flow: elyra-core.app → app/workspace
1. Visit https://elyra-core.app, click the Login CTA, and let the browser hand you off to `https://api.elyra-core.app/assistant/oauth/google/start?next=https%3A%2F%2Fapp.elyra-core.app%2Fworkspace`.
2. Complete the Google OAuth consent screen.
3. Expect the final redirect to land you at `https://app.elyra-core.app/workspace` (or any backed `next` target that resolves within the allowlist).
4. In DevTools → Network, trigger requests to the central assistant endpoints and confirm none return `401` (especially `whoami`, `dashboard/summary`, `tasks/list`, `calendar/events`, `drive/files`).
5. To reset the session, remove the seeded KV entry (e.g., rerun the cleanup script referenced in Prompt #5), restart the flow from step 1, and ensure the guard still redirects to OAuth before any `/assistant` calls succeed.

## So erkennst du, dass Login wirklich aktiv ist
1. Nach dem OAuth-Flow öffnest du die DevTools → Network und filterst auf `api.elyra-core.app/assistant`.
2. Fordere nacheinander diese Endpunkte an und bestätige `HTTP 2xx` (Status, Timing und Body):
    - `https://api.elyra-core.app/assistant/auth/whoami` → `{ ok: true, userId: "...", providers: [...], ... }`
   - `https://api.elyra-core.app/assistant/dashboard/summary`
   - `https://api.elyra-core.app/assistant/tasks/list`
   - `https://api.elyra-core.app/assistant/calendar/events`
   - `https://api.elyra-core.app/assistant/drive/files`
3. Schau dir den Response-Body und die Header an, um sicherzustellen, dass die Guard-Token (falls sichtbar) mit dem Browser-Session-Token übereinstimmen und kein `AUTH_REQUIRED` mehr zurückkommt.
4. Falls ein Endpunkt `401 AUTH_REQUIRED` liefert, sichere sofort die Request-URL plus den JSON-Body (oder das leere Payload) für die weitere Diagnose.

## Wenn 401 nach OAuth: welche Keys prüfen
1. Jeder eingeloggte User verwahrt seine Google-Tokens unter `google_tokens:<userId>` in `ASSISTANT_KV`. Nach einem Login schreibt `whoami` das `userId`-Feld in die Antwort, also kannst du mit diesem Wert gezielt nach `google_tokens:<userId>` suchen (z. B. via `wrangler kv:key get` oder über die Dashboard-UI).
2. Für defaultähnliche Server-Workflows (Cron, Reminder) wird weiter mit `sessions` gearbeitet; prüfe `sessions` (oder den KV-Fallback) auf einen aktiven `mf-s`-Eintrag für den `userId`, den du erwartest, da es keinen `assistant-db:default-user`-Fallback mehr gibt.
3. Sollten valide Tokens vorliegen, aber `/assistant/auth/whoami` oder andere `/assistant/*`-Aufrufe bleiben bei `401`, überprüfe die `sessions`-Tabelle (oder den KV-Fallback), ob eine `mf-s`-Session für den `userId` existiert und nicht revoked/abgelaufen ist, sowie die `identities`-Tabelle für die Provider-Mapping-Sicht.

## Logout verification (Acceptance tests)

### A) Logout endpoint exists
1. Run:
   ```bash
   curl -i -X POST https://api.elyra-core.app/assistant/auth/logout
   ```
   Expect:
   - `HTTP/1.1 200 OK`.
   - Response body `{ "ok": true }`.
   - Header `Set-Cookie: mf-s=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`.
   - If the request includes an `Origin` like `https://app.elyra-core.app`, the response also sends `Access-Control-Allow-Credentials: true`.

### B) whoami blocks after logout
1. Immediately after logout (or after clearing `mf-s` manually) run:
   ```bash
   curl -i https://api.elyra-core.app/assistant/auth/whoami
   ```
   Expect:
   - `HTTP/1.1 401 Unauthorized`.
   - JSON body `{ "ok": false, "code": "AUTH_REQUIRED", "loginUrl": "...", "authUrl": "..." }`.
   - No new `mf-s` session is minted by the server once the cookie is absent.

### C) App gating after logout (incognito proof)
1. Open an incognito/fresh browser window and visit `https://app.elyra-core.app/workspace`.
   - The middleware probes `https://api.elyra-core.app/assistant/auth/whoami`; without `mf-s` it immediately emits a redirect to `https://api.elyra-core.app/assistant/oauth/google/start?next=https%3A%2F%2Fapp.elyra-core.app%2Fworkspace`.
2. Optional: verify the server redirect manually with:
   ```bash
   curl -I https://app.elyra-core.app/workspace | rg -i "HTTP/|location:"
   ```
   Expect `HTTP/1.1 302`/`307` and a `Location` header that matches the OAuth start URL (the `next` query should point to `https://app.elyra-core.app/workspace` or a sanitized fallback).
3. After finishing the OAuth/dev bypass flow and receiving a valid `mf-s`, trigger `POST https://api.elyra-core.app/assistant/auth/logout` (via UI or curl). Revisit `/workspace` to confirm the middleware still reroutes the session-less browser all the way back to the OAuth starter URL before the page renders.

## App workspace guard verification
1. Open a fresh browser (or incognito window) and go to `https://app.elyra-core.app/workspace`. The middleware now fetches `https://api.elyra-core.app/assistant/auth/whoami` before rendering; if that request returns `401 AUTH_REQUIRED` (or fails), you should immediately see a redirect to `https://api.elyra-core.app/assistant/oauth/google/start?next=<url-encoded https://app.elyra-core.app/workspace>` where the `next` value never points to `/assistant/oauth/...`.
2. Visiting `https://app.elyra-core.app/` without a session behaves the same: the guard never lets the marketing shell render and redirects to the OAuth start URL with the sanitized `next` target.
3. After OAuth completes, `whoami` returns `200` and reloading `/workspace` (or `/merlin`) stays on the app without additional redirects, even if you refresh or hit a different protected route that your original `next` intended.
4. Trigger `POST https://api.elyra-core.app/assistant/auth/logout` (via browser/UI or curl), confirm it clears `mf-s`, then visit `/workspace` again; the guard must redirect you back to the OAuth start endpoint before any client-side JavaScript runs so the experience is locked again.
5. Optional sanity check: `curl -I https://app.elyra-core.app/workspace` now returns a `307`/`302` redirect whose `Location` header is the OAuth start URL with `next=https://app.elyra-core.app/workspace` (or the sanitized fallback) so you can audit the server-side allowlist logic.

## Workspace redirect lifecycle

1. Incognito: `/workspace` (or `/merlin`) without an `mf-s` cookie now triggers the middleware to fetch `whoami` and immediately emit a `302/307` to `https://api.elyra-core.app/assistant/oauth/google/start?next=<sanitized app URL>`—verify with `curl -I https://app.elyra-core.app/workspace | rg -i "HTTP/|location:"` and confirm the `Location` header is the OAuth starter URL (the `next` never points into `/assistant/oauth/*`).
2. Login: complete the OAuth journey so the worker issues an `mf-s` cookie; you should land back on `/workspace`, and any further refreshes or navigations stay on the page with no server-side redirect.
3. Logout: POST to `https://api.elyra-core.app/assistant/auth/logout`, observe the `Set-Cookie: mf-s=; Max-Age=0` response, and revisit `/workspace`—the middleware should again respond with a redirect to the OAuth start URL before the client renders anything.

## Done checklist
- [x] Guard logic enforces auth for `/assistant/*` (OPTIONS stays open and OAuth routes are exempt via prefix matching).
- [x] `merlin-client` now emits `auth:required` on 401, handles parse failures, and surfaces `loginUrl/next`.
- [x] `mira.js` listens to the event, renders a login banner, and navigates with `next`.
- [x] Documentation covers curl smoke tests and manual browser validation.
