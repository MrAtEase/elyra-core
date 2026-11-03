# MVP Scope and Non-Negotiables

## MVP Must-Haves

### Core Platform

1. **Workspace Management:**
   - Workspace creation and configuration
   - Workspace-scoped OAuth token storage
   - Workspace-scoped data access
   - Cross-workspace permission model

2. **OAuth Integration:**
   - Google OAuth flow (initiation, callback, token storage, refresh)
   - Microsoft OAuth flow (initiation, callback, token storage, refresh)
   - Workspace-scoped token storage in KV
   - Automatic token refresh

3. **MERLIN Orchestration:**
   - MERLIN Brain v1 (core reasoning)
   - Workspace-aware context observation
   - Cross-service orchestration (calendar, email, tasks, documents)
   - Workspace boundary enforcement

4. **API Gateway:**
   - `/assistant/*` endpoints (auth-protected)
   - `/assistant/oauth/*` endpoints (OAuth flows)
   - `/assistant/calendar/*` endpoints (CRUD operations)
   - `/assistant/tasks/*` endpoints (task management)
   - `/assistant/email/*` endpoints (email operations)
   - `/assistant/integrations/*` endpoints (integration management)

### Google Workspace Integration

**Why Google Workspace is Non-Negotiable:**

1. **Market Dominance:**
   - Google Workspace has the largest market share in SMB and mid-market
   - Franchises and multi-location businesses predominantly use Google Workspace
   - Enterprise customers often use Google Workspace alongside Microsoft 365

2. **API Maturity:**
   - Google Calendar API is mature and stable
   - Gmail API provides comprehensive email access
   - Google Drive API enables document operations
   - Google Docs and Slides APIs enable content creation

3. **OAuth Reliability:**
   - Google OAuth 2.0 is well-documented and stable
   - Token refresh is reliable and well-supported
   - Scope management is clear and granular

4. **Integration Depth:**
   - Google Workspace APIs support read/write/delete operations
   - APIs support batch operations for efficiency
   - Webhooks are available for real-time updates

**Required Google Workspace Services:**

- **Gmail:** Read emails, send emails
- **Calendar:** Read events, create events, update events, delete events
- **Tasks:** Read tasks, create tasks, update tasks, delete tasks
- **Drive:** Read files, create files, update files, delete files
- **Docs:** Read documents, create documents, update documents
- **Slides:** Read presentations, create presentations, update presentations

### Read/Write/Delete Operations

**Why Read/Write/Delete is Required:**

1. **Business Operations:**
   - Businesses need to create calendar events (not just read them)
   - Businesses need to send emails (not just read them)
   - Businesses need to update tasks (not just read them)
   - Businesses need to modify documents (not just read them)

2. **MERLIN Orchestration:**
   - MERLIN must be able to execute operations, not just observe
   - Orchestration requires write access to coordinate across services
   - Automation requires delete access to clean up completed tasks

3. **Enterprise Requirements:**
   - Enterprise customers require full CRUD operations
   - Read-only access is insufficient for business operations
   - Write access is required for automation and orchestration

**Delete with Confirmation:**

All delete operations require explicit confirmation:

- **User Confirmation:** Frontend prompts user before delete
- **API Confirmation:** Delete endpoints require confirmation parameter
- **Audit Trail:** All deletes are logged with user ID, timestamp, workspace ID

### Manual Setup by Customer

**Why Manual Setup is a Feature, Not a Weakness:**

1. **Enterprise Readiness:**
   - Enterprise customers require control over OAuth consent
   - Manual setup ensures customers understand what permissions are granted
   - Manual setup enables customer IT teams to review and approve

2. **Security:**
   - Manual setup prevents unauthorized access
   - Customers explicitly grant permissions (not automatic)
   - OAuth consent screen provides transparency

3. **Compliance:**
   - Manual setup enables compliance review (GDPR, SOC 2, etc.)
   - Customers can document what permissions are granted
   - Audit trail starts with customer-initiated OAuth flow

4. **Flexibility:**
   - Customers can choose which services to integrate (not all-or-nothing)
   - Customers can revoke permissions independently
   - Customers can re-authenticate if tokens expire

**Setup Process:**

1. Customer visits brand frontend (app.elyra-core.app)
2. Customer initiates OAuth flow (`/assistant/oauth/google/start?workspaceId=...`)
3. Customer reviews OAuth consent screen (Google/Microsoft)
4. Customer grants permissions
5. Tokens stored in workspace-scoped KV keys
6. Workspace connection created in D1 database
7. Customer can now use MERLIN-powered features

## Out of Scope (MVP)

### Not Included in MVP

1. **Mobile Applications:**
   - No native iOS or Android apps
   - Web application is mobile-responsive
   - Future: Mobile apps may be added post-MVP

2. **Third-Party Integrations (Beyond Google/Microsoft):**
   - No Slack integration
   - No Salesforce integration
   - No HubSpot integration
   - No custom API integrations
   - Future: Third-party integrations may be added post-MVP

3. **Advanced Analytics:**
   - No custom dashboards
   - No advanced reporting
   - No predictive analytics
   - Basic insights available through MERLIN
   - Future: Advanced analytics may be added post-MVP

4. **Multi-Language Support:**
   - English only
   - No internationalization
   - Future: Multi-language support may be added post-MVP

5. **White-Label Platform:**
   - No white-label licensing to third parties
   - No platform-as-a-service offering
   - Future: White-label licensing may be added post-MVP

6. **Advanced Permissions:**
   - Basic workspace roles (operator, viewer)
   - No custom role definitions
   - No fine-grained permissions
   - Future: Advanced permissions may be added post-MVP

7. **Real-Time Collaboration:**
   - No real-time document collaboration
   - No real-time calendar synchronization
   - No real-time task updates
   - Future: Real-time features may be added post-MVP

8. **Advanced Automation:**
   - No custom automation workflows
   - No visual workflow builder
   - No scheduled automation
   - MERLIN orchestration provides basic automation
   - Future: Advanced automation may be added post-MVP

9. **Data Export/Import:**
   - No bulk data export
   - No bulk data import
   - No migration tools
   - Future: Data export/import may be added post-MVP

10. **Advanced Security:**
    - No SSO (Single Sign-On)
    - No MFA (Multi-Factor Authentication)
    - No IP whitelisting
    - Basic OAuth authentication
    - Future: Advanced security may be added post-MVP

### Why These Are Out of Scope

1. **Focus:**
   - MVP focuses on core orchestration and workspace management
   - Additional features can be added post-MVP based on customer feedback

2. **Complexity:**
   - Advanced features require significant development effort
   - MVP prioritizes core functionality over advanced features

3. **Market Validation:**
   - MVP validates core value proposition
   - Advanced features can be added after market validation

4. **Resource Constraints:**
   - MVP must be deliverable with available resources
   - Advanced features require additional resources

## MVP Success Criteria

### Technical Criteria

1. **Workspace Isolation:**
   - Workspaces are fully isolated (data, tokens, permissions)
   - Cross-workspace access requires explicit permission
   - No data leakage between workspaces

2. **OAuth Reliability:**
   - OAuth flows work reliably (Google, Microsoft)
   - Token refresh works automatically
   - Token storage is workspace-scoped

3. **MERLIN Orchestration:**
   - MERLIN observes workspace context
   - MERLIN orchestrates operations across services
   - MERLIN maintains workspace boundaries

4. **API Stability:**
   - API endpoints are stable and well-documented
   - API responses are consistent
   - API errors are handled gracefully

### Business Criteria

1. **Customer Onboarding:**
   - Customers can complete OAuth setup in under 5 minutes
   - Customers understand what permissions are granted
   - Customers can use MERLIN-powered features immediately after setup

2. **Workspace Operations:**
   - Customers can create and manage workspaces
   - Customers can grant cross-workspace permissions
   - Customers can revoke permissions independently

3. **Business Operations:**
   - Customers can create calendar events
   - Customers can send emails
   - Customers can manage tasks
   - Customers can modify documents

## Open Questions

- Should MVP include Microsoft 365 integration, or focus on Google Workspace only?
- What is the minimum viable set of Google Workspace services (can we exclude some services)?
- Should MVP include delete operations, or start with read/write only?
- What is the recommended approach for customers who want to integrate both Google and Microsoft?
- How should MVP handle OAuth token expiration and re-authentication flows?

