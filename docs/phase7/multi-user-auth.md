# Phase 7: Multi-User Auth

## Intent

- Treat every authenticated person as a single `users` record and let them link multiple identity providers (Google, Apple, Microsoft, later email/password).
- Keep the assistant guard centered on the `mf-s` session cookie so no client or JS ever “carries” tokens; the worker owns session/state and revocation.
- Prepare for true multi-user tenants/workspaces while keeping provider identities distinct from the internal user.

## Data Model (D1)

```sql
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT,
  email_verified INTEGER,
  display_name TEXT,
  status TEXT,
  created_at INTEGER,
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS identities (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  email TEXT,
  email_verified INTEGER,
  created_at INTEGER,
  UNIQUE(provider, provider_user_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at INTEGER,
  expires_at INTEGER,
  revoked_at INTEGER
);
```

- Users own an email/verification flag that can be updated whenever a trusted identity asserts it.
- Identities track the provider-specific subject (`sub`, `oid`, etc.) and are the only place the worker reads tokens.
- Sessions reference `user_id`, expire via `expires_at`, and can be revoked (`revoked_at`). The `mf-s` cookie mirrors that row.

## OAuth Flow

1. Client hits `POST /assistant/oauth/:provider/start` (also `GET .../start` for legacy links) with an optional `next=…`.
2. Worker stores `state` + `next` in KV (`oauth_state:<id>`), builds the provider URL, and redirects to the provider.
3. Provider calls back to `GET|POST /assistant/oauth/:provider/callback` (Apple uses `form_post`), returning `code` + `state`.
4. Worker exchanges the code for tokens, decodes the identity payload, and upserts the identity record.
5. Worker resolves the `user` via the identity (see "Identity resolution logic").
6. Worker creates a `sessions` row + `mf-s` cookie and redirects to the sanitized `next` (defaults to the allowlisted workspace URL).
7. All `/assistant/*` endpoints read the session from the `mf-s` cookie; no tokens are embedded in the UI.

## Identity Resolution Logic (core)

```text
if (identity exists for provider + provider_user_id) {
  use identity.user_id
} else if (email is verified && user exists with same email) {
  attach identity to that user
} else {
  create new user record
  attach identity to the new user
}
```

- Never auto-merge users without a verified email. A second provider without verification becomes a new identity-linked user.
- The worker always updates `users.email`/`email_verified` when a verified provider claims that email.

## Providers

- **Google** – existing flow persists tokens in `ASSISTANT_KV` under `google_tokens:<userId>` and refreshes them server-side before calendar/email/drive calls. OAuth scopes default to `openid email profile` plus the calendar scope, offline refresh, and `prompt=consent`.
- **Apple** – builds the `authorize` URL with `response_type=code id_token`, `response_mode=form_post`, `scope=name email`, and a JWT `client_secret` (either precomputed in `APPLE_CLIENT_SECRET` or generated with `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY`). Apple returns `sub` as the stable user ID and only shares email/`email_verified` on first login; no email means no automatic merge.
- **Microsoft** – uses Azure AD v2 (`https://login.microsoftonline.com/{tenant}/oauth2/v2.0/*`), requests `openid email profile offline_access`, and prefers `oid` (fallback to `sub`). Tokens (and refresh grants) stay in the worker; the UI still relies on `mf-s`.

## API Endpoints

| Method | Route | Notes |
| --- | --- | --- |
| `GET /assistant/auth/providers` | Lists available providers (`google`, `apple`, `microsoft`). |
| `POST /assistant/oauth/:provider/start` | Initiates OAuth; stores `next` and returns a 302 to the provider. |
| `GET|POST /assistant/oauth/:provider/callback` | Handles the provider’s callback, resolves identity/user, creates session, sets `mf-s`, redirects to `next`. |
| `GET /assistant/auth/whoami` | Returns `{ ok, userId, providers: [...], providerStatus: {...}, tokenStatus: { google: {...} } }` when `mf-s` is valid; otherwise returns `401 AUTH_REQUIRED` with `loginUrl`. |
| `POST /assistant/auth/logout` | Revokes the session row, clears the `mf-s` cookie, and returns `{ ok: true }`. |

Example `providers` payload:

```json
{ "providers": [ { "id": "google", "label": "Continue with Google" }, ... ] }
```

## Security & Session Notes

- No `DEFAULT_USER_KEY` or magic `user` string can bypass the guard; every `/assistant/*` request must present `mf-s`.
- The session cookie is `HttpOnly`, `Secure`, `SameSite=Lax`, and mirrored to the session row (`expires_at`, `revoked_at`).
- Tokens never leak to the client; the worker tracks Google/Apple/Microsoft tokens in KV but refuses to use them without a valid session.
- Sessions can be revoked at any time via `/assistant/auth/logout` or by setting `revoked_at`.
- Providers are strictly identities; there is no provider-provided user object—only the internal `users` row is treated as “the user”.

## Acceptance Tests (curl)

1. **Unauthenticated whoami**
   ```bash
   curl -i https://api.elyra-core.app/assistant/auth/whoami
   ```
   Expect `HTTP 401 AUTH_REQUIRED` with `{ code: "AUTH_REQUIRED", loginUrl: "https://api.elyra-core.app/assistant/oauth/google/start", ... }`.

2. **Login via provider**
   ```bash
   open https://api.elyra-core.app/assistant/oauth/google/start?next=https://app.elyra-core.app/workspace
   ```

3. **Authenticated whoami**
   ```bash
   curl -i -b "mf-s=..." https://api.elyra-core.app/assistant/auth/whoami
   ```
   Expect `200` with `{ ok: true, userId, providers: [...], tokenStatus: { google: {...} } }`.

4. **Logout**
   ```bash
   curl -i -X POST -b "mf-s=..." https://api.elyra-core.app/assistant/auth/logout
   ```
   Expect `Set-Cookie: mf-s=; Max-Age=0`.

5. **Post-logout whoami**
   ```bash
   curl -i -b "mf-s=..." https://api.elyra-core.app/assistant/auth/whoami
   ```
   Should revert to `401 AUTH_REQUIRED`.

## TODO / Next Steps

- Wire Apple/Microsoft secrets into the production environment and verify both callbacks.
- Surface `/assistant/auth/providers` in the UI so login buttons can read the enabled providers.
- Extend identity linking to email/password in the future, reusing the same identity resolution logic.
