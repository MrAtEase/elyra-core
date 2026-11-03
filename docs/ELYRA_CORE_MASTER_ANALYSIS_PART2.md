## 8. Technische Roadmap

### Phase 1: Foundation (Woche 1–2)

**Ziel:** Worker wird zur echten API. Shell wird zerlegbar. Workspace-Switch funktioniert end-to-end.

| Task | Owner | Prio | Abhängigkeit |
|------|-------|------|-------------|
| Worker: Hono-Router einführen, CORS-Middleware | Agent B | P0 | Keine |
| Worker: `/assistant/auth/whoami` mit echtem D1-Lookup | Agent B | P0 | Router |
| Worker: `/assistant/workspaces` (Liste) + `/switch` | Agent B | P0 | Whoami |
| D1 Migration: `workspace.type`, `workspace.accent_color`, `workspace.slug` | Agent B | P0 | Keine |
| Frontend: `WorkspaceShell.tsx` zerlegen in 6 Komponenten | Agent A | P0 | Keine |
| Frontend: `WorkspaceContext` aufsplitten in AuthContext + WorkspaceContext | Agent A | P0 | Shell-Zerlegung |
| Frontend: Routing `/w/[slug]/[tool]` implementieren | Agent A | P0 | Context-Split |
| Frontend: `WorkspaceSelector` mit Accent-Preview | Agent A | P1 | Routing |
| Frontend: `StatusBar` mit Workspace-Name + Sync-Status | Agent A | P1 | Shell-Zerlegung |
| Deploy Worker to Production | Human | P0 | Worker-Routes fertig |

**Exit-Kriterium Phase 1:**
Ein User kann sich einloggen, sieht seinen Personal Workspace, kann einen Company Workspace erstellen, und der Wechsel ändert URL + Accent + Rail + API-Context.

### Phase 2: Tools + Integration (Woche 3–4)

**Ziel:** Mail, Calendar, Notion als read-only Tools. AI-Surface funktioniert.

| Task | Owner | Prio | Abhängigkeit |
|------|-------|------|-------------|
| Worker: `/assistant/workspaces/:id/mail/threads` (Gmail proxy) | Agent B | P0 | Phase 1 |
| Worker: `/assistant/workspaces/:id/calendar/events` (Google Calendar proxy) | Agent B | P0 | Phase 1 |
| Worker: `/assistant/workspaces/:id/notion/discover` | Agent B | P1 | Phase 1 |
| Worker: `/assistant/workspaces/:id/notion/bindings` (CRUD) | Agent B | P1 | Discover |
| Frontend: Mail-Tool (Inbox-Liste, read-only) | Agent A | P0 | Mail-API |
| Frontend: Calendar-Tool (7-Tage-Ansicht, read-only) | Agent A | P0 | Calendar-API |
| Frontend: Notion-Tool (Discovery + Enable UI) | Agent A | P1 | Notion-API |
| Frontend: `AISurface.tsx` (Slide-Over, Chat-Interface) | Agent A | P0 | Phase 1 |
| Worker: `/assistant/workspaces/:id/ai/chat` (Claude/Gemini proxy) | Agent B | P0 | Phase 1 |
| AI: Workspace-scoped System Prompt Generation | Agent A | P0 | AI-Chat API |
| Orb: Systemstatus-Binding (idle, thinking, error) | Agent A | P1 | AI-Surface |

**Exit-Kriterium Phase 2:**
User sieht Mail + Calendar im Workspace-Kontext. Kann Notion-Pages discovern und für AI aktivieren. Kann über den Orb mit AI sprechen, die weiß in welchem Workspace sie ist.

### Phase 3: Polish + Builder Foundation (Woche 5–6)

**Ziel:** UX-Polish, Onboarding, Builder-Primitives.

| Task | Owner | Prio |
|------|-------|------|
| Onboarding Flow: 3-Step Signup → Personal WS → Optional Company WS | Agent A | P0 |
| Command Palette (Cmd+K): Navigation + Search | Agent A | P1 |
| Design System Enforcement: alle Komponenten auf Tokens umstellen | Agent A | P1 |
| Builder: Form-Primitive (Fields, Validation) | Agent B | P1 |
| Builder: View-Primitive (Table, Board) | Agent B | P1 |
| Workspace Invite System (Email → Join) | Agent B | P0 |
| Google Workspace: Calendar Write (create events) | Agent B | P2 |
| Light Mode | Agent A | P2 |

**Exit-Kriterium Phase 3:**
Neuer User kann sich anmelden, wird geführt durch Onboarding, landet im funktionierenden Workspace. Builder kann einfache Formulare erstellen.

### Phase 4: Franchise Scale (Woche 7+)

**Ziel:** Hierarchie, Templates, Policy-Engine.

| Task | Owner | Prio |
|------|-------|------|
| D1: `workspace.parent_id`, `workspace.path` (ltree-Emulation) | Agent B | P0 |
| Policy-Engine: `WorkspacePolicy` mit locked/inherited | Agent B | P0 |
| `FranchiseAgreement` Model | Agent B | P1 |
| Builder: Template-System (publish, lock, distribute) | Agent B | P1 |
| RBAC: Role-basierte Permissions statt binärem Check | Agent B | P0 |
| Aggregation-Dashboards (Parent sieht Child-Daten) | Agent A | P1 |
| iCloud Mail Integration (email-io aktivieren) | Agent B | P2 |
| Mobile / PWA | Agent A | P2 |

---

## 9. Risiken & No-Gos

### Risiken

| Risiko | Schwere | Mitigation |
|--------|---------|------------|
| Worker-Rewrite dauert zu lang | Hoch | Hono als Router, nicht selbst bauen. Existierende Auth-Logik portieren, nicht neu schreiben. |
| Shell-Zerlegung bricht bestehendes UI | Hoch | Feature-Branch, visuelle Regression-Tests mit Playwright Screenshots. |
| Zwei Datenbanken (D1 + Supabase) erzeugen Inkonsistenz | Mittel | Klare Ownership: D1 = Identity/Auth/Workspace-Meta. Supabase = App-Daten. Niemals duplizieren. |
| AI-Kosten explodieren | Mittel | Rate-Limiting per Workspace. Gemini-Credits nutzen wenn verfügbar. Kein unbegrenztes Chatten. |
| Notion API Rate Limits | Niedrig | Sync-Intervalle (15 min minimum). Cached Content für AI, nicht Live-Fetches. |
| Scope Creep: "noch dieses Feature" | Hoch | MVI-Definition ist bindend. Alles andere ist Phase 3+. |

### No-Gos

| Was | Warum |
|-----|-------|
| NextAuth einführen | Custom Auth funktioniert. Migration jetzt wäre reine Zeitverschwendung. |
| Prisma/Drizzle für D1 | D1 ist SQLite, raw SQL reicht. ORM-Overhead lohnt sich nicht bei 10 Tabellen. |
| GraphQL | REST + workspace-scoped Header ist einfacher, schneller, ausreichend. |
| Real-time Chat (Slack-Klon) | Out of scope. Notifications ja, Chat nein. |
| Mobile-first Development | Desktop-first. Mobile kommt in Phase 4 als PWA. |
| Micro-Frontend Architecture | Overkill. Next.js App Router mit Tool-Komponenten reicht. |
| Multi-Region Deployment | Cloudflare Worker ist bereits global. Kein Multi-Region-Setup nötig. |

---

## 10. Empfehlung: Womit morgen anfangen

### Tag 1: Zwei parallele Tracks starten

**Track A (Frontend — Claude):**
1. `WorkspaceShell.tsx` öffnen
2. `ShellHeader` extrahieren (Zeilen die Header rendern → eigene Datei)
3. `ShellLayout` erstellen (Grid-Container, importiert Header + Rail + Canvas)
4. Sicherstellen: App rendert identisch nach Refactor (visueller Diff = 0)

**Track B (Worker — Codex/Gemini):**
1. `hono` installieren (`npm i hono`)
2. `src/index.ts` auf Hono-Router umschreiben
3. `/assistant/auth/whoami` implementieren: Session-Cookie lesen → D1-Lookup → User + Workspaces zurückgeben
4. Deploy to Production, `/health` + `/assistant/auth/whoami` verifizieren

**Human (du):**
1. Entscheide: Workspace-Slug-Format (`fish-delish-porto` vs. `fd-porto` vs. UUID)
2. Entscheide: Accent-Colors (5 Presets oder Freeform?)
3. Review Track A + B am Ende des Tages

### Warum diese Reihenfolge?

- **Whoami ist der Schlüssel.** Ohne einen funktionierenden `/whoami` der echte Daten zurückgibt, kann das Frontend nichts workspace-scoped rendern.
- **Shell-Zerlegung ist der Enabler.** Ohne saubere Komponenten-Grenzen kann kein Feature sauber eingebaut werden.
- **Beide Tracks sind unabhängig.** Frontend und Worker arbeiten gegen definierte Interfaces. Kein Blocking.

---

## Anhang: DB-Ownership-Entscheidung

### Empfehlung: Dual-DB beibehalten

```
Cloudflare D1 (SQLite, Edge):
  ├── users
  ├── identities
  ├── workspaces (metadata: slug, type, accent, parent_id)
  ├── memberships
  ├── sessions
  ├── workspace_invites
  └── user_settings

  Warum: Läuft am Edge, <10ms Latenz für Auth-Checks.
  Worker braucht diese Daten bei jedem Request.

Supabase Postgres:
  ├── tasks
  ├── calendar_events
  ├── mail_threads
  ├── integrations + tokens
  ├── sync_runs
  ├── entity_links
  ├── notion_bindings (neu)
  ├── ai_conversations (neu)
  └── builder_* (Phase 3)

  Warum: RLS, Realtime, komplexe Queries, Relationen.
  Tool-Daten brauchen eine richtige DB.
```

**Regel: Jede Tabelle lebt in genau einer DB. Keine Duplikation. Worker liest D1 für Auth, proxied zu Supabase für App-Daten.**

---

*Dokument erstellt: 2026-02-06*
*Status: Arbeitsfähig*
*Nächste Aktion: Tag 1, Track A + Track B parallel starten*
