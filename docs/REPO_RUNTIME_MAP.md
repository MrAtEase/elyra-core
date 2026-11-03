# Repository Runtime Map - mira-stack

## Deploy Surface Map

| Domain | Repo | Path | Build/Deploy Method | Status |
|--------|------|------|---------------------|--------|
| `api.elyra-core.app` | `mira-stack` | `worker/` | Cloudflare Workers (`wrangler deploy`) | ✅ Active |
| `app.elyra-core.app` | `fish-delish` | `app/` | Cloudflare Pages (static) | ✅ Active |
| `elyra-core.app` | `fish-delish` | `marketing/` | Cloudflare Pages (static) | ⏳ Planned |

## Source of Truth - Deployed Surfaces

### 1. Worker/API (`api.elyra-core.app`)

**Source Directory:** `mira-stack/worker/`

**Entry Point:** `worker/src/index.ts`

**Routes:**
- `/assistant/*` - Main assistant API endpoints (auth-protected)
- `/assistant/oauth/google/*` - Google OAuth flow
- `/assistant/oauth/microsoft/*` - Microsoft OAuth flow
- `/assistant/calendar/*` - Calendar CRUD operations
- `/assistant/tasks/*` - Tasks management
- `/assistant/email/*` - Email operations
- `/assistant/integrations/*` - Integration management
- `/email/*` - Legacy email endpoints (maintained for compatibility)

**Deployment:**
- Command: `cd worker && npx wrangler deploy`
- Config: `worker/wrangler.toml`
- Environment: Cloudflare Workers
- Database: D1 (`ASSISTANT_DB`)
- Storage: KV (`ASSISTANT_KV`)

**Build Artifacts:**
- Compiled TypeScript → JavaScript in `worker/dist/` (git-ignored)
- No static assets deployed

### 2. App Shell (`app.elyra-core.app`)

**Source Directory:** `fish-delish/app/` (NOT `mira-stack/mira-app/`)

**Entry Point:** `fish-delish/app/index.html`

**Deployment:**
- Repo: `fish-delish` (separate repository)
- Method: Cloudflare Pages (static site)
- Project: `fish-delish-app`
- Build: No build step required (static HTML/CSS/JS)

**Note:** The `mira-stack/mira-app/` directory is **legacy/unused** and should NOT be deployed.

### 3. Marketing Site (`elyra-core.app`)

**Source Directory:** `fish-delish/marketing/` (currently empty)

**Status:** Planned, not yet implemented

**Deployment:**
- Repo: `fish-delish` (separate repository)
- Method: Cloudflare Pages (static site)
- Project: `fish-delish-marketing`

## Runtime Directories (Active)

### `mira-stack/worker/`
- ✅ **ACTIVE** - Deployed to `api.elyra-core.app`
- Contains: TypeScript source, `wrangler.toml`, migrations, static assets

### `mira-stack/mira-os/`
- ✅ **ACTIVE** - Used by Worker at runtime
- Contains: Core OS engines, runners, integrations
- Imported by: `worker/src/index.ts` and other runtime modules

### `mira-stack/email-provider/`
- ✅ **ACTIVE** - Used by Worker and MERLIN
- Contains: Provider adapters (Gmail, Outlook, Local)

### `mira-stack/merlin/`
- ✅ **ACTIVE** - Used by Worker API gateway
- Contains: Reasoning engines, dev agent runner

## Legacy/Unused Directories (NOT Deployed)

### `mira-stack/mira-app/`
- ❌ **LEGACY** - Do NOT deploy
- **Reason:** Frontend moved to `fish-delish/app/` repository
- **Status:** Historical artifact, kept for reference only
- **Action:** Can be archived or removed after verification

### `mira-stack/fish-delish-site/`
- ❌ **LEGACY** - Do NOT deploy
- **Reason:** Marketing site moved to `fish-delish/marketing/` repository
- **Status:** Historical artifact
- **Action:** Can be archived or removed after verification

### `mira-stack/merlin-vscode/`
- ⚠️ **DEV-ONLY** - Not deployed to production
- **Reason:** VS Code extension for local development
- **Status:** Tooling, not runtime

### `mira-stack/builder/`
- ⚠️ **DEV-ONLY** - Not deployed to production
- **Reason:** Project builder tooling
- **Status:** Development tool

### `mira-stack/services/api-gateway/`
- ⚠️ **DEV-ONLY** - Not deployed to production
- **Reason:** Local Express server for testing
- **Status:** Development tool

## Build & Deploy Commands

### Worker/API Deployment
```bash
cd worker
npx wrangler d1 migrations apply ASSISTANT_DB --remote
npx wrangler deploy
```

### Frontend Deployment (fish-delish repo)
```bash
cd fish-delish
# No build step required for static app
npx wrangler pages deploy app --project-name=fish-delish-app
```

## Environment Configuration

### Worker Environment Variables (in `wrangler.toml` or Cloudflare Dashboard)
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI` = `https://api.elyra-core.app/assistant/oauth/google/callback`
- `DASHBOARD_URL` = `https://app.elyra-core.app`
- `DEFAULT_USER_KEY`
- `MAILCHANNELS_DOMAIN` = `elyra-core.app`
- `MAIL_FROM` = `assistant@elyra-core.app`

### Frontend Configuration (fish-delish repo)
- API Origin: `https://api.elyra-core.app` (configured in `app/js/apiOrigin.js`)
- Local Dev Override: `localStorage.setItem('miraApiOrigin', 'http://localhost:8787')`

## Verification Checklist

- [x] Worker routes `/assistant/*` are active on `api.elyra-core.app`
- [x] Frontend app is deployed from `fish-delish/app/` to `app.elyra-core.app`
- [x] `mira-stack/mira-app/` is NOT deployed (legacy)
- [x] `mira-stack/fish-delish-site/` is NOT deployed (legacy)
- [x] OAuth redirects point to `api.elyra-core.app`
- [x] Frontend API calls point to `api.elyra-core.app`
