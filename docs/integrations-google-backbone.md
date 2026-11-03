# Google Workspace Integrations Backbone

## Übersicht

Implementierung eines produktionsnahen Integrations-Backbones für Google Workspace (Gmail + Calendar + Tasks) als Integration im MIRA Workspace.

## Implementierte Features

### 1. Workspace-scoped OAuth Flow
- **Neuer Endpoint**: `GET /assistant/oauth/google/start?workspaceId=...&scopes=mail.readonly,calendar.readonly,tasks.readonly`
  - Erzeugt Google OAuth URL mit workspace-spezifischen Scopes
  - Validiert Workspace-Zugriff des Users
  - Unterstützt Scope-Aliase (z.B. `mail.readonly`, `calendar.readonly`, `tasks.readonly`)
- **Callback**: `GET /assistant/oauth/google/callback`
  - Tauscht OAuth Code gegen Tokens
  - Speichert Tokens workspace-scoped: `google_tokens:<userId>:<workspaceId>`
  - Erstellt automatisch `workspace_connections` Einträge

### 2. Token Storage & Management
- **Storage Key Format**: `google_tokens:<userId>:<workspaceId>`
- **Zusätzlicher Key**: `google_tokens:<userId>:<workspaceId>:<providerUserId>` für Provider-User-ID Lookup
- **Token Refresh**: `refreshGoogleAccessTokenIfNeeded()` prüft Expiration und erneuert automatisch
- **Workspace-scoped**: Tokens sind immer an einen Workspace gebunden

### 3. Integration Status & Management
- **GET `/assistant/integrations/google/status`**: Gibt Connection-Status, Scopes, Expiration zurück
- **POST `/assistant/integrations/google/connect`**: Startet OAuth-Flow mit Workspace-Scopes
- **DELETE `/assistant/integrations/google/disconnect`**: Löscht Tokens und setzt Connections auf `disconnected`

### 4. Workspace Connections
- Automatische Erstellung von `workspace_connections` Einträgen für:
  - `mail` (wenn `gmail.readonly` Scope vorhanden)
  - `calendar` (wenn `calendar.readonly` Scope vorhanden)
  - `docs` (wenn Drive Scopes vorhanden)
- Provider-Format: `google_oauth:<providerUserId>`
- Status: `connected` / `disconnected`

### 5. UI Implementation
- **Settings Module**: Neue Sektion "Google Workspace Integration" in `mira-app/modules/settings.js`
- **Features**:
  - Status-Anzeige (Connected / Not connected)
  - Scope-Chips (Gmail, Calendar, Tasks)
  - Connect-Button (öffnet OAuth-Flow)
  - Disconnect-Button (löscht Tokens)
  - Automatisches Status-Refresh

## Environment Variables (Worker)

### Erforderlich
- `GOOGLE_CLIENT_ID` - Google OAuth Client ID
- `GOOGLE_CLIENT_SECRET` - Google OAuth Client Secret
- `GOOGLE_REDIRECT_URI` - OAuth Redirect URI (z.B. `https://api.elyra-core.app/assistant/oauth/google/callback`)

### Optional
- `GOOGLE_SCOPES` - Default Scopes (falls nicht gesetzt: `openid email profile https://www.googleapis.com/auth/calendar.readonly`)

## API Endpoints

### GET `/assistant/oauth/google/start`
Startet workspace-scoped Google OAuth Flow.

**Query Parameters:**
- `workspaceId` (optional): Workspace ID (falls nicht gesetzt, wird aktiver Workspace verwendet)
- `scopes` (optional): Comma-separated Scope-Aliase (z.B. `mail.readonly,calendar.readonly,tasks.readonly`)
- `next` (optional): Redirect URL nach OAuth (default: `/workspace/settings/user/integrations`)

**Response:** 302 Redirect zu Google OAuth URL

**Beispiel:**
```
GET /assistant/oauth/google/start?workspaceId=ws_123&scopes=mail.readonly,calendar.readonly,tasks.readonly
```

### GET `/assistant/oauth/google/callback`
OAuth Callback Handler (wird von Google aufgerufen).

**Query Parameters:**
- `code`: OAuth Authorization Code
- `state`: OAuth State (für CSRF-Schutz)

**Response:** 302 Redirect zu `next` URL mit Session Cookie

### GET `/assistant/integrations/google/status`
Gibt aktuellen Connection-Status zurück.

**Response:**
```json
{
  "provider": "google",
  "connected": true,
  "scopes": [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/tasks.readonly"
  ],
  "expiresAt": 1234567890
}
```

### POST `/assistant/integrations/google/connect`
Startet OAuth-Flow für Google Workspace Integration.

**Query Parameters:**
- `scopes` (optional): Comma-separated Scope-Aliase (default: `mail.readonly,calendar.readonly,tasks.readonly`)
- `next` (optional): Redirect URL nach OAuth

**Response:** 302 Redirect zu `/assistant/oauth/google/start`

### DELETE `/assistant/integrations/google/disconnect`
Löscht Google Workspace Tokens und setzt Connections auf `disconnected`.

**Response:**
```json
{
  "ok": true,
  "provider": "google"
}
```

## Scope Aliases

Die folgenden Scope-Aliase werden unterstützt:

- `mail` → Gmail full access
- `mail.readonly` → `https://www.googleapis.com/auth/gmail.readonly`
- `calendar` → Calendar full access
- `calendar.readonly` → `https://www.googleapis.com/auth/calendar.readonly`
- `tasks` → Tasks full access
- `tasks.readonly` → `https://www.googleapis.com/auth/tasks.readonly`
- `docs` → Drive + Docs + Sheets
- `slides` → Google Slides

## Lokales Testen

### 1. Worker starten
```bash
npm run dev:worker
```
- This helper ensures `wrangler dev` runs from `worker/` with `wrangler.personal-assistant-dev..toml` so that `ASSISTANT_KV` and `ASSISTANT_DB` are bound. See [docs/LOCAL_DEV.md](docs/LOCAL_DEV.md) for the full local dev workflow.

### 2. Environment Variables setzen
In `wrangler.toml` oder `.dev.vars`:
```toml
GOOGLE_CLIENT_ID = "your-client-id.apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET = "your-client-secret"
GOOGLE_REDIRECT_URI = "http://localhost:8787/assistant/oauth/google/callback"
```

### 3. Google Cloud Console konfigurieren
1. Gehe zu [Google Cloud Console](https://console.cloud.google.com/)
2. Erstelle OAuth 2.0 Credentials
3. Füge Authorized Redirect URI hinzu:
   - Local: `http://localhost:8787/assistant/oauth/google/callback`
   - Production: `https://api.elyra-core.app/assistant/oauth/google/callback`
4. Scopes konfigurieren:
   - `https://www.googleapis.com/auth/gmail.readonly`
   - `https://www.googleapis.com/auth/calendar.readonly`
   - `https://www.googleapis.com/auth/tasks.readonly`

### 4. UI testen
1. Öffne `mira-app/index.html` im Browser (oder starte lokalen Server)
2. Navigiere zu Settings
3. Scrolle zu "Google Workspace Integration"
4. Klicke "Connect Google Workspace"
5. Folge OAuth-Flow
6. Prüfe Status-Anzeige

## Datenmodell

### KV Storage
- `google_tokens:<userId>:<workspaceId>` - Google Tokens (JSON)
  - `access_token`: Access Token
  - `refresh_token`: Refresh Token
  - `expires_at`: Unix Timestamp
  - `scope`: Space-separated Scopes
  - `providerUserId`: Google User ID

### Database (D1)
- `workspace_connections` - Connection-Metadaten
  - `provider`: `google_oauth:<providerUserId>`
  - `domain`: `mail`, `calendar`, `docs`
  - `access`: `read`, `write`
  - `scopes_json`: JSON-Array der OAuth Scopes
  - `status`: `connected`, `disconnected`

## Troubleshooting

### OAuth Callback schlägt fehl
- Prüfe `GOOGLE_REDIRECT_URI` stimmt mit Google Cloud Console überein
- Prüfe `GOOGLE_CLIENT_ID` und `GOOGLE_CLIENT_SECRET` sind korrekt
- Prüfe Redirect URI ist in Authorized Redirect URIs in Google Cloud Console

### Tokens werden nicht gespeichert
- Prüfe `ASSISTANT_KV` Binding ist konfiguriert
- Prüfe Session hat `activeWorkspaceId`
- Prüfe User hat Zugriff auf Workspace

### Status zeigt "Not connected" obwohl verbunden
- Prüfe Tokens existieren in KV: `google_tokens:<userId>:<workspaceId>`
- Prüfe Workspace ID stimmt überein
- Prüfe Session ist gültig

### Scopes fehlen
- Prüfe Scope-Aliase in `GOOGLE_SCOPE_ALIAS_MAP`
- Prüfe Scopes wurden in OAuth-Flow angefordert
- Prüfe Google Cloud Console OAuth Consent Screen Scopes

## Nächste Schritte

- [ ] Erweiterte Scope-Verwaltung (UI für Scope-Auswahl)
- [ ] Token-Expiration-Warnungen
- [ ] Integration-Test-Funktionen (z.B. "Test Connection")
- [ ] Mail/Calendar/Tasks Views (separate Prompts)
- [ ] Workspace-level vs. User-level Integrationen

## Geänderte Dateien

### Backend (Worker)
- `worker/src/index.ts`
  - Neue Scope-Aliase für `mail.readonly`, `calendar.readonly`, `tasks.readonly`
  - Neuer Endpoint `/assistant/oauth/google/start` mit Workspace-Scoping
  - Erweiterte `/assistant/integrations/google/connect` für Workspace-Scopes

### Frontend
- `mira-app/modules/settings.js`
  - Neue Sektion "Google Workspace Integration"
  - Connect/Disconnect Handler
  - Status-Refresh Funktion

## Test-Checkliste

### UI Clickflow
1. [ ] Öffne Settings
2. [ ] Scrolle zu "Google Workspace Integration"
3. [ ] Prüfe Status zeigt "Not connected"
4. [ ] Klicke "Connect Google Workspace"
5. [ ] Prüfe Redirect zu Google OAuth
6. [ ] Autorisiere Scopes in Google
7. [ ] Prüfe Redirect zurück zu Settings
8. [ ] Prüfe Status zeigt "Connected"
9. [ ] Prüfe Scope-Chips werden angezeigt
10. [ ] Klicke "Disconnect"
11. [ ] Prüfe Status zeigt "Not connected" wieder

### API Endpoints
1. [ ] `GET /assistant/integrations/google/status` gibt korrekten Status zurück
2. [ ] `POST /assistant/integrations/google/connect` startet OAuth-Flow
3. [ ] `GET /assistant/oauth/google/start?workspaceId=...&scopes=...` erzeugt korrekte OAuth URL
4. [ ] `GET /assistant/oauth/google/callback` speichert Tokens korrekt
5. [ ] `DELETE /assistant/integrations/google/disconnect` löscht Tokens
