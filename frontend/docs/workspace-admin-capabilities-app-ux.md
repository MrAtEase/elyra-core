# Capabilities + App Install/Enable UX

## UI Spec
## Surface
- `WorkspaceAdminSurface` -> `Capabilities` tab

## Sections
1. Surface Access Toggles
2. Capability Flag Toggles
3. Manifest Pack App Cards

## App Card Content
- App name/category
- install state: `not installed | enabled | disabled`
- risk badges from manifest `risk_tags`
- policy badges from tool registry statuses
- blocked reason text if policy/auth/tool state blocks usage
- actions: `Install | Enable | Disable | Uninstall`

## Data Calls
1. `GET /api/os/workspace-admin`
   - returns workspace-scoped sections
   - `sections.capabilities.data.apps_manifest_pack` is source of app list
2. `PATCH /api/os/workspace-admin/capabilities`
   - body: `{ kind: "surface" | "capability", id, status }`
3. `PATCH /api/os/workspace-admin/apps`
   - body: `{ app_id, action: "install" | "enable" | "disable" | "uninstall" }`

## Guardrails
1. No hardcoded app list: always derived from `contract.app_manifest`.
2. Owner-only mutation:
   - non-owner gets `403 OWNER_REQUIRED`
   - UI disables controls for non-owner.
3. Workspace scope enforced via authenticated `activeWorkspace.id`.
4. Inputs validated by Zod.
5. Blocked reasons shown from policy/auth/tool status derivation.
