# Elyra/Elli Project Assessment

## 1) Current State (from thread analysis)

You already have important foundations:
- `/w` Domain-Cutover (Routing + Middleware + Legacy Redirects) — Basis is there
- Marketing routes implemented — ok, but copy/layout still needs to become exactly spec-compliant (currently still feels like "placeholder")
- Elli Policy-Module (Modes/Confidence/ActionProposals/Tests) — strong, but not yet wired end-to-end
- OAuth Scopes adjusted toward "full write / full access" — important, but not sufficient on its own
- Big gap is clearly identified: the actual Worker-Endpoints + Confirmation hard-gate + Audit + Slides/Drive write are still completely missing "production-hard".

---

## 2) The Real Effort: 4 Major Construction Sites

### A) Multi-Agent / Multi-LLM Orchestration (Anthropic via Vertex + Gemini + OpenAI + Codex)

**Effort: medium to large** (depending on requirements)
- Model Gateway (unified internal API)
- Routing/Failover/Tool-call repair
- Unified Tool-Schema + Validator
- Cost-/Rate-Limits per Provider
- Observability without PII-Leak

If you do this "properly" (tool-robust + deterministic + auditable), it's not "just hooking up 2 SDKs".

### B) Tool/Integration Layer: Mail + Calendar + Drive/Slides "Full Write"

**Effort: large** (because it's mutating + high-trust)

What's still missing:
- `/assistant/workspaces/:slug/...` complete endpoint set (read + write)
- Token refresh + reconnect flows stable
- Calendar conflict checking server-side
- Gmail send/label/trash server-side
- Slides create/modify/export (Drive + Slides APIs) server-side
- Robustness: retries, idempotency keys, partial failure

This is the core that makes you "feel like a product" — and the core that can break the most.

### C) Confirmation & Audit as "non-bypassable" (Trust Core)

**Effort: medium technically, high in discipline/test depth**

You need:
- Confirmation Events persistent (D1 or similar)
- Every mutation must match confirmation_event_id + user_id + workspace_id
- Audit log: proposal → confirm → execute → result (incl. error)
- Tests: Confirmation bypass, replay attacks, stale confirmations

This must be server-side hard enforced. UI is not enough.

### D) GDPR/Privacy/Security "really serious"

**Effort: large**, because it cuts across everything.

In production you want:
- TLS in transit
- Encryption at rest (DB/Secrets)
- KMS/Secrets isolation
- Minimization (store as little data as possible)
- Logging without content

And: "I don't want any data from a customer" — practically means:
- Strict Workspace Isolation
- No Cross-Workspace queries
- No logs with Email bodies / event descriptions / doc content
- No Prompt-Logging with PII
- No Provider training opt-in
- DPA/AVV with your subprocessors (Google/Vertex/OpenAI etc.)

---

## 3) Effort from Current State (order of magnitude)

Engineering checklist with effort points (S = Small, M = Medium, L = Large):

### Block 1: Domain Migration & "App runs stable"
| Task | Effort |
|------|--------|
| DNS/SSL/redirects/cookie scope clean | S |
| "/w" consistent everywhere, no old /workspace leaks | S |
| Auth + onboarding gating correct | M |
| **Total** | **S–M** |

### Block 2: Tool MVPs (UI thin, but real)
| Task | Effort |
|------|--------|
| Mail Read | M |
| Calendar Read + Week view | M |
| Planner CRUD | M |
| Integrations UI + connect/test/remove | M |
| **Total** | **M** |

### Block 3: Mutations + Confirmation Enforcement (the hard part)
| Task | Effort |
|------|--------|
| Confirmation store + audit log | M |
| Gmail send/label/trash | M |
| Calendar create/update/cancel + conflict aware | M |
| Drive list/search | S |
| Slides create/update/export | L |
| **Total** | **L** |

### Block 4: Multi-LLM Orchestrator
| Task | Effort |
|------|--------|
| Model gateway + routing + fallbacks | M |
| Tool-call validation + repair loop | M |
| Provider connectors (Anthropic Vertex, Gemini, OpenAI, Codex) | M |
| **Total** | **M–L** |

### Block 5: GDPR/Privacy Hardening
| Task | Effort |
|------|--------|
| Data minimization + retention policy + deletion | M |
| PII-safe logging + redaction | M |
| Secrets/KMS + token encryption strategy | M–L |
| Threat model + security tests | M |
| **Total** | **M–L** |

**Summary:** From "now" to "runs securely with Mail/Calendar write + Slides create" the dominant effort is **Mutations + Confirmation + Security**.

---

## 4) Information Needed (Infrastructure & Policy Decisions)

### A) Hosting/Infra Facts
1. Where exactly does the Worker run? (Cloudflare Workers? Vercel Edge? own?)
2. Where is the DB (D1/Postgres/Supabase)?
3. Where are Secrets stored (CF Secrets, GCP Secret Manager, Vault)?

### B) Data Policy (GDPR)
4. Do you permanently store Email/Calendar/Docs content anywhere? (Yes/No)
   - Recommendation: **No**. Only minimal cache, short-lived, if at all.
5. Retention: how long may Logs/Audit Events exist?
6. Deletion concept: "User deletes Workspace" → what gets deleted where?

### C) LLM Provider Policy
7. Which providers may see content? (OpenAI/Anthropic/Gemini)
8. Are there "no data retention" / "no training" settings per Provider to enforce?

### D) Slides Use-Case (so we don't overbuild)
9. Which top actions in Slides must work in V1?
   - "Create deck from template"
   - "Add slides"
   - "Replace text"
   - "Export PDF"
   - "Branding / Theme"

---

## 5) Agent Organization (Codex/Claude/Gemini)

To avoid chaos, divide Agents by layers:
- **Agent A (Backend/Worker)**: Endpoints + confirmation enforcement + token refresh + audit
- **Agent B (Integrations/Google APIs)**: Gmail/Calendar/Drive/Slides API wrapper + conflict logic
- **Agent C (LLM Gateway)**: Provider connectors + tool schema + validation/repair
- **Lead**: Security/GDPR decisions + Threat Model + "what we store" Policy

---

## Core Architecture Principle

If you really mean "privacy-first", it's not just a feature — it's an architecture decision:

> **Minimize, don't store, confirm before mutating, audit without content, redaction everywhere.**
