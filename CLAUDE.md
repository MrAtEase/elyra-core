# Elyra Core — Claude Code Contract

This repository is the Elyra OS platform: an AI-first operating system shell built with Next.js 16,
Cloudflare Workers, and a multi-provider AI agent backbone (Gemini, Claude, OpenAI/Codex).

---

## Architecture Overview

```
elyra-core/
  frontend/          Next.js 16 app — the OS shell UI + all API routes
  worker/            Cloudflare Worker — auth, memory, workspace brain
  backend/ai-service/ Node.js AI service — Gemini/Claude/OpenAI calls
  email-io/          Email processing microservice
  .run/playground/   Isolated hot-reload mirror for safe live preview
  scripts/           Repo management (restart-elyra-local.sh, etc.)
```

### Key Frontend Paths

| Path | Purpose |
|------|---------|
| `app/os/` | Next.js App Router pages for the OS shell |
| `app/os/layout.tsx` | Auth guard + WorkspaceOS shell (persists across routes) |
| `app/api/os/code/run/route.ts` | **Critical**: 10K-line AI coding agent pipeline |
| `app/api/os/code/runs/` | Run persistence API |
| `components/os/shell/WorkspaceOS.tsx` | OS shell — header, canvas, intent line |
| `components/os/kernel/KernelProvider.tsx` | Window/app state manager |
| `components/os/apps/code/CodingAgentWindow.tsx` | Coding agent UI (chat, diff, logs) |
| `.run/playground/frontend/` | Playground mirror — sync after editing route.ts |

---

## Provider Routing (Gemini · Claude · Codex)

Elly routes each task to the optimal AI provider via `resolveVibeProvider()` in `route.ts`:

| Skill / Task type | Preferred provider | Why |
|---|---|---|
| `review-code`, `db-review`, `perf-audit` | **Gemini** | Large context window, repo-wide analysis |
| `security-scan`, `tdd-guide`, `api-design` | **Claude** | Complex reasoning, multi-step logic |
| `implement-feature`, patch-heavy edits | **OpenAI/Codex** | Strong code generation |
| `ux-ui-design`, UI refactors | **Gemini CLI** | Visual + layout reasoning |
| Default fallback | Gemini → OpenAI → Claude | Availability order |

**Never hardcode a provider** — always route through `resolveVibeProvider()` or `resolveProvider()`.

---

## Coding Standards

### TypeScript / React
- Use `type` for types, `interface` only for extensible contracts
- No `any` or `unknown` without explicit justification
- Prefer `const` + arrow functions over `function` declarations inside components
- Always destructure props — never `props.foo`
- All `useCallback` / `useMemo` must list complete dependency arrays
- New React components: functional only, no class components
- CSS: use Tailwind + Elyra design tokens (`var(--os-border-soft)`, `var(--text-primary)`, etc.)

### Next.js App Router
- Server components by default; `"use client"` only when hooks/events needed
- API routes: always return typed `NextResponse.json()`; use `withSupabaseAuthorization` for auth
- No direct `supabase` calls in page components — use API routes or server actions

### Immutability Rule (CRITICAL)
Always create new objects. Never mutate state directly:
```typescript
// ✅ correct
setItems(prev => [...prev, newItem]);
// ❌ wrong
items.push(newItem); setItems(items);
```

### Error Handling
- All `async` functions in API routes: wrap in `try/catch`, return `{ ok: false, error: string }`
- localStorage: always wrap in `try/catch` — QuotaExceededError is silently swallowed elsewhere
- Never `console.log` in production paths — use `addLog()` in CodingAgentWindow, structured logging in route.ts

---

## Agent System (route.ts) — Critical Rules

The file `frontend/app/api/os/code/run/route.ts` is the AI agent pipeline. Changes here have wide blast radius.

### After editing route.ts — ALWAYS sync to playground:
```bash
cp frontend/app/api/os/code/run/route.ts \
   .run/playground/frontend/app/api/os/code/run/route.ts
```

### Skill System
Each `CodingSkill` has:
1. A **system prompt** in `skillSystemPrompt()` — provider-agnostic text instructions
2. A **provider preference** in `resolveVibeProvider()` — which AI backend to use
3. A **local fallback plan** in `buildLocalPlan()` — used when AI is unavailable
4. A **mode** in `modeForSkill()` — maps to LocalAgentRequestMode

### Diff Pipeline (in order)
1. `callGeminiJson` (or Claude/OpenAI) → raw diff
2. `fixDiffHunkCounts` → recount `@@` headers
3. `stripSpuriousRemovedLines` → remove hallucinated removals
4. `applyPatchAndVerify` fallbacks: `git apply` → `-C1` → `--ignore-whitespace` → `--3way` → `GNU patch -F3` → AI repair
5. Build gate → sync to playground → snapshot commit

### Patch Repair
`repairPatchWithGemini` has NO `responseSchema` (removed due to truncation). Keep it that way.

---

## Playground Workflow

```
PLAYGROUND (port 3100) ← hot preview, isolated mirror
       ↓ promote
DEV (port 3000) ← main development branch
       ↓ promote
PROD ← production deployment
```

- Run `./scripts/restart-elyra-local.sh restart` to restart all services
- Playground uses `--webpack` (Turbopack crashes on symlinked node_modules)
- Main frontend uses `--turbopack`

---

## Testing & Build

```bash
# TypeScript check
cd frontend && npx tsc --noEmit

# Build (full)
cd frontend && npm run build

# Unit tests
cd frontend && npm test

# E2E (Playwright)
cd frontend && npm run test:e2e

# Specific suites
npm run test:security-enforcement
npm run test:runtime-backbone
npm run test:ssot-enforcement
```

---

## Security Rules

- **No hardcoded secrets** — API keys, tokens, passwords must be in `.env.local` or worker secrets
- **SQL injection**: always use parameterized Supabase queries (`.eq()`, `.filter()` — never raw SQL interpolation)
- **Auth**: all `/api/os/*` routes must call `fetchWhoamiPayload()` and check `hasWorkspaceAccess()`
- **Do not report generic security findings** for local tooling (child_process, shell execution in dev scripts) — only flag externally reachable, production-exposed attack paths
- **Rate limiting**: worker routes have rate limiting; do not bypass in new API routes

---

## Multi-Provider Skill Principles

When adding or modifying skills, ensure they work with ALL THREE providers:
1. **Prompts are provider-agnostic** — write instructions that work for Gemini, Claude, and OpenAI
2. **Provider routing is in `resolveVibeProvider()`** — add skill-based routing there
3. **No provider-specific prompt formatting** — no `<thinking>` tags, no Anthropic-specific XML
4. **JSON output schema** — use the same response schema for all providers; test with each

---

## Memory System

```
WorkspaceBrainProfile   → workspace identity (purpose, role, goals, rules)
WorkspaceMemoryEntry    → task-level memories (what worked, what to avoid)
persistCodingMemory()   → save task outcome to worker memory
buildLongTermMemoryContext() → inject memories into prompts
```

Memories are stored in Supabase `workspace_memories` table, scoped per `workspace_id`.
Limit: 8 recent memories injected per prompt to stay within context budget.

---

## Repo Layout Conventions

| Convention | Rule |
|---|---|
| CSS variables | Always prefer `var(--os-xxx)` over hardcoded colors |
| New app pages | Add `page.tsx` in `app/os/<appname>/` returning `null` (shell handles window) |
| New skills | Update: `CodingSkill` type, `skillSystemPrompt`, `resolveVibeProvider`, `modeForSkill`, `buildLocalPlan`, `SKILL_ICONS`, skill select list in CodingAgentWindow |
| New API routes | Must have auth check + typed response + error handling |
| Window chrome | Never add per-window close buttons — use WorkspaceOS chrome bar |

---

## Preferred Tools (in Claude Code)

```bash
# Search
rg "pattern" frontend/          # ripgrep — faster than grep
# File edits: prefer targeted Edit over Write for existing files
# Build verification
cd frontend && npx tsc --noEmit && echo "✅ Types OK"
# Restart stack
./scripts/restart-elyra-local.sh restart
# Sync to playground (after route.ts changes)
cp frontend/app/api/os/code/run/route.ts .run/playground/frontend/app/api/os/code/run/route.ts
```
