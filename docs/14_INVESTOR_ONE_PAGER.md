# Investor One-Pager

## What We Are Building

MIRA OS is a workspace-native AI orchestration platform that enables multi-workspace businesses to operate with unified intelligence while maintaining strict data isolation. MERLIN, the orchestrating assistant, coordinates operations across Google Workspace services (Calendar, Mail, Tasks, Drive, Docs, Slides) within workspace boundaries. Fish-Delish serves as the first production workspace, demonstrating the platform's capabilities with a complete customer implementation including OAuth integration, workspace-scoped data access, and brand-specific frontend.

## The Wedge

Google Workspace integration provides the first "control deck" for business operations. Calendar, Tasks, Email, and Documents represent the core operational surface where businesses make decisions, execute actions, and coordinate work. By integrating these services with workspace-aware orchestration, MIRA OS becomes the intelligence layer that observes context, reasons about actions, and executes operations across the business infrastructure. This wedge is defensible because workspace isolation is architectural (not configurational), OAuth integration is deep (read/write/delete), and MERLIN orchestration is workspace-native (not retrofitted).

## What Is Already Working Today

**OAuth Backbone:** Google Workspace OAuth flow is implemented and tested. Token storage is workspace-scoped in Cloudflare KV. Token refresh is automatic. Workspace connections are tracked in D1 database.

**Workspace Isolation:** All tokens, data, and operations are scoped to workspaces. Token keys include workspace ID: `google_tokens:<userId>:<workspaceId>`. Database queries filter by workspace ID. Cross-workspace access is architecturally impossible.

**Live Calendar Read:** Calendar events are fetched from Google Calendar API using workspace-scoped tokens. Events are displayed in dashboard UI. API endpoint `/assistant/calendar/events` is functional.

**Integration UI:** Frontend modules exist for calendar, tasks, email, and documents. Dashboard widgets display workspace-scoped data. Workspace switching UI is implemented.

**Worker Routes:** All required API endpoints are implemented: `/assistant/calendar/*`, `/assistant/tasks/*`, `/assistant/email/*`, `/assistant/drive/*`, `/assistant/slides/*`. Endpoints handle workspace scoping correctly.

**Dashboard Widgets:** Calendar, tasks, and email views are exposed in UI. Frontend modules connect to backend APIs. Workspace context is propagated from session to UI.

## MVP by 07.01 (Commitment)

**Guaranteed Delivery:**

- Complete OAuth flow for Google Workspace (connect, token refresh, workspace connections)
- Calendar operations: list events, create events, update events, delete events (with confirmation)
- Tasks operations: list tasks, create tasks, update tasks, complete tasks
- Email operations: list inbox, send email, email intelligence (summarization, draft reply, task extraction)
- Drive operations: list files, upload files, download files, get file metadata
- Docs/Slides operations: list documents, create documents, update documents, delete presentations (with confirmation)
- Workspace isolation: all operations scoped to active workspace, no cross-workspace access
- UI shell: functional dashboard with calendar, tasks, email, and documents views
- MERLIN orchestration: workspace-aware context observation and cross-service coordination
- Audit points: delete operations require confirmation, audit logging specification defined

**Evidence:** All infrastructure exists (OAuth, tokens, workspace isolation). All backend APIs are implemented. Frontend modules exist and need connection to APIs. No new infrastructure is required. Only UI integration and API completion remain.

## Business Structure

**Holding + Operating Companies:** MIRA OS Holding owns the platform infrastructure (MERLIN engines, OAuth integrations, workspace management). Operating companies (Fish-Delish, future brands) own brand-specific frontends, customer relationships, and brand IP. This structure de-risks rollout by isolating brand operations from platform operations.

**Franchise Expansion Requirement:** The business model requires 3 locations in 18 months to validate franchise scalability. Each location is a workspace. The brand is a workspace. The holding company is a workspace. Cross-workspace intelligence is available when permitted, but data boundaries are enforced at the infrastructure level.

**Why This Structure De-Risks Rollout:** Repository-level isolation (fish-delish repo vs. mira-stack repo) ensures brand-specific code changes do not affect other brands. Each brand can have independent deployment cycles. Brand-specific bugs are contained to the brand repository. New brands are new repositories, not new infrastructure.

## Go-to-Market

**Fish-Delish Flagship:** Fish-Delish serves as the first production workspace, demonstrating the platform's capabilities with a complete customer implementation. The workspace is live at `app.elyra-core.app` with Google Workspace integration, calendar events, email threads, and dashboard widgets.

**Tourism/Portugal 2030:** Exploring eligibility for Portugal 2030 tourism and digital transformation programs. The platform's workspace-native architecture aligns with multi-location business needs in the tourism sector.

**EU Programs Angle:** Exploring eligibility for EU digital innovation and SME support programs. The platform's infrastructure model (holding + operating companies) aligns with EU program requirements for scalable, exportable technology.

**Note:** Program eligibility is exploratory. No guarantees are made regarding program acceptance or funding.

## The Ask

**Use of Funds Categories:**

- Platform development: MERLIN engine enhancements, additional OAuth providers (Microsoft 365), workspace management features
- Brand expansion: Fish-Delish location rollout, new brand development, franchise onboarding
- Infrastructure scaling: Cloudflare Workers scaling, database capacity, API rate limit management
- Team expansion: Engineering, product, sales, operations
- Market validation: Customer acquisition, pilot programs, franchise partnerships

**What We Need from Partners:**

- Google/OpenAI support: API access, rate limit increases, technical partnerships, integration support
- Distribution: Introductions to franchise operators, multi-location businesses, enterprise customers
- Strategic introductions: Investors, advisors, customers, partners in tourism, hospitality, retail sectors

## Appendix

**Technical Documentation:**

- Feature to Code Map: `docs/10_MVP_FEATURE_TO_CODE_MAP.md` - Maps MVP features to concrete code locations
- Auth and OAuth Flows: `docs/11_AUTH_AND_OAUTH_FLOWS.md` - Describes OAuth integration and session management
- Workspace Isolation Guarantees: `docs/12_WORKSPACE_ISOLATION_GUARANTEES.md` - Architectural invariants for workspace isolation
- MVP Contract: `docs/13_MVP_CONTRACT.md` - Delivery guarantees, exclusions, risk register, timeline

**Demo Checklist:**

- OAuth connection: User connects Google Workspace account, grants permissions, tokens stored workspace-scoped
- Calendar view: User views calendar events from Google Calendar, creates new event, updates event, deletes event (with confirmation)
- Tasks view: User views tasks from Google Tasks, creates task, completes task
- Email view: User views inbox emails, sends email, uses email intelligence (summarization, draft reply, task extraction)
- Drive view: User views Drive files, uploads file, downloads file
- Workspace isolation: User switches workspaces, verifies data boundaries, confirms cross-workspace access is blocked
- MERLIN orchestration: MERLIN observes workspace context, coordinates operations across services, maintains workspace boundaries

## Open Questions

- What is the optimal go-to-market sequence: franchise first, enterprise first, or SMB first?
- How should we structure pricing: per-workspace, per-user, per-location, or revenue share?
- What is the recommended approach for Microsoft 365 integration: prioritize after Google Workspace MVP or develop in parallel?
- How should we handle cross-workspace permissions: automatic for brand operators, opt-in, or explicit permission model?
- What is the recommended session expiration duration for production: fixed windows or activity-based refresh?
- Should structured audit logging be implemented for MVP, or is console logging sufficient for initial deployment?
- What is the recommended approach for real-time updates: webhooks, polling, or hybrid model?
- How should workspace deletion cascade to OAuth tokens and connections: immediate deletion or grace period?
- What is the migration path for customers using legacy systems: data import, API integration, or greenfield deployment?
- How should we position MIRA OS relative to incumbents: disruptor, complement, or replacement?

