# Development guide

How the repository is organised, how to run it locally and the rules for changing it.
These rules apply to people and to AI coding assistants alike.

## Repository layout

| Folder | Purpose |
|---|---|
| `frontend/` | Next.js 16 app: the OS shell, all windows/apps and the API routes under `app/api/` |
| `worker/` | Cloudflare Worker: sign-in, sessions, users, workspaces and memberships (D1/KV) |
| `backend/ai-service/` | Node.js (Fastify) service for AI calls: Gemini, Claude, OpenAI |
| `email-io/` | Internal service for iCloud mail (IMAP/SMTP) |
| `scripts/` | Local dev and verification scripts |

Key frontend paths:

| Path | Purpose |
|---|---|
| `app/os/` | App Router pages of the OS shell |
| `components/os/shell/WorkspaceOS.tsx` | Shell: header, workspace switcher, canvas, intent line |
| `components/os/kernel/` | Window and app state, workspace model |
| `lib/api/requireAuth.ts` | Central login / platform-owner check for API routes |
| `lib/marketplace/` | Marketplace, templates and sandboxed mini-apps |
| `components/os/apps/settings/TeamPanel.tsx` | Team & roles UI; API in `app/api/os/team/`, rules in `worker/src/team.ts` |

## Run locally

```bash
npm install
cp frontend/.env.example frontend/.env.local
cp backend/ai-service/.env.example backend/ai-service/.env
cp worker/.dev.vars.example worker/.dev.vars
# fill in the values, then:
npm run dev:all
```

Services: frontend `:3000`, worker `:8787`, AI service `:8788`, email-io `:3001`.

## Checks

```bash
cd frontend && npx tsc --noEmit      # types
cd frontend && npm test              # unit tests
cd frontend && npm run test:e2e      # Playwright
cd worker && npx tsc --noEmit
cd backend/ai-service && npx tsc --noEmit
```

## Rules

### Security (non-negotiable)

- Every API route starts with `requireUser()` or `requirePlatformOwner()` from `lib/api/requireAuth.ts`.
- Every route that takes a `workspaceId` resolves it to the user's real workspace id and checks the
  membership (`hasWorkspaceAccess`). Store data under the real id, never under an alias.
- No environment-based shortcuts around authentication or workspace checks.
- No secrets in code. New variables go into the matching `.env.example`.
- Parameterised database queries only.

### AI providers

- Never hard-code a provider. Route through the provider router so Gemini, Claude and OpenAI stay
  interchangeable, with automatic fallback.
- Prompts are provider-neutral (no vendor-specific tags). Same JSON schema for every provider.
- Actions with side effects (send, delete, change external data) need user approval and an audit entry.

### Code style

- TypeScript strict mode (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`); no `any`.
- Functional React components; complete dependency arrays for hooks.
- Never mutate state; always create new objects.
- Use the design tokens (`var(--os-…)`, `var(--text-primary)`, …) instead of fixed colours.
- `try/catch` around async work in API routes; respond with `{ ok: false, error }`.
- Wrap `localStorage` access in `try/catch`.

### Changes

- Every user-visible change gets a line in `CHANGELOG.md`.
