# Demo Script: 3-Minute Investor Demo

## Goal

Show MERLIN orchestrating real workspace signals from Google Workspace within workspace boundaries.

## Setup Assumptions

- Google Workspace account is connected to the active workspace
- OAuth tokens are valid and not expired
- Production environment is accessible at `app.elyra-core.app` and `api.elyra-core.app`
- Browser session is authenticated (mf-s cookie present)
- Calendar and Tasks have live data from Google Workspace
- MERLIN action suggestions are enabled in the UI

## Minute-by-Minute Script

### Minute 0:00 - Open App and Show Workspace

**Action:** Navigate to `https://app.elyra-core.app` and log in if needed.

**Spoken Line:** "MIRA OS is a workspace-native AI orchestration platform. I'm opening the Fish-Delish workspace, which is our first production deployment."

**What to Show:**
- Dashboard loads with workspace context visible
- Workspace selector shows active workspace (Fish-Delish)
- UI indicates authenticated state

**If This Fails:**
- Fallback: Show workspace switching UI and explain multi-workspace architecture
- Alternative: Navigate directly to workspace URL if available

### Minute 0:30 - Show Connected State

**Action:** Navigate to integrations or settings view, or show connection status in dashboard.

**Spoken Line:** "The workspace is connected to Google Workspace via OAuth. All tokens are stored workspace-scoped, meaning each workspace has isolated access to its own Google account."

**What to Show:**
- Integration status shows "Connected" for Google Workspace
- Connection details show scopes granted (calendar, mail, tasks, drive)
- Explain that tokens are stored with workspace ID in the key

**If This Fails:**
- Fallback: Show connection status endpoint response: `GET /assistant/integrations/google/status`
- Alternative: Explain OAuth architecture from documentation

### Minute 1:00 - Show Calendar Next Events

**Action:** Navigate to calendar view or dashboard calendar widget.

**Spoken Line:** "MERLIN observes workspace context in real time. Here are the next calendar events from Google Calendar, fetched using workspace-scoped tokens."

**What to Show:**
- Calendar events displayed from Google Calendar API
- Events show real dates, times, and titles
- Explain that data is live from Google Workspace, not mocked

**If This Fails:**
- Fallback: Show calendar API endpoint response: `GET /assistant/calendar/events?range=30`
- Alternative: Show tasks instead if calendar fails

### Minute 1:30 - Show Open Tasks

**Action:** Navigate to tasks view or dashboard tasks widget.

**Spoken Line:** "Tasks are also integrated. These are live tasks from Google Tasks, scoped to this workspace. MERLIN can coordinate across calendar and tasks to suggest actions."

**What to Show:**
- Tasks list displayed from Google Tasks API
- Tasks show real titles, due dates, and completion status
- Explain workspace scoping: tasks from this workspace only

**If This Fails:**
- Fallback: Show tasks API endpoint response: `GET /assistant/tasks`
- Alternative: Show email inbox if tasks fail

### Minute 2:00 - Trigger MERLIN Action Suggestion

**Action:** Use a MERLIN action suggestion feature in the UI, such as:
- "Suggest next action based on calendar"
- "Create task from email"
- "Schedule follow-up"
- Any non-destructive orchestration suggestion

**Spoken Line:** "MERLIN observes the workspace context and suggests coordinated actions. This suggestion is based on calendar events, tasks, and email patterns, all within workspace boundaries."

**What to Show:**
- MERLIN suggestion appears in UI
- Suggestion references real data (calendar event, task, or email)
- Explain that MERLIN maintains workspace isolation while coordinating across services

**If This Fails:**
- Fallback: Show email intelligence feature (summarize email, draft reply)
- Alternative: Show workspace isolation by switching workspaces and explaining boundaries

### Minute 2:30 - Show Workspace Boundaries

**Action:** Either switch to a different workspace (if available) or show workspace ID in UI/URL, or explain isolation architecture.

**Spoken Line:** "Workspace isolation is architectural, not configurational. Each workspace has its own tokens, connections, and data. Cross-workspace access is impossible because tokens are stored with workspace ID in the key."

**What to Show:**
- Workspace selector showing multiple workspaces (if available)
- Or show workspace ID in URL or UI
- Explain token key format: `google_tokens:userId:workspaceId`
- Explain that switching workspaces changes the active context

**If This Fails:**
- Fallback: Show workspace isolation documentation or explain architecture
- Alternative: Show whoami endpoint response showing workspace context

### Minute 3:00 - Closing

**Spoken Line:** "MIRA OS provides workspace-native AI orchestration for multi-workspace businesses. The platform is production-ready, with Fish-Delish as the first workspace. We're positioned for franchise expansion and enterprise deployment."

**What to Emphasize:**
- Platform model: infrastructure supports multiple workspaces
- Production deployment: Fish-Delish is live
- Workspace isolation: architectural guarantee
- OAuth integration: deep integration with Google Workspace
- MERLIN orchestration: cross-service coordination within boundaries

## Fallback Paths

### Fallback Path 1: API Endpoint Demo

If UI fails, demonstrate via API endpoints:

1. Show whoami: `GET /assistant/auth/whoami` (shows workspace context)
2. Show connection status: `GET /assistant/integrations/google/status`
3. Show calendar events: `GET /assistant/calendar/events?range=30`
4. Show tasks: `GET /assistant/tasks`
5. Explain that UI connects to these endpoints

**Spoken Line:** "The backend API is fully functional. All operations are workspace-scoped and use OAuth tokens. The UI connects to these endpoints to display data."

### Fallback Path 2: Documentation Walkthrough

If both UI and API fail, show documentation:

1. Open `docs/10_MVP_FEATURE_TO_CODE_MAP.md` - Show feature completeness
2. Open `docs/12_WORKSPACE_ISOLATION_GUARANTEES.md` - Explain isolation architecture
3. Open `docs/11_AUTH_AND_OAUTH_FLOWS.md` - Show OAuth integration depth
4. Open `docs/13_MVP_CONTRACT.md` - Show delivery guarantees

**Spoken Line:** "The system is fully documented and production-ready. All features are implemented and tested. The architecture ensures workspace isolation at the infrastructure level."

## Closing Line (Tailored to Antler/Outsized/FO)

**For Antler/Outsized/FO:** "MIRA OS is a platform play in workspace-native AI orchestration. We've built the infrastructure, proven it with Fish-Delish, and are ready to scale to franchises and enterprise customers. The architecture supports multi-workspace businesses with strict isolation guarantees, making it ideal for franchise models and enterprise deployments."

