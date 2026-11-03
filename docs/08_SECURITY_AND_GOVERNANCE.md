# Security and Governance

## Workspace Isolation Guarantees

### Architectural Isolation

Workspace isolation is enforced at the infrastructure level, not through configuration:

1. **Token Storage:**
   - OAuth tokens stored in KV with workspace-scoped keys: `google_tokens:<userId>:<workspaceId>`
   - Tokens cannot be accessed without workspace context
   - Cross-workspace token access is architecturally impossible

2. **Data Access:**
   - API operations require workspace context
   - Workspace context is validated before data access
   - Data access is scoped to workspace OAuth tokens

3. **Database Records:**
   - Workspace connections stored in D1 with workspace ID
   - Database queries filtered by workspace ID
   - Cross-workspace database access requires explicit permission

4. **MERLIN Context:**
   - MERLIN filters outputs based on active workspace
   - MERLIN cannot access data from other workspaces without permission
   - MERLIN maintains workspace boundaries in all operations

### Isolation Verification

**Token Isolation:**
- Tokens stored with workspace-scoped keys
- Token lookup requires workspace ID
- Token access logs include workspace ID

**Data Isolation:**
- Calendar events accessed via workspace-scoped tokens
- Email threads accessed via workspace-scoped tokens
- Tasks stored with workspace ID
- Documents accessed via workspace-scoped tokens

**API Isolation:**
- API endpoints require workspace context
- Workspace context validated on every request
- API responses filtered by workspace context

## Token Scoping Principles

### No Global Tokens

**Principle:** All OAuth tokens are workspace-scoped. There are no global tokens, no shared tokens, no platform-level tokens.

**Implementation:**
- Token storage keys include workspace ID: `google_tokens:<userId>:<workspaceId>`
- Token lookup requires workspace ID
- Token refresh maintains workspace scoping

**Rationale:**
- Global tokens violate workspace isolation
- Shared tokens create security vulnerabilities
- Platform-level tokens create single points of failure

### No Shared State

**Principle:** Workspaces do not share state. Each workspace maintains independent OAuth connections, independent data, independent configuration.

**Implementation:**
- Workspace connections stored per workspace
- OAuth tokens stored per workspace
- Workspace configuration stored per workspace

**Rationale:**
- Shared state violates workspace isolation
- Shared state creates security vulnerabilities
- Shared state creates operational complexity

### Token Refresh Scoping

**Principle:** Token refresh maintains workspace scoping. Refreshed tokens are stored with the same workspace-scoped key.

**Implementation:**
- Token refresh uses workspace-scoped refresh token
- Refreshed tokens stored with workspace-scoped key
- Token refresh logs include workspace ID

**Rationale:**
- Token refresh must maintain isolation
- Refreshed tokens must remain workspace-scoped
- Token refresh must be auditable per workspace

## Auditability

### What Is Logged

**OAuth Operations:**
- OAuth flow initiation (workspace ID, user ID, timestamp)
- OAuth callback (workspace ID, user ID, timestamp, success/failure)
- Token refresh (workspace ID, user ID, timestamp, success/failure)
- Token deletion (workspace ID, user ID, timestamp)

**API Operations:**
- API request (endpoint, workspace ID, user ID, timestamp)
- API response (status code, workspace ID, user ID, timestamp)
- API errors (error message, workspace ID, user ID, timestamp)

**Cross-Workspace Access:**
- Permission grant (source workspace, target workspace, user ID, timestamp)
- Permission revocation (source workspace, target workspace, user ID, timestamp)
- Cross-workspace data access (source workspace, target workspace, access type, user ID, timestamp)

**Data Operations:**
- Calendar event creation (workspace ID, user ID, event ID, timestamp)
- Calendar event update (workspace ID, user ID, event ID, timestamp)
- Calendar event deletion (workspace ID, user ID, event ID, timestamp, confirmation)
- Email send (workspace ID, user ID, recipient, timestamp)
- Task creation (workspace ID, user ID, task ID, timestamp)
- Task update (workspace ID, user ID, task ID, timestamp)
- Task deletion (workspace ID, user ID, task ID, timestamp, confirmation)
- Document modification (workspace ID, user ID, document ID, timestamp)

### What Is Never Logged

**Sensitive Data:**
- OAuth tokens (access tokens, refresh tokens)
- Email content (body, attachments)
- Document content (body, attachments)
- User passwords (not applicable, OAuth only)

**Rationale:**
- Sensitive data should not be logged
- Logs should enable auditability without exposing sensitive data
- Logs should be sufficient for compliance without storing sensitive data

### Log Storage

**Log Format:**
- Structured JSON logs
- Timestamp (ISO 8601)
- Workspace ID
- User ID
- Operation type
- Operation details (non-sensitive)

**Log Retention:**
- Logs retained for compliance period (configurable, default 90 days)
- Logs stored in Cloudflare Workers logs
- Logs can be exported for external audit systems

**Log Access:**
- Logs accessible to platform operators
- Logs accessible to workspace operators (workspace-scoped logs only)
- Logs accessible to holding operators (all logs)

## Deletion with Confirmation

### Principle

All delete operations require explicit confirmation. Deletion cannot be accidental, cannot be automated without confirmation, cannot be reversed without audit trail.

### Implementation

**Frontend Confirmation:**
- Delete operations prompt user for confirmation
- Confirmation includes what will be deleted
- Confirmation requires explicit user action (click, not just page load)

**API Confirmation:**
- Delete endpoints require `confirm: true` parameter
- Delete endpoints validate confirmation parameter
- Delete endpoints return error if confirmation missing

**Audit Trail:**
- All deletes logged with confirmation timestamp
- Delete logs include user ID, workspace ID, what was deleted
- Delete logs are permanent (not deleted with data)

### Rationale

1. **Data Protection:**
   - Prevents accidental deletion
   - Prevents malicious deletion
   - Enables recovery (if data is recoverable from provider)

2. **Compliance:**
   - Deletion confirmation required for GDPR compliance
   - Deletion audit trail required for SOC 2 compliance
   - Deletion logs required for enterprise security reviews

3. **User Trust:**
   - Users trust system with important data (calendar, email, documents)
   - Deletion confirmation builds user trust
   - Deletion audit trail enables user verification

## Enterprise Security Review

### Why This System Can Pass Enterprise Security Review

1. **Workspace Isolation:**
   - Isolation is architectural, not configurational
   - Isolation can be verified through code review
   - Isolation can be tested through security testing

2. **Token Scoping:**
   - Tokens are workspace-scoped (no global tokens)
   - Token scoping can be verified through code review
   - Token scoping can be tested through security testing

3. **Auditability:**
   - All operations are logged (non-sensitive data)
   - Logs are structured and queryable
   - Logs can be exported for external audit systems

4. **Deletion Confirmation:**
   - Deletion requires explicit confirmation
   - Deletion is auditable
   - Deletion can be verified through code review

5. **OAuth Security:**
   - OAuth flows follow industry best practices
   - OAuth tokens are stored securely (KV, encrypted at rest)
   - OAuth token refresh is automatic and secure

6. **No Secrets in Code:**
   - Secrets stored in Cloudflare Workers secrets
   - Secrets never committed to git
   - Secrets can be rotated without code changes

### Security Review Checklist

**Workspace Isolation:**
- [ ] Workspace isolation is architectural (not configurational)
- [ ] Workspace isolation can be verified through code review
- [ ] Workspace isolation can be tested through security testing

**Token Scoping:**
- [ ] All tokens are workspace-scoped
- [ ] No global tokens exist
- [ ] Token scoping can be verified through code review

**Auditability:**
- [ ] All operations are logged (non-sensitive data)
- [ ] Logs are structured and queryable
- [ ] Logs can be exported for external audit systems

**Deletion Confirmation:**
- [ ] Deletion requires explicit confirmation
- [ ] Deletion is auditable
- [ ] Deletion can be verified through code review

**OAuth Security:**
- [ ] OAuth flows follow industry best practices
- [ ] OAuth tokens are stored securely
- [ ] OAuth token refresh is automatic and secure

**Secret Management:**
- [ ] Secrets stored in secure storage (Cloudflare Workers secrets)
- [ ] Secrets never committed to git
- [ ] Secrets can be rotated without code changes

## Compliance Considerations

### GDPR

**Data Minimization:**
- Only necessary data is collected (OAuth tokens, workspace configuration)
- Data is scoped to workspace (no cross-workspace data collection)
- Data can be deleted (workspace deletion, OAuth revocation)

**Right to Access:**
- Users can access their data (workspace data, OAuth connections)
- Data access is workspace-scoped
- Data access is auditable

**Right to Deletion:**
- Users can delete their data (workspace deletion, OAuth revocation)
- Deletion requires confirmation
- Deletion is auditable

### SOC 2

**Access Control:**
- Workspace isolation enforces access control
- Cross-workspace access requires explicit permission
- Access control is auditable

**Data Protection:**
- Data is encrypted at rest (KV, D1)
- Data is encrypted in transit (HTTPS)
- Data is workspace-scoped (isolation)

**Audit Trail:**
- All operations are logged
- Logs are structured and queryable
- Logs can be exported for external audit systems

## Open Questions

- What is the recommended log retention period for compliance (GDPR, SOC 2)?
- Should logs be stored in external systems (Splunk, Datadog) for enterprise customers?
- How should workspace deletion cascade to OAuth tokens and connection records?
- What is the recommended approach for handling OAuth token expiration if refresh fails?
- Should the system support IP whitelisting for enterprise customers?
- How should the system handle security incidents (data breach, unauthorized access)?

