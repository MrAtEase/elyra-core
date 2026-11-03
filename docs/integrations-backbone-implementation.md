# Integrations Backbone Implementation

## Übersicht

Implementierung eines produktionsnahen Integrations-Backbones für Google und Microsoft OAuth-Integrationen (Mail/Kalender/Tasks).

## Implementierte Features

### 1. Token Storage & Management
- **Google Tokens**: Bereits vorhanden, unverändert
- **Microsoft Tokens**: Neue Funktionen `loadMicrosoftTokens()` und `saveMicrosoftTokens()`
  - Speicherung in `ASSISTANT_KV` unter `microsoft_tokens:<userId>:<workspaceId>`
  - Unterstützung für `providerUserId` als zusätzlicher Key
  - Automatische Konvertierung von `expires_in` zu `expires_at`

### 2. Token Refresh Logic
- **Google**: Bereits vorhanden (`refreshGoogleAccessTokenIfNeeded`)
- **Microsoft**: Neue Funktion `refreshMicrosoftAccessTokenIfNeeded()`
  - Prüft Token-Expiration
  - Nutzt `refresh_token` für automatische Erneuerung
  - Speichert aktualisierte Tokens zurück

### 3. Workspace Connections
- **Google**: Bereits vorhanden (`ensureGoogleWorkspaceConnections`)
- **Microsoft**: Neue Funktion `ensureMicrosoftWorkspaceConnections()`
  - Erstellt `workspace_connections` Einträge für `mail`, `calendar`, `docs`
  - Mappt Microsoft OAuth Scopes zu Domain-Access (`read`/`write`)
  - Unterstützt `resolveMicrosoftConnectionAccess()` für Scope-Interpretation

### 4. OAuth Flow Integration
- **Callback Handler**: Erweitert um Microsoft Token-Speicherung
  - Speichert Tokens nach erfolgreichem OAuth-Callback
  - Erstellt Workspace-Connections automatisch
  - Unterstützt `providerUserId` und `email` in Connection-Config

### 5. API Routes (`/assistant/integrations/*`)

#### GET `/assistant/integrations`
- Listet alle Integrationen für aktuellen Workspace/User
- Gibt Status, Scopes, Domains zurück
- Response Format:
```json
{
  "integrations": [
    {
      "provider": "google",
      "connected": true,
      "scopes": ["openid", "email", "profile", "calendar.readonly"],
      "domains": ["mail", "calendar"],
      "email": null
    }
  ]
}
```

#### POST `/assistant/integrations/:provider/connect`
- Startet OAuth-Flow für angegebenen Provider
- Unterstützt `next` Query-Parameter für Redirect nach OAuth
- Redirects zu Provider OAuth-URL

#### DELETE `/assistant/integrations/:provider/disconnect`
- Löscht Tokens aus KV
- Setzt `workspace_connections` Status auf `disconnected`
- Response: `{ "ok": true, "provider": "google" }`

#### GET `/assistant/integrations/:provider/status`
- Gibt aktuellen Connection-Status zurück
- Response Format:
```json
{
  "provider": "google",
  "connected": true,
  "scopes": ["openid", "email"],
  "expiresAt": 1234567890
}
```

### 6. UI Implementation
- **Seite**: `/workspace/settings/user/integrations`
- **Features**:
  - Liste aller verfügbaren Integrationen (Google, Microsoft)
  - Connect/Disconnect Buttons
  - Anzeige von Status, Scopes, Domains
  - Loading States während OAuth-Flow
  - Error Handling

## Betroffene Dateien

### Backend (Worker)
- `worker/src/index.ts`
  - Microsoft Token-Funktionen (Zeilen ~162-220)
  - Microsoft Workspace Connections (Zeilen ~10791-10860)
  - Microsoft Token Refresh (Zeilen ~220-280)
  - Integrations API Routes (Zeilen ~7026-7150)
  - OAuth Callback Erweiterung (Zeilen ~11093-11110)

### Frontend
- `fish-delish-site/app/workspace/settings/user/integrations/page.tsx`
  - Komplette UI-Implementierung

## Environment Variables

### Google (bereits vorhanden)
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`
- `GOOGLE_SCOPES` (optional)

### Microsoft (neu benötigt)
- `MICROSOFT_CLIENT_ID` - Azure AD App Client ID
- `MICROSOFT_CLIENT_SECRET` - Azure AD App Client Secret
- `MICROSOFT_TENANT_ID` - Optional, default: `common`
- `MICROSOFT_REDIRECT_URI` - OAuth Redirect URI (z.B. `https://api.elyra-core.app/assistant/oauth/microsoft/callback`)

## Lokales Testen

### 1. Worker starten
```bash
cd fishdelish-stack-main/worker
npm run dev
# oder
wrangler dev
```

### 2. Frontend starten
```bash
cd fishdelish-stack-main/fish-delish-site
npm run dev
```

### 3. Environment Variables setzen
In `worker/wrangler.toml` oder `.dev.vars`:
```toml
MICROSOFT_CLIENT_ID = "your-client-id"
MICROSOFT_CLIENT_SECRET = "your-client-secret"
MICROSOFT_TENANT_ID = "common"  # oder spezifische Tenant-ID
MICROSOFT_REDIRECT_URI = "http://localhost:8787/assistant/oauth/microsoft/callback"
```

### 4. URLs zum Testen

#### Integrations UI
- `http://localhost:3000/workspace/settings/user/integrations`

#### API Endpoints (direkt)
- `GET http://localhost:8787/assistant/integrations`
- `GET http://localhost:8787/assistant/integrations/google/status`
- `GET http://localhost:8787/assistant/integrations/microsoft/status`
- `POST http://localhost:8787/assistant/integrations/google/connect`
- `POST http://localhost:8787/assistant/integrations/microsoft/connect`
- `DELETE http://localhost:8787/assistant/integrations/google/disconnect`
- `DELETE http://localhost:8787/assistant/integrations/microsoft/disconnect`

### 5. Test-Flow

1. **UI öffnen**: Navigiere zu `/workspace/settings/user/integrations`
2. **Connect klicken**: Klicke auf "Connect" für Google oder Microsoft
3. **OAuth Flow**: Wird zu Provider OAuth-Seite weitergeleitet
4. **Callback**: Nach erfolgreicher Authentifizierung zurück zur Integrations-Seite
5. **Status prüfen**: Integration sollte als "Connected" angezeigt werden
6. **Disconnect testen**: Klicke auf "Disconnect" und bestätige
7. **Status prüfen**: Integration sollte als "Not Connected" angezeigt werden

## Microsoft OAuth Scopes

Standard-Scopes für Microsoft:
- `openid email profile offline_access` - Basis-Authentifizierung
- `User.Read` - Benutzer-Informationen
- `Mail.Read` - E-Mail lesen
- `Calendars.Read` - Kalender lesen

Für erweiterte Berechtigungen können Scopes über `scopeOverride` Parameter angepasst werden.

## Datenmodell

### KV Storage
- `google_tokens:<userId>:<workspaceId>` - Google Tokens
- `microsoft_tokens:<userId>:<workspaceId>` - Microsoft Tokens
- Optional: `*:<providerUserId>` Varianten für Provider-User-ID Lookup

### Database (D1)
- `workspace_connections` - Tabelle für Connection-Metadaten
  - `provider`: z.B. `google_oauth:123` oder `microsoft_oauth:456`
  - `domain`: `mail`, `calendar`, `docs`
  - `access`: `read`, `write`
  - `scopes_json`: JSON-Array der OAuth Scopes
  - `status`: `connected`, `disconnected`

## Wichtige Hinweise

1. **Keine Design-Änderungen**: UI verwendet bestehende Settings-Komponenten
2. **Keine großen Refactors**: Nur neue Funktionen und kleine Erweiterungen
3. **Workspace-basiert**: Alle Integrationen sind pro Workspace/User
4. **Token-Sicherheit**: Tokens werden nur in KV gespeichert, nie an Client gesendet
5. **Session-basiert**: Alle API-Calls erfordern gültige Session (`mf-s` Cookie)

## Nächste Schritte (optional)

- [ ] Erweiterte Scope-Verwaltung (UI für Scope-Auswahl)
- [ ] Token-Expiration-Warnungen
- [ ] Integration-Test-Funktionen (z.B. "Test Connection")
- [ ] Mehr Provider (z.B. Apple, Notion, GitHub)
- [ ] Workspace-level vs. User-level Integrationen

