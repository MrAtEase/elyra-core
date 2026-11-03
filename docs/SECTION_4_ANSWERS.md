# Section 4 Answers — Infrastructure & Policy Facts

Derived from codebase analysis on 2026-02-08. All answers verified against source code.

---

## A) Hosting/Infra Facts

### 1. Where exactly does the Worker run?

**Cloudflare Workers.**

Evidence:
- `worker/wrangler.toml`: `name = "elyra-api"`, `compatibility_date = "2026-02-05"`
- Production route: `api.elyra-core.app` (zone: `elyra-core.app`)
- Account ID: `6850ed51666acaf2875fd9031b046c77`
- Deploy command: `npx wrangler deploy`

Frontend runs as **Next.js** (likely on Vercel or Cloudflare Pages — `next.config.js` exists, no `vercel.json` found, but also not exported as static).

### 2. Where is your DB?

**Two databases (dual-DB architecture):**

| Database | Type | Purpose | Location |
|----------|------|---------|----------|
| **ASSISTANT_DB** | Cloudflare D1 (SQLite) | Auth, sessions, workspaces, memberships, onboarding, integration tokens | CF edge |
| **Supabase** | PostgreSQL | Tasks, calendar_events, mail_threads, sync_runs, entity_links | `pvpjnljocdqpmsropybk.supabase.co` |

Additionally:
- **ASSISTANT_KV** (Cloudflare KV): OAuth tokens, session state — KV ID: `e82e2c32de9a4cd181f164d158ea2b11`

### 3. Where are Secrets stored?

| Environment | Method | Location |
|-------------|--------|----------|
| **Production** | Cloudflare Secrets Dashboard | Encrypted at rest by CF |
| **Development** | `.dev.vars` file | `worker/.dev.vars` (gitignored) |
| **Frontend dev** | `.env.local` file | `frontend/.env.local` (gitignored) |

Secrets include:
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT_ID`
- `OPENAI_API_KEY`
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`
- `INTERNAL_API_KEY`, `INTERNAL_API_SECRET`

**No KMS.** No GCP Secret Manager, no HashiCorp Vault. OAuth tokens stored **plaintext** in KV.

---

## B) Data Policy (GDPR)

### 4. Do you permanently store Email/Calendar/Docs content anywhere?

**Partially yes — in Supabase.**

| Data | Stored? | Where | Notes |
|------|---------|-------|-------|
| Email threads | Yes | `mail_threads` table (Supabase) | Synced from Gmail |
| Calendar events | Yes | `calendar_events` table (Supabase) | Synced from Google Calendar |
| Task descriptions | Yes | `tasks` table (Supabase) | User-created content |
| Document content | No | — | Only file metadata via Drive API |
| Email bodies | Unknown | Check `mail_threads` schema | May store snippets |

**Recommendation:** Move to **pass-through only** for email bodies and calendar descriptions. Store only IDs + metadata for linking. Fetch content live from provider API.

### 5. Retention: how long may Logs/Audit Events exist?

**Currently undefined.** No retention policy is enforced.

- Sessions: 30 days TTL (code-enforced via `SESSION_TTL_MS`)
- Audit logs: `docs/08_SECURITY_AND_GOVERNANCE.md` says "default 90 days" — **not implemented**
- Supabase data: no TTL, no cleanup job
- KV tokens: no TTL, persist indefinitely

**Recommendation:**
- Audit logs: 90 days
- Confirmation events: 30 days after terminal state
- Cached provider data: 0 (never store) or 5 min TTL max
- Deleted workspace data: immediate purge + 90-day audit retention

### 6. Deletion concept: "User deletes Workspace" → what gets deleted where?

**Currently: NOT IMPLEMENTED.** No workspace deletion cascade exists.

Proposed cascade:

| Step | Store | What | Method |
|------|-------|------|--------|
| 1 | Cloudflare KV | OAuth tokens (`google_tokens:*:workspaceId`) | KV delete |
| 2 | Cloudflare D1 | `workspace_connections` WHERE workspace_id = X | SQL DELETE |
| 3 | Cloudflare D1 | `memberships` WHERE workspace_id = X | SQL DELETE |
| 4 | Cloudflare D1 | `sessions` WHERE active_workspace_id = X | SQL DELETE |
| 5 | Cloudflare D1 | `confirmation_events` WHERE workspace_id = X | SQL DELETE |
| 6 | Cloudflare D1 | `audit_log` WHERE workspace_id = X | Retain 90 days, then delete |
| 7 | Supabase | `tasks` WHERE workspace_id = X | SQL DELETE (RLS) |
| 8 | Supabase | `calendar_events` WHERE workspace_id = X | SQL DELETE |
| 9 | Supabase | `mail_threads` WHERE workspace_id = X | SQL DELETE |
| 10 | Supabase | `entity_links` (orphaned) | CASCADE |
| 11 | Supabase | `integrations` WHERE workspace_id = X | SQL DELETE |
| 12 | Cloudflare D1 | `workspaces` WHERE id = X | SQL DELETE |

---

## C) LLM Provider Policy

### 7. Which providers may see content?

**Currently: OpenAI only.**

| Provider | Configured | Model | API Key Present |
|----------|-----------|-------|-----------------|
| OpenAI | Yes | `gpt-5.2` (chat), `gpt-5.1-codex` (code) | `OPENAI_API_KEY` in `.dev.vars` |
| Anthropic | No | — | No key configured |
| Google Gemini | No | — | No key configured |
| Vertex AI | No | — | No credentials |

Code: `worker/src/llmService.ts` makes direct calls to `https://api.openai.com/v1/responses`.

### 8. Are there "no data retention" / "no training" settings per Provider?

**Currently: NOT configured.**

- No `X-No-Training` or equivalent headers sent to OpenAI
- No Anthropic usage (but Anthropic API has `anthropic-beta: no-training` header option)
- No opt-out configured

**Recommendation per provider:**
| Provider | Opt-out Method |
|----------|---------------|
| OpenAI | Use API (not playground). Enterprise API does NOT train on data by default. Verify DPA. |
| Anthropic | API calls are NOT used for training by default. Verify via Terms. |
| Google Gemini | Use Vertex AI (not consumer Gemini). Vertex does NOT train on customer data. |

---

## D) Slides Use-Case

### 9. Which top actions in Slides must work in V1?

**Cannot be determined from code** — no Slides implementation exists. The Google Presentations scope is requested in OAuth, but no Slides API wrapper exists.

Based on the assessment doc suggestions, recommend selecting from:
- "Create deck from template" — most valuable for business users
- "Replace text" — enables template-based deck generation
- "Export PDF" — essential for sharing/distribution

The `add slides` and `branding/theme` features are significantly more complex and should be V2.

---

## Summary of Gaps Found

| Area | Status | Critical Gap |
|------|--------|--------------|
| Token encryption | Missing | OAuth tokens stored plaintext in KV |
| Audit logging | Spec only | No D1 tables, no implementation |
| Confirmation persistence | In-memory only | State lost on Worker restart |
| Workspace deletion | Missing | No cascade, no cleanup |
| Retention policy | Undefined | No TTL on any persisted data |
| PII in logs | Unverified | No structured logging, no redaction |
| Multi-LLM | OpenAI only | No Anthropic/Gemini connectors |
| Slides API | Missing | Scope requested but no code |
| Calendar mutations | Missing | Read-only, no create/update/delete |
| Data export (GDPR) | Missing | No Art. 20 compliance endpoint |
