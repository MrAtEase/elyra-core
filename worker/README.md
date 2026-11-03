# Personal Assistant — Cloudflare Workers Starter

This starter gives you a **single Worker** that can:
- Link your Google Workspace account (OAuth) ✅
- Read inbox + send emails via Gmail API ✅
- List Calendar events (and provides hooks to sync with Notion) ✅
- Store tokens & state in Cloudflare KV ✅
- Expose simple REST endpoints and a mini HTML dashboard ✅
- Run scheduled jobs (cron) to do syncs ✅

> Future modules (placeholders provided): Notion sync (two-way), Slides creation, “brainstorm” endpoint using an LLM, task memory.

---

## 1) Prereqs

- Cloudflare account + `wrangler` installed
- Google Cloud project with OAuth2 **Web application** client (use your existing project)
- Notion integration secret (optional for step 1)
- Your Worker URL (e.g. `https://personal-assistant.<your-subdomain>.workers.dev`)

## 2) Create KV & set up `wrangler.toml`

```bash
cd assistant-starter

# Create KV (once)
wrangler kv:namespace create ASSISTANT_KV
# copy the "id" it prints (and optionally "preview_id")

# Edit wrangler.toml -> replace <KV_ID_HERE> with your real id
```

## 3) Add secrets

```bash
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_CLIENT_SECRET
wrangler secret put GOOGLE_CLIENT_ID_EXTERNAL
wrangler secret put GOOGLE_CLIENT_SECRET_EXTERNAL
wrangler secret put GOOGLE_CLIENT_FORCE_EXTERNAL   # set to 1 to prefer the external/personal OAuth client (useful for consumer Gmail accounts)
wrangler secret put NOTION_TOKEN                # optional now
wrangler secret put OPENAI_API_KEY               # optional if you want /brainstorm
```

> Your Google **redirect URI** must be `https://<your-worker-domain>/auth/google/callback`
> You can store a separate OAuth client (External consent screen, add test users such as `test-user@example.com`) in `GOOGLE_CLIENT_ID_EXTERNAL`/`GOOGLE_CLIENT_SECRET_EXTERNAL`. The worker prefers the external client when `ENVIRONMENT` is not production or when `GOOGLE_CLIENT_FORCE_EXTERNAL=1`.

## 4) Publish

```bash
wrangler publish
```

## 5) Link Google (one time)

Visit:

```
https://<your-worker-domain>/auth/google/start
```

Approve. On success, tokens are stored in KV under key `google_tokens:paul` (change in code if you want multi-user).

## 6) Try endpoints

### Inbox (last 10 unread)
```
GET /email/inbox
```

### Send mail
```
POST /email/send
{
  "to": "someone@example.com",
  "subject": "Hello from Worker",
  "text": "It works!"
}
```

### Upcoming events
```
GET /calendar/upcoming
```

### Calendar CRUD (used by M.I.R.A OS)

All endpoints expect/return JSON and respond with `{ ok: boolean, ... }`.

- `GET /assistant/calendar/events?range=30&start=<iso>&end=<iso>`  
  Lists events from Google Calendar (primary by default). Returns `{ ok: true, events: GoogleEvent[] }`.
- `POST /assistant/calendar/create`  
  Body: `{ summary, description?, start, end, location?, userKey? }`  
  Creates an event and returns `{ ok: true, event }`.
- `POST /assistant/calendar/update`  
  Body: `{ id, summary?, description?, start?, end?, location?, userKey? }`  
  Updates an event (time or details) and returns `{ ok: true, event }`.
- `POST /assistant/calendar/delete`  
  Body: `{ id, userKey? }`  
  Deletes an event and returns `{ ok: true, deleted: <id> }`.

### PokerState memory (Merlin)
Merlin now keeps a workspace+user scoped PokerState so the assistant can infer direction without asking “Need Direction.” The state exposes `primary_focus`, `energy_state`, `time_horizon`, `life_policy` (with `protect_evenings`, `min_hobby_hours_per_week`, `max_focus_blocks_per_day`), `last_intent`, and `updatedAt`. Missing fields default to execution today + medium energy and are persisted automatically.

- `GET /assistant/workspaces/:workspaceId/poker`  
  Returns `{ ok: true, state: PokerState }`. Requires authentication and workspace membership.
- `PUT /assistant/workspaces/:workspaceId/poker`  
  Accepts partial patches for the same fields (life_policy patches support the nested keys listed above). Responses merge the patch, save the new state, and return `{ ok: true, state }`.

### Action Router (assistant/chat)

The chat endpoint now exposes a lightweight action router for structured workflows. The assistant can propose `{ action: { type, payload, status } }` units that flow through PokerState (stored in `pending_action`) and require explicit confirmation before executing. The supported action types are:
1. `calendar_create`, `calendar_update`, `calendar_delete` (create, update, or cancel Google/Microsoft events).
2. `task_create`, `task_update` (create a new task via synced providers/local storage and mark it done).
3. `mail_send` (send a short email via MailChannels).

Each proposal arrives with `status: "proposed"` and includes payloads such as `{ summary, start, end, description?, location?, calendarId? }` for calendar actions or `{ title, due?, description? }` for tasks. The worker persists the proposal in `PokerState.pending_action` so follow-ups stay scoped to the user+workspace.

- `POST /assistant/chat` responses always include an `action` object. When `action.status === "proposed"`, the assistant is asking for a clear confirmation before executing the external change.

---

## iCloud Mail (connect/verify/disconnect)

Endpoints (session required):
- `POST /assistant/workspaces/:workspaceId/mail/icloud/connect`
- `POST /assistant/workspaces/:workspaceId/mail/icloud/verify`
- `DELETE /assistant/workspaces/:workspaceId/mail/icloud/disconnect`

Smoke scripts:
```bash
WORKER_API_ORIGIN=http://localhost:8787 \\
SESSION_COOKIE="mf-s=..." \\
WORKSPACE_ID="ws_..." \\
ICLOUD_EMAIL="user@icloud.com" \\
ICLOUD_APP_PASSWORD="xxxx-xxxx-xxxx-xxxx" \\
./scripts/check-icloud-connect.sh

WORKER_API_ORIGIN=http://localhost:8787 \\
SESSION_COOKIE="mf-s=..." \\
WORKSPACE_ID_A="ws_a" \\
WORKSPACE_ID_B="ws_b" \\
ICLOUD_IDENTITY_ID="conn_..." \\
./scripts/check-icloud-isolation.sh
```
- Optional: set `ICLOUD_SYNC_SENT="true"` to append SMTP-sent messages into the iCloud Sent folder (best-effort; defaults to off).
- On the next user message, the worker inspects the latest pending action. Confirmation keywords (`ja`, `confirm`, `do it`, etc.) trigger execution by calling the relevant helper (`createCalendarEvent`, `updateCalendarEvent`, `deleteCalendarEvent`, task providers/local storage helpers, or the MailChannels sender). The reply includes `action.status === "executed"` plus the created/updated resource details.
- If the user declines or reformulates the request, the pending action is cleared (or replaced) so Merlin can plan another proposal. All proposals continue to run through the constraint kernel to respect energy, time, and life policies before reaching the confirmation step.

Set `POKER_DEBUG=true` in the worker environment to log Poker load/save operations during development.

Aliases `/assistant/calendar/*-event` are kept for backward compatibility and map to the same handlers. User scoping currently defaults to `DEFAULT_USER_KEY` but is resolved centrally to support multi-user/workspaces later.

Mini dashboard:
```
GET /
```

## Deploy + Migrations

Run the migrations before every production deploy so the D1 schema and bindings stay in sync:

1. `npx wrangler d1 migrations apply ASSISTANT_DB --remote`
2. `npx wrangler deploy`

> The new migration `migrations/0003_poker_state.sql` creates the `poker_state` table powering the PokerState endpoints.

---

## 7) Cron (sync loop)

`wrangler.toml` already defines a sample cron every 10 minutes. Edit `onCron()` in `src/index.ts` to:
- sync Notion ↔ Google Calendar
- triage emails
- auto-generate slides, etc.

---

## Notes

- The Worker runtime uses **fetch** and Web APIs (no Node-only libs). OAuth flows are implemented with plain HTTP.
- For Google Slides generation: use the Slides API in `src/slides.ts` (stubbed) to create in your Drive from a template.
- For Notion ↔ Calendar: fill `src/notion.ts` and `src/calendar.ts` merger functions; the structures are scaffolded.

---

## Local Dev Auth

- **Environment variables** – Local auth depends on the same bindings as production plus a few dev overrides. Populate `worker/.dev.vars` (or your shell) with:
  - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `OPENAI_API_KEY`, `NOTION_TOKEN`
  - `GOOGLE_CLIENT_ID_EXTERNAL`, `GOOGLE_CLIENT_SECRET_EXTERNAL`, `GOOGLE_CLIENT_FORCE_EXTERNAL=true` (set to `1` to exercise the consumer/external OAuth client during dev)
  - `DEFAULT_USER_KEY` (e.g. `paul`), `ENVIRONMENT=local`, `ALLOW_DANGEROUS_ADMIN=true`, `ALLOW_IDENTITY_MERGE_BY_EMAIL=0` (set to `1` only when you explicitly want to merge provider identities by email)
  - `DASHBOARD_URL=http://localhost:3000`, `GOOGLE_REDIRECT_URI=http://localhost:8787/assistant/oauth/google/callback`
- `EMAIL_IO_BASE_URL=http://localhost:4001`, `INTERNAL_API_KEY=devkey`, `INTERNAL_API_SECRET=devsecret` (shared with email-io internal auth)
  - `worker/.dev.vars` is gitignored and streamed into `wrangler dev --env dev`; the new `[env.dev.vars]` block in `worker/wrangler.toml` seeds the rest (`GOOGLE_SCOPES`, `MIRA_*`, `OPENAI_CHAT_MODEL`, etc.).

- **Running locally** – use `npm run dev:worker` (runs `npx wrangler dev --env dev` from `worker/`), `npm run dev:site` for the Next.js shell, or `npm run dev:all` to start both services together. For ad-hoc testing you can also run `cd worker && npx wrangler dev --env dev --port 8787`.

- **Common pitfalls**
  - The `mf-s` cookie omits `Domain` and only emits `Secure` when we are over `https`; if you override these attributes (or hit the worker through a production domain) the browser will drop the cookie before it reaches `localhost`.
  - The worker now returns `Access-Control-Allow-Credentials` for `http://localhost:3000`, so every browser fetch to `/assistant/*` must request `{ credentials: "include" }`. Missing credentials is the main reason the UI stays stuck on the login screen.
  - Double-check that `DASHBOARD_URL` and `GOOGLE_REDIRECT_URI` stay pointed at the local hosts – pointing them at `https://app.elyra-core.app` prevents the OAuth flow from returning to your dev workspace.
  - Capture the `mf-s` cookie from the browser or `scripts/dev-smoke-test.mjs` and reuse it with `curl -H "Cookie: mf-s=<value>" http://localhost:8787/assistant/auth/whoami` to guarantee the worker sees `ok: true`.

---

Happy shipping! 🚀
