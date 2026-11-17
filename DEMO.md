# Elyra Core – Demo-Ablauf (ca. 4–5 Minuten)

Ziel: zeigen, dass Elyra Core eine funktionierende KI-Assistenten-Plattform ist –
mit echtem Modell (Google Gemini), echten Daten (Gmail) und sauberer Architektur.

## Vorbereitung

```bash
cd ~/Projects/Elyra-Core/elyra-core-main
npm run dev:all          # Worker :8787, KI-Dienst :8788, Mail-Dienst :3001, Frontend :3000
```

Browser: http://localhost:3000/os – Fenster maximieren, rechtes Panel mit „Fixed“ anheften.

## Ablauf

1. **Überblick (30 s)** – Startseite „Person Control Center“: Kalender, Inbox und
   Aktivität aus den verbundenen Google-Konten. Oben die Workspaces (Person, Elyra Core, Fish Delish).
2. **Elli, Modell (20 s)** – „Welches Modell bist du?“ → Elli nennt Gemini + Modellname.
3. **Kontext pro Chat (40 s)** – „Ich bewerbe mich bei einer Performance-Marketing-Agentur.“
   → dann: „Nenne mir drei KI-Use-Cases dafür.“ → Elli bezieht sich auf die erste Nachricht.
   Danach „+ New“ → neuer Chat startet ohne den alten Kontext.
4. **Marketing Tools › Reporting (90 s)** – oben „Apps“ → „Reporting“ (oder http://localhost:3000/os/reporting).
   Dashboard: Spend, Umsatz, ROAS, CPA mit Vormonatsvergleich, Kanäle, Kampagnentabelle mit
   Auffälligkeiten (Skalierungskandidaten, Abwärtstrends, Creative-Müdigkeit) und Budget-Vorschlag.
   Ziel-ROAS umstellen → alles rechnet neu. Dann „Empfehlungen generieren“ → Elli schreibt
   Fazit, drei Maßnahmen und nächste Schritte.
   Dann oben „Als Präsentation“ → Slides öffnet einen Kunden-Report (Kennzahlen-Folien, Kanal-Vergleich,
   Zeitstrahl, Sprechernotizen) aus genau diesen Zahlen. Antwortet Gemini nicht innerhalb von 25 s,
   wird das Deck direkt aus den Report-Daten gebaut (Label „Aus Report-Daten (ohne KI)“).
   Alternativ im Chat: „Analysiere die Kampagnen-Performance vom letzten Monat und erstelle einen Kunden-Report.“
   Dazu sagen: *Prototyp mit Beispieldaten; Kennzahlen rechnet der Code, Gemini schreibt nur die
   Empfehlungen – so halluziniert das Modell keine Zahlen. Nächster Schritt wäre die Anbindung an die
   Google-Ads- und Meta-Marketing-API.*
5. **Mails (30 s)** – Mail-App öffnen: echter Gmail-Posteingang.
6. **Architektur (60 s)** – kurz erklären (siehe unten).

## Architektur in einem Satz pro Teil

- **Frontend** (Next.js 16): Elyra OS mit Fenstern, Dock und KI-Panel.
- **KI-Dienst** (Fastify, `backend/ai-service`): klassifiziert die Anfrage, antwortet direkt
  oder erstellt einen Mehrschritt-Plan mit Tools (Gmail, Kalender, Tasks, Drive, Slides),
  streamt den Fortschritt per Server-Sent Events.
- **Modell-Routing**: Gemini zuerst, bei Überlastung (503/429), Timeout oder nicht verfügbarem
  Modell automatischer Wechsel auf das nächste Modell; optional Anthropic/OpenAI/Vertex.
- **Reporting-Prototyp** (App „Marketing Tools › Reporting“, `frontend/components/os/apps/reporting/`;
  API `/v1/reporting/analysis` + `/recommendations`; Chat-Tool `reporting.analyze`; Logik in `backend/ai-service/src/reporting/`): fiktiver Kunde „Nordwind Outdoor“,
  9 Kampagnen, Oktober vs. September; KPIs (ROAS, CPA, CTR, CVR, Trends) deterministisch im Code,
  Empfehlungen per LLM, regelbasierter Fallback, falls das Modell nicht erreichbar ist.
- **Worker** (Cloudflare Workers, lokal via Wrangler): Auth und Workspaces.
- **Mail-Dienst** (`email-io`): IMAP/SMTP für iCloud-Mail.
- **Daten**: Supabase (Postgres) – Intents, Runs, Schritte, Tool-Calls, Artefakte.

## Modell umstellen

`GEMINI_MODEL` in `frontend/.env.local` und `backend/ai-service/.env`
(Fallbacks: `GEMINI_FALLBACK_MODELS` bzw. `GEMINI_FALLBACK_MODEL`).
