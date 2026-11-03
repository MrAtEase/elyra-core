# Elly Chief Orchestrator Roadmap

## Zielbild

Elly wird zur zentralen Orchestrator-Schicht von Elyra Core.

Rollenbild:
- Elly kennt den Langzeitkontext pro Workspace: `Privat`, `Fish Delish`, `Elyra Core`.
- Elly hält den groen Plan: Ziele, Prioritten, Initiativen, Routinen, offene Loops, relevante Personen, Hobbys, Arbeitsstil.
- Elly reasoningt er Domains hinweg: Mail, Calendar, Tasks, Projects, Code, Builder, Integrationen.
- Elly zerlegt Absichten in ausfhrbare Task Contracts.
- Spezialisierte Executor fhren diese Contracts aus: `Coder`, `Mail`, `Calendar`, `Tasks`, `Builder`.
- Kritische Schritte bleiben supervised: Send, Push, Merge, Promotion, deletions, money-moving actions.

Zielzustand im Betrieb:
1. Du sagst Elly: `Check meine Mails, fasse zusammen, bereite Antworten vor, plane meine Woche.`
2. Elly liest Workspace Brain + aktuelle Mail/Calendar/Tasks/Project-Kontexte.
3. Elly erzeugt einen priorisierten Plan mit konkreten Subtasks.
4. Elly delegiert kleine, klar gescopte Auftrge an den Coder oder andere Apps.
5. Die Executor liefern Events, Artefakte, Diffs, Drafts und Verifikationsresultate zurcck.
6. Elly aktualisiert das Langzeitgedchtnis und empfiehlt den nchsten Schritt.

Architekturprinzip:
- Big-picture reasoning gehrt in Elly.
- Repo- und Tool-Execution gehrt in spezialisierte Executor.
- Memory ist shared, aber strukturiert.
- Performance kommt durch Caching, harte Scopes und Fast Paths.

## Vorhandene Module wiederverwenden

### 1. Workspace Brain und Identitt
Bereits vorhanden:
- `/Users/paulodak/Projects/elyra-core/frontend/app/api/v1/workspace-brain/route.ts`
- `workspace_identity.profile_json`
- Settings/Brain-Surface in `/Users/paulodak/Projects/elyra-core/frontend/components/os/shell/SettingsView.tsx`

Wiederverwendung:
- `workspace_identity.profile_json` wird zum SSOT fr Workspace-Strategie.
- Das bestehende Brain-API bleibt der Einstiegspunkt fr Lesen/Schreiben.
- Die Settings-Oberflche wird zur Editor-Flche fr Workspace-Ziele, Operating Rules und Rollenbild.

### 2. Runs, Events, Approvals, Audit
Bereits vorhanden:
- `/Users/paulodak/Projects/elyra-core/frontend/app/api/os/runs/quick-action/route.ts`
- `orchestration_runs`
- `run_events`
- Worker-Runtime in `/Users/paulodak/Projects/elyra-core/worker/src/cloudOs.ts`

Wiederverwendung:
- `orchestration_runs` bleibt die zentrale Run-Ledger-Tabelle.
- `run_events` bleibt die Event-Timeline fr UI, Audit und Debugging.
- Quick actions werden nicht ersetzt, sondern unter den Chief-Orchestrator gehngt.

### 3. Elli Intent- und Action-System
Bereits vorhanden:
- `/Users/paulodak/Projects/elyra-core/worker/src/elli/system.ts`

Wiederverwendung:
- Intent-Klassifikation bleibt erhalten.
- `assistant`, `planner`, `operator` werden nicht neu erfunden.
- Das System wird um cross-domain reasoning, workspace memory retrieval und contract generation erweitert.

### 4. Mail, Calendar, Tasks
Bereits vorhanden:
- Worker-Endpoints in `/Users/paulodak/Projects/elyra-core/worker/src/index.ts`
- Frontend-Apps in:
  - `/Users/paulodak/Projects/elyra-core/frontend/components/os/programs/MailProgram.tsx`
  - `/Users/paulodak/Projects/elyra-core/frontend/components/os/programs/CalendarProgram.tsx`
  - `/Users/paulodak/Projects/elyra-core/frontend/components/os/apps/tasks/TasksApp.tsx`

Wiederverwendung:
- Mail, Calendar und Tasks werden als erste-class Executors behandelt.
- Elly ruft keine diffuse Generallogik auf, sondern delegiert an bestehende Domnen-APIs.
- Draft- und Approval-Flows bleiben supervised.

### 5. Coder und lokaler Agent
Bereits vorhanden:
- `/Users/paulodak/Projects/elyra-core/frontend/app/api/os/code/run/route.ts`
- `/Users/paulodak/Projects/elyra-core/worker/src/apiServer.ts`
- `/Users/paulodak/Projects/elyra-core/worker/src/devTaskRunner.ts`
- `/Users/paulodak/Projects/elyra-core/worker/src/features/featureExecutor.ts`

Wiederverwendung:
- Der Coder bleibt Executor fr Codearbeit.
- Die neue Aufgabe des Chief-Orchestrators ist nur, klare Task Contracts an den Coder zu bergeben.
- Scoping, file edits, terminal, build, test, git und push bleiben im Coder.

### 6. Provider-Routing
Bereits vorhanden:
- `/Users/paulodak/Projects/elyra-core/frontend/lib/orb-os/providers/providerRouter.ts`

Wiederverwendung:
- Provider-Routing bleibt Plattformfunktion von Elyra Core.
- Gemini, Codex, Claude, spter Mistral/Perplexity laufen unter demselben Run-Rahmen.
- Unterschiede werden als Capabilities modelliert, nicht als komplett eigene Ablfe.

### 7. Builder / Workflow-Flche
Bereits vorhanden:
- `/Users/paulodak/Projects/elyra-core/frontend/components/os/apps/builder/BuilderWindow.tsx`
- `/Users/paulodak/Projects/elyra-core/frontend/components/os/apps/studio/StudioWindow.tsx`

Wiederverwendung:
- Builder wird nicht als Demo belassen, sondern mit echten automations und tool actions verdrahtet.
- Studio kann Skill-/Workflow-Authoring fr wiederkehrende Ablfe werden.

## Neue Services, Tabellen und APIs

### A. Chief Orchestrator Service
Neuer Service:
- `worker/src/orchestrator/chiefOrchestrator.ts`

Aufgaben:
- Workspace Brain laden
- aktuelle Kontext-Snapshots laden
- Intent in operative Mission umwandeln
- Task Contracts erzeugen
- Executor auswhlen
- Supervisor-Entscheidungen markieren
- Memory-Updates nach erfolgreicher Ausfhrung schreiben

### B. Workspace Brain v2
Neue Struktur im Brain-Profil:
- `mission`
- `goals`
- `activeInitiatives`
- `operatingRules`
- `peopleContext`
- `routines`
- `hobbies`
- `preferences`
- `openLoops`
- `delegationPolicy`

Neue API:
- `GET /api/v1/workspace-brain/context?workspaceId=...`
- `POST /api/v1/workspace-brain/upsert-memory`
- `POST /api/v1/workspace-brain/derive-summary`

Ziel:
- separates Brain-Read-Model fr schnelle Orchestrator-Reads
- keine teuren Vollabfragen bei jedem kleinen Run

### C. Context Snapshot Service
Neue Tabelle:
- `workspace_context_snapshots`

Zweck:
- voraggregierte Snapshots fr:
  - unread mail summary
  - next calendar blocks
  - urgent tasks
  - active projects
  - recent coding outcomes

Neue Jobs/APIs:
- `POST /api/os/context/refresh`
- `GET /api/os/context/snapshot?workspaceId=...`

Ziel:
- nicht bei jedem Run Gmail/Calendar/Tasks live und voll scannen
- stattdessen Snapshot lesen und nur gezielt nachladen

### D. Task Contract Schema
Neue Tabelle:
- `task_contracts`

Felder:
- `id`
- `workspace_id`
- `run_id`
- `executor_type`
- `title`
- `goal`
- `scope_json`
- `constraints_json`
- `definition_of_done_json`
- `verification_json`
- `priority`
- `status`

Neue API:
- `POST /api/os/contracts`
- `GET /api/os/contracts/[id]`
- `POST /api/os/contracts/[id]/dispatch`

Ziel:
- Chef-Orchestrator und Executor entkoppeln
- klare, kleine, verifizierbare Arbeitsvertrge

### E. Executor Registry
Neuer Service:
- `worker/src/orchestrator/executorRegistry.ts`

Zweck:
- mappt Contract-Typ auf Executor:
  - `code` -> Coder
  - `mail` -> Mail executor
  - `calendar` -> Calendar executor
  - `tasks` -> Task executor
  - `workflow` -> Builder/automation executor

### F. Provider Capability Registry
Neue Datei/Service:
- `frontend/lib/orb-os/providers/capabilityRegistry.ts`

Capabilities:
- speed
- tool-use quality
- long-context fit
- code-edit reliability
- JSON reliability
- review quality
- cost band

Ziel:
- Routing er Capabilities statt hart codierter Sonderwege

### G. Memory Writeback Ledger
Neue Tabelle:
- `workspace_memory_entries`

Typen:
- `decision`
- `preference`
- `routine`
- `project_state`
- `people_note`
- `coding_decision`
- `follow_up`

Ziel:
- neben dem Brain-Profil ein append-only Memory-Ledger
- bessere Nachvollziehbarkeit und Konfliktbehandlung

### H. Workflow Runtime
Neue Tabellen:
- `workflow_definitions`
- `workflow_runs`
- `workflow_steps`
- `workflow_step_events`

Neue APIs:
- `POST /api/os/workflows`
- `POST /api/os/workflows/[id]/run`
- `GET /api/os/workflows/[id]/runs`

Ziel:
- Builder wird echte Automation Runtime
- Elly kann Workflows mit dir aufsetzen und ausfhren

## Reihenfolge der Umsetzung

### Phase 1: Coder Reliability und Truth Fixes
Dauer:
- 1 bis 2 Wochen

Ziele:
- Preview, build, tests und applied changes haben eine einzige Wahrheit.
- Scoped runs nutzen standardmig den schnellen Tool-first Pfad.
- Große Planung wird nicht im Coder erzwungen.

Arbeitspakete:
1. Coder Fast Path fr kleine/scoped Tasks
2. Vollstndige Spiegelung des verifizierten Mirrors in Preview
3. Harte Scope-Erzwingung bei UI-Fixes
4. Live Run Events stabilisieren
5. echte Build-/Webpack-Failure-Propagation in UI

Erfolgskriterium:
- kleine bis mittlere Codenderungen laufen schnell und nachvollziehbar
- `build passed` ist nicht mehr vom Preview-Zustand entkoppelt

### Phase 2: Workspace Brain als SSOT
Dauer:
- 1 bis 2 Wochen

Ziele:
- einheitliche Brain-Struktur fr `Privat`, `Fish Delish`, `Elyra Core`
- der Orchestrator kennt Mission, Ziele, Routinen und Prioritten

Arbeitspakete:
1. Brain v2 Schema definieren
2. vorhandene `workspace_identity.profile_json` Migration
3. Brain Read-Model API einfhren
4. Settings-Oberflche zum Editieren des Brain ausbauen
5. Memory writeback ledger einfhren

Erfolgskriterium:
- Elly kann pro Workspace stabil sagen, was wichtig ist und welche Regeln gelten

### Phase 3: Chief Orchestrator
Dauer:
- 2 bis 3 Wochen

Ziele:
- Elly denkt den groen Plan, nicht der Coder
- Elly erzeugt Contracts fr spezialisierte Executor

Arbeitspakete:
1. `chiefOrchestrator.ts` einfhren
2. Context snapshot loading anbinden
3. Task contract schema + dispatch einbauen
4. Run-Typ `chief_orchestration` einfhren
5. approval-/supervision-Layer definieren

Erfolgskriterium:
- Mail/Calendar/Tasks/Coder bekommen nur noch konkrete Teilauftrge

### Phase 4: Domain Executors zusammenziehen
Dauer:
- 2 bis 4 Wochen

Ziele:
- Mail, Calendar, Tasks und Coder arbeiten unter einem gemeinsamen Executor-Modell

Arbeitspakete:
1. Executor registry bauen
2. Mail draft/send supervised flows standardisieren
3. Calendar plan/create/reschedule standardisieren
4. Tasks derive/create/update standardisieren
5. Ergebnisformate vereinheitlichen

Erfolgskriterium:
- jeder Executor liefert dieselbe Klasse von Artefakten: plan, result, evidence, next-step

### Phase 5: Workflow Runtime und Builder
Dauer:
- 2 bis 3 Wochen

Ziele:
- Elly kann mit dir wiederkehrende Workflows definieren und ausfhren

Arbeitspakete:
1. Workflow runtime Tabellen und APIs
2. Builder an echte workflow definitions anbinden
3. Chief Orchestrator kann Workflow-Vorschlge erzeugen
4. supervised approvals in Workflow-Schritten

Erfolgskriterium:
- wiederkehrende Prozesse laufen systematisch und nachvollziehbar

### Phase 6: Platform Hardening
Dauer:
- 3 bis 6 Wochen

Ziele:
- hohe Zuverlssigkeit im Alltag

Arbeitspakete:
1. Retry-Strategien
2. Idempotenz fr actions
3. bessere Fehlerklassifikation
4. quotas, rate-limit, backoff
5. monitoring und incident diagnostics
6. provider capability routing finalisieren

Erfolgskriterium:
- definierte Kernworkflows laufen mit hoher Stabilitt und guter Transparenz

## Performance-Strategie pro Phase

### Phase 1
Fokus:
- Coder beschleunigen

Strategie:
- keine Pflicht-Planung fr kleine Tasks
- Full-repo scan vermeiden, wenn Scope bekannt ist
- direct-edit/tool-first vor feature-agent fallback
- Preview- und Verification-Pfade entdoppeln

Messwerte:
- time-to-first-edit
- total run time for scoped UI fixes
- failed runs due to patch/apply mismatch

### Phase 2
Fokus:
- Brain-Zugriffe schnell machen

Strategie:
- Brain Read-Model cachen
- Workspace-Profil klein und strukturiert halten
- schwere Ableitungen in Background-Summaries auslagern

Messwerte:
- brain load latency
- cache hit rate
- number of full profile rehydrates per run

### Phase 3
Fokus:
- Chief Orchestrator ohne Overhead-Monster bauen

Strategie:
- Kontext-Snapshots statt Live-Vollabfragen
- Orchestrator erzeugt nur Contracts, nicht die ganze Execution selbst
- Contracts klein und streng typisiert halten

Messwerte:
- time-to-plan
- contracts generated per run
- average contract size

### Phase 4
Fokus:
- Executor standardisieren ohne Zusatzlatenz

Strategie:
- einheitliche executor interface
- domain-specific logic bleibt in den jeweiligen Modulen
- nur das Handoff standardisieren

Messwerte:
- dispatch latency
- executor success rate
- approval turnaround time

### Phase 5
Fokus:
- Workflow-Runtime skalierbar halten

Strategie:
- asynchron ausfhren
- step events append-only
- nur relevante Schritte streamen
- snapshots statt Vollhistorien im UI

Messwerte:
- workflow run latency
- step throughput
- event stream volume per run

### Phase 6
Fokus:
- Plattform robust und kosteneffizient

Strategie:
- provider routing nach capability und cost band
- retries nur dort, wo sie Erfolgschance haben
- evidence-first debugging
- budget und quota enforcement frh im Run

Messwerte:
- p95 run duration
- cost per successful task
- retry success rate
- incident count by executor

## Zielzustand fr Zuverlssigkeit

Realistisches Ziel:
- nicht `100% magisch`
- sondern `hochzuverlssig auf definierte Kernworkflows`

Technische Definition:
- kleiner Codefix: schnell, nachvollziehbar, verifiziert
- Mail triage + draft: sauber, supervised, reproduzierbar
- week planning: aus Kalender, Tasks, offenen Themen und Workspace-Zielen ableitbar
- Workflow setup: wiederholbar, auditiert, approval-fhig

## Wichtigste Architekturentscheidung

Der entscheidende Schnitt ist:
- Elly ist der Chef-Orchestrator.
- Coder ist ein Executor.
- Mail/Calendar/Tasks/Builder sind ebenfalls Executor.
- Workspace Brain ist das gemeinsame Langzeitgedchtnis.
- Runs, events, approvals und audit bleiben das Plattform-Rcckgrat.

Wenn dieser Schnitt sauber umgesetzt wird, steigt beides:
- Zuverlssigkeit
- Geschwindigkeit

Wenn der Coder weiter den groen Plan mitdenken muss, bleibt beides schlechter:
- langsamer
- fragiler
- weniger vorhersehbar
