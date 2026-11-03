# MVP Contract & Delivery Guarantees

## Overview

This document defines the MVP as a contract, not a vision. It specifies what is guaranteed, what is explicitly excluded, why this scope is sufficient for investment, and how delivery will be completed by 07.01.

## 1. What This MVP Guarantees (Non-Negotiable)

### Identity & Session

**Guarantee:** Users authenticate via OAuth (Google Workspace) and receive a session cookie (`mf-s`) that is HttpOnly, Secure, and SameSite=Lax. Sessions are stored in D1 database and associate a user ID with an active workspace ID.

**Evidence:**
- Session management implemented in `worker/src/index.ts`
- Session cookie set during OAuth callback
- Session validation on all authenticated endpoints
- Workspace context derived from session

**Reference:** `docs/11_AUTH_AND_OAUTH_FLOWS.md` - Flow A: User Opens App → Session Established → Whoami

### Workspace Isolation

**Guarantee:** All data, tokens, and operations are scoped to a workspace. Tokens are stored with workspace-scoped keys: `google_tokens:<userId>:<workspaceId>`. Database queries filter by `workspace_id`. Cross-workspace access is architecturally impossible.

**Evidence:**
- Token storage keys include workspace ID
- All database queries filter by workspace ID
- API operations require workspace context from session
- No global tokens or user-level tokens without workspace context

**Reference:** `docs/12_WORKSPACE_ISOLATION_GUARANTEES.md` - Invariants 1-4

### Google Workspace Read/Write Operations

**Guarantee:** The MVP provides read and write access to Google Workspace services: Calendar, Mail (Gmail), Tasks, Drive, Docs, and Slides. All operations use workspace-scoped OAuth tokens and maintain workspace boundaries.

**Calendar:**
- List events (read)
- Create events (write)
- Update events (write)
- Delete events (write, with confirmation)

**Mail (Gmail):**
- List inbox emails (read)
- Send emails (write)
- Email intelligence features (summarization, draft reply, task extraction)

**Tasks:**
- List tasks (read)
- Create tasks (write)
- Update tasks (write)
- Complete tasks (write)

**Drive:**
- List files (read)
- Upload files (write)
- Download files (read)
- Get file metadata (read)

**Docs:**
- List documents (read)
- Create documents (write)
- Update documents (write)

**Slides:**
- List presentations (read)
- Create presentations (write)
- Update presentations (write)
- Delete presentations (write, with confirmation)

**Evidence:**
- API endpoints implemented: `/assistant/calendar/*`, `/assistant/tasks/*`, `/assistant/email/*`, `/assistant/drive/*`, `/assistant/slides/*`
- Google API integrations functional in `worker/src/index.ts`
- Token refresh automatic before API operations

**Reference:** `docs/10_MVP_FEATURE_TO_CODE_MAP.md` - Feature to Code Mapping

### Merlin Orchestration Layer

**Guarantee:** MERLIN (M.E.R.L.I.N) operates as the orchestrating assistant that observes workspace context and coordinates operations across integrated services. MERLIN maintains workspace boundaries and provides cognitive reasoning through engine layers.

**Evidence:**
- MERLIN Brain v1 implemented (core reasoning)
- Workspace-aware context observation
- Cross-service orchestration capabilities
- Workspace boundary enforcement

**Reference:** `docs/00_SYSTEM_OVERVIEW.md` - MERLIN section

### UI Shell + Dashboard Visibility

**Guarantee:** A functional web application shell provides dashboard views for calendar, tasks, email, and documents. The UI connects to backend APIs and displays workspace-scoped data. The shell is responsive and supports workspace switching.

**Evidence:**
- Frontend modules exist: `fish-delish/app/modules/calendar.js`, `tasks.js`, `email.js`, `slides.js`
- Dashboard UI implemented in `fish-delish/app/modules/dashboard.js`
- API integration points defined

**Reference:** `docs/10_MVP_FEATURE_TO_CODE_MAP.md` - Frontend modules

### Auditability (Where Logs Can Exist)

**Guarantee:** All delete operations require explicit confirmation (`confirm: true` parameter). Audit points are defined for connection operations, read operations, write operations, and delete operations. Audit records include `userId`, `workspaceId`, `action`, `timestamp`, and relevant context (non-sensitive data only).

**Evidence:**
- Delete endpoints require confirmation parameter
- Audit logging specification in `docs/08_SECURITY_AND_GOVERNANCE.md`
- Audit points documented in `docs/12_WORKSPACE_ISOLATION_GUARANTEES.md` - Audit Points

**Reference:** `docs/12_WORKSPACE_ISOLATION_GUARANTEES.md` - Audit Points section

## 2. What This MVP Explicitly Does NOT Do

### No Full Automation Without Confirmation

**Exclusion:** The MVP does not execute destructive or irreversible operations without explicit user confirmation. All delete operations require a `confirm: true` parameter from the frontend, and the frontend must prompt the user before sending this parameter.

**Rationale:** This ensures user control and prevents accidental data loss. Automation can suggest actions, but execution requires approval.

**Evidence:** Delete endpoints check for `confirm: true` parameter. See `docs/10_MVP_FEATURE_TO_CODE_MAP.md` - Audit & Confirmation Flows.

### No Destructive Actions Without User Approval

**Exclusion:** The MVP does not delete calendar events, tasks, emails, or documents without user confirmation. The frontend must show a confirmation dialog before calling delete endpoints.

**Rationale:** Destructive actions are irreversible. User approval is required to prevent accidental loss of data.

**Evidence:** Delete endpoints require confirmation. Frontend modules must implement confirmation dialogs.

### No AI Hallucinated Execution

**Exclusion:** The MVP does not allow MERLIN or any AI component to execute operations based on hallucinated or unverified data. All operations must be based on actual data from Google Workspace APIs or user input.

**Rationale:** AI hallucinations can lead to incorrect operations. The MVP requires data verification before execution.

**Evidence:** MERLIN orchestration uses actual API responses, not generated data. See `docs/00_SYSTEM_OVERVIEW.md` - MERLIN section.

### No Cross-Workspace Actions

**Exclusion:** The MVP does not allow operations that access data from one workspace while operating in another workspace context. All operations are scoped to the active workspace from the session.

**Rationale:** Workspace isolation is a core security guarantee. Cross-workspace access requires explicit permissions, which are not in MVP scope.

**Evidence:** Workspace isolation is architectural. See `docs/12_WORKSPACE_ISOLATION_GUARANTEES.md` - Invariant 3: No Cross-Workspace Reads/Writes.

### No Enterprise Admin Features Yet

**Exclusion:** The MVP does not include enterprise administration features such as SSO (Single Sign-On), MFA (Multi-Factor Authentication), IP whitelisting, custom role definitions, or fine-grained permissions beyond basic workspace roles.

**Rationale:** Enterprise admin features require significant development effort and are not necessary for MVP validation. They can be added post-MVP based on customer feedback.

**Evidence:** See `docs/07_MVP_SCOPE_AND_NON_NEGOTIABLES.md` - Out of Scope (MVP) section.

## 3. Why This Is Enough To Invest

### Category Creation Argument

The MVP creates a new category: workspace-aware AI orchestration for multi-workspace businesses. Unlike generic AI assistants that operate in a single context, MIRA OS enables businesses to manage multiple workspaces (personal, customer, platform) with a single intelligent assistant that maintains boundaries while providing cross-workspace insights when permitted.

**Market Position:** No existing solution provides workspace-aware AI orchestration with OAuth integration, workspace isolation, and cross-service coordination in a single platform.

**Evidence:** See `docs/05_SYSTEM_POSITIONING.md` for market positioning and competitive analysis.

### Platform vs Product Distinction

The MVP is a platform, not a product. It provides the infrastructure for workspace management, OAuth integration, and AI orchestration. Individual workspaces (like Fish-Delish) are products built on the platform.

**Platform Capabilities:**
- Multi-workspace support
- OAuth integration backbone (Google, Microsoft)
- MERLIN orchestration layer
- Workspace isolation guarantees
- API gateway for workspace operations

**Product Example:** Fish-Delish workspace demonstrates the platform's capabilities with a complete customer implementation.

**Evidence:** See `docs/00_SYSTEM_OVERVIEW.md` - Workspace Types and Fish-Delish Workspace example.

### Why Fish-Delish Proves the System

Fish-Delish is a production workspace that demonstrates the full MIRA OS stack:

**Fish-Delish Workspace:**
- Domain: `elyra-core.app` (marketing)
- App: `app.elyra-core.app` (frontend shell)
- API: `api.elyra-core.app` (MERLIN Worker)
- OAuth: Google Workspace integration
- Data: Calendar events, Gmail threads, Drive files
- Branding: Workspace-specific UI, colors, policies

**Proof Points:**
1. Workspace isolation works: Fish-Delish data is isolated from other workspaces
2. OAuth integration works: Google Workspace connection functional
3. MERLIN orchestration works: Assistant coordinates across services
4. UI shell works: Dashboard displays workspace-scoped data
5. Multi-workspace architecture works: Platform supports multiple workspaces

**Evidence:** See `docs/00_SYSTEM_OVERVIEW.md` - Example: Fish-Delish Workspace and `fish-delish/README.md`.

### Why This Generalizes to Enterprise

The MVP architecture generalizes to enterprise because:

1. **Workspace Isolation:** Enterprise customers require data isolation between departments, teams, or business units. The MVP's workspace isolation model scales to enterprise needs.

2. **OAuth Integration:** Enterprise customers use Google Workspace or Microsoft 365. The MVP's OAuth integration backbone supports both providers.

3. **Multi-Workspace Support:** Enterprise customers manage multiple workspaces (departments, subsidiaries, franchises). The MVP's multi-workspace architecture supports this.

4. **Auditability:** Enterprise customers require audit trails for compliance. The MVP defines audit points and logging requirements.

5. **Platform Model:** Enterprise customers can deploy the platform and create multiple workspaces for different business units, maintaining isolation while enabling cross-workspace insights when permitted.

**Evidence:** See `docs/06_HOLDING_AND_FRANCHISE_MODEL.md` for franchise and enterprise model.

## 4. Delivery Timeline

### Now → 07.01

**Current Date:** December 30, 2024  
**Target Date:** January 7, 2025  
**Remaining Time:** 8 days

### What Is Already Done

**Infrastructure (Complete):**
- OAuth flow handlers implemented and tested
- Token storage workspace-scoped and functional
- Token refresh automatic and reliable
- Workspace connections tracked in D1
- Workspace isolation architecturally enforced

**Backend APIs (Complete):**
- All required endpoints exist: `/assistant/calendar/*`, `/assistant/tasks/*`, `/assistant/email/*`, `/assistant/drive/*`, `/assistant/slides/*`
- Endpoints handle workspace scoping correctly
- Endpoints integrate with Google APIs
- Delete confirmation implemented

**Google API Integrations (Complete):**
- Calendar API: Reading and writing events works
- Tasks API: Full CRUD operations implemented
- Gmail API: Inbox reading and email sending work
- Drive API: File listing, upload, download implemented
- Docs/Slides API: Structure exists, needs completion

**MERLIN Orchestration (Complete):**
- MERLIN Brain v1 implemented
- Workspace-aware context observation
- Cross-service orchestration capabilities

**Frontend Modules (Structure Complete):**
- Calendar module: `fish-delish/app/modules/calendar.js`
- Tasks module: `fish-delish/app/modules/tasks.js`
- Email module: `fish-delish/app/modules/email.js`
- Slides module: `fish-delish/app/modules/slides.js`
- Dashboard UI: `fish-delish/app/modules/dashboard.js`

**Documentation (Complete):**
- System overview, architecture, OAuth flows, workspace isolation documented
- Feature to code map complete
- MVP scope and non-negotiables defined

**Evidence:** See `docs/10_MVP_FEATURE_TO_CODE_MAP.md` - Why This MVP is Realistically Shippable by 07.01.

### What Remains (UI Wiring, Deploy, Polish)

**UI Integration (2-3 days):**
- Connect existing frontend modules to backend APIs
- Add confirmation dialogs for delete operations
- Expose calendar/tasks/email views in UI
- Wire up workspace switching UI

**Slides API Completion (1 day):**
- Complete Google Slides API integration in `worker/src/slides.ts`
- Connect Slides endpoints to frontend

**Email Intelligence UI (1 day):**
- Expose email intelligence features in frontend
- Connect email summarization, draft reply, task extraction to UI

**Testing & Polish (1-2 days):**
- End-to-end testing of OAuth flows
- Testing of workspace isolation
- UI/UX polish
- Error handling improvements

**Deployment (1 day):**
- Deploy worker to production
- Deploy frontend to Cloudflare Pages
- Verify production OAuth flows
- Smoke testing

**Total Estimated Effort:** 6-8 days

**Risk Buffer:** 0-2 days for unexpected issues

**Conclusion:** Delivery by 07.01 is realistic because:
- All infrastructure exists (OAuth, tokens, workspace isolation)
- All backend APIs are implemented
- Frontend modules exist and need connection to APIs
- No new infrastructure is required
- Only UI integration and API completion remain

## 5. Risk Register

### Technical Risks

**OAuth Token Refresh Failures**

**Risk:** Access token expires and refresh token is invalid or revoked, causing operations to fail.

**Impact:** High - Users cannot access Google Workspace data until re-authentication.

**Probability:** Medium - Token refresh failures are rare but possible (user revokes access, OAuth app credentials change).

**Mitigation:**
- Automatic token refresh with 60-second buffer before expiration
- Graceful error handling: Return 401 with clear error message
- Frontend shows reconnect prompt when token refresh fails
- Re-authentication flow is simple (user clicks reconnect button)

**Evidence:** See `docs/11_AUTH_AND_OAUTH_FLOWS.md` - Token Refresh Failures section.

**Google API Rate Limits**

**Risk:** Google API rate limits are exceeded, causing operations to fail.

**Impact:** Medium - Operations may be delayed or fail temporarily.

**Probability:** Low - Rate limits are generous for typical usage patterns.

**Mitigation:**
- Rate limit handling in API request wrappers
- Exponential backoff on rate limit errors
- User notification if rate limits are exceeded
- Monitor API usage to detect approaching limits

**Evidence:** Google API rate limits are documented and can be monitored.

**Workspace Isolation Violations**

**Risk:** Bug in code allows cross-workspace data access.

**Impact:** Critical - Security violation, data leakage.

**Probability:** Very Low - Workspace isolation is architectural (tokens stored with workspace ID, queries filter by workspace ID).

**Mitigation:**
- Workspace isolation is enforced at the storage layer (KV keys include workspace ID)
- Database queries always filter by workspace ID
- No API endpoint accepts workspaceId parameter that differs from session's active workspace
- Automated tests verify workspace isolation

**Evidence:** See `docs/12_WORKSPACE_ISOLATION_GUARANTEES.md` - Isolation Verification section.

**Slides API Integration Incomplete**

**Risk:** Google Slides API integration is not fully implemented by 07.01.

**Impact:** Low - Slides features may be limited, but other features are complete.

**Probability:** Medium - Slides API integration needs completion.

**Mitigation:**
- Slides API structure exists, needs implementation
- Can defer full Slides features if needed (read-only is acceptable for MVP)
- Other Google Workspace services (Calendar, Tasks, Email, Drive) are complete

**Evidence:** See `docs/10_MVP_FEATURE_TO_CODE_MAP.md` - Docs / Slides Handling section.

### Operational Risks

**Deployment Issues**

**Risk:** Production deployment fails or causes downtime.

**Impact:** High - Users cannot access the system.

**Probability:** Low - Cloudflare Workers and Pages deployments are reliable.

**Mitigation:**
- Staging environment for testing before production
- Gradual rollout (deploy to staging first, verify, then production)
- Rollback plan (previous version can be redeployed)
- Monitoring and alerting for production issues

**User Onboarding Complexity**

**Risk:** Users find OAuth setup confusing or time-consuming.

**Impact:** Medium - Users may abandon setup, reducing adoption.

**Probability:** Low - OAuth flow is standard and well-documented.

**Mitigation:**
- Clear instructions in UI
- OAuth consent screen explains permissions
- Setup can be completed in under 5 minutes
- Support documentation available

**Evidence:** See `docs/07_MVP_SCOPE_AND_NON_NEGOTIABLES.md` - Manual Setup by Customer section.

**Frontend-Backend Integration Issues**

**Risk:** Frontend modules fail to connect to backend APIs correctly.

**Impact:** Medium - Features may not work in UI even though backend is functional.

**Probability:** Medium - UI integration requires careful testing.

**Mitigation:**
- Frontend modules exist and have defined API integration points
- API endpoints are stable and well-documented
- End-to-end testing before deployment
- Error handling in frontend for API failures

**Evidence:** See `docs/10_MVP_FEATURE_TO_CODE_MAP.md` - Frontend modules section.

### Mitigations Summary

**High-Impact Risks:**
- OAuth token refresh failures: Mitigated with automatic refresh and graceful error handling
- Deployment issues: Mitigated with staging environment and rollback plan

**Medium-Impact Risks:**
- Google API rate limits: Mitigated with rate limit handling and monitoring
- User onboarding complexity: Mitigated with clear instructions and documentation
- Frontend-backend integration issues: Mitigated with existing modules and testing

**Low-Impact Risks:**
- Slides API integration incomplete: Acceptable for MVP, can be completed post-MVP

**Conclusion:** Risks are manageable and mitigated. No critical blockers identified for 07.01 delivery.

## Open Questions

- Should MVP include Microsoft 365 integration, or focus on Google Workspace only?
- What is the minimum viable set of Google Workspace services (can we exclude some services)?
- Should MVP include delete operations, or start with read/write only?
- What is the recommended approach for customers who want to integrate both Google and Microsoft?
- How should MVP handle OAuth token expiration and re-authentication flows?
- Should structured audit logging be implemented for MVP, or is console logging sufficient?
- What is the recommended UI/UX pattern for workspace switching in the frontend?
- Should MVP include real-time updates (webhooks), or is polling sufficient?
- How should workspace deletion cascade to OAuth tokens and connections (should tokens be deleted immediately or after a grace period)?
- What is the recommended session expiration duration for production (currently configurable via `SESSION_MAX_AGE_SECONDS`)?

