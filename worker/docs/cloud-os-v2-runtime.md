# Cloud OS V2 Runtime (Phase 1-4 Umsetzung)

Diese Implementierung liefert eine persistente Orchestration-Laufzeit unter `/v1/os/*` und lässt die bestehenden `/v1/*`-Routen unverändert.

## Neu implementiert

### Phase 1 (Stabiler Core)
- Persistente Runs mit `intent_text`, `plan_json`, `current_step`, `run_version`, `plan_version`.
- Persistente Run-Timeline über `run_steps` und `tool_calls`.
- Queue-basierter Worker via `orchestration_queue`.
- Retry/Backoff mit `retry_count`/`max_retries`.
- Idempotency-Key pro ToolCall (`tool_calls.idempotency_key`).
- Cancel/Resume Endpunkte:
  - `POST /v1/os/runs/:id/cancel`
  - `POST /v1/os/runs/:id/resume`

### Phase 2 (Tool Engine)
- Tool Registry (`tools`, `tool_endpoints`).
- Serverseitige Permissions (`tool_permissions`) inkl. Approval-Gates (`approvals`).
- Budgeting + Cost Ledger (`workspace_budgets`, `usage_ledger`).
- Concurrency/Backpressure-Grundlage über Queue-Leases.

### Phase 3 (Graph + Memory + Evals)
- Persistierter Execution Graph (`run_graph_nodes`, `run_graph_edges`).
- Workspace-Memory (`memories`) inkl. `memory_read`/`memory_write` Tools.
- Eval Harness (`eval_suites`, `eval_cases`, `eval_runs`) mit Dry-Run-Auswertung.

### Phase 4 (Multi-Workspace Intelligence)
- Delegation Layer (`delegations`) mit `acting_as`-Prüfung.
- Federation Request Workflow (`federation_requests`).
- Proaktive Ziele (`goals`) als langlebige Entitäten.

## Neue API Endpunkte

### Runs / Worker
- `POST /v1/os/runs`
- `GET /v1/os/runs`
- `GET /v1/os/runs/:id`
- `POST /v1/os/runs/:id/cancel`
- `POST /v1/os/runs/:id/resume`
- `POST /v1/os/worker/tick`

### Governance
- `GET /v1/os/approvals`
- `POST /v1/os/approvals/:id/approve`
- `POST /v1/os/approvals/:id/reject`
- `GET /v1/os/tools`
- `POST /v1/os/tools`

### Intelligence
- `GET /v1/os/memories`
- `GET|POST /v1/os/delegations`
- `GET|POST /v1/os/goals`
- `GET|POST /v1/os/federation/requests`
- `POST /v1/os/evals/suites`
- `POST /v1/os/evals/run`

### Ops
- `GET /v1/os/metrics`
- `GET|POST /v1/os/incidents`

## Incident Playbooks (Kurz)

### Runaway Costs
1. `GET /v1/os/metrics` prüfen (`cost_today_cents`, `queued_runs`).
2. Tool/Permission drosseln (`POST /v1/os/tools` / `tool_permissions` DB).
3. Betroffene Runs canceln (`POST /v1/os/runs/:id/cancel`).
4. Incident erfassen (`POST /v1/os/incidents`).

### Queue Backlog
1. `GET /v1/os/metrics` und Queue-Status prüfen.
2. Mehr `worker/tick` Trigger (Cron oder manuell) ausführen.
3. Fehlercodes in `orchestration_queue.last_error_*` auswerten.
4. Dead-Letter Runs gezielt `resume`n.

### Approval Stalls
1. `GET /v1/os/approvals` auf `pending` prüfen.
2. Freigaben/Rückweisungen per Approval-Endpunkte setzen.
3. Danach Worker ticken, damit Runs fortsetzen.

## Migrations / Compatibility
- Migration: `migrations/0006_orchestration_runtime_v2.sql`.
- Versionierung vorhanden: `run_version`, `plan_version`, `policy_version`, `schema_versions`.
- V1 API bleibt kompatibel; V2 ist namespace-isoliert (`/v1/os/*`).

## Empfohlene nächste harte Schritte
1. Cron-Scheduler für `POST /v1/os/worker/tick`.
2. p95-Latenz über echte Histogramme statt Proxy-Aggregat.
3. Deterministische Planner-Policies (temperature/constraints) serverseitig erzwingen.
4. Fault-Injection Tests für Timeout/429/Retry-Dedupe.
