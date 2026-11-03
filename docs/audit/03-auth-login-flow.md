# Auth / Login Gate Analysis

## Current state ("public" access)
- The MIRA UI (`mira-app/js/mira.js:5146-5160`) listens for the `auth:required` event and shows a reconnect banner when the backend emits `401`/`AUTH_REQUIRED`. The client (`mira-app/js/merlin-client.js:12-66`) uses the default context `userKey: "paul"` and `credentials: "include"`, so it relies on cookies/session state from `https://api.elyra-core.app` to stay logged in.
- The worker contains Google OAuth helpers (`worker/src/index.ts:10-2055`) that store tokens in `ASSISTANT_KV` as `google_tokens:${userKey}`, but there is no 401 guard anywhere; every `/assistant/*`, `/email/*`, `/calendar/*`, `/drive/*`, `/knowledge/*` call simply returns data or a 500 on error. As such, `auth:required` is never triggered and the app is open to anybody who can hit `https://app.elyra-core.app` or the Pages shell.
- The marketing entry point (`fish-delish-site/index.html:1-50`) already points users to `https://mira-assistant.elyra-core.app` via the top-right Login link, so the desired flow is: marketing → login → `app.elyra-core.app`. Right now there is no enforced gate between the login click and the workspace assets.

## Product requirement
> All visitors landing on `elyra-core.app` have to authenticate via the worker’s Google OAuth before they can reach `app.elyra-core.app`. The login landing should support `next=<returnUrl>` so we can redirect back to whichever asset triggered the login. App assets must check the session cookie on every request and refuse to render if the session has expired or is missing.

## Option A: Edge gate via the Cloudflare Worker (recommended)
1. **Implementation path**
   - Extend `worker/src/index.ts` to expose a `/auth/session` or `/auth/status` endpoint that reads a session cookie (e.g., `mira_session`) and ensures it maps to a valid KV entry (use `ASSISTANT_KV.get(`session:${sessionId}`)`). Keep the existing `saveGoogleTokens`/`loadGoogleTokens` helpers and reuse them to load the `userKey`.
   - Add a `login` route (`GET /auth/google/start`) that accepts a `next` query param, stores it in a short-lived `state` KV entry plus the generated `session` id, and redirects to `https://accounts.google.com/o/oauth2/v2/auth` using the existing `GOOGLE_SCOPES` and `GOOGLE_REDIRECT_URI` from `wrangler.toml:9-18`.
   - Update `handleGoogleCallback` (`worker/src/index.ts:2030-2052`) to set a cookie `Set-Cookie: mira_session=<sessionId>; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=3600` when the token exchange succeeds, and to redirect to the remembered `next` URL (default `https://app.elyra-core.app/workspace`).
   - Add a middleware at the very top of the fetch handler (`worker/src/index.ts:3230-4060`) that checks the cookie on every request for `app` or `mira` asset routes. If the session is missing/expired, either redirect to `/auth/google/start?next=<encodedRequest>` or return `401 {code: "AUTH_REQUIRED", authUrl: ...}` so the SPA banner (from `mira.js`) can react. Use the same `buildCorsHeaders` logic (`worker/src/index.ts:667-705`) so `Access-Control-Allow-Credentials` stays `true` for `app.elyra-core.app`.
   - Protect `/assistant/*` endpoints by returning `401` when no valid session is attached, ensuring the client’s `auth:required` banner is triggered for API calls as well.
2. **Cookies/headers**
   - Cookie name: `mira_session`. Use `HttpOnly; Secure; SameSite=None; Path=/; max-age=3600`. Ensure the worker sets `Access-Control-Allow-Credentials` via `buildCorsHeaders` and `credentials: "include"` remains in `merlin-client` so the cookie is sent automatically.
   - Worker should set response header `Cache-Control: no-store` on the login callback to avoid caching.
   - API calls can optionally accept `x-session-id` (fallback) if cookies are stripped (use `extractContextValue` to check headers, similar to `userKey` resolution around `worker/src/index.ts:717`).
3. **Redirect handling**
   - `Login` button on `elyra-core.app` should point to `https://api.elyra-core.app/assistant/oauth/google/start?next=https://app.elyra-core.app/workspace`.
   - The worker saves the `next` value during the OAuth handshake (store as `state` or tie to `sessionId`). After callback, redirect to `next` or default to `DASHBOARD_URL` (`worker/wrangler.toml:18`).
4. **CORS + API calls**
   - CORS already allows `https://app.elyra-core.app`/`https://mira-assistant.elyra-core.app` (`worker/src/index.ts:667-693`), so once the cookie is issued on `api.elyra-core.app`, the SPA can hit `/assistant/*` with credentials.
   - Any login gate needs to live on the same `api.elyra-core.app` origin to avoid third-party cookie issues; this points toward the worker being the best gate.

## Option B: Next.js middleware gate (`fish-delish-site/middleware.ts`)
1. **Implementation path**
   - Create `middleware.ts` in `fish-delish-site/` that uses `NextResponse.next()`/redirect to check for the `mira_session` cookie before rendering `app/*`. All requests to `/workspace`, `/merlin`, or static assets will go through this middleware.
   - The middleware can call `https://api.elyra-core.app/auth/session` to validate the cookie (pass it via `headers: { cookie: req.headers.get('cookie') }`) and redirect to `/api/google/start?next=<requested>` if unauthorized. Alternatively, it can verify a signed JWT stored in the cookie.
2. **Cookies/headers**
   - The middleware should treat the `mira_session` cookie as `HttpOnly` and forward it to the worker validation endpoint via headers.
   - On redirect, include the `next` query param so that the login callback can send the user back to whichever workspace/private route they requested.
3. **Redirect handling**
   - Without a session, middleware redirects to `https://api.elyra-core.app/assistant/oauth/google/start?next=<encoded-original>`. After login, the worker returns to the same path.
   - Because middleware runs at the Edge, you can keep the workspace static asset available for authenticated users only.
4. **CORS/API considerations**
   - The worker-backed `/assistant/*` routes already expect credentials: this approach keeps the session completely managed by the worker while letting Next handle the pre-flight gating.
   - Downside: `mira-assistant` (Pages shell) bypasses the middleware, so you would still need the worker gate for that origin or rely entirely on Option A. Limit Option B to the `app` domain if you choose this path.

## Option C: SPA router + session check on load (`mira-app/js/mira.js`, `fish-delish-site/app/layout.tsx`)
1. **Implementation path**
   - On app startup (Next layout or MIRA shell), send a call to `/assistant/auth/status` to confirm the cookie is present; if the call returns `401`, render a full-screen `LoginRequired` modal that forces the user to log in via the OAuth start endpoint.
   - Store a client-side flag when the login banner is shown to avoid repeated popups; use localStorage for `miraAuthState`.
2. **Cookies/headers**
   - The SPA still depends on `credentials: "include"` so the `mira_session` cookie is transmitted. Without the cookie, the API returns `401` and the SPA shows the login modal (this mimics the existing `auth:required` banner but with a “block” overlay).
3. **Redirect handling**
   - After login, use `window.location.assign(next)` to land the user on the original path. Because the SPA handles this entirely client-side, you can include the `next` parameter in the OAuth URL as before.
4. **CORS/API considerations**
   - Works with the current CORS setup but leaves the assets accessible until the client detects the missing session (bad for security). Use this only if Edge/Next gating cannot be delivered in time.

## Recommended option
Option A is the most resilient: the worker already understands Google OAuth (`worker/src/index.ts:2006-2052`), stores tokens in `ASSISTANT_KV` (`worker/src/index.ts:1-33`), and is capable of issuing JSON-native `401` responses via `buildJsonResponse`. Adding a cookie-based gate there means both `app.elyra-core.app` and `mira-assistant.elyra-core.app` share a single auth source and we can rely on the worker to answer `auth:required` whenever the session is missing. This keeps the API reachability consistent, leverages the existing `GOOGLE_REDIRECT_URI`, and avoids the need for a separate Next middleware or SPA-only checks. After implementing the gate, update the marketing `Login` CTA (`fish-delish-site/index.html:20-40`) and the `Merlin` banner (`mira-app/js/mira.js:5146-5160`) to point at `/assistant/oauth/google/start?next=` before shipping.
