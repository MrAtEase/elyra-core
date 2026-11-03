# OAuth Integrations Overview

## Google OAuth Integration

### OAuth Flow

1. **Initiation:**
   - User visits `/assistant/oauth/google/start?workspaceId=<workspaceId>`
   - Worker generates OAuth state, stores in KV with TTL (5 minutes)
   - Redirects to Google OAuth consent screen with requested scopes

2. **Authorization:**
   - User approves scopes on Google consent screen
   - Google redirects to callback: `/assistant/oauth/google/callback?code=<code>&state=<state>`

3. **Token Exchange:**
   - Worker validates state from KV
   - Exchanges authorization code for access token and refresh token
   - Stores tokens in KV with workspace-scoped key

4. **Workspace Connection:**
   - Creates `workspace_connections` record in D1
   - Maps OAuth scopes to domain access (mail, calendar, drive, docs, slides)
   - Associates provider user ID and email with workspace

### Token Storage

**KV Key Format:**
```
google_tokens:<userId>:<workspaceId>
google_tokens:<userId>:<workspaceId>:<providerUserId>
```

**Token Structure:**
```json
{
  "access_token": "...",
  "refresh_token": "...",
  "expires_in": 3600,
  "expires_at": 1234567890,
  "obtained_at": 1234567890,
  "scope": "openid email profile calendar ...",
  "token_type": "Bearer",
  "providerUserId": "..."
}
```

**Storage Logic:**
- Primary key: `google_tokens:<userId>:<workspaceId>`
- Secondary key (if providerUserId present): `google_tokens:<userId>:<workspaceId>:<providerUserId>`
- Both keys store same token data for lookup flexibility

### Token Refresh

**Automatic Refresh:**
- `refreshGoogleAccessTokenIfNeeded()` checks token expiration
- If `expires_at - 60 seconds < now`, triggers refresh
- Uses `refresh_token` to obtain new `access_token`
- Updates `expires_at` and `obtained_at` timestamps
- Saves refreshed tokens back to KV

**Refresh Flow:**
1. Load tokens from KV using workspace-scoped key
2. Check if access token is expired (with 60-second buffer)
3. If expired, POST to `https://oauth2.googleapis.com/token` with:
   - `grant_type=refresh_token`
   - `refresh_token=<stored_refresh_token>`
   - `client_id` and `client_secret`
4. Parse response, update token fields
5. Save updated tokens to KV

### Workspace Scoping

**Workspace Context:**
- OAuth flow requires `workspaceId` parameter
- Tokens are stored per workspace: `google_tokens:<userId>:<workspaceId>`
- Each workspace maintains separate OAuth connection
- API operations require workspace context to load correct tokens

**Connection Records:**
- D1 table `workspace_connections` tracks active integrations
- Fields: `user_id`, `workspace_id`, `provider`, `provider_user_id`, `scopes`, `domains`, `email`
- Provider format: `google_oauth` or `google_oauth:<providerUserId>`

## Microsoft OAuth Integration

### OAuth Flow

1. **Initiation:**
   - User visits `/assistant/oauth/microsoft/start?workspaceId=<workspaceId>`
   - Worker generates OAuth state, stores in KV
   - Redirects to Microsoft OAuth consent screen

2. **Authorization:**
   - User approves scopes on Microsoft consent screen
   - Microsoft redirects to callback: `/assistant/oauth/microsoft/callback?code=<code>&state=<state>`

3. **Token Exchange:**
   - Worker validates state
   - Exchanges code for tokens at `https://login.microsoftonline.com/<tenantId>/oauth2/v2.0/token`
   - Extracts provider user ID from `id_token` (JWT payload)
   - Stores tokens in KV with workspace-scoped key

4. **Workspace Connection:**
   - Creates `workspace_connections` record in D1
   - Maps OAuth scopes to domain access
   - Associates provider user ID and email with workspace

### Token Storage

**KV Key Format:**
```
microsoft_tokens:<userId>:<workspaceId>
microsoft_tokens:<userId>:<workspaceId>:<providerUserId>
```

**Token Structure:**
```json
{
  "access_token": "...",
  "refresh_token": "...",
  "expires_in": 3600,
  "expires_at": 1234567890,
  "scope": "openid email profile Calendars.Read ...",
  "token_type": "Bearer",
  "id_token": "...",
  "providerUserId": "..."
}
```

**Storage Logic:**
- Primary key: `microsoft_tokens:<userId>:<workspaceId>`
- Secondary key (if providerUserId present): `microsoft_tokens:<userId>:<workspaceId>:<providerUserId>`
- Automatically converts `expires_in` to `expires_at` if missing

### Token Refresh

**Automatic Refresh:**
- `refreshMicrosoftAccessTokenIfNeeded()` checks token expiration
- If expired, uses `refresh_token` to obtain new `access_token`
- POSTs to `https://login.microsoftonline.com/<tenantId>/oauth2/v2.0/token`
- Updates and saves tokens

**Refresh Flow:**
1. Load tokens from KV
2. Check expiration (with 60-second buffer)
3. If expired, POST to Microsoft token endpoint with:
   - `grant_type=refresh_token`
   - `refresh_token=<stored_refresh_token>`
   - `client_id`, `client_secret`, `tenant_id`
4. Parse response, update token fields
5. Save updated tokens to KV

### Workspace Scoping

**Workspace Context:**
- Same pattern as Google: tokens stored per workspace
- Each workspace maintains separate Microsoft OAuth connection
- Provider format: `microsoft_oauth` or `microsoft_oauth:<providerUserId>`

## OAuth Scopes

### Google Scopes

| Scope | Domain | Access Level | Purpose |
|-------|--------|--------------|---------|
| `openid` | Auth | Read | Identity verification |
| `https://www.googleapis.com/auth/userinfo.email` | Auth | Read | User email address |
| `https://www.googleapis.com/auth/userinfo.profile` | Auth | Read | User profile information |
| `https://www.googleapis.com/auth/calendar` | Calendar | Read/Write | Full calendar access |
| `https://www.googleapis.com/auth/drive` | Drive | Read/Write | Full Google Drive access |
| `https://www.googleapis.com/auth/presentations` | Slides | Read/Write | Google Slides access |
| `https://www.googleapis.com/auth/gmail.send` | Gmail | Write | Send emails |
| `https://www.googleapis.com/auth/gmail.modify` | Gmail | Read/Write | Read, label, archive, trash, and modify emails |

**Default Scope String:**
```
openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/presentations https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.modify
```

### Microsoft Scopes

| Scope | Domain | Access Level | Purpose |
|-------|--------|--------------|---------|
| `openid` | Auth | Read | Identity verification |
| `email` | Auth | Read | User email address |
| `profile` | Auth | Read | User profile information |
| `Calendars.Read` | Calendar | Read | Read calendar events |
| `Calendars.ReadWrite` | Calendar | Read/Write | Full calendar access |
| `Mail.Read` | Mail | Read | Read emails |
| `Mail.Send` | Mail | Write | Send emails |
| `Files.Read` | Drive | Read | Read OneDrive files |
| `Files.ReadWrite` | Drive | Read/Write | Full OneDrive access |

**Note:** Microsoft integration is partially implemented. Full scope mapping and domain access resolution may require additional work.

## Scope to Domain Mapping

### Google Domain Mapping

| OAuth Scope | Domain | Access Level |
|-------------|--------|--------------|
| `calendar` | `calendar` | `read`, `write` |
| `gmail.modify` | `mail` | `read`, `write` |
| `gmail.send` | `mail` | `write` |
| `drive` | `drive` | `read`, `write` |
| `presentations` | `slides` | `read`, `write` |

### Microsoft Domain Mapping

| OAuth Scope | Domain | Access Level |
|-------------|--------|--------------|
| `Calendars.Read` | `calendar` | `read` |
| `Calendars.ReadWrite` | `calendar` | `read`, `write` |
| `Mail.Read` | `mail` | `read` |
| `Mail.Send` | `mail` | `write` |
| `Files.Read` | `drive` | `read` |
| `Files.ReadWrite` | `drive` | `read`, `write` |

## Integration Status Endpoints

### GET `/assistant/integrations`

Returns all integrations for the current workspace/user.

**Response:**
```json
{
  "integrations": [
    {
      "provider": "google",
      "connected": true,
      "scopes": ["openid", "email", "profile", "calendar.readonly"],
      "domains": ["mail", "calendar"],
      "email": "user@example.com"
    }
  ]
}
```

### POST `/assistant/integrations/:provider/connect`

Initiates OAuth flow for a provider.

**Parameters:**
- `provider`: `google` or `microsoft`
- `workspaceId`: Workspace ID (required)
- `scopes`: Optional scope override

**Response:**
- Redirects to OAuth consent screen
- On success, redirects back to `next` URL with tokens stored

### DELETE `/assistant/integrations/:provider`

Disconnects OAuth integration for a provider.

**Action:**
- Deletes tokens from KV
- Removes `workspace_connections` records from D1

## Security Considerations

1. **State Validation:**
   - OAuth state stored in KV with 5-minute TTL
   - State ID validated on callback to prevent CSRF

2. **Token Storage:**
   - Tokens stored in Cloudflare KV (encrypted at rest)
   - Workspace-scoped keys prevent cross-workspace token leakage

3. **Refresh Token Security:**
   - Refresh tokens never exposed to frontend
   - Automatic refresh handled server-side only

4. **Scope Validation:**
   - Scopes validated against allowed list
   - Domain access derived from granted scopes

## Open Questions

- Should we support incremental scope requests (request additional scopes after initial OAuth)?
- How should token expiration be handled if refresh fails (re-auth flow)?
- Should provider user IDs be stored separately for multi-account scenarios?
- What is the recommended approach for handling OAuth consent screen changes (scope updates)?
- How should workspace deletion cascade to OAuth tokens and connections?
- Should Microsoft integration support tenant-specific configurations beyond `MICROSOFT_TENANT_ID`?
