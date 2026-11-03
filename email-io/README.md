# Email I/O Service (Scaffold)

Die `email-io`-Service stellt eine interne HTTP-Schnittstelle bereit, über die der Cloudflare-Worker später iCloud-Mail über einen dedizierten Node.js-Prozess ansprechen kann. Aktuell sind nur die Gerüste für Auth, Routes und Fehlerhandling implementiert.

## Voraussetzungen
- Node.js 18 oder neuer
- `npm install`

## Lokaler Ablauf
```bash
cd services/email-io
npm install
npm run dev
```
Der Service lauscht standardmäßig auf Port `3001`. Verwende `PORT` zum Überschreiben.

## Build & Start
```bash
npm run build
npm start
```

## Konfiguration / ENV
| Variable | Beschreibung |
| --- | --- |
| `PORT` | (optional) Port, auf dem Fastify startet (Default `3001`). |
| `INTERNAL_API_KEY` | **Pflicht.** Der gleiche interne Schlüssel, den API-Gateway und Worker beim Header `x-internal-api-key` schicken. |
| `IMAP_SOCKET_TIMEOUT_MS` | (optional) Socket-Timeout für IMAP (ms). |
| `IMAP_AUTH_TIMEOUT_MS` | (optional) Auth-Timeout für IMAP (ms). |
| `IMAP_GREETING_TIMEOUT_MS` | (optional) Greeting-Timeout für IMAP (ms). |
| `SMTP_CONNECTION_TIMEOUT_MS` | (optional) Connection-Timeout für SMTP (ms). |
| `SMTP_GREETING_TIMEOUT_MS` | (optional) Greeting-Timeout für SMTP (ms). |
| `SMTP_SOCKET_TIMEOUT_MS` | (optional) Socket-Timeout für SMTP (ms). |

## Sicherheitsmodell
- Es gibt keine Endpunkte für externe Nutzer.
- Jeder Request muss den Header `x-internal-api-key` besitzen und exakt dem ENV-Wert `INTERNAL_API_KEY` entsprechen.
- Anfragen ohne gültigen Key bekommen einen HTTP 401 mit `{ ok: false, error: 'UNAUTHORIZED', message: '...' }`.

## Aktuelle Endpunkte
- `GET /health` → `{ ok: true }`
- `POST /icloud/folders` → `{ ok: true, folders: [...] }`
- `POST /icloud/threads` → `{ ok: true, threads: [...], folder: "INBOX" }`
- `POST /icloud/send` → `{ ok: true, messageId, accepted, rejected }`
- `POST /icloud/append` → `{ ok: true, folder, uid }`

Nach diesem Grundgerüst kann Phase 4 (IMAP-Read) direkt aufsetzen.
## Health Check
Sobald der Service läuft, kannst du ihn über den internen Key prüfen:

```bash
curl -H "x-internal-api-key: $INTERNAL_API_KEY" http://localhost:4001/health
```

Antwort:
```json
{ "ok": true }
```

## Beispiel: iCloud SMTP Send
```bash
curl -s http://localhost:4001/icloud/send \\
  -H "content-type: application/json" \\
  -H "x-internal-api-key: $INTERNAL_API_KEY" \\
  -d '{
    "workspaceId": "ws-demo",
    "identityId": "conn-icloud-123",
    "credentials": {
      "email": "user@icloud.com",
      "appPassword": "app-password",
      "smtpHost": "smtp.mail.me.com",
      "smtpPort": 587,
      "secure": false
    },
    "payload": {
      "to": ["someone@example.com"],
      "subject": "Hello",
      "text": "Plain text body",
      "headers": {
        "In-Reply-To": "<abc-123@example.com>",
        "References": "<abc-123@example.com>"
      }
    }
  }'
```

Antwort:
```json
{
  "ok": true,
  "messageId": "<...>",
  "accepted": ["someone@example.com"],
  "rejected": []
}
```

## Beispiel: iCloud IMAP Append (Sent)
```bash
curl -s http://localhost:4001/icloud/append \\
  -H "content-type: application/json" \\
  -H "x-internal-api-key: $INTERNAL_API_KEY" \\
  -d '{
    "workspaceId": "ws-demo",
    "identityId": "conn-icloud-123",
    "credentials": {
      "email": "user@icloud.com",
      "appPassword": "app-password"
    },
    "payload": {
      "folder": "Sent Messages",
      "rawMime": "From: user@icloud.com\\r\\nTo: someone@example.com\\r\\nSubject: Hello\\r\\nDate: Tue, 27 Jan 2026 10:00:00 GMT\\r\\nMessage-ID: <abc-123@example.com>\\r\\n\\r\\nPlain text body"
    }
  }'
```
