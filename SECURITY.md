# Security

Elyra Core is a prototype and portfolio project. It is not operated as a public service.
This document describes the security model and how to report a problem.

## Reporting a vulnerability

Please do not open a public issue. Report it privately through GitHub:
[Security › Report a vulnerability](https://github.com/MrAtEase/elyra-core/security/advisories/new).
You will get an answer within a few days.

## Security model

### Authentication

- Users sign in with Supabase Auth (Google OAuth or email magic link).
- The worker issues an HttpOnly session cookie. API routes in the frontend verify every request
  against the worker (`/assistant/auth/whoami`) through one central helper:
  `frontend/lib/api/requireAuth.ts` (`requireUser`, `requirePlatformOwner`).
- The AI service verifies the Supabase JWT on every request.

### Workspace isolation

- A user only has access to workspaces they are a **member** of. Memberships are stored in the
  worker database and are the single source of truth.
- Frontend API routes resolve the requested workspace to the user's real workspace id and reject
  anything else with `403`. There is no development-mode shortcut.
- The AI service accepts a client-supplied workspace id only after confirming the membership with
  the worker (cached for 60 seconds).
- Data is always stored under the real workspace id, never under a shared alias.

### Roles

- `owner`, `admin`, `member`, `viewer` (shown as "Gast") per workspace.
- Owners and admins manage the team; only owners grant or change the owner role. A workspace
  always keeps at least one owner. The worker enforces these rules, not the UI.
- Personal workspaces never get other members. Teams live in separate company workspaces.
- Only the platform owner can invite people into the system workspace.
- Only owners can delete a company workspace, after typing its exact name. Personal and system
  workspaces cannot be deleted. The audit log is kept.

### Platform view ("Kunden")

- Only the platform owner sees the customer list (Elyra Core › Workspace Admin › Kunden). The
  worker checks this on every call, independent of the UI.
- It shows metadata only: workspace name, owner email, member count, last activity and AI usage
  numbers. Mails, events, documents, chats and app data are never read for it.
- The platform owner can suspend a company workspace (e.g. abuse or an unpaid invoice). Members
  lose access immediately, data stays, and it can be reactivated at any time. Both are audited.

### Invitations

- An invitation is bound to one email address and a role. The link token (32 random bytes) is
  shown once; only its SHA-256 hash is stored.
- Accepting requires a session with exactly that email address, so a forwarded link is useless.
- Links expire after 7 days, work once and can be withdrawn. A new invite for the same address
  replaces the old one; at most 50 invitations can be open per workspace.
- Invites, role changes and removals are written to the audit log (domain `team`).
- **Platform owner** (the operator of an instance) is configured by exact email address in
  `SYSTEM_FOUNDER_ALLOWLIST` / `NEXT_PUBLIC_SYSTEM_FOUNDER_ALLOWLIST`. Whole domains are never
  trusted. The role cannot be requested by a client.
- Only the platform owner can use the diagnostic routes (see below). There is no in-app agent that
  can read or change the codebase.

### Diagnostic and test routes

- `/api/dev/email-io-health` (mail service health for the diagnostics panel) answers only the
  platform owner; everyone else gets `403`. It returns status information, never credentials.
- `/dev/*` pages only call owner-only APIs and show nothing to other users.
- `/os/smoke/*` pages are fixtures for the Playwright tests and return `404` in production builds.
- There is no route that exposes environment variables or secrets.

### Human in the loop

- Elly proposes actions; anything that sends, deletes or changes data outside the app needs an
  explicit approval and is written to an audit log.

### Secrets

- No secrets in the repository. Every service has an `.env.example` / `.dev.vars.example`.
- Third-party tokens (Google, GitHub, IMAP app passwords) are encrypted at rest with AES-256-GCM.
- Mini-apps built by the assistant run in a sandboxed iframe (`allow-scripts allow-forms`, no
  same-origin, `default-src 'none'`) and only talk to the host through a narrow message bridge.

## Known limitations

- Prototype: no penetration test, no formal audit, no production SLA.
- Rate limits exist for mini-app AI calls; other AI routes rely on provider limits.
