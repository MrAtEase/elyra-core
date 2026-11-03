# ELYRA CORE — Architecture V2: Complete System Specification

---

## 1. System Vision

Elyra Core is an **AI-native system platform** — not a dashboard, not a SaaS tool, but an intelligent operational foundation. Every workspace is a self-contained operational unit. Elli (the AI copilot) is not a chat widget bolted on; she is the primary interface through which users understand their workspace, take action, and get guided.

**Core Principles:**
- **Workspace-first**: Every piece of data, every action, every AI conversation is scoped to a workspace. No global state leaks.
- **Elli-guided**: No empty screens. Every view has context, guidance, and actionable next steps.
- **Progressive complexity**: A single founder sees simplicity. A franchise operator sees hierarchy. Same platform, different surface area.
- **Production-only thinking**: No hacks, no "we'll fix it later". If it ships, it works.

**Architecture summary:**
```
┌─────────────────────────────────────────────────────┐
│  Frontend (Vercel)                                  │
│  Next.js App Router · Server Components first       │
│  ┌──────────┬──────────┬──────────┬──────────┐      │
│  │ ShellLayout│ Rail    │ Canvas   │ AISurface│      │
│  │ (Header)  │(Tools)  │(Content) │(Elli)    │      │
│  └──────────┴──────────┴──────────┴──────────┘      │
└─────────────────────┬───────────────────────────────┘
                      │ HTTPS (mf-s cookie)
┌─────────────────────▼───────────────────────────────┐
│  Worker API (Cloudflare Workers)                    │
│  api.elyra-core.app                                 │
│  Hono router · Session middleware · CORS            │
│  ┌────────┬────────┬────────┬────────┬────────┐     │
│  │ Auth   │Workspace│Integr.│ Elli   │ Tasks  │     │
│  │ Routes │ Routes │Routes  │ Routes │ Routes │     │
│  └────────┴────────┴────────┴────────┴────────┘     │
│  D1 (Edge Auth/Sessions/Workspace Metadata)         │
└─────────────────────┬───────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────┐
│  Supabase                                           │
│  Auth (GoTrue) · Postgres (App Data) · RLS          │
│  profiles · workspaces · workspace_members          │
│  integrations_catalog · workspace_integrations      │
│  elly_sessions · tasks                              │
└─────────────────────────────────────────────────────┘
```

---

## 2. Routes & Navigation (Information Architecture)

### 2.1 Route Map

```
/                           → redirect: authenticated ? /w : /signin
/signin                     → Sign in page (Supabase Auth UI)
/auth/callback              → OAuth callback handler

/w                          → Workspace selector (if >1) or redirect to single workspace
/w/[slug]                   → Workspace home (dashboard)
/w/[slug]/mail              → Mail inbox (read-only initially)
/w/[slug]/calendar          → Calendar view (read-only initially)
/w/[slug]/planner           → Task planner (Elli-generated tasks)
/w/[slug]/planner/[taskId]  → Task detail
/w/[slug]/integrations      → Marketplace (installed + available)
/w/[slug]/integrations/[key]→ Integration detail + config
/w/[slug]/team              → Team members
/w/[slug]/team/invite       → Invite flow
/w/[slug]/settings          → Workspace settings
/w/[slug]/settings/profile  → User profile within workspace
/w/[slug]/settings/billing  → Billing (future)
/w/[slug]/admin             → Workspace admin (owner/admin only)

/onboarding                 → Onboarding stepper (max 3 steps)
/help                       → Help center
/system/diagnostics         → Dev diagnostics (non-prod)
```

### 2.2 Navigation Structure (Rail)

```yaml
Rail Items (top to bottom):
  - id: home
    icon: Home
    label: Home
    route: /w/[slug]
    visibleIf: always

  - id: mail
    icon: Mail
    label: Mail
    route: /w/[slug]/mail
    visibleIf: always

  - id: calendar
    icon: Calendar
    label: Calendar
    route: /w/[slug]/calendar
    visibleIf: always

  - id: planner
    icon: ListChecks
    label: Planner
    route: /w/[slug]/planner
    visibleIf: always

  - id: integrations
    icon: Puzzle
    label: Integrations
    route: /w/[slug]/integrations
    visibleIf: always

  # Bottom-pinned:
  - id: team
    icon: Users
    label: Team
    route: /w/[slug]/team
    visibleIf: role in [owner, admin]

  - id: settings
    icon: Settings
    label: Settings
    route: /w/[slug]/settings
    visibleIf: always
```

### 2.3 Next.js File Structure

```
frontend/app/
├── layout.tsx                          # Root layout (html, body, fonts)
├── page.tsx                            # / → redirect logic (Server Component)
├── signin/
│   └── page.tsx                        # Sign in
├── auth/
│   └── callback/
│       └── route.ts                    # OAuth callback (Server Route)
├── onboarding/
│   └── page.tsx                        # Onboarding stepper
├── w/
│   ├── layout.tsx                      # ShellLayout (wraps all workspace routes)
│   ├── page.tsx                        # Workspace selector
│   └── [slug]/
│       ├── layout.tsx                  # Workspace context provider
│       ├── page.tsx                    # Workspace home/dashboard
│       ├── mail/
│       │   └── page.tsx
│       ├── calendar/
│       │   └── page.tsx
│       ├── planner/
│       │   ├── page.tsx
│       │   └── [taskId]/
│       │       └── page.tsx
│       ├── integrations/
│       │   ├── page.tsx                # Marketplace list
│       │   └── [key]/
│       │       └── page.tsx            # Integration detail
│       ├── team/
│       │   ├── page.tsx
│       │   └── invite/
│       │       └── page.tsx
│       ├── settings/
│       │   ├── page.tsx
│       │   └── profile/
│       │       └── page.tsx
│       └── admin/
│           └── page.tsx
├── help/
│   └── page.tsx
└── system/
    └── diagnostics/
        └── page.tsx
```

### 2.4 Middleware

```typescript
// frontend/middleware.ts
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Root redirect
  if (pathname === '/') {
    // Check for session cookie existence (not validation — Worker does that)
    const hasSession = request.cookies.has('mf-s')
    if (hasSession) {
      return NextResponse.redirect(new URL('/w', request.url))
    }
    return NextResponse.redirect(new URL('/signin', request.url))
  }

  // Legacy route redirects
  if (pathname.startsWith('/workspace')) {
    return NextResponse.redirect(new URL('/w', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/', '/workspace/:path*'],
}
```

---

## 3. Database Schema + RLS

### 3.1 Supabase Postgres Schema (public.*)

```sql
-- =============================================================================
-- PROFILES
-- =============================================================================
CREATE TABLE public.profiles (
  id          uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email       text NOT NULL,
  full_name   text,
  avatar_url  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- =============================================================================
-- WORKSPACES
-- =============================================================================
CREATE TABLE public.workspaces (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type                  text NOT NULL CHECK (type IN ('personal', 'company', 'franchise', 'client')),
  name                  text NOT NULL,
  slug                  text NOT NULL UNIQUE,
  parent_workspace_id   uuid REFERENCES public.workspaces(id),
  accent_color          text DEFAULT '#5cffec',
  logo_url              text,
  created_by            uuid NOT NULL REFERENCES public.profiles(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_workspaces_slug ON public.workspaces(slug);
CREATE INDEX idx_workspaces_parent ON public.workspaces(parent_workspace_id)
  WHERE parent_workspace_id IS NOT NULL;

-- =============================================================================
-- WORKSPACE MEMBERS
-- =============================================================================
CREATE TABLE public.workspace_members (
  workspace_id  uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role          text NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'guest')),
  title         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);

CREATE INDEX idx_workspace_members_user ON public.workspace_members(user_id);

-- =============================================================================
-- INTEGRATIONS CATALOG (global, not workspace-scoped)
-- =============================================================================
CREATE TABLE public.integrations_catalog (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key         text NOT NULL UNIQUE,
  name        text NOT NULL,
  description text,
  category    text NOT NULL, -- 'communication', 'productivity', 'data', 'custom'
  provider    text,          -- 'google', 'notion', 'icloud', etc.
  icon_url    text,
  scopes      jsonb DEFAULT '[]'::jsonb,
  is_beta     boolean DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- =============================================================================
-- WORKSPACE INTEGRATIONS (per-workspace installation)
-- =============================================================================
CREATE TABLE public.workspace_integrations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  integration_key text NOT NULL REFERENCES public.integrations_catalog(key),
  status          text NOT NULL CHECK (status IN ('installed', 'configured', 'active', 'error', 'disabled')),
  settings        jsonb DEFAULT '{}'::jsonb,
  installed_by    uuid REFERENCES public.profiles(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, integration_key)
);

-- =============================================================================
-- INTEGRATION TOKENS (secrets — consider Worker KV for production)
-- =============================================================================
CREATE TABLE public.integration_tokens (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  integration_key text NOT NULL,
  token_data      jsonb NOT NULL, -- encrypted in practice; consider KV
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, integration_key)
);

-- =============================================================================
-- ELLY SESSIONS (AI context per workspace per user)
-- =============================================================================
CREATE TABLE public.elly_sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  mode          text NOT NULL CHECK (mode IN ('assistant', 'mentor', 'instructor', 'planner', 'operator')),
  state         jsonb DEFAULT '{}'::jsonb,
  messages      jsonb DEFAULT '[]'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_elly_sessions_workspace_user
  ON public.elly_sessions(workspace_id, user_id);

-- =============================================================================
-- TASKS (Elli planner output)
-- =============================================================================
CREATE TABLE public.tasks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  created_by    uuid NOT NULL REFERENCES public.profiles(id),
  assigned_to   uuid REFERENCES public.profiles(id),
  title         text NOT NULL,
  description   text,
  status        text NOT NULL CHECK (status IN ('todo', 'doing', 'done', 'blocked')) DEFAULT 'todo',
  priority      int DEFAULT 0,
  due_date      timestamptz,
  metadata      jsonb DEFAULT '{}'::jsonb,
  source        text DEFAULT 'manual', -- 'manual' | 'elli' | 'integration'
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_tasks_workspace ON public.tasks(workspace_id);
CREATE INDEX idx_tasks_assigned ON public.tasks(assigned_to) WHERE assigned_to IS NOT NULL;

-- =============================================================================
-- CUSTOMERS (future, but schema-ready)
-- =============================================================================
CREATE TABLE public.customers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  display_name    text NOT NULL,
  status          text NOT NULL CHECK (status IN ('active', 'paused', 'churned')) DEFAULT 'active',
  billing_ref     text,
  metadata        jsonb DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);
```

### 3.2 RLS Policies

```sql
-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.elly_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
-- integrations_catalog is public read
ALTER TABLE public.integrations_catalog ENABLE ROW LEVEL SECURITY;

-- Helper function: is user a workspace member?
CREATE OR REPLACE FUNCTION public.is_workspace_member(ws_id uuid)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_members
    WHERE workspace_id = ws_id AND user_id = auth.uid()
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Helper: is user owner or admin?
CREATE OR REPLACE FUNCTION public.is_workspace_admin(ws_id uuid)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_members
    WHERE workspace_id = ws_id
      AND user_id = auth.uid()
      AND role IN ('owner', 'admin')
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- PROFILES: users see own profile
CREATE POLICY profiles_select ON public.profiles FOR SELECT USING (id = auth.uid());
CREATE POLICY profiles_update ON public.profiles FOR UPDATE USING (id = auth.uid());
CREATE POLICY profiles_insert ON public.profiles FOR INSERT WITH CHECK (id = auth.uid());

-- WORKSPACES: members can see
CREATE POLICY workspaces_select ON public.workspaces FOR SELECT
  USING (public.is_workspace_member(id));
CREATE POLICY workspaces_insert ON public.workspaces FOR INSERT
  WITH CHECK (created_by = auth.uid());
CREATE POLICY workspaces_update ON public.workspaces FOR UPDATE
  USING (public.is_workspace_admin(id));

-- WORKSPACE_MEMBERS: members can see members, admins can modify
CREATE POLICY wm_select ON public.workspace_members FOR SELECT
  USING (public.is_workspace_member(workspace_id));
CREATE POLICY wm_insert ON public.workspace_members FOR INSERT
  WITH CHECK (public.is_workspace_admin(workspace_id));
CREATE POLICY wm_delete ON public.workspace_members FOR DELETE
  USING (public.is_workspace_admin(workspace_id));

-- INTEGRATIONS_CATALOG: everyone can read
CREATE POLICY ic_select ON public.integrations_catalog FOR SELECT USING (true);

-- WORKSPACE_INTEGRATIONS: workspace members
CREATE POLICY wi_select ON public.workspace_integrations FOR SELECT
  USING (public.is_workspace_member(workspace_id));
CREATE POLICY wi_insert ON public.workspace_integrations FOR INSERT
  WITH CHECK (public.is_workspace_admin(workspace_id));
CREATE POLICY wi_update ON public.workspace_integrations FOR UPDATE
  USING (public.is_workspace_admin(workspace_id));

-- INTEGRATION_TOKENS: admins only
CREATE POLICY it_select ON public.integration_tokens FOR SELECT
  USING (public.is_workspace_admin(workspace_id));
CREATE POLICY it_insert ON public.integration_tokens FOR INSERT
  WITH CHECK (public.is_workspace_admin(workspace_id));

-- ELLY_SESSIONS: user's own sessions within workspace
CREATE POLICY es_select ON public.elly_sessions FOR SELECT
  USING (user_id = auth.uid() AND public.is_workspace_member(workspace_id));
CREATE POLICY es_insert ON public.elly_sessions FOR INSERT
  WITH CHECK (user_id = auth.uid() AND public.is_workspace_member(workspace_id));
CREATE POLICY es_update ON public.elly_sessions FOR UPDATE
  USING (user_id = auth.uid() AND public.is_workspace_member(workspace_id));

-- TASKS: workspace members
CREATE POLICY tasks_select ON public.tasks FOR SELECT
  USING (public.is_workspace_member(workspace_id));
CREATE POLICY tasks_insert ON public.tasks FOR INSERT
  WITH CHECK (public.is_workspace_member(workspace_id));
CREATE POLICY tasks_update ON public.tasks FOR UPDATE
  USING (public.is_workspace_member(workspace_id));

-- CUSTOMERS: workspace members
CREATE POLICY customers_select ON public.customers FOR SELECT
  USING (public.is_workspace_member(workspace_id));
CREATE POLICY customers_insert ON public.customers FOR INSERT
  WITH CHECK (public.is_workspace_admin(workspace_id));
```

### 3.3 D1 Schema (Edge Layer — kept for auth/sessions)

The existing D1 schema stays as the edge auth layer. It handles:
- Session tokens (`mf-s` cookie resolution)
- Fast workspace membership checks at the edge
- Onboarding state

Changes needed to existing D1 migrations:

```sql
-- 0004_workspace_hierarchy.sql
ALTER TABLE workspaces ADD COLUMN parent_workspace_id TEXT
  REFERENCES workspaces(id);
ALTER TABLE workspaces ADD COLUMN accent_color TEXT DEFAULT '#5cffec';

-- Sync D1 workspace records from Supabase on workspace create/update
-- via Worker (D1 = cache/edge, Supabase = source of truth)
```

**Data flow:** Supabase Postgres is the source of truth for app data. D1 is an edge-optimized mirror for auth decisions and session resolution. On workspace create, the Worker writes to both. On read, the Worker uses D1 for session/auth and Supabase for app data.

---

## 4. API Contracts (Worker Endpoints)

### 4.1 Auth Routes (existing, enhanced)

```
POST   /assistant/auth/exchange-supabase
  Headers: Authorization: Bearer <supabase_access_token>
  Response 200: { ok: true, workspaceId: string }
  Sets: mf-s cookie
  Side effects: upserts user in D1, ensures personal workspace,
                upserts profile in Supabase

GET    /assistant/auth/whoami
  Cookie: mf-s
  Response 200: WhoamiResponse (see below)
  Response 401: { ok: false, code: "AUTH_REQUIRED", loginUrl: "/signin" }

POST   /assistant/auth/logout
  Cookie: mf-s
  Response 200: { ok: true }
  Clears: mf-s cookie, revokes session in D1
```

**WhoamiResponse shape** (enhanced):
```typescript
interface WhoamiResponse {
  ok: true
  user: { id: string; email: string }
  workspaces: WhoamiWorkspace[]
  activeWorkspace: WhoamiWorkspace | null
  membership: { role: string; title: string | null; workspaceId: string } | null
  capabilities: string[]
  onboarding: {
    state: 'pending' | 'in_progress' | 'complete'
    workspaceId: string | null
  }
  userSettings: {
    locale: string | null
    theme: string | null
    defaultWorkspaceId: string | null
  }
}

interface WhoamiWorkspace {
  id: string
  slug: string
  type: 'personal' | 'company' | 'franchise' | 'client'
  name: string
  accentColor: string
  logoUrl: string | null
  brand: {
    productName: string
    assistantName: string
    workspaceLabel: string
  }
}
```

### 4.2 Workspace Routes (new)

```
GET    /assistant/workspaces
  Cookie: mf-s
  Response 200: { ok: true, workspaces: WhoamiWorkspace[] }

POST   /assistant/workspaces
  Cookie: mf-s
  Body: { name: string, type: 'company', slug?: string }
  Response 201: { ok: true, workspace: WhoamiWorkspace }

GET    /assistant/workspaces/:slug
  Cookie: mf-s
  Response 200: { ok: true, workspace: WhoamiWorkspace, membership: {...} }
  Response 403: { ok: false, code: "NOT_MEMBER" }

PATCH  /assistant/workspaces/:slug
  Cookie: mf-s
  Body: { name?, accentColor?, logoUrl? }
  Response 200: { ok: true, workspace: WhoamiWorkspace }

POST   /assistant/workspaces/:slug/switch
  Cookie: mf-s
  Response 200: WhoamiResponse (with new activeWorkspace)
  Side effect: updates session.active_workspace_id

GET    /assistant/workspaces/:slug/members
  Cookie: mf-s
  Response 200: { ok: true, members: Member[] }

POST   /assistant/workspaces/:slug/members/invite
  Cookie: mf-s (owner/admin)
  Body: { email: string, role: 'member' | 'admin' | 'guest' }
  Response 200: { ok: true, inviteId: string }
```

### 4.3 Onboarding Routes (enhanced)

```
GET    /assistant/onboarding
  Cookie: mf-s
  Response 200: { ok: true, state: 'pending' | 'in_progress' | 'complete', step: number }

POST   /assistant/onboarding/complete
  Cookie: mf-s
  Body: {
    workspaceType: 'personal' | 'company'
    workspaceName: string
    role: string
    title?: string
    goal?: string
  }
  Response 200: { ok: true, workspaceId: string, workspaceSlug: string }
```

### 4.4 Integrations / Marketplace Routes (new)

```
GET    /assistant/integrations/catalog
  Cookie: mf-s
  Response 200: { ok: true, integrations: IntegrationCatalogItem[] }
  // Reads from Supabase integrations_catalog table

GET    /assistant/workspaces/:slug/integrations
  Cookie: mf-s
  Response 200: { ok: true, installed: WorkspaceIntegration[] }

POST   /assistant/workspaces/:slug/integrations/:key/install
  Cookie: mf-s (owner/admin)
  Response 200: { ok: true, integration: WorkspaceIntegration }

POST   /assistant/workspaces/:slug/integrations/:key/configure
  Cookie: mf-s (owner/admin)
  Body: { settings: Record<string, unknown> }
  Response 200: { ok: true }

POST   /assistant/workspaces/:slug/integrations/:key/test
  Cookie: mf-s
  Response 200: { ok: true, result: 'success' | 'error', message: string }

DELETE /assistant/workspaces/:slug/integrations/:key
  Cookie: mf-s (owner/admin)
  Response 200: { ok: true }
```

**IntegrationCatalogItem:**
```typescript
interface IntegrationCatalogItem {
  key: string           // 'gmail', 'google_calendar', 'notion', 'email_imap'
  name: string          // 'Gmail'
  description: string   // 'Read and send email via Gmail'
  category: string      // 'communication'
  provider: string      // 'google'
  iconUrl: string | null
  scopes: string[]
  isBeta: boolean
}
```

**WorkspaceIntegration:**
```typescript
interface WorkspaceIntegration {
  key: string
  name: string
  status: 'installed' | 'configured' | 'active' | 'error' | 'disabled'
  settings: Record<string, unknown>
  installedAt: string
}
```

### 4.5 Elli Routes (new)

```
POST   /assistant/workspaces/:slug/elli/chat
  Cookie: mf-s
  Body: {
    message: string
    mode?: 'assistant' | 'mentor' | 'instructor' | 'planner' | 'operator'
    sessionId?: string    // resume existing session
  }
  Response 200 (streaming): Server-Sent Events
    event: message    data: { type: 'text', content: string }
    event: action     data: { type: 'action', action: ActionProposal }
    event: task       data: { type: 'task', task: Task }
    event: done       data: { type: 'done', sessionId: string }

GET    /assistant/workspaces/:slug/elli/sessions
  Cookie: mf-s
  Response 200: { ok: true, sessions: EllySession[] }

GET    /assistant/workspaces/:slug/elli/sessions/:sessionId
  Cookie: mf-s
  Response 200: { ok: true, session: EllySession }

POST   /assistant/workspaces/:slug/elli/actions/:actionId/confirm
  Cookie: mf-s
  Response 200: { ok: true, result: ActionResult }

POST   /assistant/workspaces/:slug/elli/actions/:actionId/dismiss
  Cookie: mf-s
  Response 200: { ok: true }
```

### 4.6 Tasks Routes (new)

```
GET    /assistant/workspaces/:slug/tasks
  Cookie: mf-s
  Query: ?status=todo,doing&assignee=me&limit=50
  Response 200: { ok: true, tasks: Task[] }

POST   /assistant/workspaces/:slug/tasks
  Cookie: mf-s
  Body: { title: string, description?: string, status?: string, assignedTo?: string }
  Response 201: { ok: true, task: Task }

PATCH  /assistant/workspaces/:slug/tasks/:taskId
  Cookie: mf-s
  Body: { title?, description?, status?, assignedTo?, priority?, dueDate? }
  Response 200: { ok: true, task: Task }

DELETE /assistant/workspaces/:slug/tasks/:taskId
  Cookie: mf-s
  Response 200: { ok: true }
```

### 4.7 Mail & Calendar Routes (existing pattern, workspace-slug scoped)

```
GET    /assistant/workspaces/:slug/mail/status
GET    /assistant/workspaces/:slug/mail/threads?limit=20&label=INBOX
GET    /assistant/workspaces/:slug/mail/threads/:threadId
POST   /assistant/workspaces/:slug/mail/send
POST   /assistant/workspaces/:slug/mail/threads/:threadId/trash
GET    /assistant/workspaces/:slug/mail/labels

GET    /assistant/workspaces/:slug/calendar/events
POST   /assistant/workspaces/:slug/calendar/events
PATCH  /assistant/workspaces/:slug/calendar/events/:eventId
DELETE /assistant/workspaces/:slug/calendar/events/:eventId
```

---

## 5. Onboarding Flow

### 5.1 Screens & States

**Trigger:** User authenticates but has `onboarding.state !== 'complete'`.

```
┌─────────────────────────────────────────────┐
│            STEP 1: Welcome                  │
│                                             │
│    [Orb animation — gentle pulse]           │
│                                             │
│    "Willkommen bei Elyra Core."             │
│    "Ich bin Elli, dein AI-Copilot."         │
│                                             │
│    "Zuerst: Was beschreibt dich am besten?" │
│                                             │
│    ┌─────────────────────────────┐           │
│    │ ○ Ich baue mein eigenes    │           │
│    │   Unternehmen auf          │           │
│    │ ○ Ich manage ein bestehendes│          │
│    │   Unternehmen              │           │
│    │ ○ Ich bin Teil eines Teams │           │
│    └─────────────────────────────┘           │
│                                             │
│    [Weiter →]                               │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│            STEP 2: Workspace                │
│                                             │
│    "Wie heißt dein Workspace?"              │
│                                             │
│    Name: [________________________]         │
│    Typ:  ○ Personal  ● Company              │
│                                             │
│    Elli: "Ein Workspace ist dein            │
│    digitales Hauptquartier. Alles —         │
│    E-Mail, Kalender, Aufgaben,             │
│    Integrationen — lebt hier drin."        │
│                                             │
│    [← Zurück]  [Workspace erstellen →]      │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│            STEP 3: Ready                    │
│                                             │
│    [Orb animation — confident glow]         │
│                                             │
│    "Elyra Core · [Workspace Name]"          │
│    "Alles klar. Dein Workspace ist bereit." │
│                                             │
│    Elli: "Ich habe drei Empfehlungen        │
│    für deinen Start:"                       │
│                                             │
│    ☐ E-Mail verbinden                       │
│    ☐ Kalender verbinden                     │
│    ☐ Ersten Task erstellen                  │
│                                             │
│    [Los geht's →]                           │
└─────────────────────────────────────────────┘
```

### 5.2 State Machine

```
pending → in_progress (user reaches Step 1)
        → complete (user finishes Step 2 or 3)

On "complete":
  POST /assistant/onboarding/complete
  → Creates workspace in D1 + Supabase
  → Creates membership (role: owner)
  → Updates session.active_workspace_id
  → Redirects to /w/[slug]
```

### 5.3 Error Cases

| Error | User sees | Recovery |
|-------|----------|----------|
| API unreachable | "Elyra kann den Server nicht erreichen. Bitte prüfe deine Verbindung." + Retry button | Auto-retry after 5s, max 3x |
| Duplicate slug | "Dieser Name ist bereits vergeben. Bitte wähle einen anderen." | Inline form error |
| Session expired | Redirect to /signin with `?reason=session_expired` | Re-auth, resume onboarding |
| DB write failure | "Es gab ein Problem beim Erstellen deines Workspace. Bitte versuche es erneut." + Retry | Retry button, no data loss |

---

## 6. Marketplace Concept

### 6.1 Architecture

```
integrations_catalog (Supabase)     ← Global catalog, seeded by us
         │
         ▼
Marketplace UI (/w/[slug]/integrations)
  ├── Available (not installed)
  ├── Installed (configured/active)
  └── Beta (flagged)
         │
         ▼ Install
workspace_integrations (Supabase)   ← Per-workspace install state
         │
         ▼ Configure (OAuth, API keys)
integration_tokens (Supabase/KV)    ← Secrets
         │
         ▼ Test
Worker validates connectivity        ← Live check
         │
         ▼ Active
Integration is usable by workspace tools + Elli
```

### 6.2 UI States

```
┌──────────────────────────────────────────────────────┐
│  Integrations                                        │
│  ─────────────────────────────────────────────       │
│  [Installed (2)]  [Available (5)]  [Beta (1)]        │
│                                                      │
│  ┌────────────────────┐  ┌────────────────────┐      │
│  │ 📧 Gmail           │  │ 📅 Google Calendar  │     │
│  │ Status: Active ●   │  │ Status: Active ●   │      │
│  │ Connected as:      │  │ 7 events this week │      │
│  │ paul@elyra-core.app│  │                    │      │
│  │ [Settings] [Test]  │  │ [Settings] [Test]  │      │
│  └────────────────────┘  └────────────────────┘      │
│                                                      │
│  Available                                           │
│  ┌────────────────────┐  ┌────────────────────┐      │
│  │ 📝 Notion          │  │ 📧 IMAP Email      │      │
│  │ Connect Notion     │  │ Generic IMAP/SMTP  │      │
│  │ pages & databases  │  │ email provider     │      │
│  │ [Install]          │  │ [Install]          │      │
│  └────────────────────┘  └────────────────────┘      │
└──────────────────────────────────────────────────────┘
```

### 6.3 Integration Detail View

```
┌──────────────────────────────────────────────────────┐
│  ← Back to Integrations                              │
│                                                      │
│  📝 Notion                                           │
│  ─────────────────────────────────────────────       │
│                                                      │
│  What it does:                                       │
│  Connects your Notion workspace to Elyra Core.       │
│  Elli can read your pages and databases to answer    │
│  questions and provide context.                      │
│                                                      │
│  Required permissions:                               │
│  • Read pages and databases                          │
│  • Search content                                    │
│                                                      │
│  Status: Not installed                               │
│                                                      │
│  [Install Notion →]                                  │
│                                                      │
│  ─────────────────────────────────────────────       │
│  Elli says:                                          │
│  "Wenn du Notion verbindest, kann ich deine          │
│  Dokumente durchsuchen und dir Zusammenfassungen     │
│  geben. Ich kann aber nichts in Notion ändern."      │
└──────────────────────────────────────────────────────┘
```

### 6.4 Install Flow (4 states)

```
NOT_INSTALLED → INSTALLED → CONFIGURED → ACTIVE
                   │             │           │
                   └── error ────┘── error ──┘
                         │
                      DISABLED

Install: POST /assistant/workspaces/:slug/integrations/:key/install
Configure: POST .../configure  (OAuth redirect or API key form)
Test: POST .../test  (live connectivity check)
Active: automatic after successful test
```

### 6.5 Initial Catalog Seed

```sql
INSERT INTO public.integrations_catalog (key, name, description, category, provider, scopes, is_beta) VALUES
  ('gmail', 'Gmail', 'Read and send email via your Google account.', 'communication', 'google',
   '["gmail.readonly", "gmail.send"]'::jsonb, false),
  ('google_calendar', 'Google Calendar', 'View and manage your Google Calendar events.', 'productivity', 'google',
   '["calendar.readonly", "calendar.events"]'::jsonb, false),
  ('notion', 'Notion', 'Connect Notion pages and databases for AI context.', 'productivity', 'notion',
   '["read_content", "search"]'::jsonb, true),
  ('email_imap', 'IMAP Email', 'Connect any email provider via IMAP/SMTP.', 'communication', 'generic',
   '[]'::jsonb, true),
  ('google_drive', 'Google Drive', 'Access documents and files from Google Drive.', 'data', 'google',
   '["drive.readonly"]'::jsonb, true);
```

---

## 7. Elli Behavior Specification

### 7.1 Modes

| Mode | Purpose | Trigger | Behavior |
|------|---------|---------|----------|
| **Assistant** | Answer questions, explain features | Default mode | Conversational, helpful, concise |
| **Mentor** | Suggest best practices | User asks "how should I..." | Opinionated, references patterns |
| **Instructor** | Step-by-step tutorials | Onboarding, first-time features | Linear, checkpoint-based, patient |
| **Planner** | Generate actionable task lists | User says "plan...", "organize..." | Creates Tasks in DB, structured output |
| **Operator** | Execute actions via integrations | User confirms an action | Executes, reports result, asks for confirmation on destructive ops |

### 7.2 System Prompt Strategy

```typescript
function buildElliSystemPrompt(ctx: ElliContext): string {
  return `
You are Elli, the AI copilot for Elyra Core.

## Identity
- Name: Elli
- Personality: calm, intelligent, precise, helpful
- Language: Match the user's language (DE/EN)
- Tone: Professional but warm. Never patronizing.

## Current Context
- Workspace: ${ctx.workspace.name} (${ctx.workspace.type})
- User: ${ctx.user.email} (role: ${ctx.membership.role})
- Active tool: ${ctx.activeTool || 'none'}
- Mode: ${ctx.mode}

## Workspace Data Available
${ctx.integrations.map(i => `- ${i.name}: ${i.status}`).join('\n')}

## Available Actions
${ctx.availableActions.map(a => `- ${a.name}: ${a.description}`).join('\n')}

## Rules
1. NEVER access data from other workspaces.
2. NEVER execute destructive actions without explicit user confirmation.
3. When proposing an action, output it as a structured ActionProposal.
4. If unsure, ask for clarification instead of guessing.
5. Keep responses concise. No walls of text.
6. When in Planner mode, output structured tasks with titles, descriptions, and suggested priorities.
7. When in Operator mode, always show what you're about to do before doing it.
8. Reference workspace-specific data when available (mail threads, calendar events, tasks).

## ActionProposal Format
When you want to take an action, respond with:
{
  "type": "action",
  "action": {
    "kind": "mail_send" | "calendar_create" | "task_create" | "integration_connect" | ...,
    "label": "Human-readable description of what will happen",
    "payload": { ... },
    "destructive": false,
    "requiresConfirmation": true
  }
}

## Task Output Format (Planner mode)
{
  "type": "tasks",
  "tasks": [
    { "title": "...", "description": "...", "priority": 1, "source": "elli" }
  ]
}
`.trim()
}
```

### 7.3 Guardrails

| Rule | Implementation |
|------|---------------|
| No cross-workspace data | System prompt + server-side: Elli queries are always scoped by `workspace_id` |
| No destructive without confirm | `requiresConfirmation: true` for all write/delete actions |
| No hallucinated data | Ground responses in actual workspace data (mail, calendar, tasks) |
| Rate limiting | Max 20 messages/minute per user per workspace |
| Token budget | Max 4096 output tokens per response |
| Conversation isolation | Sessions are `(user_id, workspace_id)` — never cross-pollinate |

### 7.4 Elli Surface UX

```
States:
┌──────────────────────────────────┐
│ COLLAPSED (Orb in header)        │
│ Orb pulses gently                │
│ Click → expand                   │
└──────────────────────────────────┘
         │ click
         ▼
┌──────────────────────────────────┐
│ EXPANDED (Slide-over panel)      │
│ ┌────────────────────────────┐   │
│ │ Elli · Assistant Mode      │   │
│ │ ─────────────────────────  │   │
│ │                            │   │
│ │ Chat messages here         │   │
│ │                            │   │
│ │ ─────────────────────────  │   │
│ │ [Message input...]    [→]  │   │
│ └────────────────────────────┘   │
│ Mode: [Assistant ▾]              │
└──────────────────────────────────┘
         │ action proposed
         ▼
┌──────────────────────────────────┐
│ ACTION CONFIRMATION MODAL        │
│                                  │
│ "Elli möchte:"                   │
│ ─────────────────────────        │
│ Send email to team@fish.de       │
│ Subject: "Wochenplan KW23"       │
│                                  │
│ [Ablehnen]  [Bestätigen →]       │
└──────────────────────────────────┘
```

---

## 8. Test Plan

### 8.1 DevTools Verification

```bash
# 1. Health check
curl https://api.elyra-core.app/health
# Expected: { "ok": true, "service": "elyra-api" }

# 2. Exchange token (after Supabase login)
curl -X POST https://api.elyra-core.app/assistant/auth/exchange-supabase \
  -H "Authorization: Bearer <supabase_token>" \
  -H "Origin: https://app.elyra-core.app" \
  -v
# Expected: 200, Set-Cookie: mf-s=..., { "ok": true, "workspaceId": "..." }

# 3. Whoami with session
curl https://api.elyra-core.app/assistant/auth/whoami \
  -H "Cookie: mf-s=<session_id>" \
  -H "Origin: https://app.elyra-core.app"
# Expected: 200, full WhoamiResponse with user, workspaces, activeWorkspace

# 4. Workspace creation via onboarding
curl -X POST https://api.elyra-core.app/assistant/onboarding/complete \
  -H "Cookie: mf-s=<session_id>" \
  -H "Content-Type: application/json" \
  -H "Origin: https://app.elyra-core.app" \
  -d '{"workspaceType":"company","workspaceName":"Elyra Core","role":"owner"}'
# Expected: 200, { "ok": true, "workspaceId": "..." }

# 5. Verify DB state (Supabase)
# In Supabase SQL editor:
SELECT * FROM public.profiles WHERE email = 'paul@elyra-core.app';
SELECT * FROM public.workspaces WHERE slug = 'elyra-core';
SELECT * FROM public.workspace_members WHERE user_id = '<paul_id>';

# 6. Verify D1 state
npx wrangler d1 execute ASSISTANT_DB --command "SELECT * FROM users;"
npx wrangler d1 execute ASSISTANT_DB --command "SELECT * FROM workspaces;"
npx wrangler d1 execute ASSISTANT_DB --command "SELECT * FROM sessions WHERE revoked_at IS NULL;"
```

### 8.2 Frontend E2E Checks

```
Manual checklist:
□ / redirects to /signin when not authenticated
□ / redirects to /w when authenticated
□ /signin shows Google + email options
□ After login, onboarding appears if state !== 'complete'
□ Onboarding creates workspace, redirects to /w/[slug]
□ Workspace home shows Elli greeting, empty state with suggestions
□ Rail shows correct items for role
□ Clicking workspace selector shows workspaces
□ Switching workspace changes URL, accent color, orb color
□ /w/[slug]/integrations shows catalog
□ Elli panel opens/closes, messages send
□ Logout clears session, redirects to /signin
```

### 8.3 Browser DevTools Checks

```
□ No CORS errors in console
□ mf-s cookie set with correct domain, HttpOnly, Secure, SameSite
□ No "Failed to fetch" errors
□ Network tab: /assistant/auth/whoami returns 200 (not 401) when logged in
□ CSS variables --brand-accent, --accent update on workspace switch
□ No uncaught promise rejections
```

---

## 9. Failure Modes & Mitigations

| Failure | Symptom | Mitigation |
|---------|---------|------------|
| **CORS mismatch** | "Access to fetch blocked by CORS policy" | Worker ALLOW_ORIGINS must include exact frontend origin. Check `Origin` header matches. |
| **Cookie not set** | Whoami returns 401 after exchange | Check `Domain` (`.elyra-core.app`), `SameSite` (None for cross-origin), `Secure` flag. Ensure frontend and API share domain. |
| **Session expired** | Sudden 401 during usage | Frontend: catch 401 in fetch wrapper, redirect to /signin with `?reason=session_expired`. Show toast. |
| **D1 <> Supabase desync** | User exists in D1 but not Supabase (or vice versa) | Exchange handler writes to both. Add reconciliation cron (Worker Cron Trigger, daily). |
| **DNS misconfiguration** | `api.elyra-core.app` unreachable | Use Cloudflare DNS with proxied AAAA record. Verify with `dig api.elyra-core.app`. |
| **Supabase GoTrue down** | Exchange fails (verifySupabaseToken returns null) | Return 502 with clear message. Frontend shows "Auth service temporarily unavailable" with retry. |
| **Worker cold start** | First request slow (~50ms) | Acceptable for Workers. No mitigation needed. |
| **Rate limiting** | AI/Elli endpoint hammered | Cloudflare rate limiting rule: 60 req/min per IP on `/assistant/workspaces/*/elli/*`. Worker-level: 20 msg/min per user. |
| **Stale workspace state after switch** | Old workspace data visible briefly | `switchWorkspace()` must invalidate all tool state (mail, calendar, tasks). React key on workspace ID forces remount. |
| **Double write on workspace create** | Race condition: two workspaces created | Unique constraint on `workspaces.slug`. D1 + Supabase both have unique slug. Worker catches conflict, returns existing. |
| **Integration OAuth failure** | OAuth redirect fails or token invalid | Show clear error with "Retry" button. Store OAuth state in KV with TTL. Validate state param on callback. |
| **AI response too slow** | Elli panel shows spinner for >10s | Streaming (SSE) — user sees partial response immediately. Timeout at 30s with "Elli is taking longer than usual." |
| **Proxy/CDN caching** | Stale whoami response | All API responses: `Cache-Control: no-store`. Vercel rewrites: no caching on /assistant/* proxy. |

---

## 10. Component Architecture (Shell Decomposition)

### 10.1 New Component Tree

```
frontend/components/
├── shell/
│   ├── ShellLayout.tsx          # ~80 lines. CSS Grid: header + body(rail + canvas) + statusbar
│   ├── ShellHeader.tsx          # ~100 lines. Brand mark + WorkspaceSelector + Orb + UserMenu
│   ├── WorkspaceSelector.tsx    # ~80 lines. Dropdown with accent preview, keyboard nav
│   ├── UserMenu.tsx             # ~60 lines. Avatar, name, dropdown (settings, help, logout)
│   ├── Rail.tsx                 # ~100 lines. Reads from tool registry, renders nav items
│   ├── Canvas.tsx               # ~20 lines. {children} wrapper
│   ├── StatusBar.tsx            # ~60 lines. Workspace name, sync indicator, AI status
│   └── AISurface.tsx            # ~120 lines. Slide-over panel for Elli
├── elli/
│   ├── ElliPanel.tsx            # Chat interface
│   ├── ElliMessage.tsx          # Single message bubble
│   ├── ElliActionCard.tsx       # Action confirmation card
│   └── ElliModeSelector.tsx     # Mode switcher (assistant, planner, etc.)
├── providers/
│   ├── AuthProvider.tsx         # Auth state only
│   ├── WorkspaceProvider.tsx    # Workspace list + active workspace
│   └── ElliProvider.tsx         # AI state per workspace
├── workspace/
│   ├── WorkspaceHome.tsx        # Dashboard/home view
│   ├── WorkspaceOnboarding.tsx  # Onboarding stepper (existing, refactored)
│   └── admin/                   # Admin views
├── integrations/
│   ├── MarketplaceList.tsx
│   ├── IntegrationCard.tsx
│   └── IntegrationDetail.tsx
├── mail/                        # Mail tool (self-contained state)
├── calendar/                    # Calendar tool (self-contained state)
├── planner/                     # Task planner tool
├── orb2035/                     # Orb (existing, keep as-is)
└── ui/                          # Shared primitives
```

### 10.2 Context Split

```typescript
// providers/AuthProvider.tsx
interface AuthContextValue {
  user: { id: string; email: string } | null
  authState: 'checking' | 'authenticated' | 'unauthenticated'
  login(): void
  logout(): Promise<void>
}

// providers/WorkspaceProvider.tsx
interface WorkspaceContextValue {
  workspaces: Workspace[]
  activeWorkspace: Workspace | null
  switchWorkspace(slug: string): Promise<void>
  accentColor: string
  membership: { role: string; title: string | null } | null
}

// providers/ElliProvider.tsx
interface ElliContextValue {
  mode: ElliMode
  setMode(mode: ElliMode): void
  isOpen: boolean
  toggle(): void
  sendMessage(message: string): Promise<void>
  messages: ElliMessage[]
  pendingAction: ActionProposal | null
  confirmAction(): Promise<void>
  dismissAction(): void
}

// Each tool manages its OWN state:
// - Mail state lives in /mail page component
// - Calendar state lives in /calendar page component
// - No global mail/calendar/tasks state anymore
```

---

---

# DESIGN PROMPT BLOCK

> Copy everything below into a design-focused LLM (Figma AI, Midjourney prompt, or design spec generator).

---

## ELYRA CORE — Design System & UI Specification

### Role

You are a Lead Product Designer + Motion Designer.
You are designing the complete UI for **Elyra Core**, a dark-first premium AI-native system platform.
The Orb stays exactly as it is now (organic, pulsing, gradient sphere). Everything else is new.

---

### Design Goals

- **Premium, calm, high-quality** — this is a system platform, not a startup dashboard
- **Few colors, clear hierarchy** — content speaks, not chrome
- **Generous whitespace, clear typography** — editorial meets utility
- **"System Platform"** feel — think Linear, Raycast, Arc Browser
- **Dark-first** — light mode is explicitly out of scope for now

---

### Visual System

#### Colors

```
Background:
  --surface-0:    #0a0a0c      (deepest background)
  --surface-1:    #111114      (cards, panels)
  --surface-2:    #18181c      (elevated surfaces, hover)
  --surface-3:    #222228      (active states, selected)

Text:
  --text-primary:   #f0f0f2    (headings, primary content)
  --text-secondary: #8e8e96    (labels, metadata)
  --text-tertiary:  #4a4a52    (disabled, placeholders)

Accent (Elyra gradient-inspired):
  --accent:         #5cffec    (primary accent — teal/cyan)
  --accent-soft:    rgba(92, 255, 236, 0.12)  (backgrounds, highlights)
  --accent-ring:    rgba(92, 255, 236, 0.25)  (focus rings)
  --accent-on:      #0a0a0c    (text on accent backgrounds)

  Note: accent changes per workspace (workspace.accent_color)

Semantic:
  --success:   #34d399
  --warning:   #fbbf24
  --error:     #f87171
  --info:      #60a5fa

Borders:
  --border-subtle:   rgba(255, 255, 255, 0.06)
  --border-default:  rgba(255, 255, 255, 0.10)
  --border-strong:   rgba(255, 255, 255, 0.16)
```

#### Typography

```
Font stack: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif

Scale:
  --text-xs:    12px / 16px   (metadata, timestamps)
  --text-sm:    13px / 18px   (labels, secondary content)
  --text-base:  14px / 20px   (body text, default)
  --text-lg:    16px / 24px   (section headers)
  --text-xl:    20px / 28px   (page titles)
  --text-2xl:   24px / 32px   (hero text)
  --text-3xl:   32px / 40px   (onboarding headlines)

Weights:
  Regular: 400 (body)
  Medium:  500 (labels, nav)
  Semibold: 600 (headings)

Letter spacing:
  Headings: -0.02em
  Body: 0
  Labels/caps: 0.04em
```

#### Elevation & Surfaces

```
Glass panels:
  background: rgba(17, 17, 20, 0.8)
  backdrop-filter: blur(24px) saturate(1.2)
  border: 1px solid var(--border-subtle)
  border-radius: 16px

Cards:
  background: var(--surface-1)
  border: 1px solid var(--border-subtle)
  border-radius: 12px
  padding: 20px

Shadows (minimal, only for floating elements):
  --shadow-sm: 0 2px 8px rgba(0, 0, 0, 0.3)
  --shadow-md: 0 4px 16px rgba(0, 0, 0, 0.4)
  --shadow-lg: 0 8px 32px rgba(0, 0, 0, 0.5)
```

#### Spacing Scale

```
  --space-1:   4px
  --space-2:   8px
  --space-3:   12px
  --space-4:   16px
  --space-5:   20px
  --space-6:   24px
  --space-8:   32px
  --space-10:  40px
  --space-12:  48px
  --space-16:  64px
  --space-20:  80px
```

#### Layout Grid

```
Shell:
  Rail width: 64px (collapsed), 220px (expanded — future)
  Header height: 56px
  StatusBar height: 32px
  Canvas: flex-1, max-width 1200px centered, padding 32px
  AISurface: 420px wide, slides from right

Breakpoints:
  sm: 640px
  md: 768px
  lg: 1024px
  xl: 1280px
```

---

### Buttons

```
Primary:
  background: var(--accent)
  color: var(--accent-on)
  border-radius: 8px
  padding: 8px 16px
  font-weight: 500
  height: 36px
  hover: brightness(1.1)
  active: brightness(0.95)

Secondary:
  background: transparent
  color: var(--text-primary)
  border: 1px solid var(--border-default)
  border-radius: 8px
  hover: background var(--surface-2)

Ghost:
  background: transparent
  color: var(--text-secondary)
  hover: color var(--text-primary)

Danger:
  background: transparent
  color: var(--error)
  hover: background rgba(248, 113, 113, 0.1)
```

---

### Motion Guidelines

```
Transitions:
  Default: 200ms ease-out
  Layout shifts: 300ms ease-out
  Orb morphing: 600ms cubic-bezier(0.4, 0, 0.2, 1)
  Panel slide: 300ms cubic-bezier(0.32, 0.72, 0, 1)
  Accent color change: 400ms ease-in-out (CSS variable transition)

Orb:
  Idle: gentle rotation (20s cycle), subtle pulse (4s cycle)
  Working: faster rotation (8s cycle), brightness increase
  Error: color shifts toward --error, pulse becomes irregular
  Success: brief flash of --success, returns to workspace accent

Rules:
  - No bounce animations
  - No scale > 1.05 on hover
  - Prefer opacity transitions over transform
  - Motion should feel "measured" — nothing snappy or playful
```

---

### Component List (Design System)

| Component | Description |
|-----------|-------------|
| `Button` | Primary, Secondary, Ghost, Danger variants |
| `Input` | Text input with label, error state, helper text |
| `Select` | Custom dropdown with accent ring |
| `Card` | Surface container with optional header |
| `Badge` | Status indicator (active, error, beta) |
| `Avatar` | User avatar with initials fallback |
| `Tooltip` | Dark tooltip, appears on hover after 400ms |
| `Modal` | Centered overlay with backdrop blur |
| `SlideOver` | Right-side panel (for Elli) |
| `Toast` | Bottom-right notification, auto-dismiss 5s |
| `Stepper` | Onboarding progress (3 dots) |
| `NavItem` | Rail navigation item (icon + optional label) |
| `EmptyState` | Illustration + message + CTA |
| `LoadingState` | Skeleton lines + subtle pulse |
| `ErrorState` | Error icon + message + retry button |
| `IntegrationCard` | Logo + name + status badge + action |
| `TaskCard` | Title + status pill + assignee avatar |
| `MailListItem` | From + subject + date + unread indicator |
| `CalendarEvent` | Time + title + source indicator |

---

### Screen Descriptions

#### 1. Sign In

```
Full-screen dark background (--surface-0).
Centered card (480px wide, glass panel).
  Top: Elyra Core wordmark (text, not logo), --text-primary, --text-xl.
  Below: "Sign in to your workspace", --text-secondary, --text-sm.
  Spacing: --space-8.
  Button: "Continue with Google" (Primary, full-width, Google icon left).
  Divider: thin line with "or" centered.
  Email input + "Continue" button.
  Bottom: "Don't have an account? Get started" link, --text-tertiary.
Background: very subtle gradient radial from center (accent at 3% opacity).
Orb: NOT visible on signin. Clean, corporate.
```

#### 2. Auth Callback (Loading)

```
Full-screen, centered.
Orb (small, 48px) with working animation.
Below orb: "Authenticating..." in --text-secondary, --text-sm.
No other elements. Pure focus.

Error state:
  Orb shifts to error color.
  Text: "Authentication failed" in --text-primary.
  Below: error message in --text-secondary.
  Button: "Try again" (Secondary).
```

#### 3. Workspace Selector (/w)

```
Full-screen dark background.
Center: Orb (large, 120px), gentle idle animation.
Below orb: "Elyra Core" wordmark, --text-2xl.
Below: "Choose your workspace", --text-secondary.

Workspace cards arranged horizontally (or vertically on mobile):
  Each card: glass panel, 200px wide.
    Accent color bar (4px) at top.
    Workspace name, --text-lg.
    Type badge (Company, Personal).
    Member count, --text-tertiary.
    Click → navigate to /w/[slug].

Bottom: "+ Create workspace" ghost button.

If only 1 workspace: auto-redirect, never show this screen.
```

#### 4. Workspace Home (/w/[slug])

```
Shell layout active (Header + Rail + Canvas).

Canvas content:
  Top: "Good morning, Paul." (or time-appropriate greeting), --text-xl.
  Below: "Here's what's happening in [Workspace Name]", --text-secondary.

  3-column grid (responsive → 1 column on mobile):
    Card 1: "Upcoming"
      Next 3 calendar events. Each: time + title.
      Empty: "No events this week."
      Footer: "View Calendar →" link.

    Card 2: "Inbox"
      3 most recent unread emails. Each: from + subject.
      Empty: "All caught up." + Elli suggestion.
      Footer: "View Mail →" link.

    Card 3: "Tasks"
      Top 3 active tasks. Each: title + status pill.
      Empty: "No tasks yet." + "Ask Elli to create a plan" button.
      Footer: "View Planner →" link.

  Below grid: Elli prompt area.
    "Ask Elli anything about [Workspace Name]..."
    Input bar with send button. Clicking opens AISurface.
```

#### 5. Marketplace (/w/[slug]/integrations)

```
Canvas:
  Header: "Integrations" --text-xl + "Manage your workspace connections" --text-secondary.

  Tab bar: [Installed] [Available] [Beta]

  Grid of IntegrationCards (3 columns):
    Each card:
      Icon (32px, from catalog).
      Name, --text-lg.
      One-line description, --text-secondary.
      Status badge (Active ● green, Error ● red, Not installed ○ gray).
      Action button: [Configure] or [Install].

  Available tab: same cards but with [Install] buttons.
  Beta tab: same cards with "Beta" badge.
```

#### 6. Integration Detail

```
Canvas:
  Back link: "← Integrations" --text-secondary.
  Icon (48px) + Name --text-xl.
  Description paragraph, --text-base, max-width 640px.

  Section: "Required Permissions"
    Bullet list of scopes, --text-secondary.

  Section: "Status"
    Current status badge.
    If configured: "Connected as paul@elyra-core.app"
    Buttons: [Test Connection] [Remove]

  Section: "Elli says"
    Glass panel with Elli avatar (small orb).
    Contextual explanation of what this integration enables for AI.

  If not installed:
    Primary CTA: [Install → ]
```

#### 7. Onboarding Stepper

```
Full-screen overlay (backdrop blur over workspace).
Centered card (560px wide, glass panel).

Progress: 3 dots at top. Active dot = accent color. Others = --border-default.

Step content centered within card.
  Step 1: Welcome text + role selection (radio buttons).
  Step 2: Workspace name input + type toggle.
  Step 3: Ready confirmation + suggested first tasks (checkboxes).

Navigation: [← Back] [Continue →] at bottom.
  Final step: [Get Started →] (Primary button).

Orb visible at top of card, small (40px), responds to step changes:
  Step 1: gentle pulse.
  Step 2: subtle grow.
  Step 3: confident glow.
```

#### 8. Elli Panel

```
AISurface slides from right (420px wide).

Header:
  "Elli" + mode badge (e.g., "Assistant").
  Close button (X) at right.
  Mode selector: dropdown or segmented control.

Chat area (flex-1, scrollable):
  Messages alternate left (Elli) and right (user).
  Elli messages: glass panel background, accent-soft border-left (3px).
  User messages: --surface-2 background, right-aligned.

  Action cards inline in chat:
    Glass panel with accent border.
    "Elli möchte:" + action description.
    [Ablehnen] (Ghost) [Bestätigen] (Primary).

  Planner output:
    Task list with checkboxes.
    Each task: title + priority indicator.
    "Erstelle diese Tasks" (Primary) button.

Input area (bottom):
  Input field + send button.
  Above input: suggested quick actions as chips.
    "Zusammenfassung", "Plane meinen Tag", "E-Mails checken"
```

---

### Microcopy Examples

| Context | DE | EN |
|---------|----|----|
| Greeting (morning) | Guten Morgen, Paul. | Good morning, Paul. |
| Greeting (afternoon) | Guten Tag, Paul. | Good afternoon, Paul. |
| Empty inbox | Alles erledigt. Keine neuen E-Mails. | All caught up. No new emails. |
| Empty tasks | Noch keine Aufgaben. Frag Elli nach einem Plan. | No tasks yet. Ask Elli for a plan. |
| Elli CTA | Frag Elli... | Ask Elli... |
| Integration installed | Gmail ist verbunden. | Gmail is connected. |
| Integration error | Verbindung fehlgeschlagen. Bitte erneut versuchen. | Connection failed. Please try again. |
| Workspace switch | Wechsel zu [Name]... | Switching to [Name]... |
| Action confirm | Soll Elli das ausführen? | Should Elli execute this? |
| Action confirmed | Erledigt. | Done. |
| Session expired | Deine Sitzung ist abgelaufen. Bitte erneut anmelden. | Your session has expired. Please sign in again. |

---

### Content Tone Guidelines

- **Voice:** Calm authority. Like a senior engineer who knows the answer but doesn't show off.
- **Length:** Shorter is better. One sentence > two sentences.
- **Format:** Use sentence case for everything except product names.
- **Errors:** Never blame the user. State what happened + what to do next.
- **Loading:** Use "..." or skeleton, never "Please wait".
- **Empty states:** Always have a next action. Never leave the user stranded.
- **Elli:** Speaks in first person ("Ich kann..."), never third person ("Elli kann...").

---

*End of Design Prompt Block*

---

## Appendix: Migration Path from Current Codebase

### What stays
- Worker `index.ts` auth routes (exchange, whoami, logout, onboarding) — enhanced, not replaced
- D1 schema (0001) — extended with 0004
- Supabase Auth configuration
- Orb implementation (`orb2035/OrganicSphere.tsx`)
- Design tokens concept (`tokens.css` — will be updated to match new system)
- i18n infrastructure (`lib/i18n/`)
- Auth guard utilities (`utils/auth-guard.ts`)

### What gets decomposed
- `WorkspaceShell.tsx` (1092 lines) → `shell/ShellLayout.tsx` + `shell/ShellHeader.tsx` + `shell/Rail.tsx` + `shell/Canvas.tsx` + `shell/StatusBar.tsx` + `shell/UserMenu.tsx` + `shell/WorkspaceSelector.tsx`
- `WorkspaceContext.tsx` (1574 lines) → `providers/AuthProvider.tsx` + `providers/WorkspaceProvider.tsx` + `providers/ElliProvider.tsx` (mail/calendar/tasks state moves to page-level)
- `CoreDock.tsx` → `shell/Rail.tsx` with dynamic tool registry

### What gets replaced
- Route structure: `/workspace/[category]/[module]` → `/w/[slug]/[tool]`
- Workspace switching: localStorage-based → URL-based (slug is truth)
- Monolithic context: single provider → 3 focused providers
- API routing: manual if/else → Hono router on Worker

### What's new
- Supabase schema (profiles, workspaces, workspace_members, etc.)
- Marketplace (integrations_catalog, workspace_integrations)
- Elli system (elly_sessions, structured AI modes, action proposals)
- Tasks system
- StatusBar, AISurface components
- Next.js middleware for routing
