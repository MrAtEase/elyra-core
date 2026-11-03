# Runtime Deployment Map

## Production Domain Mapping

| Domain | Repository | Source Path | Build/Deploy Method | Status |
|--------|------------|-------------|---------------------|--------|
| `elyra-core.app` | `fish-delish` | `marketing/` | Cloudflare Pages (static) | ⏳ Planned |
| `app.elyra-core.app` | `fish-delish` | `app/` | Cloudflare Pages (static) | ✅ Active |
| `api.elyra-core.app` | `mira-stack` | `worker/` | Cloudflare Workers (`wrangler deploy`) | ✅ Active |

## Source of Truth Directories

### 1. Worker/API (`api.elyra-core.app`)

**Source Directory:** `mira-stack/worker/`

**Entry Point:** `worker/src/index.ts`

**Routes:**
- `/assistant/*` - Main MERLIN API endpoints (auth-protected)
- `/assistant/oauth/google/*` - Google OAuth flow
- `/assistant/oauth/microsoft/*` - Microsoft OAuth flow
- `/assistant/calendar/*` - Calendar CRUD operations
- `/assistant/tasks/*` - Tasks management
- `/assistant/email/*` - Email operations
- `/assistant/integrations/*` - Integration management
- `/email/*` - Legacy email endpoints (maintained for compatibility)

**Deployment:**
```bash
cd worker
npx wrangler d1 migrations apply ASSISTANT_DB --remote
npx wrangler deploy
```

**Configuration:**
- Config file: `worker/wrangler.toml`
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
- Repository: `fish-delish` (separate repository)
- Method: Cloudflare Pages (static site)
- Project: `fish-delish-app`
- Build: No build step required (static HTML/CSS/JS)

**Note:** The `mira-stack/mira-app/` directory is **legacy/unused** and should NOT be deployed.

**API Configuration:**
- API Origin: `https://api.elyra-core.app` (configured in `app/js/apiOrigin.js`)
- Local Dev Override: `localStorage.setItem('miraApiOrigin', 'http://localhost:8787')`

### 3. Marketing Site (`elyra-core.app`)

**Source Directory:** `fish-delish/marketing/` (currently empty)

**Status:** Planned, not yet implemented

**Deployment:**
- Repository: `fish-delish` (separate repository)
- Method: Cloudflare Pages (static site)
- Project: `fish-delish-marketing`

## Local Development Mapping

### Worker (Local)

**URL:** `http://localhost:8787`

**Start Command:** `npm run dev:worker` (see [docs/LOCAL_DEV.md](docs/LOCAL_DEV.md) for the complete workflow).

**Notes:**
- Secrets for local dev live in `worker/.dev.vars`.
- Keep the local D1 in sync with `wrangler d1 migrations apply ASSISTANT_DB --local` (run from `worker/`).
- The doc [docs/LOCAL_DEV.md](docs/LOCAL_DEV.md) describes the OAuth redirect, `mf-s` cookie, and the smoke-test script.

### Frontend (Local)

**URL:** `http://localhost:3000`

**Start Command:** `npm run dev:site`

**Notes:**
- Set `localStorage.miraApiOrigin` to `http://localhost:8787` or use the built-in default in `fish-delish-site`.
- The worker and frontend share cookies via the CORS headers documented in [docs/LOCAL_DEV.md](docs/LOCAL_DEV.md).

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

### `mira-stack/fish-delish-site/`
- ❌ **LEGACY** - Do NOT deploy
- **Reason:** Marketing site moved to `fish-delish/marketing/` repository
- **Status:** Historical artifact

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

## Environment Configuration

### Worker Environment Variables

**In `wrangler.toml` (vars section):**
```
GOOGLE_SCOPES=openid https://www.googleapis.com/auth/userinfo.email ...
GOOGLE_REDIRECT_URI=https://api.elyra-core.app/assistant/oauth/google/callback
DEFAULT_USER_KEY=paul
MAILCHANNELS_DOMAIN=elyra-core.app
MAIL_FROM=assistant@elyra-core.app
DASHBOARD_URL=https://app.elyra-core.app
```

**Secrets (set via Cloudflare Dashboard or CLI):**
```
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
MICROSOFT_CLIENT_ID
MICROSOFT_CLIENT_SECRET
MICROSOFT_TENANT_ID
OPENAI_API_KEY
```

### Frontend Configuration

**In `fish-delish/app/js/apiOrigin.js`:**
- Production: `https://api.elyra-core.app`
- Local Dev: `http://localhost:8787` (via localStorage override)

## Verification Checklist

- [x] Worker routes `/assistant/*` are active on `api.elyra-core.app`
- [x] Frontend app is deployed from `fish-delish/app/` to `app.elyra-core.app`
- [x] `mira-stack/mira-app/` is NOT deployed (legacy)
- [x] `mira-stack/fish-delish-site/` is NOT deployed (legacy)
- [x] OAuth redirects point to `api.elyra-core.app`
- [x] Frontend API calls point to `api.elyra-core.app`
- [x] Local dev uses `localhost:8787` for Worker
- [x] Local dev frontend can override API origin via localStorage

## Open Questions

- Should `elyra-core.app` (marketing) be deployed from `fish-delish/marketing/` or remain in `fish-delish/app/` subdirectory?
- What is the recommended local development workflow when frontend and backend are in separate repos?
- Should there be a unified local dev script that starts both Worker and frontend?
- How should environment-specific configuration be managed across repos?
- What is the rollback procedure if a Worker deployment fails?
