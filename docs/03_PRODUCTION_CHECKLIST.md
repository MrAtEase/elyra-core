# Production Deployment Checklist

## Pre-Deployment Verification

### Code Quality
- [ ] All TypeScript compiles without errors
- [ ] No linter errors in `worker/` directory
- [ ] All tests pass (if applicable)
- [ ] UI/UX consistency verified across key app surfaces (theme, spacing, alignment, readability)
- [ ] No hardcoded secrets or API keys in code
- [ ] Environment variables properly referenced from `wrangler.toml` or secrets

### UI/UX Consistency
- [ ] Design system tokens and component patterns are used consistently (colors, spacing, typography, states)
- [ ] Accessibility spot-check completed (contrast, focus visibility, keyboard navigation, semantic labels)
- [ ] Critical user flows are intuitive and coherent (signin, workspace switch, app navigation, key actions)
- [ ] No major visual regressions between desktop and mobile breakpoints on core routes

### Database Migrations
- [ ] All D1 migrations reviewed and tested locally
- [ ] Migration files in `worker/migrations/` are idempotent
- [ ] Backup plan for rollback if migration fails
- [ ] Migration command ready: `npx wrangler d1 migrations apply ASSISTANT_DB --remote`

### Configuration Review
- [ ] `worker/wrangler.toml` has correct production values
- [ ] `GOOGLE_REDIRECT_URI` points to `https://api.elyra-core.app/assistant/oauth/google/callback`
- [ ] `DASHBOARD_URL` points to `https://app.elyra-core.app`
- [ ] All required secrets are set in Cloudflare Dashboard

## Worker Deployment

### Go/No-Go Criteria

**GO if:**
- [x] All pre-deployment checks pass
- [x] Local testing confirms Worker starts without errors
- [x] OAuth flow tested locally with `.dev.vars`
- [x] Database migrations tested on remote D1 (staging if available)
- [x] No breaking changes to `/assistant/*` API contracts

**NO-GO if:**
- [ ] TypeScript compilation errors
- [ ] Missing required environment variables
- [ ] Database schema changes not migrated
- [ ] OAuth redirect URIs not configured in Google/Microsoft OAuth apps
- [ ] Breaking API changes without frontend coordination

### Deployment Steps

1. **Apply Database Migrations:**
   ```bash
   cd worker
   npx wrangler d1 migrations apply ASSISTANT_DB --remote
   ```
   - Verify migration output shows expected changes
   - Check for any migration errors

2. **Deploy Worker:**
   ```bash
   npx wrangler deploy
   ```
   - Monitor deployment output for errors
   - Verify deployment URL matches `api.elyra-core.app`

3. **Verify Deployment:**
   - Check Cloudflare Dashboard for successful deployment
   - Verify Worker is active and responding

### Post-Deployment Verification

**Smoke Tests (curl commands):**

1. **Health Check:**
   ```bash
   curl -I https://api.elyra-core.app/
   ```
   - Expected: `200 OK` or `302 Redirect`

2. **Auth Endpoint:**
   ```bash
   curl https://api.elyra-core.app/assistant/auth/whoami
   ```
   - Expected: JSON response (may be `401` if unauthenticated)

3. **OAuth Start:**
   ```bash
   curl -I "https://api.elyra-core.app/assistant/oauth/google/start"
   ```
   - Expected: `302 Redirect` to Google OAuth consent screen

4. **API Endpoints (requires auth):**
   ```bash
   # With valid session cookie
   curl -H "Cookie: <session_cookie>" \
        https://api.elyra-core.app/assistant/calendar/events
   ```
   - Expected: JSON response with calendar events or error message

## Pages Deployment

### Frontend (app.elyra-core.app)

**Go/No-Go Criteria:**

**GO if:**
- [x] Static files build/serve correctly
- [x] API origin configured to `https://api.elyra-core.app`
- [x] No hardcoded localhost URLs in production code
- [x] OAuth redirects point to production API

**NO-GO if:**
- [ ] API calls point to localhost or staging
- [ ] Missing required configuration files
- [ ] Build errors or missing assets

### Deployment Steps

1. **Verify Source:**
   - Confirm deploying from `fish-delish/app/` (NOT `mira-stack/mira-app/`)
   - Check `app/js/apiOrigin.js` has production URL

2. **Deploy to Cloudflare Pages:**
   ```bash
   cd fish-delish
   npx wrangler pages deploy app --project-name=fish-delish-app
   ```
   - Or use Cloudflare Dashboard Pages interface
   - Or configure Git integration for automatic deploys

3. **Verify Deployment:**
   - Visit `https://app.elyra-core.app`
   - Check browser console for errors
   - Verify API calls go to `api.elyra-core.app`

### Marketing Site (elyra-core.app)

**Status:** Planned, not yet implemented

**When Ready:**
- [ ] Source directory `fish-delish/marketing/` contains static files
- [ ] Deploy to Cloudflare Pages project `fish-delish-marketing`
- [ ] Configure custom domain `elyra-core.app`

## OAuth Configuration

### Google OAuth

**Pre-Deployment:**
- [ ] OAuth app created in Google Cloud Console
- [ ] Authorized redirect URI: `https://api.elyra-core.app/assistant/oauth/google/callback`
- [ ] Scopes configured: Calendar, Gmail, Drive, Slides (as needed)
- [ ] `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` set as Worker secrets

**Verification:**
```bash
# Test OAuth flow
curl -I "https://api.elyra-core.app/assistant/oauth/google/start?workspaceId=ws-default"
```
- Expected: Redirect to Google OAuth consent screen
- After approval, should redirect back to callback URL

### Microsoft OAuth

**Pre-Deployment:**
- [ ] Azure AD app registration created
- [ ] Redirect URI: `https://api.elyra-core.app/assistant/oauth/microsoft/callback`
- [ ] API permissions configured (Calendar, Mail, Files)
- [ ] `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT_ID` set as Worker secrets

**Verification:**
```bash
# Test OAuth flow
curl -I "https://api.elyra-core.app/assistant/oauth/microsoft/start?workspaceId=ws-default"
```
- Expected: Redirect to Microsoft OAuth consent screen

## DNS and TLS

### DNS Configuration

- [ ] `api.elyra-core.app` CNAME points to Cloudflare Workers route
- [ ] `app.elyra-core.app` CNAME points to Cloudflare Pages
- [ ] `elyra-core.app` A/AAAA records configured (if marketing site deployed)

### TLS/SSL

- [ ] Cloudflare SSL/TLS mode set to "Full" or "Full (strict)"
- [ ] SSL certificates automatically provisioned by Cloudflare
- [ ] No mixed content warnings (HTTP resources on HTTPS pages)

**Verification:**
```bash
# Check TLS
curl -I https://api.elyra-core.app
curl -I https://app.elyra-core.app
```
- Expected: `200 OK` or `302 Redirect` with valid TLS

## Post-Deployment Monitoring

### Immediate Checks (First 5 Minutes)

- [ ] Worker logs show no errors in Cloudflare Dashboard
- [ ] API endpoints respond within expected latency
- [ ] OAuth flows complete successfully
- [ ] Frontend loads without console errors
- [ ] Database queries execute without errors

### Extended Monitoring (First Hour)

- [ ] No unexpected errors in Worker logs
- [ ] OAuth token refresh working correctly
- [ ] Calendar/Email/Tasks API endpoints functional
- [ ] Session management working (cookies, auth state)
- [ ] CORS headers correct for frontend origin

### Rollback Procedure

**If Deployment Fails:**

1. **Worker Rollback:**
   - Use Cloudflare Dashboard to rollback to previous Worker version
   - Or redeploy previous commit: `git checkout <previous-commit> && npx wrangler deploy`

2. **Database Rollback:**
   - If migration caused issues, restore from backup (if available)
   - Or manually revert schema changes via SQL

3. **Frontend Rollback:**
   - Use Cloudflare Pages to rollback to previous deployment
   - Or redeploy previous commit

## Environment Variables Checklist

### Required Secrets (Worker)

- [ ] `GOOGLE_CLIENT_ID`
- [ ] `GOOGLE_CLIENT_SECRET`
- [ ] `MICROSOFT_CLIENT_ID` (if Microsoft OAuth enabled)
- [ ] `MICROSOFT_CLIENT_SECRET` (if Microsoft OAuth enabled)
- [ ] `MICROSOFT_TENANT_ID` (if Microsoft OAuth enabled)
- [ ] `OPENAI_API_KEY` (if MERLIN AI features enabled)

### Required Variables (wrangler.toml)

- [ ] `GOOGLE_REDIRECT_URI` = `https://api.elyra-core.app/assistant/oauth/google/callback`
- [ ] `DASHBOARD_URL` = `https://app.elyra-core.app`
- [ ] `DEFAULT_USER_KEY` = `paul` (or appropriate default)
- [ ] `MAILCHANNELS_DOMAIN` = `elyra-core.app`
- [ ] `MAIL_FROM` = `assistant@elyra-core.app`

## Open Questions

- What is the recommended staging environment setup (separate Worker, separate domain)?
- How should we handle zero-downtime deployments for database migrations?
- What monitoring/alerting should be set up for production (error rates, latency, OAuth failures)?
- Should there be a canary deployment strategy for Worker updates?
- How should we handle secrets rotation (OAuth client secrets, API keys)?
- What is the disaster recovery plan if Cloudflare Workers/KV/D1 become unavailable?
