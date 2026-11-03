# Elyra Orb-OS CQRS / Dual-Store SSOT

## Single Source of Truth clarified

- `Execution SSOT`: Worker `cloudOsV2` (`/v1/os/*`) is the only command write path for run execution when `ELYRA_USE_WORKER_BACKBONE=1`.
- `Control-plane SSOT`: Workspace/admin/config/policy/plugin metadata is managed via Supabase-backed control-plane APIs.

This is an explicit CQRS split, not an accidental dual-write setup.

## Plane ownership matrix

| Table / Entity | Plane | Writer (authoritative) | Readers |
|---|---|---|---|
| `runs`, `orchestration_runs`, `tool_calls`, `artifacts`, `approvals`, `run_events` | data_plane | Worker `cloudOsV2` | UI/API read models |
| `workspace_capabilities`, `installed_apps`, `app_manifests`, `tool_registry_entries`, `workspace_policies` | control_plane | Admin/API services | Worker + UI |
| `plugin_manifests`, `workspace_plugins`, `plugin_audit_log` | control_plane | Plugin endpoints | Worker + UI |
| `os_metric_samples`, `os_metric_aggregates`, `os_incidents` | control_plane observability | API emitters + trigger jobs | Admin surface |

## Control-plane -> data-plane contracts

- Worker runtime executes commands from `/v1/os/*`.
- Policy/registry/capability decisions are expected from control-plane contract snapshots.
- Versioning inputs:
  - `workspace_capabilities.contract_version`
  - `workspace_capabilities.policy_version`
  - `app_manifests.manifest_version`
  - `tool_registry_entries.version`

## Failure and degraded-mode rules

- Worker unavailable:
  - UI/API returns `degraded_mode=true`
  - No local data-plane fallback execution
  - Error code: `BACKBONE_UNAVAILABLE`
- Control-plane unavailable:
  - Existing runtime runs continue
  - Admin/settings/bootstrap endpoints degrade section-wise
- Signature/auth failure on worker proxy:
  - Worker returns `invalid_proxy_signature` / `proxy_signing_misconfigured`
  - Frontend surfaces safe degraded response

## Runtime enforcement

- Frontend CQRS guardrails:
  - `assertControlPlaneWrite(table)`
  - `assertDataPlaneWrite(table)`
  - file: `lib/orb-os/cqrs/ownership.ts`
- SSOT mode hard block:
  - local execution throws `410` (`Local tool execution is disabled in SSOT mode.`)
- Proxy security:
  - HMAC request signing headers from frontend proxy
  - worker verifies timestamp/nonce/signature

