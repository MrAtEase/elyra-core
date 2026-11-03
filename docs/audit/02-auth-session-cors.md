# Auth, Sessions & CORS

## What exists now
- **Sessions**: `SESSION_COOKIE_NAME = 'mf-s'` is set by the worker and cleared by `POST /assistant/auth/logout`; cookies are `HttpOnly`, `Secure`, `SameSite=Lax`, scoped to `Domain=.elyra-core.app`, so the shell and API can share credentials.
- **Auth endpoints**: `/assistant/auth/whoami` returns `401 AUTH_REQUIRED` when the cookie is missing, `/assistant/oauth/google/start` initiates the OAuth handshake, `/api/google/callback` exchanges the code, and `/assistant/auth/logout` clears the session and KV tokens.
- **CORS**: `STATIC_CORS_ORIGINS` plus `DASHBOARD_URL`/`DASHBOARD_URLS` env vars build `Access-Control-Allow-Origin` with credentials, while `POST`, `GET`, `OPTIONS`, etc. remain acceptable.

## Where in code
`worker/src/index.ts` defines the cookie and CORS helpers. The headers builder looks at the request origin, merges `STATIC_CORS_ORIGINS`, overrides from `DASHBOARD_URL`/`DASHBOARD_URLS`, and only allows Pages previews under `*.pages.dev`:

```ts
const STATIC_CORS_ORIGINS = [
  'https://app.elyra-core.app',
  'https://elyra-core.app',
];

function buildCorsHeaders(request?: Request): Record<string, string> {
  const headers: Record<string, string> = {};
  const origin = request?.headers.get('Origin');
  const allowedOrigins = new Set(STATIC_CORS_ORIGINS);
  for (const overrideOrigin of getDashboardOriginOverrides(currentEnv)) {
    allowedOrigins.add(overrideOrigin);
  }
  headers['Access-Control-Allow-Methods'] = 'GET,POST,PUT,PATCH,DELETE,OPTIONS';
  headers['Access-Control-Allow-Headers'] = (request?.headers.get('Access-Control-Request-Headers') || DEFAULT_CORS_HEADERS).trim() || DEFAULT_CORS_HEADERS;
  if (origin && (allowedOrigins.has(origin) || isAllowedPagesDevOrigin(origin))) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Credentials'] = 'true';
    headers['Vary'] = 'Origin';
  }
  return headers;
}
```

Other helpers like `allowCorsResponse` and `buildJsonResponse` wrap every API response with these headers so the shell and Pages previews can call the worker in credentials mode.

## How to verify
1. `curl -i -X POST https://api.elyra-core.app/assistant/auth/logout` (should 200 with `set-cookie: mf-s=; Domain=.elyra-core.app; Max-Age=0`).
2. `curl -i https://api.elyra-core.app/assistant/auth/whoami` returns `HTTP/2 401` with `code: "AUTH_REQUIRED"`, `authUrl`, and `loginUrl`.
3. `curl -iL "https://api.elyra-core.app/assistant/oauth/google/start?next=https%3A%2F%2Fapp.elyra-core.app%2Fworkspace"` ends up redirecting to `https://accounts.google.com/o/oauth2/v2/auth` with scopes.
4. Use the shell from `https://app.elyra-core.app` and open the browser console – the worker’s CORS headers must allow the origin and provide `Access-Control-Allow-Credentials: true` for `mf-s`.

## Known gaps
- `STATIC_CORS_ORIGINS` is hardcoded to the two fish-delish origins, so any emergent host (new Pages preview or `workers.dev` alias) must be added to `DASHBOARD_URLS` or handled manually.
- OAuth callback uses `https://api.elyra-core.app/api/google/callback` only; if the worker is aliased elsewhere, the callback URI must be mirrored in Google Cloud settings to avoid redirect mismatches.
- There is no dedicated health endpoint returning `200` with CORS headers, so verifying Origins still requires hitting auth endpoints or shell assets.
