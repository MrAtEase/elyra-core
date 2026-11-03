# Assistant Worker – Setup & Betrieb (Vollständige Anleitung)

Diese Anleitung richtet das Cloudflare Worker‑Projekt so ein, dass du nur noch deine IDs/Secrets eintragen und kurz testen musst. Ich habe die Anleitung kompakt, fehlerfrei und schrittweise geschrieben.

---
## Übersicht — was erledigt ist
- Worker-Skeleton (TypeScript) mit Endpoints: `/health`, `/mail/test`, `/memo/set`, `/memo/get`, `/notion/create-task`.
- `wrangler.toml` mit Variablen/Platzhaltern vorbereitet.
- `worker/package.json` mit Scripts: `dev`, `deploy`, `cf:login`, `format`.
- Secrets: `NOTION_TOKEN`, `OPENAI_API_KEY` können per `wrangler secret put` gesetzt werden (einige sind bereits gesetzt).
- KV Namespaces wurden bereits angelegt — trage die IDs in `wrangler.toml` ein, falls noch Platzhalter vorhanden sind.

---
## Voraussetzungen
- Node 18+ und npm
- Cloudflare Account (du bist bereits eingeloggt)
- Domain `elyra-core.app` (für MailChannels Absender)
- Notion Internal Integration (Token) + eine Notion-Datenbank mit den Properties: **Name** (Title), **Due** (Date), **Notes** (Rich text)
- Google Cloud Projekt mit aktivierter Vertex AI API und einem Service Account mit der Rolle "Vertex AI User".

---
## 1) Projektordner & Install
```bash
cd worker
npm i
npm run cf:login
```

---
## 2) KV Namespaces (falls noch nicht in wrangler.toml)
```bash
# im Worker-Ordner
npx wrangler kv:namespace create assistant-kv --binding=MEMO --update-config
npx wrangler kv:namespace create assistant-kv-preview --binding=MEMO --preview --update-config
```
Danach: `wrangler.toml` prüfen — es sollte ein `[[kv_namespaces]]`-Block mit `binding = "MEMO"` und passenden `id`/`preview_id` geben.

---
## 3) Env-Variablen in wrangler.toml (Beispiel)
```toml
[vars]
MAILCHANNELS_DOMAIN = "elyra-core.app"
MAIL_FROM = "assistant@elyra-core.app"
NOTION_API_VERSION = "2022-06-28"
GOOGLE_SCOPES = "openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/presentations"

# Google Cloud / Vertex AI Settings
GCP_PROJECT_ID = "<DEINE_GCP_PROJEKT_ID>"
GCP_REGION = "europe-west3" # z.B. Frankfurt
GCP_GEMINI_MODEL = "gemini-1.5-pro-preview-0409" # Oder das jeweils neueste Modell
```

---
## 4) MailChannels: DNS (SPF) – unbedingt prüfen
Füge für `elyra-core.app` einen SPF-Eintrag ein oder erweitere deinen bestehenden SPF um MailChannels:
```
v=spf1 include:relay.mailchannels.net include:_spf.google.com ~all
```
DKIM/DMARC sind empfohlen für bessere Zustellbarkeit, nicht zwingend für erste Tests.

---
## 5) Secrets setzen (Wrangler)
```bash
# im worker-Ordner
npx wrangler secret put NOTION_TOKEN
npx wrangler secret put OPENAI_API_KEY   # optional
```
`NOTION_TOKEN` = Notion Internal Integration Token (gebe der Integration Les/Schreibrechte zur Ziel-DB).

---
## 6) Quellcode prüfen
Datei: `worker/src/index.ts` (ist vorhanden). Der Worker implementiert die Endpoints und nutzt `env.MEMO` (KV) sowie `env.NOTION_TOKEN`.
Wenn du Änderungen brauchst, editiere diese Datei und dann `npm run deploy`.

---
## 7) Deploy & Test
```bash
# im Worker-Ordner
npm run deploy
```
### Tests
- Health:
```bash
curl https://<DEINE_WORKER_URL>/health
```
- Mail testen:
```bash
curl -X POST https://<DEINE_WORKER_URL>/mail/test \
 -H 'content-type: application/json' \
 -d '{"to":"Paul.odak@elyra-core.app"}'
```
- KV setzen/lesen:
```bash
curl -X POST https://<DEINE_WORKER_URL>/memo/set \
 -H 'content-type: application/json' \
 -d '{"key":"focus","value":{"today":"Launch prep","owner":"Paul"}}'

curl "https://<DEINE_WORKER_URL>/memo/get?key=focus"
```
- Notion Task anlegen:
```bash
curl -X POST https://<DEINE_WORKER_URL>/notion/create-task \
 -H 'content-type: application/json' \
 -d '{"database_id":"<DEINE_NOTION_DB_ID>","title":"Kickoff Assistant","due":"2025-11-07","note":"erste Aufgabe"}'
```

---
## 8) Troubleshooting (häufig)
- **Mail nicht angekommen** → SPF/DKIM, From-Domain, MailChannels-API-Fehler prüfen
- **Notion 401/403** → Token, Integration-Rechte, DB-ID
- **KV-Fehler** → `wrangler.toml` hat falsche ID/Format; bei Parser‑Fehler `wrangler.toml` auf korrekte TOML-Syntax prüfen (z. B. `[[kv_namespaces]]` statt `kv_namespaces = [ ... ]`)
- **Deploy Errors** → `wrangler whoami`, `wrangler kv namespace list` zur Diagnose

---
## 9) Nächste Ausbaustufen (Priorität & Aufwandsschätzung)
Ich habe das weitere System in Prioritäten eingeteilt (leicht / mittel / schwer):

1) **2‑Way Sync Notion ↔ Calendar (Google Calendar)** — *schwierigkeit: mittel* — *Aufwand: 2–4 Tage*
   - OAuth Flow + Token-Refresh, Webhooks in Notion oder Polling, Mapping von Notion‑Properties ↔ Kalenderfelder, Konfliktlösung.

2) **Gmail Integration (lesen, Entwürfe vorschlagen, senden über MailChannels oder Gmail API)** — *schwierigkeit: mittel–schwer* — *Aufwand: 3–6 Tage*
   - OAuth, Push/Watch für neue Mails, Parsing, Vorlagen/Antwort-Generator, Sicherheits-Review.

3) **Präsentations‑Generator (Slides API / HTML → Slides)** — *schwierigkeit: schwer* — *Aufwand: 4–8 Tage*
   - Template-System, Design-Engine, automatische Inhalts-Extraktion aus Notion/Agenda, Export nach Google Slides/Drive.

4) **Persistentes Langzeitgedächtnis / Tasks Dashboard (KV→D1 / Durable Objects)** — *schwierigkeit: mittel* — *Aufwand: 2–4 Tage*
   - Struktur, Retention, Suche, Aufgabenstatus, Synchronisation mit Notion.

5) **Brainstorming / Mentor / Drill‑Instructor (LLM‑gestützt)** — *schwierigkeit: mittel* — *Aufwand: 2–5 Tage*
   - Prompt‑Design, Tools zur Sitzungsgliederung, Speicherung von Sitzungskontext.

---
## 10) Checklist — wir streben auf 100% Funktionalität
- [x] Worker skeleton vorhanden & deploybar
- [x] KV Namespaces angelegt (IDs beschikbaar)
- [x] Secrets (NOTION_TOKEN, OPENAI_API_KEY) gesetzt
- [x] Uptime‑Checks + Alert‑Policies (GCP) konfiguriert
- [x] MailChannels DNS: SPF ergänzt (ggf. geprüft)
- [ ] Gmail/Calendar 2‑Way Sync (todo)
- [ ] Präsentations-Generator (todo)
- [ ] Persistentes Langzeitgedächtnis/Dashboard (todo)

---
## If you want: ich kann jetzt direkt
1. Vollständige `docs/VERIFICATION_COMMANDS.md` anlegen (alle curl/curl+jq Befehle für Verifikation) — mache ich sofort.
2. `worker/src/index.ts` erweitern um einen zusätzlichen Endpoint `/gmail/authorize` (OAuth start) und `/gmail/callback` (OAuth callback) — ich erstelle die Code‑Schnipsel.
3. Präsentations‑Pipeline initial vorbereiten (Templates + HTTP‑Endpoint) — initiale Boilerplate bauen.

Sag mir jetzt: welche(s) der drei Optionen (1–3) soll ich sofort anlegen? Wenn du nichts auswählst, lege ich **1) VERIFICATION_COMMANDS.md** an (am hilfreichsten direkt).

---
*Ende der Setup-Anleitung.*


# Verifizierungs- und Prüf‑Befehle (curl / jq)

Diese Datei enthält alle wichtigen Befehle, um Services zu prüfen und Verifizierungs‑Codes zu senden/auszulesen.

## 1) Worker Health
```bash
curl https://<DEINE_WORKER_URL>/health | jq .
```

## 2) MailChannels Test (senden)
```bash
curl -X POST https://<DEINE_WORKER_URL>/mail/test \
  -H 'content-type: application/json' \
  -d '{"to":"Paul.odak@elyra-core.app"}' | jq .
```

## 3) KV Test
```bash
curl -X POST https://<DEINE_WORKER_URL>/memo/set \
  -H 'content-type: application/json' \
  -d '{"key":"test","value":{"time":"'"$(date -u)"'"}}' && \
curl "https://<DEINE_WORKER_URL>/memo/get?key=test" | jq .
```

## 4) Notion Task Test
```bash
curl -X POST https://<DEINE_WORKER_URL>/notion/create-task \
 -H 'content-type: application/json' \
 -d '{"database_id":"<DEINE_NOTION_DB_ID>","title":"API Test Task","due":"2025-11-07","note":"created by worker"}' | jq .
```

## 5) Cloudflare KV Namespaces prüfen (lokal)
```bash
# Liste auf deinem Rechner
npx wrangler kv namespace list
```

## 6) Wrangler / Deployment
```bash
# Login (falls nötig)
npm run cf:login
# Deploy
npm run deploy
# Tail logs
npx wrangler tail
```

## 7) Notion‑Token check (einfacher API‑Call)
```bash
curl -s -H "Authorization: Bearer $NOTION_TOKEN" \
  -H "Notion-Version: 2022-06-28" \
  https://api.notion.com/v1/users/me | jq .
```

---
