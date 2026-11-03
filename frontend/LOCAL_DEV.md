# Local Development (fish-delish-site)

1. **Terminal A – Worker (lokal auf 8787 starten)**
   - `cd ../worker`
   - `npx wrangler dev`
   - Der Worker hört standardmäßig auf `http://localhost:8787` und bindet die D1-Instanz `ASSISTANT_DB` sowie die Secrets aus `.dev.vars`.
   - OAuth-Redirect: `http://localhost:8787/api/google/callback` (gleiches Ziel wie `GOOGLE_REDIRECT_URI` in `worker/.dev.vars`).
   - Damit der lokalen OAuth-Flow das Workspace-Frontend kennt, steht dort `DASHBOARD_URL=http://localhost:3000` in `worker/.dev.vars`, damit der Worker den Next-Host als Default-/Allowlist-Ziel erkennt.

2. **Terminal B – Next (frontend auf 3000 starten)**
   - `cd ../fish-delish-site`
   - `cp .env.example .env.local` (falls noch nicht vorhanden) und setze `NEXT_PUBLIC_ASSISTANT_API_BASE` auf die Worker-URL, die du für `/assistant/*` nutzen willst (`http://localhost:8787` lokal, `https://api.elyra-core.app` in der Produktion).
   - `npm run dev`
   - Die Next-App löst die Assistant-Base-URL aus `NEXT_PUBLIC_ASSISTANT_API_BASE` (oder den Legacy-Varianten `NEXT_PUBLIC_API_ORIGIN` / `NEXT_PUBLIC_API_URL`). Fehlt die Variable oder ist sie ungültig, loggt die App in Development eine Warnung und zeigt auf `/signin` das Banner „API base not configured“. In Production wird auf `https://api.elyra-core.app` zurückgefallen, damit Previews nicht brechen.
   - Es gibt keine Alternativen wie `window.__MIRA_API_ORIGIN__` oder Local-Storage-Overrides für das Next-Frontend.
   - Wenn du die Rewrite-Konfiguration in `next.config.js` änderst, starte `npm run dev` neu, denn diese Regeln werden nicht automatisch neu geladen.
   - Änderungen an `next.config.js` allgemein (z. B. Bild- oder RemotePattern-Konfigurationen) erfordern ebenfalls einen Neustart von `npm run dev`, da die Datei nur beim Start eingelesen wird.

3. **Browser + OAuth**
   - Öffne `http://localhost:3000` und melde dich über den Assistant-Flow an.
   - Die OAuth-Weiterleitung zeigt automatisch auf den lokalen Worker (siehe Punkt 1). Achte darauf, dass Google-Redirects in deinem Projekt auf `http://localhost:8787/api/google/callback` (und nicht auf Cloudflare) zeigen.

4. **Hinweis zu Worker-Env & D1**
   - `wrangler dev` benutzt automatisch die Bindings aus `wrangler.toml`, inklusive `ASSISTANT_DB`. Falls deine lokale D1-Instanz die Schema-Migrationen noch nicht kennt, führe `npx wrangler d1 migrations apply ASSISTANT_DB --local` aus, bevor du den Worker startest.

Mit dieser Konfiguration läuft die UI auf `localhost:3000` und spricht über `/assistant/*` mit dem Worker auf `localhost:8787`. Die Next-App vertraut ausschließlich auf `NEXT_PUBLIC_ASSISTANT_API_BASE`, während die statische Shell (`mira-app`) und der Worker jeweils ihren eigenen, dokumentierten Ursprung beziehen.

5. **Weitere Umgebungsvariablen & Smoke-Checks**
   - Die Next-App akzeptiert `NEXT_PUBLIC_ASSISTANT_API_BASE` sowie die Legacy-Varianten `NEXT_PUBLIC_API_ORIGIN` / `NEXT_PUBLIC_API_URL`. Setze mindestens eine dieser Variablen lokal oder in Vercel (Preview + Production), damit der Worker-Login funktioniert.
   - Die Supabase-Verbindung bezieht sich auf `NEXT_PUBLIC_SUPABASE_URL` und `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Hole die Werte aus dem Supabase-Dashboard unter _Project Settings_ → _API_ (Public API keys), kopiere sie in deine `.env.local` und in die Vercel-Settings der Preview/Production-Deployments.
   - Schreibe `NEXT_PUBLIC_E2E_AUTH_MODE=unauthenticated` in `.env.local` (nur in non-production) oder hänge `?e2e=1` an `/workspace`, um die „Ready to sign in?“ Oberfläche deterministisch zu erzwingen. Beide Varianten deaktivieren sich automatisch, wenn du das Flag in Produktion nicht setzt.
   - Playwright-Tests und das neue Smoke-Check-Skript verwenden `FDL_APP_URL`, um die Ziel-URL zu überschreiben. Der Standard ist `http://localhost:3000`, aber du kannst ihn auf `https://app.elyra-core.app` setzen, wenn du gegen eine Vorschauumgebung testen willst.
   - Starte `npm run check:auth-flow`, sobald der Dev-Server läuft: Das Playwright-Skript versucht, die `whoami`-Antwort zu lesen und loggt, ob das Sign-in-Panel samt Google-Button sichtbar ist. Mehrere Fehlversuche werden im Terminal sichtbar, der Prozess beendet sich mit Exit-Code `1`, wenn die UI nicht bereitsteht.

| Component | Origin Source | Override Allowed |
| --- | --- | --- |
| fish-delish-site (Next.js) | `NEXT_PUBLIC_ASSISTANT_API_BASE` (oder `NEXT_PUBLIC_API_ORIGIN` / `NEXT_PUBLIC_API_URL`) aus `.env.local` oder der Deployment-Umgebung | Nein |
| mira-app (statische Shell) | `window.__MIRA_API_ORIGIN__` / LocalStorage oder das fest programmierte `https://api.elyra-core.app` | Ja |
| Worker (personal-assistant) | Hostname, der durch `wrangler dev` / `wrangler.toml` konfiguriert wird (keine UI-Overrides) | Nein |

6. **Supabase-Migration & Smoke-Checks**
   - **Migration fahren:** `npm run supabase:migrate` führt `supabase db push --file db/migrations/0001_fish_delish_mvp.sql` aus, sofern deine Supabase-CLI-Session mit dem Zielprojekt verbunden ist. Alternativ den vollständigen SQL-Code aus `db/migrations/0001_fish_delish_mvp.sql` in den Supabase SQL-Editor kopieren und ausführen. Der Kommentarblock am Ende zeigt ein manuelles Seed-Template (Workspace + Mitgliedschaft, `user_id` aus der mf-s-Session via `whoami`).
 - **Smoke-Check: Token & PostgREST:** Öffne die Browser-Konsole gegen deine Produktions/Demo-URL (z. B. `https://app.elyra-core.app`), rufe `POST /api/supabase/token` mit `credentials: "include"` auf und bestätige, dass die Antwort `{ access_token, expires_at, expires_in }` mit Status `200` zurückkommt. Danach importiere `supabaseBrowserClient` aus `lib/supabase/browser` oder verwende `@supabase/supabase-js` direkt und führe drei `SELECT`-Anfragen aus:
    ```ts
    const workspaceId = "<workspace-id>";
    const { data: tasks, error: tasksError } = await supabaseBrowserClient
      .from("tasks")
      .select("*")
      .eq("workspace_id", workspaceId);

     const { data: calendarEvents, error: calendarError } = await supabaseBrowserClient
       .from("calendar_events")
       .select("*")
       .eq("workspace_id", workspaceId);

    const { data: mailThreads, error: mailError } = await supabaseBrowserClient
      .from("mail_threads")
      .select("*")
      .eq("workspace_id", workspaceId);
    ```
    Alle Aufrufe sollten `200`/`ok` sein und im Falle leerer Tabellen `[]` liefern, nicht `404`. Fehlerhafte Antworten zeigen meist fehlende RLS-Policies, fehlende Membership oder ein ungültiges Token.

# Layout & Theme Checks

1. Mit laufendem Worker/Next-Server (Punkte 1–3 oben) den Workspace öffnen, ein Benutzerkonto anmelden und in der Seitenleiste zum Kalender wechseln. Scroll innerhalb des `main-card-scroll`-Containers (z. B. nach unten für die Wochenübersicht) und wechsle dann zu Mail. Die Mail-Karte sollte ohne vertikales Springen direkt oben starten, die Scroll-Position des Karten-Containers wird durch die neue Logik zurückgesetzt.
2. Wiederhole den Wechsel ein paar Mal (Calendar → Mail → Tasks) und achte darauf, dass die Inhalte immer am oberen Rand beginnen, ohne dass Bootstrap/Browser-Restore eine unerwartete Offset-Position reaktiviert.
3. Öffne das Profilmenü, wechsle zwischen „Classic“ und „Midnight“ und verifiziere, dass Pillen, Buttons, Karten, Border und Texte die jeweils neuen Theme-Variablen (kein hartes Schwarz, dunkle Octet-Farben) verwenden. In Midnight sollte die neue Palette (#181b1f bis #7b888a) sichtbar sein; in Classic bleibt der Ton weich und nicht rein schwarz.
4. Im Kalender auf das Wochenende (Sa/So) scrollen bzw. mit den Next-/Prev-Buttons dorthin springen und prüfen, dass die Weekend-Slots weiterhin erreichbar sind und sich der Scroll-Container ohne Ruckeln bewegt.
