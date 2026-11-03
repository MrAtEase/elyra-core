# Workspace Admin Surface — Premium Control Center

## Component Hierarchy
1. `DesktopSurface` (settings surface branch)
2. `WorkspaceAdminSurface`
3. `WorkspaceAdminSurface > TabBar`
4. `WorkspaceAdminSurface > TabPanel`
5. `TabPanel` states:
   - `TabLoading`
   - `TabError`
   - `TabEmpty`
   - `TabReady`

## Routes / State Model
- Route: `GET /api/os/workspace-admin`
- Workspace scope: derived from authenticated `whoami.activeWorkspace.id`
- UI state:
  - `state.loading`
  - `state.error`
  - `state.payload`
  - `activeTab`
- Tabs:
  - `general`
  - `members`
  - `capabilities`
  - `integrations`
  - `ai_control_center`
  - `policies_approvals`
  - `audit_log`
  - `usage_budget`

## Empty / Loading / Error per Tab
- Every tab section is `AdminSection<T>`:
  - `state: ready | empty | error`
  - `data`
  - `error_code`
  - `error_message_safe`
- UI mapping:
  - `loading` -> `TabLoading`
  - `error` -> `TabError`
  - `empty` -> `TabEmpty`
  - `ready` -> `TabReady` with tab content

## Acceptance Criteria
1. No sidebar menu; admin appears as settings overlay panel.
2. All responses are workspace-scoped.
3. All tab content comes from contract/API payload, not hardcoded per workspace.
4. Each tab supports loading/empty/error/ready rendering.
5. Tabs include: General, Members, Capabilities, Integrations, AI Control Center, Policies & Approvals, Audit Log, Usage & Budget.
