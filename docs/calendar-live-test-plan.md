# Calendar Live - Test Plan

## Übersicht

Testplan für die Kalender-Live-Implementierung (Aufgabe B). Die Implementierung umfasst:
- Provider-agnostischer Kalender-Client (Google & Microsoft)
- API Routes für Events (GET/POST)
- UI-Komponente im Workspace Dashboard
- Caching (30-60s)
- Error Handling

## Test-Szenarien

### 1. Connected State (Provider verbunden)

#### Voraussetzungen:
- Google oder Microsoft Calendar Provider ist verbunden (via `/workspace/settings/user/integrations`)
- Gültige OAuth-Tokens vorhanden
- Calendar-Scope aktiviert

#### Test-Schritte:

1. **Events anzeigen (GET)**
   - Workspace-Seite öffnen: `/workspace`
   - Calendar-Section öffnen (expandieren)
   - **Erwartet**: 
     - Status: "connected"
     - Liste der Events für "Today + Next 7 days" wird angezeigt
     - Events zeigen: start, title, location (optional)
     - "Create event" Button ist aktiv

2. **Event erstellen (POST)**
   - Auf "Create event" Button klicken
   - **Erwartet**:
     - Button zeigt "Creating..." während Request
     - Neues Event wird erstellt (titel: "New Event", start: +1h, end: +2h)
     - Event-Liste wird automatisch aktualisiert
     - Neues Event erscheint in der Liste

3. **Caching-Verhalten**
   - Events laden (erster Request)
   - Innerhalb von 45 Sekunden erneut Events laden
   - **Erwartet**: 
     - Zweiter Request nutzt Cache (schneller)
     - Response enthält `cached: true`
   - Nach 60 Sekunden erneut laden
   - **Erwartet**: Cache ist abgelaufen, neuer API-Request

4. **Scroll-Verhalten**
   - Workspace-Seite scrollen
   - **Erwartet**: 
     - Kein neuer Scroll-Container
     - Scroll funktioniert im Main Panel wie gewohnt
     - Calendar-Section scrollt mit dem Rest der Seite

### 2. Not Connected State (Provider nicht verbunden)

#### Voraussetzungen:
- Kein Calendar Provider verbunden
- Oder Provider verbunden, aber keine Calendar-Scope

#### Test-Schritte:

1. **Events anzeigen (GET)**
   - Workspace-Seite öffnen: `/workspace`
   - Calendar-Section öffnen
   - **Erwartet**:
     - Status: "not_connected"
     - Fehlermeldung: "Calendar not connected. Please connect a calendar provider in settings."
     - "Create event" Button ist deaktiviert (disabled)
     - Keine Events angezeigt

2. **Event erstellen (POST) - sollte fehlschlagen**
   - Direkter API-Call: `POST /assistant/integrations/calendar/events`
   - **Erwartet**:
     - Status: 401
     - Response: `{ error: "Calendar not connected", code: "NOT_CONNECTED" }`

### 3. Error State (API-Fehler)

#### Voraussetzungen:
- Provider verbunden, aber API-Fehler (z.B. Token abgelaufen, Netzwerkfehler)

#### Test-Schritte:

1. **Token abgelaufen**
   - Provider verbunden, aber Token ungültig/abgelaufen
   - Events laden
   - **Erwartet**:
     - Status: "error"
     - Fehlermeldung wird angezeigt
     - Error-Handling zeigt benutzerfreundliche Meldung

2. **Netzwerkfehler**
   - API nicht erreichbar (Worker offline)
   - Events laden
   - **Erwartet**:
     - Status: "error"
     - Fehlermeldung: "Failed to load calendar events"
     - UI bleibt stabil, keine Crashes

3. **Ungültige Request-Parameter**
   - GET ohne `from` oder `to` Parameter
   - **Erwartet**:
     - Status: 400
     - Response: `{ error: "from and to query parameters required" }`

### 4. Provider-Wechsel (Google ↔ Microsoft)

#### Voraussetzungen:
- Zuerst Google verbunden, dann Microsoft verbinden

#### Test-Schritte:

1. **Google verbunden → Microsoft verbinden**
   - Google Calendar Events anzeigen
   - Microsoft Provider verbinden (mit Calendar-Scope)
   - Google Provider trennen
   - Events neu laden
   - **Erwartet**:
     - Events werden jetzt von Microsoft geladen
     - Provider-Wechsel funktioniert nahtlos

2. **Beide Provider verbunden**
   - Google und Microsoft beide verbunden
   - **Erwartet**:
     - System nutzt den zuerst gefundenen Provider (Google hat Priorität)
     - Oder: Nutzer kann Provider wählen (falls implementiert)

## API-Endpunkt Tests

### GET `/assistant/integrations/calendar/events`

#### Query Parameters:
- `from` (required): ISO 8601 Datum/Zeit
- `to` (required): ISO 8601 Datum/Zeit

#### Test Cases:

1. **Valider Request**
   ```bash
   GET /assistant/integrations/calendar/events?from=2025-01-15T00:00:00Z&to=2025-01-22T23:59:59Z
   ```
   - **Erwartet**: Status 200, `{ events: [...], cached: false }`

2. **Fehlende Parameter**
   ```bash
   GET /assistant/integrations/calendar/events
   ```
   - **Erwartet**: Status 400, `{ error: "from and to query parameters required" }`

3. **Nicht authentifiziert**
   - Request ohne Session-Cookie
   - **Erwartet**: Status 401, Auth-Required Response

4. **Provider nicht verbunden**
   - Request mit Session, aber kein Calendar-Provider
   - **Erwartet**: Status 401, `{ error: "Calendar not connected", code: "NOT_CONNECTED" }`

### POST `/assistant/integrations/calendar/events`

#### Request Body:
```json
{
  "title": "Test Event",
  "start": "2025-01-15T14:00:00Z",
  "end": "2025-01-15T15:00:00Z",
  "location": "Test Location (optional)",
  "description": "Test Description (optional)"
}
```

#### Test Cases:

1. **Valider Request**
   ```bash
   POST /assistant/integrations/calendar/events
   Content-Type: application/json
   Body: { "title": "Test", "start": "...", "end": "..." }
   ```
   - **Erwartet**: Status 200, `{ event: {...}, ok: true }`

2. **Fehlende Required Fields**
   ```bash
   POST /assistant/integrations/calendar/events
   Body: { "title": "Test" }
   ```
   - **Erwartet**: Status 400, `{ error: "title, start, and end are required" }`

3. **Nicht authentifiziert**
   - Request ohne Session-Cookie
   - **Erwartet**: Status 401, Auth-Required Response

4. **Provider nicht verbunden**
   - Request mit Session, aber kein Calendar-Provider
   - **Erwartet**: Status 401, `{ error: "Calendar not connected", code: "NOT_CONNECTED" }`

## UI-Tests

### Calendar Section Komponente

1. **Initial Load**
   - Seite öffnen
   - **Erwartet**: Calendar-Section zeigt "Loading calendar events..."

2. **Event-Liste Format**
   - Events vorhanden
   - **Erwartet**:
     - Jedes Event zeigt: Title, Start/End Zeit, Location (falls vorhanden)
     - Zeit-Format ist lesbar (z.B. "Jan 15, 2:00 PM")
     - All-Day Events zeigen nur Datum

3. **Create Event Button**
   - Status: connected
   - **Erwartet**: Button aktiv, klickbar
   - Status: not_connected oder error
   - **Erwartet**: Button disabled, nicht klickbar

4. **Responsive Design**
   - Verschiedene Bildschirmgrößen testen
   - **Erwartet**: UI bleibt lesbar und funktional

## Performance Tests

1. **Cache-Performance**
   - Erster Request: Messen der Response-Zeit
   - Zweiter Request (innerhalb Cache-TTL): Messen der Response-Zeit
   - **Erwartet**: Zweiter Request deutlich schneller (< 50ms vs. > 200ms)

2. **Viele Events**
   - Calendar mit 100+ Events in 7 Tagen
   - **Erwartet**: 
     - API liefert max. 250 Events (Google/Microsoft Limit)
     - UI rendert alle Events ohne Performance-Probleme

## Edge Cases

1. **Leerer Calendar**
   - Provider verbunden, aber keine Events
   - **Erwartet**: "No upcoming events in the next 7 days" Meldung

2. **Events außerhalb des Ranges**
   - Events vor "from" oder nach "to"
   - **Erwartet**: Werden nicht angezeigt

3. **Timezone-Unterschiede**
   - Events in verschiedenen Zeitzonen
   - **Erwartet**: Korrekte Anzeige entsprechend Browser-Zeitzone

4. **Schnelle aufeinanderfolgende Requests**
   - Mehrere Requests innerhalb von 1 Sekunde
   - **Erwartet**: Cache verhindert unnötige API-Calls

## Checkliste für manuelle Tests

- [ ] Google Calendar verbunden → Events werden angezeigt
- [ ] Microsoft Calendar verbunden → Events werden angezeigt
- [ ] Kein Provider verbunden → Fehlermeldung angezeigt
- [ ] "Create event" Button funktioniert
- [ ] Neues Event erscheint in der Liste
- [ ] Cache funktioniert (45s TTL)
- [ ] Error-Handling bei API-Fehlern
- [ ] Scroll-Verhalten unverändert
- [ ] UI-Status-States korrekt (loading/connected/error/not_connected)
- [ ] Events zeigen korrekte Daten (title, start, end, location)
- [ ] All-Day Events werden korrekt formatiert

## Automatisierte Tests (Optional)

Für automatisierte Tests könnten folgende Test-Suites erstellt werden:

1. **Unit Tests** (Worker)
   - `listCalendarEvents()` mit Mock-Tokens
   - `createCalendarEvent()` mit Mock-Tokens
   - Provider-Detection Logic

2. **Integration Tests** (API)
   - GET/POST Endpoints mit Mock-Session
   - Cache-Verhalten testen
   - Error-Handling testen

3. **E2E Tests** (UI)
   - Calendar-Section Rendering
   - Event-Liste Anzeige
   - Create Event Flow

## Bekannte Limitierungen

1. **Cache-Invalidierung**: Nach Event-Erstellung wird Cache nicht explizit invalidiert (verlässt sich auf TTL)
2. **Provider-Priorität**: Bei mehreren verbundenen Providern wird der erste genutzt (Google > Microsoft)
3. **Event-Limit**: Max. 250 Events pro Request (API-Limit)

## Nächste Schritte (Optional Erweiterungen)

- [ ] Cache-Invalidierung nach Event-Erstellung
- [ ] Provider-Auswahl im UI
- [ ] Event-Details Modal/View
- [ ] Event-Bearbeitung (Update/Delete)
- [ ] Mehrere Calendars unterstützen
- [ ] Recurring Events anzeigen
- [ ] Event-Filter (nach Typ, Status, etc.)

