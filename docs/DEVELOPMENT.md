# Elyra Core

**Elyra Core** is an AI-powered personal assistant platform built on Cloudflare Workers.

This monorepo contains the core platform infrastructure for workspace-native AI orchestration, including email intelligence, calendar management, OAuth integrations, and task automation.

---

## Repository Structure

```text
elyra-core/
├── worker/           # Cloudflare Worker (API, OAuth, orchestration)
├── frontend/         # Next.js workspace UI
├── email-io/         # Email I/O service (iCloud IMAP sync)
├── api-gateway/      # [Legacy] Internal API gateway (deprecated)
├── docs/             # Architecture and documentation
├── scripts/          # Tooling and automation
└── tests/            # System and integration tests
```

---

## Quick Start

### Development

**Terminal 1 - Worker:**
```bash
cd worker
npx wrangler dev --env dev
```

**Terminal 2 - Frontend:**
```bash
cd frontend
npm run dev
```

**Terminal 3 - Email-IO (optional):**
```bash
cd email-io
INTERNAL_API_KEY=devkey npm run dev
```

### Production Deployment

**Worker:**
```bash
cd worker
npx wrangler deploy --env production
```

**Frontend:**
```bash
cd frontend
npm run build
# Deploy to Vercel/Cloudflare Pages
```

---

## Environment Configuration

### Production Domains
- **API:** `api.elyra-core.app`
- **Frontend:** `app.elyra-core.app`
- **Email:** `assistant@elyra-core.app`

### Required Environment Variables

**Worker (wrangler.toml):**
```toml
[env.production.vars]
ENVIRONMENT = "production"
DASHBOARD_URL = "https://app.elyra-core.app"
PUBLIC_APP_ORIGIN = "https://app.elyra-core.app"
PUBLIC_API_ORIGIN = "https://api.elyra-core.app"

GOOGLE_REDIRECT_URI = "https://api.elyra-core.app/assistant/oauth/google/callback"
MAILCHANNELS_DOMAIN = "elyra-core.app"
MAIL_FROM = "assistant@elyra-core.app"

NEXT_ALLOWED_ORIGINS = "https://app.elyra-core.app,https://elyra-core.app"
SESSION_COOKIE_DOMAIN = ".elyra-core.app"
```

**Frontend (.env.production):**
```bash
NEXT_PUBLIC_ASSISTANT_API_BASE=https://api.elyra-core.app
NEXT_PUBLIC_APP_ORIGIN=https://app.elyra-core.app
```

**Local Development (.dev.vars / .env.local):**
```bash
NEXT_PUBLIC_ASSISTANT_API_BASE=http://localhost:8787
NEXT_PUBLIC_APP_ORIGIN=http://localhost:3000
SESSION_COOKIE_DOMAIN=""
```

---

## Key Features

### Authentication & OAuth
- Google Workspace OAuth integration
- Microsoft OAuth support
- Apple Sign In support
- Session management with Cloudflare KV
- Secure cookie handling across subdomains

### Email Intelligence
- iCloud IMAP integration
- Email thread fetching and display
- Email sending via worker
- Async enrichment pipeline

### Calendar Management
- Google Calendar integration
- CalDAV support for iCloud
- Event creation, updates, deletion
- AI-powered scheduling suggestions

### Task Automation
- Task creation from natural language
- Task organization and prioritization
- Integration with Notion
- Workspace-scoped task management

---

## Architecture

### Runtime Stack
- **Hosting:** Cloudflare Workers (global edge network)
- **Frontend:** Next.js (React 18+)
- **Database:** Cloudflare D1 (SQLite) + KV (key-value)
- **Auth:** OAuth 2.0 with secure session tokens
- **Email:** Mailchannels SMTP + iCloud IMAP

### Security Model
- Workspace-scoped data isolation
- No cross-workspace data access
- Explicit user confirmation for destructive actions
- CORS protection with environment-driven allowlist
- HMAC signature verification for internal APIs

---

## Development Scripts

```bash
# Start all services
npm run dev:all

# Worker only
npm run dev:worker

# Frontend only
npm run dev:frontend

# API Gateway (legacy)
npm run dev:api-gateway

# Build worker
npm run build

# Deploy worker
npm run deploy:worker

# Deploy frontend
npm run deploy:frontend
```

---

## Migration Notes

This codebase was recently refactored from legacy names:
- `mira-stack` → `elyra-core`
- `fish-delish-site` → `frontend`
- `fish-delish.pt` → `elyra-core.app`
- `@mira/*` packages → `@elyra/*`

Legacy references may still exist in documentation and should be updated as encountered.

---

## External Service Configuration

### Google Cloud Console
Configure OAuth redirect URIs:
- `https://api.elyra-core.app/assistant/oauth/google/callback`
- `http://localhost:8787/assistant/oauth/google/callback` (dev)

### Microsoft Azure AD
Configure redirect URIs:
- `https://api.elyra-core.app/assistant/oauth/microsoft/callback`

### Mailchannels
Verify domain ownership for `elyra-core.app` via DNS TXT record.

---

## Status

**Current State:** Production-ready MVP
**Active Development:** ✅
**Latest Refactoring:** Complete domain migration (Feb 2026)

---

## Documentation

See `/docs` directory for:
- Architecture overviews
- OAuth flow diagrams
- Production deployment checklists
- Security and compliance docs
- Migration guides

---

## Support

For issues or questions, please refer to the documentation in `/docs` or contact the development team.
