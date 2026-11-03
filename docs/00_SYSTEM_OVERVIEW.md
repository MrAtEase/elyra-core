# System Overview

## Core Concepts

### MIRA OS

MIRA OS is the platform infrastructure that bundles MERLIN, dashboards, workspace tooling, and orchestrated integrations. It provides the foundation for multi-workspace operations, OAuth authentication, and cross-workspace intelligence.

**Key Components:**
- `mira-os/` - Core OS engines, runners, and integrations (email, calendar, knowledge, automation)
- `worker/` - Cloudflare Worker API gateway serving `/assistant/*` endpoints
- `merlin/` - Reasoning engines and cognitive architecture
- `email-provider/` - Provider adapters (Gmail, Outlook, Local)

**Platform Scope:**
- Multi-workspace support (personal, customer workspaces, platform workspace)
- OAuth integration backbone (Google, Microsoft)
- Database and storage (D1, KV)
- Scheduled jobs and automation

### MERLIN

MERLIN (M.E.R.L.I.N) is the orchestrating assistant that surfaces task, calendar, and email work across every workspace. It operates as the intelligent layer that:

- Observes workspace context and adapts to user needs
- Orchestrates actions across integrated services (Calendar, Tasks, Email, Drive, Docs, Slides)
- Provides cognitive reasoning through multiple engine layers
- Maintains workspace boundaries while enabling cross-workspace insights when permitted

**Architecture:**
- MERLIN Brain v1 (prompts 16-20) - Core reasoning
- MERLIN Deep Cognition (prompts 21-30) - Advanced intelligence
- Dev agent runner for local development
- VS Code extension for developer workflows

**API Surface:**
- All `/assistant/*` endpoints are MERLIN-powered
- OAuth flows are MERLIN-gated
- Workspace-scoped operations default to MERLIN context

### Workspace

A workspace is a bounded context within MIRA OS that contains:
- User identity and authentication state
- OAuth tokens scoped to the workspace
- Calendar, email, tasks, and document data
- Workspace-specific branding and configuration
- Access policies and autonomy levels

**Workspace Types:**
- **Personal** - Private life data (calendar, email, tasks)
- **Customer** - Business workspace (e.g., Fish-Delish) with shared docs, drive assets, marketing data
- **Platform** - Infrastructure workspace (mira-os) for shared docs, tooling, operational data

**Example: Fish-Delish Workspace**

Fish-Delish is a customer workspace that demonstrates the full MIRA OS stack:

```
Fish-Delish Workspace
├── Domain: elyra-core.app (marketing)
├── App: app.elyra-core.app (frontend shell)
├── API: api.elyra-core.app (MERLIN Worker)
├── OAuth: Google Workspace integration
├── Data: Calendar events, Gmail threads, Drive files
└── Branding: Workspace-specific UI, colors, policies
```

**Workspace Scoping:**
- OAuth tokens stored per workspace: `google_tokens:<userId>:<workspaceId>`
- API operations require workspace context
- MERLIN filters outputs based on active workspace
- Cross-workspace access requires explicit permission

## System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                      MIRA OS Platform                        │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │   MERLIN     │    │   MIRA OS    │    │  Workspaces  │  │
│  │  Assistant   │◄───┤   Engines    │◄───┤  (Fish-      │  │
│  │              │    │              │    │   Delish)    │  │
│  └──────┬───────┘    └──────┬───────┘    └──────┬───────┘  │
│         │                   │                    │          │
│         └───────────────────┼────────────────────┘          │
│                            │                                │
│  ┌─────────────────────────▼──────────────────────────────┐  │
│  │         Cloudflare Worker (api.elyra-core.app)        │  │
│  │  ┌──────────────────────────────────────────────────┐ │  │
│  │  │  /assistant/* - MERLIN API endpoints            │ │  │
│  │  │  /assistant/oauth/* - OAuth flows                │ │  │
│  │  │  /assistant/calendar/* - Calendar CRUD           │ │  │
│  │  │  /assistant/tasks/* - Tasks management          │ │  │
│  │  │  /assistant/email/* - Email operations          │ │  │
│  │  └──────────────────────────────────────────────────┘ │  │
│  └─────────────────────────┬────────────────────────────┘  │
│                            │                                │
│  ┌─────────────────────────▼──────────────────────────────┐  │
│  │              Storage Layer                              │  │
│  │  ┌──────────────┐  ┌──────────────┐                  │  │
│  │  │  D1 Database │  │  KV Storage  │                  │  │
│  │  │  (Sessions,  │  │  (OAuth      │                  │  │
│  │  │   Workspaces)│  │   Tokens)    │                  │  │
│  │  └──────────────┘  └──────────────┘                  │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                               │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │         External Integrations                            │ │
│  │  ┌──────────────┐  ┌──────────────┐                    │ │
│  │  │   Google     │  │  Microsoft   │                    │ │
│  │  │  (Calendar, │  │  (Outlook,   │                    │ │
│  │  │   Gmail,    │  │   Calendar)  │                    │ │
│  │  │   Drive)    │  │              │                    │ │
│  │  └──────────────┘  └──────────────┘                    │ │
│  └──────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│              Frontend Shell (app.elyra-core.app)             │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  Static HTML/CSS/JS shell                             │ │
│  │  - Calls api.elyra-core.app/assistant/*               │ │
│  │  - Workspace-aware UI                                  │ │
│  │  - MERLIN client integration                           │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

## Data Flow

1. **User Authentication:**
   - User visits `app.elyra-core.app`
   - Frontend calls `api.elyra-core.app/assistant/auth/whoami`
   - If unauthenticated, redirects to OAuth flow

2. **OAuth Flow:**
   - User initiates `/assistant/oauth/google/start?workspaceId=ws-default`
   - Worker redirects to Google OAuth consent screen
   - Google redirects back to `/assistant/oauth/google/callback`
   - Worker exchanges code for tokens, stores in KV: `google_tokens:<userId>:<workspaceId>`
   - Creates workspace connection records in D1

3. **API Operations:**
   - Frontend makes request to `/assistant/calendar/events?workspaceId=ws-default`
   - Worker validates session, loads workspace-scoped tokens
   - MERLIN engines process request, call Google Calendar API
   - Response filtered by workspace context

4. **MERLIN Intelligence:**
   - MERLIN observes workspace activity
   - Engines analyze context (email threads, calendar events, tasks)
   - Surfaces relevant insights and actions
   - Maintains workspace boundaries

## Open Questions

- How should MERLIN handle cross-workspace queries when user has multiple active workspaces?
- What is the recommended workspace autonomy level for customer workspaces vs personal?
- Should platform workspace (mira-os) have read-only access to customer workspace metadata for diagnostics?
- How should workspace deletion cascade to OAuth tokens and connection records?
- What is the migration path for workspaces that outgrow the current data model?

