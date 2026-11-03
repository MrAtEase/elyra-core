# ELYRA CORE — System Status, Gap Analysis & UI-Refactor Plan

---

## 1. Executive Summary

Elyra Core hat einen funktionierenden Auth-Flow, einen teilweise funktionalen Cloudflare Worker, zwei Datenbanken (D1 + Supabase Postgres) und ein Next.js-Frontend mit visuell reichem aber architektonisch fragmentiertem UI. Der Orb existiert in drei Implementierungen. Workspace-Switching ist ein `<select>`-Dropdown. Der produktive Worker (`api.elyra-core.app`) ist ein Stub — 4 Routes, keine echte Logik. Die eigentliche Intelligenz lebt in einem lokalen Node.js Dev-Server (`apiServer.ts`, 63KB), der nie als Produktions-API konzipiert war.

**Die Lücke ist strukturell, nicht kosmetisch.** Die Teile existieren — Auth funktioniert, D1 hat ein Schema, Google OAuth läuft, der Orb rendert. Aber es gibt keine Produktions-API die etwas Sinnvolles tut, keine workspace-scoped Middleware, keine Permission-Resolution, und das UI mischt Concerns in einer monolithischen 1089-Zeilen `WorkspaceShell.tsx`.

**Der Weg:** Worker zu einer echten Produktions-API konsolidieren. Frontend-Shell zerlegen. Workspace-Switching zum architektonischen Rückgrat machen, nicht zum Dropdown. MVI in ~4 Wochen shippen mit 1 Entwickler + AI Agents.

---

## 2. Ist-Stand Analyse

| Bereich | Status | Stabil? | Blocker | Kommentar |
|---------|--------|---------|---------|-----------|
| **Auth** | Supabase Auth + Google OAuth + Token Exchange | Ja | Keiner | Session Cookie `mf-s` funktioniert. Custom Flow, kein NextAuth. Solide Basis. |
| **Workspaces (DB)** | D1-Schema: users, workspaces, memberships, sessions | Teilweise | Kein `type`-Feld, kein `parent_id`, kein `path` für Hierarchie | Reicht für Personal + Company. Franchise braucht Migration. |
| **Workspaces (UI)** | `<select>`-Dropdown, localStorage-Persistenz | Nein | Kein visueller Kontextwechsel, kein Accent-Theming, keine UI-State-Isolation | Funktional, UX-technisch unbrauchbar für Multi-Workspace. |
| **UI Shell** | `WorkspaceShell.tsx` (1089 Zeilen) = Header + Rail + Canvas + Onboarding + Auth | Nein | Monolith. Keine Trennung. Schwer testbar, schwer erweiterbar. | Muss zerlegt werden. |
| **Rail / Navigation** | `CoreDock.tsx` mit gruppierten Icons | Teilweise | Hardcodierte Items, keine dynamische Tool-Registry | Visuell ok, architektonisch zu statisch. |
| **Orb** | 3 Implementierungen: CSS (Landing), Three.js (Workspace), Merlin-Varianten | Ja, visuell | Keine systemische Rolle — reagiert nicht auf echten Systemstatus | Muss an reale Events gebunden werden. |
| **Permissions** | `isWorkspaceMember()` — binärer Check | Nein | Keine Rollen-Resolution, keine Policy-Engine, kein RBAC | Nur "drin oder nicht drin". Für MVI knapp ausreichend. |
| **API (Prod Worker)** | 4 Routes: `/`, `/health`, `OPTIONS`, `/assistant/auth/whoami` (Stub) | Nein | Whoami gibt immer `null` zurück. Kein echtes Routing. | Muss komplett aufgebaut werden. |
| **API (Dev Server)** | `apiServer.ts` mit 20+ Routes, LLM-Integration, Reasoning Engine | Ja, lokal | Node.js-Server, kein Worker. Nicht deploybar auf CF. | Wertvoller Code, muss portiert oder als separate Runtime laufen. |
| **AI** | OpenAI/Codex-Integration im Dev-Server. Reasoning Engine existiert. | Lokal ja | Nicht workspace-scoped. Kein Permission-Check. Keine Isolation. | Gute Basis, nicht produktionsreif. |
| **Supabase Postgres** | Fish-Delish MVP-Schema: Tasks, Calendar, Mail, Integrations. RLS aktiv. | Ja | Ownership unklar — Supabase oder D1 als primäre DB? | Empfehlung: Supabase = App-Daten, D1 = Edge-Auth. |
| **Google Workspace** | OAuth-Scopes für Calendar, Gmail, Drive konfiguriert. Tokens in KV. | Teilweise | Kein automatisches Provisioning. Kein Onboarding/Offboarding. | Read-only Integration für MVI realistisch. |
| **Notion** | `notion.ts` = Placeholder. Env-Vars gesetzt (DB-ID, Root-Page). | Nein | Kein Code implementiert. | API-Gateway referenziert Routes, nichts dahinter. |
| **Email (iCloud)** | `email-io/` Fastify-Service mit IMAP/SMTP-Endpoints | Scaffold | Placeholder. Nicht integriert. | Eigenständiger Service, sauber isoliert. |

---

## 3. MVI Definition — Minimum Viable Intelligence

### Was ist drin

| Feature | Scope | Anmerkung |
|---------|-------|-----------|
| Login/Signup | Supabase Auth + Google OAuth | Existiert, funktioniert |
| Personal Workspace | Auto-erstellt bei Signup | D1-Schema anpassen: `type = 'personal'` |
| Company Workspace erstellen | Formular → D1 Insert | Einfaches Create-Flow, kein Franchise |
| Workspace-Wechsel | Neuer Selector, API-Context-Header | Visueller + technischer Kontextwechsel |
| Mail anzeigen (read-only) | Gmail via Google OAuth | Existierende Token-Logik nutzen. Nur Inbox-Liste. |
| Kalender anzeigen (read-only) | Google Calendar via OAuth | Events der nächsten 7 Tage. Keine Bearbeitung. |
| Notion anbinden | OAuth + Page-Discovery | User verbindet Notion, wählt relevante Pages |
| AI im Workspace-Kontext | Orb → Slide-Over → Claude/Gemini | Kontextbewusst: weiß welcher Workspace aktiv ist |
| Workspace-Isolation | API: jeder Request workspace-scoped | Kein Cross-Workspace Data Access |

### Was explizit NICHT drin ist

- Franchise-Hierarchie (kein `parent_id`, kein `ltree`)
- RBAC / Policy-Engine (nur `isWorkspaceMember`)
- Builder (kein Forms, kein Workflows)
- HR, Marketing, Compliance Tools
- Google Workspace Provisioning (kein Account-Erstellen)
- iCloud Mail (`email-io` bleibt Scaffold)
- Notion-Sync (nur Discovery + Read)
- Offboarding-Automation
- Mobile / Responsive
- Light Mode

### MVI-Architektur

```
User → Login (Supabase) → Token Exchange → Worker Session
                                              │
                            ┌─────────────────┼─────────────────┐
                            │                 │                 │
                      Personal WS        Company WS       [future WS]
                            │                 │
                     ┌──────┴──────┐   ┌──────┴──────┐
                     │ Planner     │   │ Planner     │
                     │ Mail (RO)   │   │ Mail (RO)   │
                     │ Calendar(RO)│   │ Calendar(RO)│
                     │ Notion      │   │ Notion      │
                     │ AI (Orb)    │   │ AI (Orb)    │
                     └─────────────┘   └─────────────┘

Data: Supabase Postgres (App-Daten) + D1 (Auth/Sessions/Workspace-Metadata)
AI: Claude API oder Gemini (wenn Credits da), workspace-scoped System Prompt
```

---

## 4. UI-Refactor Blueprint

### Aktuelle Probleme

1. **`WorkspaceShell.tsx`** = 1089 Zeilen. Vermischt: Auth-State, Workspace-Loading, Header, Rail, Onboarding, Theme, Scroll-Handling, Canvas. Untestbar.
2. **State Management** = ein monolithischer React Context (`WorkspaceContext.tsx`) mit User, Workspace, Calendar, Mail, Tasks, Onboarding. Alles in einem Provider.
3. **Routing** = `/workspace/[category]/[module]` — zu generisch, kein Workspace-Slug in der URL.
4. **Kein Design-System-Enforcement** — Tokens existieren in `DESIGN_TOKENS.md` und `tokens.css`, aber Komponenten nutzen sie inkonsistent.

### Neue Architektur

#### A. Shell (max 150 Zeilen)

```
<ShellProvider>              ← Auth + Workspace State
  <ShellHeader>              ← Workspace Selector | Orb | User Menu
  <ShellBody>
    <Rail />                 ← Tool-Navigation, workspace-abhängig
    <Canvas>                 ← Tool rendert hier
      {children}
    </Canvas>
  </ShellBody>
  <StatusBar />              ← Aktiver Workspace, Sync-Status, AI-Status
  <AISurface />              ← Slide-Over Panel (Orb-triggered)
</ShellProvider>
```

#### B. Komponenten-Zerlegung

| Alt | Neu | Verantwortung |
|-----|-----|---------------|
| `WorkspaceShell.tsx` (1089 Zeilen) | `ShellLayout.tsx` (~80 Zeilen) | Nur Layout-Grid |
| eingebettet in WorkspaceShell | `ShellHeader.tsx` (~100 Zeilen) | Workspace Selector + Orb + User |
| eingebettet in WorkspaceShell | `WorkspaceSelector.tsx` (~80 Zeilen) | Dropdown mit Accent-Preview, Keyboard-Nav |
| `CoreDock.tsx` | `Rail.tsx` (~100 Zeilen) | Liest Tools aus Registry, rendert Icons |
| eingebettet in WorkspaceShell | `Canvas.tsx` (~20 Zeilen) | Wrapper für Tool-Content |
| nicht vorhanden | `StatusBar.tsx` (~60 Zeilen) | Workspace-Name, Sync-Indikator, Fehler |
| nicht vorhanden | `AISurface.tsx` (~120 Zeilen) | Slide-Over Panel für AI-Interaktion |
| `WorkspaceContext.tsx` (Monolith) | 3 getrennte Contexts | Siehe unten |

#### C. State Management — Aufspaltung

```typescript
// 1. AuthContext
{
  user: User | null
  authState: "checking" | "authenticated" | "unauthenticated"
  login(): Promise<void>
  logout(): Promise<void>
}

// 2. WorkspaceContext
{
  workspaces: Workspace[]
  activeWorkspace: Workspace | null
  switchWorkspace(id: string): Promise<void>
  accentColor: string  // derived from activeWorkspace
}

// 3. ToolContext (pro Tool, nicht global)
// Jedes Tool managed seinen eigenen State.
// Mail-State lebt im Mail-Tool.
// Calendar-State lebt im Calendar-Tool.
// Kein globaler Calendar/Mail/Tasks-State mehr.
```

#### D. Routing-Konzept

```
Aktuell:  /workspace/[category]/[module]
Neu:      /w/[workspaceSlug]/[toolSlug]
          /w/[workspaceSlug]/[toolSlug]/[resourceId]
          /personal/[toolSlug]
```

Beispiele:

```
/w/fish-delish-porto/mail
/w/fish-delish-porto/calendar
/w/fish-delish-porto/planner/task-abc123
/personal/planner
/personal/notion
```

Next.js Middleware:

```typescript
// middleware.ts
if (path.startsWith('/w/')) {
  const slug = extractSlug(path)
  // Validate workspace access via API call (cached)
  // Set workspace context header for downstream
  // Redirect to /signin if unauthenticated
}
```

**Workspace-Slug in URL = Single Source of Truth.**
Kein localStorage-basiertes Switching mehr. URL bestimmt den Kontext.

---

## 5. Workspace-Switching UX

### Technischer Flow

```
User klickt Workspace Selector → wählt "Fish-Delish Porto"
  │
  ├── 1. URL ändert sich: /w/fish-delish-porto/[aktuelles-tool]
  │
  ├── 2. WorkspaceContext.switchWorkspace("fish-delish-porto")
  │     → API Call: PATCH /assistant/auth/session { activeWorkspaceId }
  │     → Response: { workspace, tools, accent, role }
  │     → Context-State update
  │
  ├── 3. Shell reagiert:
  │     → Accent-Color ändert sich (CSS Variable --brand-accent)
  │     → Orb-Farbe morpht (smooth transition, 300ms)
  │     → Rail aktualisiert Tool-Liste
  │     → StatusBar zeigt neuen Workspace-Namen
  │
  ├── 4. API-Context:
  │     → Alle Fetch-Calls senden Header: x-workspace-id: <uuid>
  │     → Worker validiert Membership bei jedem Request
  │     → Kein Cache-Sharing zwischen Workspaces
  │
  └── 5. AI-Context:
        → AI-Surface schließt (falls offen)
        → Conversation-History wird workspace-spezifisch geladen
        → System-Prompt enthält Workspace-Metadaten
```

### Fehlerausschluss

| Risiko | Maßnahme |
|--------|----------|
| User sendet Request an falschen Workspace | `x-workspace-id` Header wird aus URL-Slug resolved, nicht aus State. URL = Truth. |
| Stale State nach Switch | `switchWorkspace()` invalidiert allen Tool-State. Tools re-fetchen bei Mount. |
| API gibt Daten aus anderem Workspace | Worker: RLS + Middleware prüft `workspace_id` gegen Session. Doppelte Absicherung. |
| AI leakt Kontext | AI-Conversation ist per `(user_id, workspace_id)` isoliert. Kein Carry-Over. |
| User verwechselt Workspaces visuell | Accent-Color + Workspace-Name in StatusBar + Orb-Farbe. Dreifache visuelle Bestätigung. |

---

## 6. Notion-Integration — Expliziter Sync

### Architektur: Discover → Enable → Sync

```
Phase 1: DISCOVER
──────────────────
User verbindet Notion OAuth → Elyra erhält Token
Elyra liest: Databases, Pages, Top-Level-Struktur
Zeigt dem User: "Diese Notion-Inhalte habe ich gefunden"
User sieht eine Liste, nichts wird automatisch aktiviert.

Phase 2: ENABLE (Explizit)
──────────────────────────
User wählt: "Diese 3 Databases und 5 Pages sind relevant für diesen Workspace"
Elyra speichert: NotionBinding { workspace_id, notion_resource_id, type, enabled }
Nur explizit aktivierte Inhalte sind für AI sichtbar.

Phase 3: SYNC (Kontrolliert)
─────────────────────────────
Aktivierte Inhalte werden periodisch gesynct (read-only zunächst).
Sync-Status sichtbar in StatusBar.
AI kann synced Content als Kontext nutzen.
User kann jederzeit Bindings entfernen.
```

### AI-Relevanz

```
AI im Workspace "Fish-Delish Porto":
  System Prompt enthält:
    - Workspace: Fish-Delish Porto (Restaurant, Location)
    - Enabled Notion Content:
      - "Betriebshandbuch" (Database, 45 Pages)
      - "Wochenpläne" (Database, 12 Pages)
      - "Rezepte" (Page, read-only)
    - NOT included: Paul's persönliche Notion-Pages

AI kann:
  - Fragen über das Betriebshandbuch beantworten
  - Wochenpläne zusammenfassen
  - Rezepte referenzieren

AI kann NICHT:
  - Paul's private Notion-Inhalte lesen
  - Inhalte aus anderem Workspace referenzieren
  - In Notion schreiben (Phase 1 = read-only)
```

### Franchise-Locking (spätere Phase)

```
Holding definiert:
  NotionTemplate {
    notion_database_id: "betriebshandbuch-master"
    locked: true
    sync_direction: "downstream"  (Holding → Locations, nie umgekehrt)
  }

Location Porto:
  - Sieht das Betriebshandbuch (read-only, gesynct von Holding)
  - Kann eigene Notion-Bindings hinzufügen (lokale Docs)
  - Kann das Betriebshandbuch nicht entfernen oder überschreiben
```

---

## 7. Multi-Agent Arbeitsweise

### Rollen

| Agent | Aufgabe | Tools | Output |
|-------|---------|-------|--------|
| **Agent A (Claude)** | Architektur, UX-Entscheidungen, Reasoning, Code-Reviews, komplexe Refactors | Claude Code CLI, Full Codebase Access | Architektur-Docs, Code-Änderungen, Review-Kommentare |
| **Agent B (Codex / Gemini)** | Deterministische Tasks: Schema-Migrationen, API-Route-Implementierung, Component-Scaffolding | Codex CLI oder Gemini Code Assist | Fertige Dateien, Tests, Migrations |
| **Agent C (Human)** | Entscheidungen, Prioritäten, Design-Validierung, Deployments | Alles | Go/No-Go, Richtungskorrekturen |

### Parallelisierung ohne Chaos

```
Regel 1: EIN Source of Truth
  → Dieses Dokument + Git Main Branch
  → Keine parallelen Branches für den gleichen Bereich

Regel 2: KLARE BOUNDARIES
  Agent A arbeitet an: Shell-Decomposition, Context-Aufspaltung, Routing
  Agent B arbeitet an: Worker-Routes, D1-Migrationen, API-Endpoints
  → Kein Overlap. Niemals gleichzeitig die gleiche Datei.

Regel 3: INTERFACE-FIRST
  Bevor Code geschrieben wird, einigen sich alle auf:
  → API-Contracts (Request/Response Types)
  → Component Props (TypeScript Interfaces)
  → State-Shape (Context Types)
  Dann arbeiten Frontend und Backend unabhängig.

Regel 4: DAILY SYNC (15 min)
  Human reviewed was fertig ist.
  Merged was funktioniert.
  Priorisiert den nächsten Tag.
```

### Konkreter Split Woche 1

```
Agent A (Claude):
  □ WorkspaceShell.tsx zerlegen → ShellLayout, ShellHeader, Rail, Canvas, StatusBar
  □ WorkspaceContext aufsplitten → AuthContext, WorkspaceContext, ToolContext
  □ Routing umbauen: /w/[slug]/[tool]
  □ WorkspaceSelector-Komponente mit Accent-Preview

Agent B (Codex/Gemini):
  □ Worker: Echtes Routing implementieren (hono)
  □ Worker: /assistant/auth/whoami mit echtem Session-Lookup
  □ Worker: /assistant/workspaces → Liste der User-Workspaces
  □ Worker: /assistant/workspaces/:id/switch → Workspace-Wechsel
  □ D1 Migration: workspace.type, workspace.accent_color hinzufügen