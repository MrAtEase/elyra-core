# Elyra Orb-OS Masterplan (Phase 0-1) — Implemented Contracts + Prompt Suite

## Scope
Dieses Dokument liefert die umsetzbare Spezifikation für:
- Phase 0: Contracts, Goals, Policy/Approvals
- Phase 1: Premium Orb-OS Design System (Light default) + Orb Global States

Technische Referenz im Code:
- `frontend/lib/orb-os/contracts/types.ts`
- `frontend/lib/orb-os/contracts/schemas.ts`
- `frontend/lib/orb-os/contracts/rendering.ts`
- `frontend/lib/orb-os/contracts/examples.ts`
- `frontend/lib/orb-os/goals/model.ts`
- `frontend/lib/orb-os/policy/model.ts`
- `frontend/app/api/os/bootstrap/route.ts`
- `frontend/components/os/shell/WorkspaceOS.tsx`
- `frontend/components/os/shell/OrbArea.tsx`
- `frontend/components/os/shell/OrbMount.tsx`
- `frontend/app/globals.css`

## Deliverables
1. UI Rendering Contract (Schema + Runtime Resolver + API Bootstrap)
2. Goal Hierarchie-Modell (North Star -> Operational -> Tasks + Run Mapping)
3. Risk/Approval-Policy-Modell (auto / confirm_user / confirm_admin)
4. Design Tokens für Orb-OS (Premium Light Default, Inter + Mono)
5. Orb Runtime States inkl. Waiting/Auth/Approval + Statusdarstellung

## UI-Komponentenliste
- Orb Core
- `OrbMount`: visueller Orb-State
- `OrbArea`: Orb-Panel, dynamische Quick Actions, Status-Badges
- `WorkspaceOS`: Shell-Orchestrierung, API-Contract-Einbindung

- Surfaces
- Dashboard (DesktopSurface)
- Assistant (ElyPanel + IntentLine)
- Goals (über Goal-Model-Contract; UI nächste Iteration)
- Apps (Launcher + WindowDock)
- Settings (bestehend)
- Builder (bestehend, capability-gated)

## Data/Contract Schema
### 1) `workspace_capabilities`
- Identität: `workspace_id`, `contract_version`, `policy_version`, `updated_at`
- Surface Gates: `surfaces.dashboard|assistant|goals|apps|settings|builder|marketplace`
- Capability Gates: `capabilities.<key>`
- Level: `enabled | hidden | read_only | admin_only`

### 2) `app_manifest`
- Core: `manifest_version`, `app_id`, `name`, `category`, `description`
- Visual: `icon.name`, `icon.variant`
- Placement: `surfaces[]` (`orb`, `edge_rail`, `apps_surface`, ...)
- Aktionen: `quick_actions[]` (`tool_ref`, `requires_auth`, `requires_approval`)
- Safety: `risk_tags[]`
- Auth: `auth_requirements[]` (scopes + fallback)
- Runtime: `tools[]`, `status_badges[]`
- Distribution: `install_constraints`, `compatibility.min_contract_version`

### 3) `integration_status`
- Scope: `workspace_id`, `integration_id`
- Health: `state`, `connected`, `health_score`, `last_refresh_at`
- Auth: `scopes[]`, `reauth_url`
- Errors: `error_code`, `error_message_safe`

### 4) UI Rendering Contract
Input:
- `workspace_capabilities`
- `app_manifest[]`
- `installed_apps[]`
- `integration_status[]`
- `tool_registry[]`

Output (`resolveUiModel`):
- `visible_surfaces[]`
- `orb_quick_actions[]`
- `edge_rail_apps[]`
- `apps_surface_apps[]`
- `dashboard_widgets[]`

## Render-Regeln Orb/Edge Rail
- Orb zeigt nur `quick_actions` aus installierten/aktivierten Apps mit `surfaces` enthält `orb`.
- QuickAction-State wird aus Tool-Status + Integration-Status abgeleitet:
- `ready` (enabled + auth ok)
- `needs_auth` (required integration nicht connected)
- `policy_blocked` (tool status)
- `disabled` (tool status)
- Edge Rail zeigt nur geöffnete Surfaces/Apps als Task Switcher.
- Keine statische Menüquelle darf als Wahrheit gelten; Registry/Capabilities sind source-of-truth.

## Goals Contract
### Entitäten
- `NorthStarGoal`
- `OperationalGoal` (FK -> North Star)
- `GoalTask` (FK -> Operational)
- `RunGoalLink` (automatische oder explizite Zuordnung)

### Status/Priority
- Status: `planned | active | blocked | at_risk | completed | archived`
- Priority: `p0..p3`

### UI Logik
- Dashboard-Prominenz: zuerst `at_risk/blocked`, dann `priority`, dann `updated_at`.
- Goals Surface: Tree-Ansicht North Star -> Operational -> Tasks.
- Assistant Chips: `current_north_star`, top operational goals, aktive tasks.

### Auto-Zuordnung von Runs
Regelreihenfolge:
1. Explizite User-Zuordnung (confidence 1.0)
2. Assistant Suggestion (confidence 0..1)
3. Fallback auf operational goal (confidence 0.4)

## Policy + Approval Contract
### Risk Mapping
- `read_only` -> `auto`
- `writes` -> `confirm_user`
- `writes` + sensitives Kontextsignal (`pii|financial_impact|org_scope`) -> `confirm_admin`
- `destructive` -> `confirm_admin`

### Runtime States
- `proposed -> queued -> running -> waiting_for_auth|waiting_for_approval -> succeeded|failed|cancelled`

### UI Badge-Regeln
- `waiting_for_auth` -> `needs_auth`
- `waiting_for_approval` -> `degraded`
- `failed` -> `policy_blocked`
- `cancelled` -> `disabled`

## Phase 1 Design System (Orb-OS)
### Tokens
- Light-first surfaces, glass panels, workspace accent glow
- Typography: Inter + JetBrains Mono
- Motion: spring + smooth easing
- Orb-accent als Workspace-Hervorhebung (Glow + focus rings)

### Orb Global States
- `idle`
- `listening`
- `planning`
- `executing`
- `waiting_for_auth`
- `waiting_for_approval`
- `success`
- `error`

Mapping in UI:
- `thinking`: listening/planning/executing
- `warning`: waiting_for_auth/waiting_for_approval
- `success`: succeeded acknowledgement
- `error`: degraded/error

## Prompt Suite (1:1 verwendbar)

### Prompt A — Contract Bootstrap API
"Implement `/api/os/bootstrap` so it returns a validated UI contract composed of workspace_capabilities, app_manifest, installed_apps, integration_status, and tool_registry. Validate with zod, resolve UI model via deterministic rules, and return `{ ok, contract, ui }`. Reject unauthenticated requests and enforce workspace_id scoping."

### Prompt B — Registry-Driven Orb Quick Actions
"Refactor Orb panel quick actions to render only from resolved UI contract (`ui.orb_quick_actions`). Remove hardcoded actions. Show state badges (`ready`, `needs_auth`, `policy_blocked`, `disabled`), disable blocked actions, and route to app or assistant intent depending on mapping."

### Prompt C — Goals Hierarchy + Run Mapping
"Implement goal entities for North Star -> Operational -> Tasks and RunGoalLink mapping with confidence/source fields. Add dashboard sorting logic prioritizing at_risk/blocked goals, then priority, then recency. Add assistant chips payload builder."

### Prompt D — Policy/Approvals Runtime
"Implement risk-to-approval resolver (`auto`, `confirm_user`, `confirm_admin`) with context signals (`pii`, `financial_impact`, `org_scope`, `restricted_domain`). Return runtime badges and retry eligibility guardrail."

### Prompt E — Premium Orb-OS Tokens (Light)
"Define Orb-OS design tokens for light default, glass panels, workspace accent glow, motion durations/easing, radius scale, spacing scale, and typography (Inter + Mono). Apply tokens to shell header, app launcher, dock, and orb panel surfaces."

### Prompt F — Orb Global State Integration
"Unify Orb runtime states across type definitions, event bus, shell mapping, and visual components. Required states: idle, listening, planning, executing, waiting_for_auth, waiting_for_approval, success, error. Ensure OrbMount + OrbArea visuals and badges represent each state."

## Acceptance Checklist
- [ ] No hardcoded quick-action menu in Orb
- [ ] Orb/UI bootstrap uses workspace-scoped contract only
- [ ] Goal hierarchy + run link model available
- [ ] Policy resolver and runtime badge mapping available
- [ ] Orb global states include auth/approval waiting and success
- [ ] Shell uses premium light tokens by default
