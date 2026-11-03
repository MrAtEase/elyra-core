# STATUS REPORT

## Vision 2035 Reset (2026-02-10)

This repository is now aligned to the Vision 2035 Cloud Workspace OS path.

### Enforced Product Path
- Single workspace only: `Vision 2035` (`id/slug: vision-2035`).
- Primary runtime path: web desktop at `/w/vision-2035`.
- Legacy multi-workspace route surfaces are redirected to `/w/vision-2035`.
- Chat endpoint usage in frontend product path is removed; runs API is used (`/v1/runs`).

### Backend Runtime (Worker)
- Added v1 endpoints:
  - `POST /v1/runs`
  - `GET /v1/runs/:id`
  - `GET /v1/runs`
  - `POST /v1/runs/:id/cancel`
  - `POST /v1/runs/:id/approve`
  - `GET /v1/approvals`
  - `GET /v1/audit`
  - `GET /v1/usage`
  - `GET /v1/window-layout`
  - `PUT /v1/window-layout`
- Policy gate is enforced before `http_request` tool execution.
- Quotas are enforced with hard stop (`quota_exceeded`).
- Approval flow is enforced (`needs_approval`) and resumable via approve endpoint.
- Audit events are written for run/step/tool/approval/quota actions.

### Database
- Added migration for hard reset + Vision 2035 seed + runtime tables:
  - `worker/migrations/0005_cloud_workspace_os.sql`

### Frontend UX
- OS-like desktop with draggable/resizable/focusable/minimizable/closable windows.
- System apps in desktop: Runs, Approvals, Audit, Files, Settings, Admin.
- Smaller persistent Orb (bottom-right) acts as command center:
  - Command palette
  - Agent prompt (starts runs)
  - Running status
  - Approval indicator
- Window layout is persisted per user via `/v1/window-layout`.

### Legacy Scope
- Legacy shell and multi-workspace components remain in repository but are not in the primary runtime path.
- Legacy routes are redirected to avoid conflicting user flows.

