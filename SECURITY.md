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

- `owner`, `admin`, `member`, `viewer` per workspace.
- **Platform owner** (the operator of an instance) is configured by exact email address in
  `SYSTEM_FOUNDER_ALLOWLIST` / `NEXT_PUBLIC_SYSTEM_FOUNDER_ALLOWLIST`. Whole domains are never
  trusted. The role cannot be requested by a client.
- Only the platform owner can use the coding agent (`/api/os/code/*`), which can read and change
  the codebase, and the diagnostic routes.

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
