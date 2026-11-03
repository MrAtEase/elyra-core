# Repository Boundaries

## Repository Structure

### mira-stack

**Purpose:** Platform infrastructure and shared runtime components.

**Contains:**
- `worker/` - Cloudflare Worker API gateway (deployed to `api.elyra-core.app`)
- `mira-os/` - Core OS engines, runners, integrations
- `merlin/` - Reasoning engines and cognitive architecture
- `email-provider/` - Provider adapters (Gmail, Outlook, Local)
- `docs/` - Platform documentation
- `scripts/` - Deployment and verification scripts

**What Belongs Here:**
- Platform-level code used by all workspaces
- OAuth integration backbone (Google, Microsoft)
- MERLIN assistant logic
- Database schemas and migrations
- Shared utilities and abstractions
- Platform documentation

**What Does NOT Belong Here:**
- Customer-specific frontend code
- Customer-specific marketing sites
- Customer-specific configuration
- Customer secrets or API keys
- Workspace-specific business logic

### fish-delish

**Purpose:** Customer workspace repository for Fish-Delish.

**Contains:**
- `app/` - Frontend shell (deployed to `app.elyra-core.app`)
- `marketing/` - Marketing site (planned for `elyra-core.app`)
- Customer-specific configuration
- Customer-specific branding assets

**What Belongs Here:**
- Customer frontend application
- Customer marketing website
- Customer-specific UI components
- Customer branding (colors, logos, themes)
- Customer-specific configuration (non-secret)

**What Does NOT Belong Here:**
- Platform infrastructure code
- MERLIN core logic
- OAuth integration code
- Database migrations
- Shared utilities used by other customers

## Separation Rationale

### Why Customer Repos Are Separate

1. **Isolation:**
   - Customer code changes do not affect other customers
   - Each customer can have independent deployment cycles
   - Customer-specific bugs are contained

2. **Security:**
   - Customer repos can have restricted access
   - Customer-specific secrets stay in customer repos (if needed)
   - Platform secrets never exposed to customer repos

3. **Scalability:**
   - New customers can be onboarded without touching platform code
   - Customer teams can work independently
   - Platform updates can be tested without customer code changes

4. **Customization:**
   - Customers can customize frontend without platform constraints
   - Customer-specific features don't bloat platform codebase
   - Marketing sites can evolve independently

### Platform vs Customer Code

**Platform Code (mira-stack):**
- Used by multiple customers
- Generic, configurable, workspace-aware
- Examples: OAuth flows, MERLIN engines, calendar API, email providers

**Customer Code (fish-delish):**
- Specific to one customer
- Custom UI, branding, workflows
- Examples: Fish-Delish frontend, marketing pages, customer-specific features

## No Secrets in Git Policy

### What Constitutes a Secret

**Secrets (Never Commit):**
- OAuth client secrets (`GOOGLE_CLIENT_SECRET`, `MICROSOFT_CLIENT_SECRET`)
- API keys (`OPENAI_API_KEY`, third-party API keys)
- Database connection strings with passwords
- Session signing keys
- Private keys or certificates
- Customer-specific API tokens

**Non-Secrets (Can Commit):**
- OAuth client IDs (public identifiers)
- Configuration file templates (`.example` files)
- Default values and placeholders
- Public API endpoints
- Documentation with example values (marked as examples)

### Secret Management

**mira-stack (Platform):**
- Secrets stored in Cloudflare Workers secrets (via Dashboard or `wrangler secret put`)
- Local development uses `worker/.dev.vars` (git-ignored)
- Never commit `.dev.vars` or actual secret values

**fish-delish (Customer):**
- Customer-specific secrets (if any) stored in Cloudflare Pages environment variables
- Or use platform secrets if customer uses platform OAuth apps
- Never commit customer API keys or tokens

### Verification

**Pre-Commit Checks:**
- Review `git diff` for secret patterns before committing
- Use `.gitignore` to exclude secret files (`.dev.vars`, `*.key`, `*.pem`)
- Scan for common secret patterns in code reviews

**Example Secret Patterns to Avoid:**
```
GOOGLE_CLIENT_SECRET=...
MICROSOFT_CLIENT_SECRET=...
OPENAI_API_KEY=sk-...
password=...
secret=...
api_key=...
```

## Code Sharing Patterns

### When to Extract to Platform

**Extract if:**
- Code is used by multiple customers
- Code provides generic functionality (OAuth, API clients, utilities)
- Code implements platform features (MERLIN, workspace management)
- Code is infrastructure-related (database, storage, auth)

**Keep in Customer Repo if:**
- Code is customer-specific UI or branding
- Code implements customer-specific business logic
- Code is marketing or content-related
- Code is experimental and not ready for platform

### Shared Dependencies

**Platform Provides:**
- API endpoints (`/assistant/*`)
- OAuth integration
- Workspace management
- MERLIN intelligence

**Customer Consumes:**
- Calls platform API endpoints
- Uses platform OAuth flows
- Configures workspace settings
- Integrates MERLIN client

## Migration Guidelines

### Moving Code from Customer to Platform

1. **Identify Generic Use Case:**
   - Code solves problem for multiple customers
   - Code is infrastructure-related
   - Code provides reusable functionality

2. **Extract and Generalize:**
   - Remove customer-specific hardcoding
   - Add workspace/configuration parameters
   - Make code workspace-aware

3. **Update Customer Repo:**
   - Remove extracted code
   - Update to use platform API/utilities
   - Test integration with platform changes

4. **Document:**
   - Update platform docs with new functionality
   - Update customer docs with migration notes

### Moving Code from Platform to Customer

1. **Identify Customer-Specific Use Case:**
   - Code only used by one customer
   - Code is customer-specific business logic
   - Code is experimental or not ready for platform

2. **Copy and Customize:**
   - Copy code to customer repo
   - Customize for customer needs
   - Remove from platform (or mark as deprecated)

3. **Update Dependencies:**
   - Ensure customer code can work independently
   - Update imports/references
   - Test customer-specific implementation

## Legacy Code Locations

### Legacy Directories (Do Not Use)

**mira-stack/mira-app/:**
- ❌ Legacy frontend code
- ✅ Use `fish-delish/app/` instead
- Status: Historical artifact, can be archived

**mira-stack/fish-delish-site/:**
- ❌ Legacy marketing site
- ✅ Use `fish-delish/marketing/` instead
- Status: Historical artifact, can be archived

### Active Directories

**mira-stack/worker/:**
- ✅ Active - Deployed to `api.elyra-core.app`
- Contains: API gateway, OAuth flows, MERLIN endpoints

**mira-stack/mira-os/:**
- ✅ Active - Used by Worker at runtime
- Contains: Core OS engines, integrations

**fish-delish/app/:**
- ✅ Active - Deployed to `app.elyra-core.app`
- Contains: Frontend shell, MERLIN client

## Repository Access

### mira-stack Access

**Who Has Access:**
- Platform developers
- Infrastructure team
- MERLIN/AI team

**What They Can Do:**
- Modify platform code
- Deploy Worker updates
- Manage OAuth integrations
- Update database schemas

### fish-delish Access

**Who Has Access:**
- Customer team (Fish-Delish)
- Frontend developers
- Marketing team

**What They Can Do:**
- Modify customer frontend
- Deploy marketing site
- Customize customer branding
- Configure customer-specific features

## Open Questions

- Should there be a shared library/package for common frontend utilities (if multiple customers need same code)?
- How should customer-specific platform features be handled (feature flags, customer config)?
- What is the process for customers to request platform features?
- Should customer repos have read-only access to platform code for reference?
- How should platform breaking changes be communicated to customer repos?
- What is the versioning strategy for platform API contracts?

