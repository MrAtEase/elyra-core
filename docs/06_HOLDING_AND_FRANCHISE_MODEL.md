# Holding and Franchise Model

## Holding Structure

### MIRA OS Holding

**Purpose:** Intellectual property, AI platform, and shared infrastructure.

**Contains:**
- MIRA OS platform code (`mira-stack` repository)
- MERLIN reasoning engines
- OAuth integration backbone (Google, Microsoft)
- Workspace management infrastructure
- Platform documentation

**Ownership:**
- Platform IP
- AI/ML models and reasoning engines
- Integration contracts with service providers
- Platform-level secrets and configuration

**Revenue Model:**
- Platform licensing to operating companies
- Infrastructure usage fees
- Future: white-label licensing to third parties

### Operating Companies

**Purpose:** Customer-facing brands and business operations.

**Examples:**
- Fish Delish (first operating company)
- Future brands (restaurant chains, retail, services)

**Contains:**
- Brand-specific frontend (`fish-delish/app/`)
- Brand-specific marketing site (`fish-delish/marketing/`)
- Brand-specific configuration
- Brand-specific branding assets

**Ownership:**
- Brand IP and trademarks
- Customer relationships
- Brand-specific data
- Brand-specific secrets (if any)

**Revenue Model:**
- Customer subscriptions
- Transaction fees
- Brand-specific revenue streams

## Repository-Level Isolation

### Why Brands Are Isolated at the Repo Level

1. **Code Isolation:**
   - Brand-specific code changes do not affect other brands
   - Each brand can have independent deployment cycles
   - Brand-specific bugs are contained to the brand repository

2. **Security:**
   - Brand repositories can have restricted access
   - Brand-specific secrets stay in brand repositories
   - Platform secrets never exposed to brand repositories

3. **Scalability:**
   - New brands are new repositories, not new infrastructure
   - Brand teams can work independently
   - Platform updates can be tested without brand code changes

4. **Customization:**
   - Brands can customize frontend without platform constraints
   - Brand-specific features don't bloat platform codebase
   - Marketing sites can evolve independently

### Repository Structure

```
mira-stack/                    (Holding - Platform)
├── worker/                    (API gateway)
├── mira-os/                   (Core OS engines)
├── merlin/                    (Reasoning engines)
├── email-provider/            (Provider adapters)
└── docs/                      (Platform documentation)

fish-delish/                   (Operating Company - Brand)
├── app/                       (Frontend shell)
└── marketing/                 (Marketing site)

future-brand/                  (Operating Company - Brand)
├── app/                       (Frontend shell)
└── marketing/                 (Marketing site)
```

## Franchise Mapping

### Franchise Structure

Franchises map to the MIRA OS architecture as follows:

```
Holding
└── Operating Company (Brand)
    └── Franchise Locations
        └── Workspaces
```

### Location to Workspace Mapping

Each franchise location is a workspace:

- **Workspace ID:** `ws-<brand>-<location-id>`
- **Workspace Type:** Customer workspace
- **OAuth Tokens:** Scoped to workspace (`google_tokens:<userId>:<workspaceId>`)
- **Data Boundaries:** Location-specific calendar, email, tasks, documents

### Brand Workspace

The brand itself is also a workspace:

- **Workspace ID:** `ws-<brand>-brand`
- **Workspace Type:** Customer workspace
- **Purpose:** Brand-level operations, shared documents, brand intelligence
- **Access:** Brand operators, holding company (with permission)

### Holding Workspace

The holding company is a workspace:

- **Workspace ID:** `ws-mira-os-platform`
- **Workspace Type:** Platform workspace
- **Purpose:** Platform operations, shared tooling, cross-brand insights
- **Access:** Platform operators, holding company operators

## Roles and Permissions

### Workspace Roles

**Location Operator:**
- Full access to location workspace
- Can create, read, update, delete location data
- Cannot access other location workspaces
- Cannot access brand workspace (unless granted)

**Brand Operator:**
- Full access to brand workspace
- Read-only access to location workspaces (with permission)
- Can aggregate insights across locations
- Cannot access other brand workspaces

**Holding Operator:**
- Full access to platform workspace
- Read-only access to brand workspaces (with permission)
- Can aggregate insights across brands
- Cannot access location workspaces (unless granted)

### Permission Model

Permissions are workspace-scoped:

1. **Workspace Membership:**
   - User is a member of a workspace
   - Membership grants default permissions (read/write based on role)

2. **Cross-Workspace Access:**
   - Requires explicit permission
   - Permission is workspace-to-workspace (not user-to-workspace)
   - Permission can be read-only or read-write

3. **Permission Inheritance:**
   - Brand operators inherit read-only access to location workspaces (configurable)
   - Holding operators inherit read-only access to brand workspaces (configurable)
   - Inheritance can be overridden per workspace

## Data Boundaries

### Workspace Data Isolation

Each workspace maintains:

- **OAuth Tokens:** Stored in KV with workspace-scoped keys
- **Calendar Events:** Scoped to workspace OAuth tokens
- **Email Threads:** Scoped to workspace OAuth tokens
- **Tasks:** Stored in workspace-scoped database records
- **Documents:** Scoped to workspace OAuth tokens (Drive, Docs, Slides)

### Cross-Workspace Data Access

Cross-workspace access requires:

1. **Explicit Permission:**
   - Source workspace grants permission to target workspace
   - Permission specifies access level (read-only, read-write)

2. **MERLIN Orchestration:**
   - MERLIN observes cross-workspace permissions
   - MERLIN filters outputs based on active workspace and permissions
   - MERLIN aggregates insights when permitted

3. **Audit Trail:**
   - All cross-workspace access is logged
   - Logs include source workspace, target workspace, access type, timestamp

### Data Portability

Workspace data is portable:

- OAuth tokens can be exported (encrypted)
- Calendar events can be exported (iCal format)
- Email threads can be exported (MIME format)
- Tasks can be exported (JSON format)
- Documents remain in provider storage (Google Drive, OneDrive)

## Franchise Operations

### Location Onboarding

1. **Workspace Creation:**
   - Create workspace: `ws-<brand>-<location-id>`
   - Assign location operator role
   - Configure location-specific settings

2. **OAuth Setup:**
   - Location operator initiates OAuth flow
   - Grants permissions (calendar, email, tasks, drive)
   - Tokens stored in workspace-scoped KV keys

3. **Brand Integration:**
   - Brand workspace grants read-only access to location workspace
   - Brand operators can view location data (with permission)
   - Location operators cannot access brand workspace (unless granted)

### Location Operations

- **Location Calendar:** Managed in location workspace
- **Location Email:** Managed in location workspace
- **Location Tasks:** Managed in location workspace
- **Location Documents:** Managed in location workspace (Drive)

### Brand Operations

- **Brand Calendar:** Managed in brand workspace
- **Brand Email:** Managed in brand workspace
- **Brand Tasks:** Managed in brand workspace
- **Brand Documents:** Managed in brand workspace (Drive)
- **Cross-Location Insights:** Aggregated from location workspaces (with permission)

### Holding Operations

- **Platform Calendar:** Managed in platform workspace
- **Platform Email:** Managed in platform workspace
- **Platform Tasks:** Managed in platform workspace
- **Platform Documents:** Managed in platform workspace (Drive)
- **Cross-Brand Insights:** Aggregated from brand workspaces (with permission)

## ASCII Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    MIRA OS Holding                           │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  Platform Infrastructure (mira-stack repo)            │  │
│  │  - MERLIN engines                                      │  │
│  │  - OAuth integrations                                  │  │
│  │  - Workspace management                                │  │
│  └────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                            │
                            │ Powers
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
        ▼                   ▼                   ▼
┌───────────────┐  ┌───────────────┐  ┌───────────────┐
│ Fish Delish   │  │ Future Brand  │  │ Future Brand  │
│ (Operating    │  │ (Operating    │  │ (Operating    │
│  Company)     │  │  Company)     │  │  Company)     │
└───────┬───────┘  └───────┬───────┘  └───────┬───────┘
        │                   │                   │
        │ Workspaces        │ Workspaces        │ Workspaces
        │                   │                   │
        ▼                   ▼                   ▼
┌───────────────┐  ┌───────────────┐  ┌───────────────┐
│ Location 1    │  │ Location 1    │  │ Location 1    │
│ (Workspace)   │  │ (Workspace)   │  │ (Workspace)   │
├───────────────┤  ├───────────────┤  ├───────────────┤
│ Location 2    │  │ Location 2    │  │ Location 2    │
│ (Workspace)   │  │ (Workspace)   │  │ (Workspace)   │
├───────────────┤  ├───────────────┤  ├───────────────┤
│ Brand         │  │ Brand         │  │ Brand         │
│ (Workspace)   │  │ (Workspace)   │  │ (Workspace)   │
└───────────────┘  └───────────────┘  └───────────────┘
```

## Open Questions

- How should franchise fees be structured (per-location workspace fees, revenue share)?
- What is the recommended approach for brands that want to white-label MIRA OS to their own customers?
- Should brand workspaces have automatic read-only access to location workspaces, or should this be opt-in?
- How should holding company access to brand workspaces be governed (automatic, opt-in, audit requirements)?
- What is the migration path for franchises that want to become independent operating companies?

