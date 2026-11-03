# Integrations Center Spec

## UI Spec
- Surface: `WorkspaceAdminSurface` -> `Integrations` tab
- Card per integration (from contract/bootstrap only):
  - status badge: `connected | disconnected | degraded | needs_auth`
  - last refresh timestamp
  - scopes list
  - safe error details
  - blocked reason (policy/role)
  - actions:
    - Connect/Reconnect CTA
    - Diagnose

## Interactions
1. Connect/Reconnect
   - uses `entry.connect_url` from API payload
   - disabled if `can_connect` is false or URL missing
2. Diagnose
   - calls `GET /api/os/integrations/diagnose?integration_id=<id>`
   - writes diagnosis result inline per card

## Error Handling
- Global fetch failure: tab-level `TabError` with Retry.
- Per-tab state:
  - `ready` => cards render
  - `empty` => `TabEmpty`
  - `error` => `TabError`
- Safe details only:
  - UI uses `safe_error_details` / `error_code`
  - no raw provider token/error leakage

## Workspace + Policy Guardrails
1. Workspace-scoped:
   - all routes bind to authenticated active `workspace_id`
2. Policy-aware:
   - `can_connect` and `blocked_reason` derive from role/policy state
3. Contract-driven:
   - integrations list derived from bootstrap contract `integration_status`
   - no hardcoded integration list
