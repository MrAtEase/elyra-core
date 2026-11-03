# Work Breakdown Structure (WBS)

Generated from codebase analysis on 2026-02-08.

---

## Block 1: Domain Migration & App Stability

### ELYRA-B1-001: DNS/SSL/Redirect/Cookie Scope Cleanup
**Effort:** S | **Priority:** P0 (blocking)

**Current State:**
- Worker routes to `api.elyra-core.app` (active)
- Frontend at `app.elyra-core.app` (active)
- Cookie `mf-s` with domain `.elyra-core.app` (prod) — configured
- Legacy `/workspace/*` redirects exist in `frontend/middleware.ts`

**Tasks:**
- [ ] Verify DNS records for `elyra-core.app`, `app.elyra-core.app`, `api.elyra-core.app`
- [ ] Verify SSL certificates are auto-renewed (Cloudflare managed)
- [ ] Verify cookie scope `.elyra-core.app` works across subdomains
- [ ] Test CORS headers between `app.elyra-core.app` → `api.elyra-core.app`

**Acceptance Criteria:**
- All subdomains resolve with valid TLS
- `mf-s` cookie is sent on cross-subdomain requests
- CORS preflight passes for all `/assistant/*` endpoints
- No mixed-content warnings

**Files:** `worker/wrangler.toml`, `worker/src/index.ts` (CORS), `frontend/middleware.ts`

---

### ELYRA-B1-002: /w Namespace Consistency — No /workspace Leaks
**Effort:** S | **Priority:** P0

**Current State:**
- `/w/[slug]/*` routes exist in `frontend/app/w/`
- Legacy `/workspace/*` redirects in `frontend/middleware.ts` (lines 1-52)
- Some pages still exist under `frontend/app/workspace/` (settings, admin)

**Tasks:**
- [ ] Audit all `frontend/app/workspace/` pages — migrate or alias to `/w/[slug]/*`
- [ ] Ensure `frontend/middleware.ts` catches ALL legacy patterns
- [ ] Search frontend codebase for hardcoded `/workspace` references
- [ ] Add redirect for `/workspace/work/planner` → `/w/active/planner` (if missing)

**Acceptance Criteria:**
- No route under `/workspace/*` serves content (all redirect to `/w/*`)
- `grep -r "/workspace" frontend/` returns only middleware redirect rules
- E2E test: navigating to any `/workspace/*` URL results in `/w/*` redirect

**Files:** `frontend/middleware.ts`, `frontend/app/workspace/`, `frontend/app/w/`

---

### ELYRA-B1-003: Auth + Onboarding Gating
**Effort:** M | **Priority:** P0

**Current State:**
- Supabase auth → exchange for `mf-s` session cookie
- `whoami` endpoint returns user + workspace context
- Onboarding table exists in D1 schema

**Tasks:**
- [ ] Implement onboarding gate: new users must complete setup before `/w/` access
- [ ] Verify session expiry (30-day TTL) triggers re-auth cleanly
- [ ] Handle edge case: user with expired Supabase token but valid `mf-s` cookie
- [ ] Ensure `resolveSessionActiveWorkspaceId()` handles missing workspace gracefully
- [ ] Add loading/error states for auth exchange flow

**Acceptance Criteria:**
- Unauthenticated users redirect to `/signin`
- New users redirect to onboarding flow
- Expired sessions redirect to `/signin` with return URL
- No blank screen on auth edge cases

**Files:** `worker/src/index.ts` (auth endpoints), `frontend/middleware.ts`, `frontend/lib/auth/`

---

## Block 2: Tool MVPs (Read-Only + UI)

### ELYRA-B2-001: Mail Read
**Effort:** M | **Priority:** P1

**Current State:**
- `worker/src/gmail.ts` has `listInbox()` (unread, last 7 days, max 10)
- `worker/src/mail/google-provider.ts` has `MailProviderAdapter` abstraction
- Frontend mail page exists at `frontend/app/w/[slug]/mail/`

**Tasks:**
- [ ] Extend `listInbox()` to support pagination (pageToken)
- [ ] Add `getMessage(id)` endpoint for full email view
- [ ] Add `listThreads()` for threaded view
- [ ] Wire `GET /assistant/email/inbox` endpoint in worker
- [ ] Wire `GET /assistant/email/thread/:id` endpoint in worker
- [ ] Build mail list UI component (sender, subject, snippet, date)
- [ ] Build thread view UI component
- [ ] Handle "Gmail not connected" state with setup CTA

**Acceptance Criteria:**
- Mail list loads within 2s for connected workspace
- Paginated inbox with 10 items per page
- Thread view shows full conversation
- Disconnected state shows "Connect Gmail" button
- Token refresh works transparently

**Files:** `worker/src/gmail.ts`, `worker/src/mail/google-provider.ts`, `worker/src/index.ts`, `frontend/app/w/[slug]/mail/`

---

### ELYRA-B2-002: Calendar Read + Week View
**Effort:** M | **Priority:** P1

**Current State:**
- `worker/src/calendar.ts` has `listUpcoming()` (next 10 events)
- Frontend calendar page exists at `frontend/app/w/[slug]/calendar/`
- Supabase has `calendar_events` table for sync

**Tasks:**
- [ ] Extend `listUpcoming()` to accept timeMin/timeMax range parameters
- [ ] Add `GET /assistant/calendar/events?start=&end=` endpoint
- [ ] Build week view calendar UI (7-day grid, hourly slots)
- [ ] Build day view calendar UI
- [ ] Show event details on click (title, time, location, attendees)
- [ ] Handle "Calendar not connected" state with setup CTA
- [ ] Optional: sync events to Supabase `calendar_events` for faster loads

**Acceptance Criteria:**
- Week view renders current week's events
- Day navigation (prev/next week)
- Event click shows detail overlay
- Events from Google Calendar API render within 2s
- Disconnected state shows "Connect Calendar" button

**Files:** `worker/src/calendar.ts`, `worker/src/index.ts`, `frontend/app/w/[slug]/calendar/`

---

### ELYRA-B2-003: Planner CRUD
**Effort:** M | **Priority:** P1

**Current State:**
- Supabase has `tasks` table with workspace scoping + RLS
- `tasks` table supports `source` tracking (manual, gmail, calendar)
- `entity_links` table supports task↔mail/calendar linkage
- Frontend planner page exists at `frontend/app/w/[slug]/planner/`

**Tasks:**
- [ ] Wire `GET /assistant/tasks` endpoint (list, filter by status)
- [ ] Wire `POST /assistant/tasks` endpoint (create)
- [ ] Wire `PUT /assistant/tasks/:id` endpoint (update status, title, due date)
- [ ] Wire `DELETE /assistant/tasks/:id` endpoint (with confirmation)
- [ ] Build task list UI (title, status, due date, source badge)
- [ ] Build task creation form (title, description, due date)
- [ ] Build inline task editing (status toggle, title edit)
- [ ] Build filter/sort controls (status, due date, source)

**Acceptance Criteria:**
- CRUD operations work for workspace-scoped tasks
- Tasks persist across sessions (Supabase)
- Task list loads within 1s
- Delete requires confirmation click
- RLS prevents cross-workspace access

**Files:** `worker/src/index.ts`, `frontend/db/migrations/`, `frontend/app/w/[slug]/planner/`

---

### ELYRA-B2-004: Integrations UI — Connect/Test/Remove
**Effort:** M | **Priority:** P1

**Current State:**
- OAuth start/callback endpoints exist for Google and Microsoft
- `workspace_connections` table tracks provider status
- Frontend settings pages exist under `frontend/app/workspace/settings/`

**Tasks:**
- [ ] Build integrations settings page at `/w/[slug]/settings/integrations`
- [ ] Show connection status per provider (Google, Microsoft) with test result
- [ ] "Connect" button triggers OAuth flow
- [ ] "Test" button verifies token validity (call whoami on provider)
- [ ] "Disconnect" button revokes tokens + deletes workspace_connection
- [ ] Show connected scopes per provider
- [ ] Handle token refresh failures with "Reconnect" CTA

**Acceptance Criteria:**
- User can connect Google/Microsoft from settings
- Connection status shows "Connected" / "Disconnected" / "Error"
- "Test" button confirms live token access
- "Disconnect" removes tokens from KV and connection record from D1
- Page reflects real-time connection state

**Files:** `worker/src/index.ts` (OAuth endpoints), `worker/src/google.ts`, `frontend/app/w/[slug]/settings/`

---

## Block 3: Mutations + Confirmation Enforcement

### ELYRA-B3-001: Confirmation Store + Audit Log (D1)
**Effort:** M | **Priority:** P0 (blocks all mutations)

**Current State:**
- Elli has in-memory confirmation state machine in `worker/src/elli/system.ts`
- D1 schema has no `confirmation_events` or `audit_log` tables
- Assessment doc specifies: every mutation needs `confirmation_event_id`

**Tasks:**
- [ ] Create D1 migration: `confirmation_events` table
  ```sql
  CREATE TABLE confirmation_events (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    action_type TEXT NOT NULL, -- 'send' | 'create' | 'update' | 'delete'
    target TEXT NOT NULL, -- 'mail' | 'calendar' | 'task' | 'integration'
    proposal_json TEXT NOT NULL, -- ActionProposal as JSON
    state TEXT NOT NULL DEFAULT 'pending', -- FSM state
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    confirmed_at TEXT,
    executed_at TEXT,
    result_state TEXT, -- 'succeeded' | 'failed'
    error_message TEXT,
    expires_at TEXT NOT NULL -- stale confirmation protection
  );
  ```
- [ ] Create D1 migration: `audit_log` table
  ```sql
  CREATE TABLE audit_log (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    action TEXT NOT NULL,
    domain TEXT NOT NULL,
    resource_id TEXT,
    confirmation_event_id TEXT REFERENCES confirmation_events(id),
    metadata_json TEXT, -- non-sensitive metadata only
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  ```
- [ ] Wire `nextConfirmationState()` to persist state transitions in D1
- [ ] Add `POST /assistant/confirm/:id` endpoint
- [ ] Add `POST /assistant/cancel/:id` endpoint
- [ ] Add middleware: reject mutation if no valid `confirmation_event_id`
- [ ] Add stale confirmation check (expire after 10 minutes)
- [ ] Write audit log entry for every state transition

**Acceptance Criteria:**
- Every mutating endpoint requires valid, non-expired `confirmation_event_id`
- Confirmation state transitions are persisted in D1
- Audit log captures: proposal → confirm → execute → result
- Stale confirmations (>10 min) are rejected
- Cannot replay a used confirmation_event_id
- Cannot use confirmation from a different workspace/user

**Files:** `worker/migrations/`, `worker/src/elli/system.ts`, `worker/src/index.ts`

---

### ELYRA-B3-002: Gmail Send/Label/Trash
**Effort:** M | **Priority:** P1

**Current State:**
- `worker/src/gmail.ts` has `sendEmail()` (basic RFC822 + base64)
- `worker/src/mail/google-provider.ts` has `sendMail()` and `trashThread()`
- No label management, no draft save

**Tasks:**
- [ ] Wire `POST /assistant/email/send` endpoint (requires confirmation)
- [ ] Wire `POST /assistant/email/trash/:id` endpoint (requires confirmation)
- [ ] Add label management: `POST /assistant/email/label` (add/remove labels)
- [ ] Implement draft save: `POST /assistant/email/draft`
- [ ] All send/trash operations must go through confirmation flow
- [ ] Generate ActionProposal for each mail mutation
- [ ] Add idempotency key to prevent duplicate sends

**Acceptance Criteria:**
- Send email requires confirmation (ActionProposal → confirm → execute)
- Sent email appears in Gmail "Sent" folder
- Trash requires confirmation
- Label add/remove works without confirmation (non-destructive)
- Duplicate send protection via idempotency key
- Missing Gmail integration returns clear error with setup guidance

**Files:** `worker/src/gmail.ts`, `worker/src/mail/google-provider.ts`, `worker/src/index.ts`

---

### ELYRA-B3-003: Calendar Create/Update/Cancel + Conflict Aware
**Effort:** M | **Priority:** P1

**Current State:**
- `worker/src/calendar.ts` has `listUpcoming()` only
- Elli has `detectCalendarConflict()` with 30-min buffer logic
- No create/update/delete endpoints

**Tasks:**
- [ ] Add `createEvent(accessToken, eventData)` to `calendar.ts`
- [ ] Add `updateEvent(accessToken, eventId, eventData)` to `calendar.ts`
- [ ] Add `deleteEvent(accessToken, eventId)` to `calendar.ts`
- [ ] Wire `POST /assistant/calendar/events` (create, requires confirmation)
- [ ] Wire `PUT /assistant/calendar/events/:id` (update, requires confirmation)
- [ ] Wire `DELETE /assistant/calendar/events/:id` (delete, requires confirmation)
- [ ] Integrate `detectCalendarConflict()` into create/update flow
- [ ] Conflict detection runs BEFORE confirmation prompt
- [ ] Suggest alternative time when conflict detected

**Acceptance Criteria:**
- Create event: generates ActionProposal, conflict check, confirmation, then creates
- Update event: generates ActionProposal, conflict check, confirmation, then updates
- Delete event: generates ActionProposal, confirmation, then deletes
- Conflict detection suggests alternative time with 30-min buffer
- All mutations persisted in Google Calendar
- Audit log records every calendar mutation

**Files:** `worker/src/calendar.ts`, `worker/src/elli/system.ts`, `worker/src/index.ts`

---

### ELYRA-B3-004: Drive List/Search
**Effort:** S | **Priority:** P2

**Current State:**
- Google Drive scope (`drive`) requested in OAuth
- No Drive API wrapper exists in codebase

**Tasks:**
- [ ] Create `worker/src/drive.ts` with:
  - `listFiles(accessToken, { query, pageToken, pageSize })`
  - `getFile(accessToken, fileId)`
  - `searchFiles(accessToken, query)`
- [ ] Wire `GET /assistant/drive/files` endpoint
- [ ] Wire `GET /assistant/drive/files/:id` endpoint
- [ ] Wire `GET /assistant/drive/search?q=` endpoint
- [ ] Build file browser UI in frontend

**Acceptance Criteria:**
- File list shows name, type, modified date, size
- Search returns relevant files within 2s
- Pagination works for large Drive folders
- Read-only (no mutations in this ticket)

**Files:** new `worker/src/drive.ts`, `worker/src/index.ts`

---

### ELYRA-B3-005: Slides Create/Update/Export
**Effort:** L | **Priority:** P2

**Current State:**
- Google Presentations scope requested in OAuth
- No Slides API wrapper exists in codebase

**Tasks:**
- [ ] Create `worker/src/slides.ts` with:
  - `createPresentation(accessToken, { title, templateId? })`
  - `getPresentation(accessToken, presentationId)`
  - `addSlide(accessToken, presentationId, { layout, content })`
  - `replaceText(accessToken, presentationId, replacements)`
  - `exportPdf(accessToken, presentationId)` (via Drive export)
- [ ] Wire endpoints:
  - `POST /assistant/slides` (create, requires confirmation)
  - `GET /assistant/slides/:id` (read)
  - `POST /assistant/slides/:id/slides` (add slide, requires confirmation)
  - `POST /assistant/slides/:id/replace` (text replace, requires confirmation)
  - `GET /assistant/slides/:id/export/pdf` (export, no confirmation)
- [ ] All mutations go through confirmation flow
- [ ] Build presentation list UI
- [ ] Build slide preview UI (thumbnail or embed)

**Acceptance Criteria:**
- Create presentation from blank or template
- Add slides with specified layout
- Replace text placeholders (e.g., `{{company_name}}`)
- Export to PDF and download
- All mutations require confirmation
- Audit log records every slide mutation

**Files:** new `worker/src/slides.ts`, `worker/src/index.ts`

---

## Block 4: Multi-LLM Orchestrator

### ELYRA-B4-001: Model Gateway + Routing + Fallbacks
**Effort:** M | **Priority:** P1

**Current State:**
- `worker/src/llmService.ts` (343 lines) calls OpenAI only
- Uses `gpt-5.2` (chat) and `gpt-5.1-codex` (code)
- No abstraction layer, direct API calls

**Tasks:**
- [ ] Create `worker/src/llm/gateway.ts` — unified model gateway
  ```ts
  interface LLMRequest {
    model: string; // "openai:gpt-5.2" | "anthropic:claude-opus-4-6" | "gemini:2.5-pro"
    messages: Message[];
    tools?: ToolDefinition[];
    maxTokens?: number;
  }
  interface LLMResponse {
    content: string;
    toolCalls?: ToolCall[];
    usage: { inputTokens: number; outputTokens: number; cost: number };
    provider: string;
    model: string;
    latencyMs: number;
  }
  ```
- [ ] Create `worker/src/llm/router.ts` — route requests to providers
  - Task-based routing: chat → GPT-5.2, code → Codex, reasoning → Claude
  - Fallback chain: primary → secondary → error
- [ ] Create `worker/src/llm/cost-tracker.ts` — per-provider cost tracking
- [ ] Add rate limit handling with exponential backoff
- [ ] Add circuit breaker pattern for provider outages

**Acceptance Criteria:**
- All LLM calls go through gateway (no direct provider calls)
- Fallback works: if primary provider fails, secondary is used
- Cost tracked per request per provider
- Rate limits handled gracefully (queue, retry, fallback)
- No PII in gateway logs

**Files:** new `worker/src/llm/`, refactor `worker/src/llmService.ts`

---

### ELYRA-B4-002: Tool-Call Validation + Repair Loop
**Effort:** M | **Priority:** P1

**Current State:**
- LLM service generates plans but no tool-call execution
- Elli system has ActionProposal schema

**Tasks:**
- [ ] Define unified tool schema (compatible with OpenAI/Anthropic/Gemini function calling)
  ```ts
  interface ToolDefinition {
    name: string;
    description: string;
    parameters: JSONSchema;
    requiresConfirmation: boolean;
  }
  ```
- [ ] Build tool-call validator: check params against schema before execution
- [ ] Build repair loop: if tool call fails validation, re-prompt LLM with error
  - Max 2 repair attempts before failing
- [ ] Map tool calls to ActionProposals (for confirmation flow)
- [ ] Add tool execution sandbox: tools run in try/catch with timeout

**Acceptance Criteria:**
- Invalid tool calls are caught before execution
- Repair loop fixes 80%+ of malformed tool calls
- Tool calls that require confirmation generate ActionProposals
- Tool execution timeout prevents runaway operations
- All tool executions logged to audit trail

**Files:** new `worker/src/llm/tools.ts`, `worker/src/elli/system.ts`

---

### ELYRA-B4-003: Provider Connectors
**Effort:** M | **Priority:** P1

**Current State:**
- OpenAI connector exists (direct API calls in `llmService.ts`)
- No Anthropic, Gemini, or Vertex connectors

**Tasks:**
- [ ] Create `worker/src/llm/providers/openai.ts` — refactor from llmService.ts
- [ ] Create `worker/src/llm/providers/anthropic.ts` — Claude API via Vertex or direct
- [ ] Create `worker/src/llm/providers/gemini.ts` — Gemini API
- [ ] Each provider implements unified `LLMProvider` interface:
  ```ts
  interface LLMProvider {
    chat(request: LLMRequest): Promise<LLMResponse>;
    supportsTools: boolean;
    supportedModels: string[];
  }
  ```
- [ ] Add provider-specific secrets to wrangler.toml + Cloudflare Secrets:
  - `ANTHROPIC_API_KEY` or Vertex credentials
  - `GEMINI_API_KEY`
- [ ] Add "no data retention" / "no training" headers per provider

**Acceptance Criteria:**
- Each provider passes integration test with simple chat completion
- Tool calling works on OpenAI and Anthropic (Gemini optional)
- Provider-specific error codes mapped to unified error types
- "No training" opt-out configured per provider where available

**Files:** new `worker/src/llm/providers/`, `worker/wrangler.toml`

---

## Block 5: GDPR/Privacy Hardening

### ELYRA-B5-001: Data Minimization + Retention Policy + Deletion
**Effort:** M | **Priority:** P0

**Current State:**
- Workspace isolation via token scoping + RLS
- No data retention policy enforced
- No workspace deletion cascade
- No data export endpoint

**Tasks:**
- [ ] Define retention policy:
  - Audit logs: 90 days (configurable)
  - Confirmation events: 30 days after terminal state
  - Sessions: 30 days (already TTL'd)
  - Cached provider data: 0 (never cached) or 5 min max
- [ ] Implement retention cleanup job (D1 scheduled deletion)
- [ ] Implement workspace deletion cascade:
  1. Revoke all OAuth tokens (KV delete)
  2. Delete workspace_connections (D1)
  3. Delete confirmation_events (D1)
  4. Delete audit_log entries (D1)
  5. Delete tasks, calendar_events, mail_threads (Supabase)
  6. Delete workspace record
- [ ] Add `DELETE /assistant/workspaces/:slug` endpoint (requires confirmation)
- [ ] Add `GET /assistant/workspaces/:slug/export` for GDPR data export (JSON)

**Acceptance Criteria:**
- Workspace deletion removes ALL data across D1, KV, and Supabase
- Retention cleanup runs daily, deletes expired records
- Data export produces JSON with all user data (minus tokens)
- No provider content (email bodies, event descriptions) stored permanently
- Deletion is auditable (deletion audit record survives workspace deletion for 90 days)

**Files:** `worker/src/index.ts`, `worker/migrations/`, `frontend/db/migrations/`

---

### ELYRA-B5-002: PII-Safe Logging + Redaction
**Effort:** M | **Priority:** P0

**Current State:**
- Cloudflare Workers logs (unstructured)
- No PII redaction
- Spec says: no email bodies, event descriptions, doc content in logs

**Tasks:**
- [ ] Create `worker/src/lib/logger.ts` — structured logger with PII redaction
  ```ts
  function log(event: AuditEvent) {
    // Redact: email bodies, event descriptions, file content
    // Keep: IDs, types, counts, timestamps, workspace_id, user_id
  }
  ```
- [ ] Add redaction rules:
  - Email: log recipient, subject length, NOT body
  - Calendar: log event ID, time range, NOT description/attendee emails
  - Drive: log file ID, type, NOT content
  - LLM: log model, token count, latency, NOT prompt/response content
- [ ] Replace all `console.log` in worker with structured logger
- [ ] Add environment flag: `LOG_LEVEL` (debug/info/warn/error)
- [ ] Ensure LLM prompts containing user data are NOT logged

**Acceptance Criteria:**
- `grep` through worker logs reveals ZERO email bodies, calendar descriptions, or file content
- Structured JSON logs with `workspace_id`, `user_id`, `action`, `timestamp`
- Log level configurable per environment
- LLM request/response content never appears in logs
- Audit events use separate structured logger (to D1), not console

**Files:** new `worker/src/lib/logger.ts`, `worker/src/index.ts`, `worker/src/llmService.ts`

---

### ELYRA-B5-003: Secrets/KMS + Token Encryption Strategy
**Effort:** M-L | **Priority:** P1

**Current State:**
- Secrets in Cloudflare Dashboard (prod) / `.dev.vars` (dev)
- OAuth tokens stored plaintext in KV
- No envelope encryption or KMS

**Tasks:**
- [ ] Evaluate: Cloudflare Workers does NOT support KMS natively
  - Option A: Encrypt tokens with AES-256-GCM using a master key from CF Secrets
  - Option B: Use external KMS (GCP Secret Manager) for key wrapping
  - Recommendation: Option A for MVP (simpler, sufficient)
- [ ] Implement token encryption wrapper:
  ```ts
  async function encryptToken(plaintext: string, env: Env): Promise<string>
  async function decryptToken(ciphertext: string, env: Env): Promise<string>
  // Uses env.TOKEN_ENCRYPTION_KEY (CF Secret)
  ```
- [ ] Migrate existing KV tokens to encrypted format
- [ ] Add `TOKEN_ENCRYPTION_KEY` to Cloudflare Secrets
- [ ] Ensure refresh flow encrypts new tokens before KV write
- [ ] Add key rotation procedure (documented, not automated for MVP)

**Acceptance Criteria:**
- All OAuth tokens in KV are encrypted at rest (AES-256-GCM)
- Token decryption only happens in Worker runtime (never exposed raw)
- Key rotation procedure documented
- Existing tokens migrated to encrypted format
- `.dev.vars` has dev encryption key for local testing

**Files:** new `worker/src/lib/crypto.ts`, `worker/src/google.ts`, `worker/wrangler.toml`

---

### ELYRA-B5-004: Threat Model + Security Tests
**Effort:** M | **Priority:** P1

**Current State:**
- Security spec exists in `docs/08_SECURITY_AND_GOVERNANCE.md`
- Workspace isolation spec in `docs/12_WORKSPACE_ISOLATION_GUARANTEES.md`
- No automated security tests

**Tasks:**
- [ ] Document threat model:
  - Cross-workspace data access
  - Confirmation bypass (direct API call without confirmation)
  - Stale/replayed confirmation tokens
  - Token theft from KV
  - CSRF on mutation endpoints
  - XSS in frontend
  - LLM prompt injection (user input → tool call)
- [ ] Write security tests:
  - [ ] Test: cannot access workspace B tokens from workspace A session
  - [ ] Test: mutation endpoint rejects missing confirmation_event_id
  - [ ] Test: expired confirmation_event_id is rejected
  - [ ] Test: confirmation from user A cannot be used by user B
  - [ ] Test: CSRF token validated on state-changing requests
  - [ ] Test: XSS payloads in task titles/email subjects are escaped
  - [ ] Test: LLM tool calls cannot bypass confirmation requirement
- [ ] Add security test runner to CI pipeline

**Acceptance Criteria:**
- Threat model document covers all attack vectors
- All security tests pass
- Cross-workspace access is impossible (verified by test)
- Confirmation bypass is impossible (verified by test)
- No XSS in rendered user content
- LLM prompt injection cannot execute unconfirmed actions

**Files:** new `docs/THREAT_MODEL.md`, new `tests/security/`, `worker/src/elli/system.test.ts`

---

## GDPR/Security Gate List

These gates BLOCK release. No exceptions.

| Gate | Requirement | Verification |
|------|------------|--------------|
| G1 | No email/calendar/doc content in logs | Log audit + grep |
| G2 | All mutations require persisted confirmation | Security test |
| G3 | Cross-workspace access impossible | Security test |
| G4 | OAuth tokens encrypted at rest | KV inspection |
| G5 | Workspace deletion removes ALL data | Integration test |
| G6 | No LLM provider receives PII in training | Provider config + headers |
| G7 | Session cookie HttpOnly + Secure + SameSite | Browser test |
| G8 | Stale confirmations rejected | Security test |
| G9 | Audit log captures all mutations | Integration test |
| G10 | Data export endpoint works (GDPR Art. 20) | Integration test |

---

## Dependency Graph

```
B1-001 (DNS/SSL) ──┐
B1-002 (/w leaks) ──┼──► B1-003 (Auth gating) ──► Block 2 (all)
                    │
                    └──► B3-001 (Confirmation store) ──┬──► B3-002 (Gmail send)
                                                       ├──► B3-003 (Calendar CRUD)
                                                       ├──► B3-004 (Drive read)
                                                       └──► B3-005 (Slides)

B4-001 (Gateway) ──► B4-002 (Tool validation) ──► B4-003 (Providers)

B5-001 (Retention) ─┐
B5-002 (Logging)   ─┼──► B5-004 (Security tests)
B5-003 (Encryption) ┘
```

**Critical Path:** B1 → B3-001 → B3-002/B3-003 → B5 (GDPR gates)
