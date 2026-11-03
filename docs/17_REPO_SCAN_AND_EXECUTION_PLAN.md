# Repo Scan & 7-Day Execution Plan

**Date:** 2025-01-07  
**Scope:** mira-stack repository (platform + orchestration layer)

---

## A. What This Repo Is

- **MIRA OS Platform**: Workspace-native AI orchestration platform with MERLIN as the intelligent assistant layer. Provides multi-workspace isolation, OAuth integration backbone, and cross-service coordination (Calendar, Mail, Tasks, Docs, Slides).

- **Cloudflare Worker API**: Single entry point (`worker/src/index.ts`) serving all `/assistant/*` endpoints. Handles auth (OAuth + session cookies), workspace-scoped token management, and Google Workspace API proxying. Deployed to `api.elyra-core.app`.

- **MERLIN Orchestration Engine**: Cognitive reasoning layer (`merlin/` + `mira-os/`) that observes workspace context, aggregates signals from integrated services, and proposes actions within workspace boundaries. Never executes without confirmation.

- **Legacy Frontend Shell**: `mira-app/` contains a static HTML/CSS/JS shell that is **NOT deployed**. The actual frontend lives in the separate `fish-delish` repository (`fish-delish/app/`). This directory exists for reference/testing only.

- **Production Workspace**: Fish-Delish is the first production workspace demonstrating the full stack. OAuth tokens are workspace-scoped (`google_tokens:<userId>:<workspaceId>`), all operations filter by workspace ID, and cross-workspace access is architecturally impossible.

- **Monorepo Structure**: Contains platform code (`worker/`, `merlin/`, `mira-os/`, `email-provider/`) plus legacy artifacts (`mira-app/`, `fish-delish-site/`). The active frontend and marketing site are in separate repos.

---

## B. Architecture Map

### Components

```
┌─────────────────────────────────────────────────────────────┐
│                    Frontend (fish-delish/app/)                │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  Workspace Shell (WorkspaceShell.tsx)                   │ │
│  │  ├─ Main Card Scroll Container (.main-card-scroll)     │ │
│  │  ├─ Intent Line (bottom input bar)                    │ │
│  │  └─ Navigation Rail (sidebar)                          │ │
│  └─────────────────────────────────────────────────────────┘ │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  Modules (JS)                                            │ │
│  │  ├─ calendar.js (week grid, day view, scroll sync)     │ │
│  │  ├─ email.js (inbox, intelligence)                     │ │
│  │  ├─ tasks.js (list, create, complete)                  │ │
│  │  ├─ dashboard.js (overview, widgets)                    │ │
│  │  └─ merlin-client.js (API wrapper)                     │ │
│  └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                            │
                            │ HTTPS + CORS + Cookie (mf-s)
                            │
┌───────────────────────────▼───────────────────────────────────┐
│         Cloudflare Worker (api.elyra-core.app)                │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  Entry Point: worker/src/index.ts                       │ │
│  │  ├─ handleAssistantRequest()                            │ │
│  │  ├─ Session Management (D1)                            │ │
│  │  ├─ OAuth Flows (/assistant/oauth/google/*)            │ │
│  │  └─ API Endpoints (/assistant/*)                       │ │
│  └─────────────────────────────────────────────────────────┘ │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  Google Integration (worker/src/google.ts)              │ │
│  │  ├─ Token Refresh                                       │ │
│  │  ├─ Calendar API                                        │ │
│  │  ├─ Gmail API                                           │ │
│  │  └─ Tasks API                                           │ │
│  └─────────────────────────────────────────────────────────┘ │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  MERLIN Engines (merlin/ + mira-os/)                    │ │
│  │  ├─ Brain v1 (reasoning)                                │ │
│  │  ├─ Deep Cognition                                      │ │
│  │  └─ Workspace Context                                   │ │
│  └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                            │
                            │ Workspace-scoped tokens
                            │
┌───────────────────────────▼───────────────────────────────────┐
│                    Storage Layer                              │
│  ┌──────────────┐  ┌──────────────┐                         │
│  │  Cloudflare  │  │  Cloudflare  │                         │
│  │  KV          │  │  D1          │                          │
│  │  (OAuth      │  │  (Sessions, │                          │
│  │   tokens)    │  │   Workspaces)│                         │
│  └──────────────┘  └──────────────┘                         │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow

1. **Auth Flow**: User → OAuth start → Google consent → Callback → Session cookie (`mf-s`) → D1 session record → Workspace context established
2. **API Request**: Frontend → `fetch('/assistant/calendar/events', { credentials: 'include' })` → Worker validates session → Loads workspace-scoped tokens from KV → Calls Google API → Returns filtered data
3. **MERLIN Orchestration**: Observes workspace signals → Aggregates context → Proposes actions → User confirms → Executes via same CRUD endpoints

### Theme System

- **Location**: `mira-app/css/tokens.css` (legacy) + `fish-delish/app/globals.css` (active)
- **Themes**: `classic` (light/dark) + `holo` (dark only)
- **Engine**: `mira-app/js/theme-engine.js` (manages `data-theme` and `data-mode` attributes on `<html>`)
- **Tokens**: CSS custom properties (`--text-0`, `--surface-0`, `--accent-0`, etc.) with theme-specific overrides

---

## C. Where to Edit What

### Critical Files (Must Know)

**Backend API:**
- `worker/src/index.ts` (12,636 lines) - Main request handler, all `/assistant/*` routes, session management, CORS
- `worker/src/google.ts` - Google OAuth + API client, token refresh logic
- `worker/wrangler.toml` - Deployment config, environment variables, KV/D1 bindings

**Frontend (fish-delish repo, but referenced here):**
- `fish-delish/app/modules/calendar.js` - Calendar week grid, day view, scroll containers
- `fish-delish/app/js/merlin-client.js` - API wrapper, handles auth redirects
- `fish-delish/app/js/apiOrigin.js` - API origin resolution (production vs localhost)
- `fish-delish/components/nav/WorkspaceShell.tsx` - Main shell layout, scroll container
- `fish-delish/app/globals.css` - Theme tokens, workspace shell styles, `.main-card-scroll` definition

**MERLIN Orchestration:**
- `merlin/core/` - Core reasoning engines
- `mira-os/engines/` - Workspace-aware engines (calendar, email, tasks)
- `email-provider/` - Provider adapters (Gmail, Outlook, Local)

**Legacy (Do NOT edit for production):**
- `mira-app/` - Legacy frontend shell (kept for reference only)
- `fish-delish-site/` - Legacy marketing site (moved to separate repo)

### Module Structure

**Calendar Module** (`mira-app/modules/calendar.js` - legacy, but logic may be reused):
- `renderWeekGrid()` - 7-column week view
- `renderDayView()` - Hour-by-hour timeline with scroll sync
- `renderMonthGrid()` - Month calendar grid
- `loadEventsForCurrentRange()` - Fetches from `/assistant/calendar/events`
- Scroll container: `.calendar-day-body` (day view), `.calendar-grid` (week/month)

**Auth Flow** (`worker/src/index.ts`):
- `createSession()` - Creates session record in D1
- `getSessionFromRequest()` - Validates `mf-s` cookie
- `buildWhoamiPayload()` - Returns user + workspace context
- `/assistant/oauth/google/start` - Initiates OAuth
- `/assistant/oauth/google/callback` - Exchanges code for tokens

**Workspace Isolation** (`worker/src/index.ts`):
- Token storage key: `google_tokens:<userId>:<workspaceId>`
- All database queries filter by `workspace_id`
- Session includes `workspaceId` from D1 lookup

---

## D. Risks & Weirdness

### Critical Issues

1. **TypeScript Errors in Worker**: `Uint8Array<ArrayBufferLike>` type incompatibility at lines 10972 and 12255. Functions `decodeBase64ToUint8Array()` and `base64UrlToUint8Array()` return types that TypeScript doesn't recognize as compatible with `BodyInit` and `BufferSource`. **Fix**: Ensure both functions create `Uint8Array` from plain number arrays, not from Node.js Buffer directly.

2. **Legacy Frontend Confusion**: `mira-app/` directory exists but is NOT deployed. Actual frontend is in `fish-delish/app/` (separate repo). Developers may edit wrong files. **Fix**: Add clear README in `mira-app/` stating it's legacy, or delete it.

3. **Calendar Scroll Container Fragility**: Day view uses `.calendar-day-body` as scroll container, but height calculation relies on `body.scrollHeight` which may be incorrect before layout. Line 2232: `const timelineHeight = body.scrollHeight || body.clientHeight || 1;` - this can cause layout jumps. **Fix**: Use `ResizeObserver` or ensure height calculation happens after layout.

### Layout & Scroll Issues

4. **Multiple Scroll Containers**: Frontend has `.main-card-scroll` (workspace shell) and `.calendar-day-body` (calendar day view). If calendar is inside main card, nested scrolling can conflict. **Fix**: Ensure calendar day view uses its own scroll container that doesn't nest inside `.main-card-scroll`, or make calendar full-height and use main card scroll only.

5. **Fixed Heights in Calendar**: Day view calculates `timelineHeight` from scroll height, then sets `eventsLayer.style.height` to that value. If viewport changes, events layer doesn't resize. **Fix**: Use CSS `height: 100%` on events layer relative to body, or recalculate on resize.

6. **Intent Line Overlap**: `.workspace-canvas` has `max-height: calc(100dvh - var(--workspace-shell-header-height) - var(--intent-safe-bottom))` but if content grows, it can overlap the intent line. **Fix**: Ensure `.main-card-scroll` has proper `padding-bottom` to account for intent line height.

### Auth & CORS Gotchas

7. **Cookie Domain Mismatch**: Session cookie is set with `Domain=.elyra-core.app` but if frontend is on different domain, cookie won't be sent. **Fix**: Verify `DASHBOARD_URL` env var matches actual frontend origin, or use `SameSite=None; Secure` for cross-domain.

8. **CORS Preflight Failures**: Worker allows credentials but if frontend origin isn't in `STATIC_CORS_ORIGINS` or `DASHBOARD_URL`, requests fail silently. **Fix**: Add explicit CORS error logging, or use `Access-Control-Allow-Origin: *` for dev (with credentials disabled).

9. **Token Refresh Race Conditions**: If multiple requests happen simultaneously and token expires, all may try to refresh at once. **Fix**: Implement token refresh lock/mutex in `refreshGoogleAccessTokenIfNeeded()`.

### Data & State Issues

10. **Workspace ID Hardcoding**: `merlin-client.js` has `DEFAULT_CONTEXT` with hardcoded `workspaceId: "ws-default"`. If user switches workspace, this breaks. **Fix**: Read workspace ID from session/whoami payload, not hardcoded constant.

11. **Event Loading Cooldown**: Calendar has `calendarCooldownUntil` that blocks requests after errors. If cooldown is too long, user can't retry. **Fix**: Reduce cooldown duration or make it user-dismissible.

12. **No Optimistic Updates**: Calendar CRUD operations don't update UI optimistically. User sees loading state even for fast operations. **Fix**: Update UI immediately, rollback on error.

---

## E. Next 7-Day Plan (Highest Leverage First)

### Day 1-2: Fix Critical TypeScript Errors

**Task 1.1**: Fix `Uint8Array` type errors in `worker/src/index.ts`
- **File**: `worker/src/index.ts` lines ~12185-12220 (decodeBase64ToUint8Array) and ~6362-6380 (base64UrlToUint8Array)
- **Change**: Ensure both functions create `Uint8Array` from plain number arrays: `const bytes: number[] = []; for (let i = 0; i < buffer.length; i++) bytes.push(buffer[i]); return new Uint8Array(bytes);`
- **Test**: Run `cd worker && npm run build` - should have zero TypeScript errors
- **Impact**: Blocks deployment, causes runtime errors in crypto operations

**Task 1.2**: Verify worker builds and deploys cleanly
- **Command**: `cd worker && npx wrangler deploy --dry-run`
- **Fix any remaining type errors**

### Day 2-3: Calendar Scroll Container Fix

**Task 2.1**: Fix calendar day view scroll height calculation
- **File**: `mira-app/modules/calendar.js` line ~2232 (or equivalent in `fish-delish/app/modules/calendar.js`)
- **Change**: Replace `const timelineHeight = body.scrollHeight || body.clientHeight || 1;` with `ResizeObserver` or `requestAnimationFrame` to calculate after layout
- **Alternative**: Use CSS `height: 100%` on `.calendar-day-events-layer` relative to `.calendar-day-body`
- **Test**: Open calendar day view, resize window, verify events layer height updates

**Task 2.2**: Ensure single scroll strategy per page
- **File**: `fish-delish/app/globals.css` (or wherever calendar styles live)
- **Change**: If calendar day view is inside `.main-card-scroll`, remove nested scrolling. Make calendar full-height and use main card scroll only, OR make calendar its own scroll container outside main card.
- **Test**: Open calendar, verify only one scroll container is active

### Day 3-4: Auth & Workspace Context Fixes

**Task 3.1**: Remove hardcoded workspace ID from merlin-client
- **File**: `mira-app/js/merlin-client.js` line ~26-30 (or equivalent in `fish-delish/app/js/merlin-client.js`)
- **Change**: Read `workspaceId` from `whoami` payload or session storage, not `DEFAULT_CONTEXT`
- **Test**: Switch workspaces, verify API calls use correct workspace ID

**Task 3.2**: Add explicit CORS error logging
- **File**: `worker/src/index.ts` - `buildCorsHeaders()` function
- **Change**: Log when origin is rejected: `console.warn('[CORS] Rejected origin:', origin)`
- **Test**: Make request from disallowed origin, verify log appears

**Task 3.3**: Fix token refresh race condition
- **File**: `worker/src/google.ts` - `refreshGoogleAccessTokenIfNeeded()` function
- **Change**: Add mutex/lock to prevent concurrent refresh attempts. Use KV to store refresh-in-progress flag with TTL.
- **Test**: Make 10 simultaneous requests with expired token, verify only one refresh happens

### Day 4-5: Optimistic Updates & UX

**Task 4.1**: Add optimistic updates to calendar CRUD
- **File**: `mira-app/modules/calendar.js` (or `fish-delish/app/modules/calendar.js`)
- **Change**: Update `events` array immediately on create/update/delete, show loading indicator on button only. On error, rollback and show error toast.
- **Test**: Create event, verify UI updates instantly, verify rollback on error

**Task 4.2**: Reduce calendar cooldown duration
- **File**: `mira-app/modules/calendar.js` - find `calendarCooldownUntil` usage
- **Change**: Reduce cooldown from current value (likely 30-60s) to 5s, or make it user-dismissible
- **Test**: Trigger error, verify cooldown is shorter or dismissible

### Day 5-6: Cleanup Legacy Code

**Task 5.1**: Add README to `mira-app/` explaining it's legacy
- **File**: `mira-app/README.md` (create if missing)
- **Content**: "This directory contains the legacy frontend shell. The active frontend is in the `fish-delish` repository. Do NOT deploy this directory. Kept for reference only."
- **Impact**: Prevents confusion about which frontend to edit

**Task 5.2**: Verify `fish-delish-site/` is truly unused
- **Check**: Search codebase for references to `fish-delish-site/`
- **Action**: If unused, add README or delete directory

### Day 6-7: Documentation & Testing

**Task 6.1**: Update runtime deployment map if frontend structure changed
- **File**: `docs/01_RUNTIME_DEPLOY_MAP.md`
- **Verify**: All paths and deployment instructions are accurate

**Task 6.2**: Add smoke test for critical user flows
- **File**: `worker/scripts/smoke.mjs` (or create new)
- **Add**: Test calendar event creation, task creation, whoami endpoint
- **Run**: `node worker/scripts/smoke.mjs` before each deployment

**Task 6.3**: Document calendar scroll container strategy
- **File**: `docs/` (create new or update existing)
- **Content**: Explain which scroll container is used where, why nested scrolling is avoided, how to add new views without breaking scroll

---

## Summary: Highest Leverage Actions

1. **Fix TypeScript errors** (Day 1) - Blocks deployment
2. **Fix calendar scroll** (Day 2-3) - Major UX issue
3. **Fix workspace ID hardcoding** (Day 3) - Breaks multi-workspace
4. **Add optimistic updates** (Day 4) - Improves perceived performance
5. **Clean up legacy confusion** (Day 5) - Prevents future mistakes

**Estimated Impact**: Fixing these 5 items will eliminate deployment blockers, improve UX significantly, and prevent multi-workspace bugs. Remaining tasks are polish and documentation.
