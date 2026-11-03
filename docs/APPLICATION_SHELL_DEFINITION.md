# ELYRA CORE — Application Shell Definition

> Structural specification for the workspace shell: routes, navigation, layout, state, and behavior.
> No code. No prose. Structured definitions only.
> Grounded in: ELYRA_CORE_ARCHITECTURE_V2.md + ELYRA_CORE_IMPLEMENTATION_SPEC.md + ELLI_AI_SYSTEM_SPEC.md

---

## 1. App Router Structure

### 1.1 Route Map

```
/                              → Redirect: has mf-s cookie → /w | else → /signin
/signin                        → Sign in (Supabase Auth UI)
/auth/callback                 → OAuth callback handler (transient)
/onboarding                    → 3-step stepper (blocks all access until complete)

/w                             → Workspace selector (multi-workspace) or auto-redirect (single)
/w/[slug]                      → Workspace Home
/w/[slug]/mail                 → Mail
/w/[slug]/calendar             → Calendar
/w/[slug]/planner              → Planner
/w/[slug]/planner/[taskId]     → Task detail
/w/[slug]/integrations         → Integrations marketplace
/w/[slug]/integrations/[key]   → Integration detail + config
/w/[slug]/team                 → Team members
/w/[slug]/team/invite          → Invite flow
/w/[slug]/settings             → Workspace settings
/w/[slug]/settings/profile     → User profile within workspace
/w/[slug]/settings/billing     → Billing (future)
/w/[slug]/admin                → Workspace admin

/help                          → Help center
/system/diagnostics            → Dev diagnostics (non-prod only)
```

### 1.2 Route Rules

| Rule | Enforcement |
|------|-------------|
| Maximum depth: 3 segments after `/w/[slug]/` | Route structure. `/w/[slug]/tool/[id]` is the deepest. |
| No route nesting beyond tool/[id] | No `/w/[slug]/planner/[taskId]/subtask`. Flat. |
| No query-param navigation | Filters (e.g., task status) use query params. Navigation never does. |
| No hash routing | All routing is path-based via Next.js App Router. |
| No catch-all routes | Every route is explicitly defined. 404 for unknown paths. |
| No modal-driven navigation | Modals are for confirmation/destruction only. Content lives at routes. |

### 1.3 Route Ownership

```
frontend/app/
├── layout.tsx                    → Root: <html>, <body>, fonts, AuthProvider
├── page.tsx                      → / redirect logic (Server Component)
├── signin/page.tsx               → Client: Supabase Auth UI
├── auth/callback/route.ts        → Server Route: OAuth exchange
├── onboarding/page.tsx           → Client: 3-step stepper
├── w/
│   ├── layout.tsx                → Server: AuthGuard + ShellLayout
│   ├── page.tsx                  → Server: workspace selector
│   └── [slug]/
│       ├── layout.tsx            → Client: WorkspaceProvider + ElliProvider + AISurface
│       ├── page.tsx              → Server: Workspace Home
│       ├── mail/page.tsx         → Client: Mail inbox
│       ├── calendar/page.tsx     → Client: Calendar view
│       ├── planner/
│       │   ├── page.tsx          → Client: Task board
│       │   └── [taskId]/page.tsx → Client: Task detail
│       ├── integrations/
│       │   ├── page.tsx          → Server: Marketplace list
│       │   └── [key]/page.tsx    → Client: Integration detail
│       ├── team/
│       │   ├── page.tsx          → Server: Team list
│       │   └── invite/page.tsx   → Client: Invite form
│       ├── settings/
│       │   ├── page.tsx          → Client: Workspace settings
│       │   └── profile/page.tsx  → Client: User profile
│       └── admin/page.tsx        → Client: Admin panel
├── help/page.tsx
└── system/diagnostics/page.tsx
```

### 1.4 Middleware

```
Matcher: ['/', '/workspace/:path*']

/ → check mf-s cookie existence → /w (present) or /signin (absent)
/workspace/* → permanent redirect to /w/* (legacy migration)
All other routes → pass through

Middleware does NOT validate the session. Cookie existence only.
The Worker API validates on every request.
```

---

## 2. Shell Layout

### 2.1 Grid Structure

```
┌──────────────────────────────────────────────────┐
│ Header (56px, fixed top, full width)             │
├────────┬─────────────────────────────────────────┤
│ Rail   │ Canvas (flex-1)                         │
│ (64px) │ max-width: 1200px, centered             │
│ fixed  │ padding: 32px                           │
│ left   │                                         │
│        │                                         │
│        │                                         │
│        │                                         │
│        │                                         │
├────────┴─────────────────────────────────────────┤
│ StatusBar (32px, fixed bottom, full width)        │
└──────────────────────────────────────────────────┘
```

### 2.2 Layout Invariants

| Invariant | Detail |
|-----------|--------|
| Rail is always 64px wide | No collapse. No expand. No hamburger. No responsive hide. |
| Header is always 56px tall | No scroll-hide. No transparency. Always present. |
| StatusBar is always 32px tall | Always visible. Never overlapped. |
| Canvas is the only scrollable area | Header, Rail, and StatusBar are fixed. |
| AISurface overlays Canvas only | Rail is never covered. Header is never covered. |
| No breadcrumbs anywhere | Tool name is implicit from Rail active state. |
| No global search bar | Elli is the search interface. |

---

## 3. Rail Navigation

### 3.1 Structure

```
┌────────┐
│  Home  │  ← Top group (5 items)
│  Mail  │
│  Cal   │
│  Plan  │
│  Integ │
│        │
│        │  ← Spacer (flex-1)
│        │
│  Team  │  ← Bottom group (2 items, role-gated)
│  Sett  │
└────────┘
```

### 3.2 Rail Items

| Position | ID | Icon | Label | Route | Visibility |
|----------|----|------|-------|-------|------------|
| Top 1 | `home` | `Home` | Home | `/w/[slug]` | All roles |
| Top 2 | `mail` | `Mail` | Mail | `/w/[slug]/mail` | All roles |
| Top 3 | `calendar` | `Calendar` | Calendar | `/w/[slug]/calendar` | All roles |
| Top 4 | `planner` | `ListChecks` | Planner | `/w/[slug]/planner` | All roles |
| Top 5 | `integrations` | `Puzzle` | Integrations | `/w/[slug]/integrations` | All roles |
| Bottom 1 | `team` | `Users` | Team | `/w/[slug]/team` | owner, admin |
| Bottom 2 | `settings` | `Settings` | Settings | `/w/[slug]/settings` | All roles |

### 3.3 Rail Behavior

| Aspect | Specification |
|--------|---------------|
| Width | 64px. Fixed. Non-negotiable. |
| Icon size | 20px |
| Item height | 44px |
| Active indicator | 3px accent bar on the left edge. Icon color: `--accent`. Background: `--surface-3`. |
| Hover | Icon color: `--text-secondary` → `--text-primary`. Duration: 100ms ease-out. |
| Tooltip | Appears after 400ms hover. Shows label text. Dark background. |
| Active state source | Derived from current URL path. Exact match for Home, prefix match for others. |
| No badges | No unread counts. No notification dots. Elli communicates status. |
| No context menus | No right-click behavior. |
| No drag reorder | Item order is fixed. |
| No icons-only toggle | Rail is always icon + implicit label via tooltip. |
| Scale on hover | None. No scale transforms on Rail items. |
| Click behavior | `router.push()` to route. No intermediary state. |

### 3.4 Role-Based Visibility

| Role | Sees |
|------|------|
| **owner** | All 7 items (Home, Mail, Calendar, Planner, Integrations, Team, Settings) |
| **admin** | All 7 items |
| **member** | 5 items (Home, Mail, Calendar, Planner, Integrations) + Settings |
| **guest** | 5 items (Home, Mail, Calendar, Planner, Integrations) + Settings |

Team is hidden from member and guest roles. The route itself is also server-protected — accessing `/w/[slug]/team` as a member returns 403.

Admin (`/w/[slug]/admin`) is not a Rail item. It is accessed from Settings by owner/admin only.

---

## 4. Header

### 4.1 Layout

```
┌──────────────────────────────────────────────────────────┐
│ [Orb 24px] elyra core     [WorkspaceSelector ▾]     [Orb trigger] [Avatar ▾] │
│ ← Left                    ← Center                  ← Right →                │
└──────────────────────────────────────────────────────────┘
```

### 4.2 Header Elements

| Position | Element | Behavior |
|----------|---------|----------|
| Left | Orb (24px) + "elyra core" wordmark | Orb: live, accent-colored, reflects Elli state. Wordmark: `--text-primary`, `--text-sm`, letter-spacing: 0.04em. Not clickable. |
| Center | WorkspaceSelector | Dropdown showing active workspace name + accent dot. Click opens workspace list. |
| Right-1 | Elli trigger | Orb button (28px). Click toggles AISurface. Orb state matches ElliProvider state. |
| Right-2 | UserMenu | Avatar (32px) with initials fallback. Click opens dropdown: Profile, Help, Sign out. |

### 4.3 WorkspaceSelector

| Aspect | Detail |
|--------|--------|
| Closed state | Active workspace name + accent-colored dot (6px). Chevron-down icon. |
| Open state | Dropdown list of all workspaces. Each item: accent color dot + name + type badge. |
| Selection | Click workspace → triggers workspace switch sequence (see Section 6). |
| Keyboard | Arrow keys navigate. Enter selects. Escape closes. |
| No search | For v1. Workspace lists are small enough. |
| Position | Centered in header. Fixed width: 240px max. Truncates long names with ellipsis. |

### 4.4 UserMenu Dropdown

| Item | Action | Visibility |
|------|--------|------------|
| User name + email | Display only | Always |
| Profile | Navigate to `/w/[slug]/settings/profile` | Always |
| Help | Navigate to `/help` | Always |
| Sign out | POST `/assistant/auth/logout` → redirect to `/signin` | Always |

---

## 5. StatusBar

### 5.1 Layout

```
┌──────────────────────────────────────────────────────────┐
│ [WS Name] · Company          ● Synced          Elli: idle│
│ ← Left                       ← Center          ← Right → │
└──────────────────────────────────────────────────────────┘
```

### 5.2 StatusBar Elements

| Position | Element | Content |
|----------|---------|---------|
| Left | Workspace identity | Name + type badge (`Personal` / `Company` / `Franchise` / `Client`) |
| Center | Sync status | `● Synced` (green dot) / `● Syncing...` (amber, pulse) / `● Offline` (red) |
| Right | Elli status | `Elli: idle` / `Elli: listening` / `Elli: thinking` / `Elli: working` |

### 5.3 StatusBar Rules

- Height: 32px. Fixed. Full width.
- Background: `--surface-1`. Border-top: `--border-subtle`.
- Text: `--text-tertiary`, `--text-xs`.
- No interactive elements. Display only.
- Updates reactively from provider state.

---

## 6. Workspace Switching

### 6.1 Trigger → Completion Sequence

```
Step 1: User selects workspace from WorkspaceSelector dropdown
Step 2: POST /assistant/workspaces/:slug/switch
Step 3: Worker updates session.active_workspace_id in D1
Step 4: Worker returns updated WhoamiResponse
Step 5: Frontend calls router.push('/w/[new-slug]')
Step 6: [slug]/layout.tsx remounts (key={params.slug})
Step 7: WorkspaceProvider receives new slug, fetches workspace data
Step 8: ElliProvider resets (fresh session, no carryover)
Step 9: CSS --accent updates on workspace shell element
Step 10: All tool state resets (mail, calendar, planner — page-level state destroyed by remount)
```

### 6.2 Motion Sequence

| Step | What happens | Duration | Easing |
|------|-------------|----------|--------|
| 1 | WorkspaceSelector closes | instant | — |
| 2 | Accent color (`--accent`) transitions to new value | 400ms | ease-in-out |
| 3 | Canvas content fades out | 150ms | ease-out |
| 4 | Canvas remounts with new workspace content | — | — |
| 5 | Canvas content fades in | 200ms | ease-out |
| 6 | Orb color morphs to new accent | 600ms | cubic-bezier(0.4, 0, 0.2, 1) |
| 7 | StatusBar updates workspace name + type | instant | — |

### 6.3 State Isolation

| State domain | On workspace switch |
|-------------|---------------------|
| WorkspaceProvider | Remounts. Fetches new workspace data from API. |
| ElliProvider | Remounts. New session. Zero history carryover. |
| Mail state | Destroyed. Page-level state ceases to exist. |
| Calendar state | Destroyed. Page-level state ceases to exist. |
| Planner state | Destroyed. Page-level state ceases to exist. |
| Integrations state | Destroyed. Page-level state ceases to exist. |
| URL | Updates to `/w/[new-slug]` (or `/w/[new-slug]/[current-tool]`). |
| AuthProvider | Unchanged. User identity persists across workspaces. |
| CSS `--accent` | Updates to new workspace's accent_color. |

### 6.4 Edge Cases

| Case | Behavior |
|------|----------|
| User switches to a workspace they were removed from | API returns 403. Redirect to `/w`. Show error inline on workspace selector. |
| Network failure during switch | Remain on current workspace. Show inline error: "Wechsel fehlgeschlagen. Bitte erneut versuchen." |
| User navigates directly to `/w/[other-slug]` via URL | Same switch sequence. POST `/switch` is called by WorkspaceProvider on mount. |
| Current workspace is deleted while user is in it | Next API call returns 404/403. Redirect to `/w`. |

---

## 7. AISurface (Elli Panel)

### 7.1 Panel Specification

| Aspect | Value |
|--------|-------|
| Width | 420px |
| Position | Right edge, overlays Canvas |
| Height | Full height minus Header (56px) and StatusBar (32px) |
| Never covers | Rail (64px) or Header or StatusBar |
| Background | Glass panel: `rgba(17, 17, 20, 0.8)`, `backdrop-filter: blur(24px) saturate(1.2)` |
| Border | Left: `1px solid var(--border-subtle)` |
| Shadow | `--shadow-lg` on the left edge |

### 7.2 Open/Close Behavior

| Trigger | Action |
|---------|--------|
| Click Elli trigger (Header Orb button) | Toggle panel open/close |
| Keyboard shortcut (Cmd+K or Cmd+J) | Toggle panel open/close |
| Click Elli prompt on Home dashboard | Open panel, focus input |
| Click outside panel (on Canvas) | Does NOT close panel. Explicit close only. |
| Press Escape | Closes panel |
| Navigate to different tool (Rail click) | Panel remains open. Elli sees new tool context. |
| Workspace switch | Panel closes. Elli session resets. |

### 7.3 Open Animation

| Property | Value |
|----------|-------|
| Direction | Slides from right |
| Duration | 300ms |
| Easing | `cubic-bezier(0.32, 0.72, 0, 1)` |
| Canvas behavior | Canvas content width shrinks by 420px (push, not overlay on desktop) |
| Backdrop | No dimming of Canvas. AISurface sits alongside. |
| Focus | Input field auto-focused on open |

### 7.4 Close Animation

| Property | Value |
|----------|-------|
| Direction | Slides to right |
| Duration | 200ms |
| Easing | `cubic-bezier(0.32, 0.72, 0, 1)` (reverse) |
| Canvas behavior | Canvas content expands back to full width |

### 7.5 Panel Internal Structure

```
┌─────────────────────────────┐
│ Header                       │
│ "Elli" + [Mode badge]  [X]  │
│ [Mode selector dropdown]     │
├─────────────────────────────┤
│ Chat area (scrollable)       │
│                              │
│ ┌─ Elli message ──────────┐ │
│ │ Glass panel, accent bar  │ │
│ │ left (3px). Left-aligned.│ │
│ └──────────────────────────┘ │
│                              │
│ ┌────── User message ─────┐ │
│ │ --surface-2 background.  │ │
│ │ Right-aligned.           │ │
│ └──────────────────────────┘ │
│                              │
│ ┌─ ActionCard (inline) ───┐ │
│ │ "Elli möchte:"          │ │
│ │ [action description]     │ │
│ │ [Ablehnen] [Bestätigen] │ │
│ └──────────────────────────┘ │
│                              │
├─────────────────────────────┤
│ Quick actions (chips)        │
│ "Zusammenfassung"            │
│ "Plane meinen Tag"           │
│ "E-Mails checken"            │
├─────────────────────────────┤
│ Input area                   │
│ [Message input...]     [→]   │
└─────────────────────────────┘
```

### 7.6 Elli Modes (selectable in panel header)

| Mode | Badge text | Behavior summary |
|------|-----------|-----------------|
| Assistant | "Assistant" | Default. Answers questions. Retrieves info. Never proposes actions unprompted. |
| Mentor | "Mentor" | Strategic advice grounded in workspace data. "Ich empfehle..." |
| Planner | "Planner" | Generates task lists with priorities. Presents before creating. |
| Operator | "Operator" | Executes actions (send, create, update). Always confirms first. |
| Instructor | "Instructor" | Step-by-step guidance. References UI elements. |

Mode selection persists for the session. New session resets to Assistant.
Elli can also auto-infer mode from message content without explicit selection.

### 7.7 Action Confirmation Flow

```
1. Elli constructs ActionProposal
2. ActionCard renders inline in chat:
   ┌──────────────────────────┐
   │ Aktion: E-Mail senden    │
   │ An: team@fish.de         │
   │ Betreff: Wochenplan KW23 │
   │ Inhalt: [preview]        │
   │                          │
   │ [Ablehnen]  [Bestätigen] │
   └──────────────────────────┘
3. User clicks Bestätigen → POST /elli/actions/:id/confirm
4. Elli reports: "Erledigt."
   OR
3. User clicks Ablehnen → POST /elli/actions/:id/dismiss
4. Elli acknowledges: "Verstanden. Nicht ausgeführt."
```

**Invariant:** No action that modifies state executes without this confirmation. This includes:
- Sending emails
- Creating/updating/canceling calendar events
- Creating/updating/deleting tasks
- Installing/removing integrations

### 7.8 Orb States (Header + Panel)

| State | Rotation | Pulse | Color | When |
|-------|----------|-------|-------|------|
| Idle | 20s cycle | 4s, subtle | Workspace `--accent` | Default, no active conversation |
| Listening | 12s cycle | 2s | Accent brightened | AISurface open, awaiting input |
| Thinking | 8s cycle | 1s, brighter | Accent + white shimmer | Elli processing response |
| Success | Normal | Brief flash | `--success` → accent | Action completed successfully |
| Error | Slower | Irregular | Shifts toward `--error` | Error state |
| Working | 8s cycle | Continuous | Accent intensified | Background operation in progress |

---

## 8. Tool Definitions

Each tool answers exactly ONE question.

### 8.1 Home (`/w/[slug]`)

**Question it answers:** "What's happening in this workspace right now?"

| Element | Content |
|---------|---------|
| Greeting | Time-aware: "Guten Morgen, Paul." / "Good morning, Paul." |
| Subline | "Was passiert gerade in [Workspace Name]." / "Here's what's happening in [Name]." |
| Card: Upcoming | Next 3 calendar events (time + title). Links to Calendar. |
| Card: Inbox | 3 most recent unread emails (from + subject). Links to Mail. |
| Card: Tasks | Top 3 active tasks (title + status). Links to Planner. |
| Elli prompt | "Frag Elli..." input bar. Click opens AISurface. |

**Empty state (Upcoming):**
| Condition | Display | CTA |
|-----------|---------|-----|
| Calendar not connected | "Keine Kalender-Verbindung." | "Kalender verbinden →" → `/w/[slug]/integrations/google_calendar` |
| Calendar connected, no events | "Keine Termine diese Woche." | "Kalender ansehen →" → `/w/[slug]/calendar` |

**Empty state (Inbox):**
| Condition | Display | CTA |
|-----------|---------|-----|
| Mail not connected | "Keine E-Mail-Verbindung." | "E-Mail verbinden →" → `/w/[slug]/integrations/gmail` |
| Mail connected, empty | "Alles erledigt." | "Frag Elli nach einer Zusammenfassung." → opens AISurface |

**Empty state (Tasks):**
| Condition | Display | CTA |
|-----------|---------|-----|
| No tasks | "Noch keine Aufgaben." | "Elli nach einem Plan fragen" → opens AISurface in Planner mode |

### 8.2 Mail (`/w/[slug]/mail`)

**Question it answers:** "What emails need my attention?"

**Read capabilities:**
| Feature | Detail |
|---------|--------|
| Thread list | From + Subject + Date + unread dot. Sorted by recency. |
| Thread detail | Full thread view. Individual messages within thread. |
| Labels | Label filter sidebar or tabs (INBOX, SENT, etc.) |
| Search | Via Elli: "Suche E-Mails von Anna" → Elli retrieves and presents results |

**Write capabilities (full access, behind confirmation):**
| Action | Trigger | Confirmation |
|--------|---------|-------------|
| Compose new email | User clicks compose OR asks Elli | Elli presents ActionCard with To, Subject, Body preview. User confirms. |
| Reply to thread | User clicks reply OR asks Elli | Elli drafts reply matching original language. ActionCard. User confirms. |
| Forward thread | User clicks forward OR asks Elli | ActionCard with recipient + forwarded content. User confirms. |
| Trash thread | User clicks trash OR asks Elli | Confirmation modal (destructive action). |
| Label/flag | User clicks label OR asks Elli | ActionCard. User confirms. |

**Elli integration:**
- Elli is aware of active tool = Mail when user is on this page
- Can summarize threads: "Fasse diese E-Mail-Konversation zusammen."
- Can draft replies: "Antworte, dass der Termin passt."
- Can search: "Zeig mir alle E-Mails von letzte Woche."
- All send actions require explicit confirmation

**Empty state:**
| Condition | Display | CTA |
|-----------|---------|-----|
| Gmail not connected | Mail icon (48px, `--text-tertiary`) + "Verbinde deine E-Mail." | "Gmail verbinden →" → `/w/[slug]/integrations/gmail` |
| Connected, no mail | "Alles erledigt. Keine neuen Nachrichten." | "Frag Elli nach einer Zusammenfassung." → opens AISurface |
| Connection error | "E-Mail-Verbindung unterbrochen." | "Neu verbinden →" → `/w/[slug]/integrations/gmail` |

### 8.3 Calendar (`/w/[slug]/calendar`)

**Question it answers:** "What's on my schedule?"

**Read capabilities:**
| Feature | Detail |
|---------|--------|
| Week view (default) | 7-day grid. Event blocks with time + title + source indicator. |
| Day view | Single day, hourly slots. |
| Event detail | Click event → detail panel: title, time, attendees, location, description. |

**Write capabilities (full access, behind confirmation):**
| Action | Trigger | Confirmation |
|--------|---------|-------------|
| Create event | User clicks time slot OR asks Elli | Elli presents ActionCard: Title, Date/Time, Duration, Attendees. User confirms. |
| Update event | User edits event OR asks Elli "Verschieb das Meeting auf 15:00" | ActionCard showing before → after. User confirms. |
| Cancel/delete event | User clicks delete OR asks Elli | Confirmation with "Teilnehmer benachrichtigen?" option. User confirms. |
| RSVP (accept/decline) | User clicks response OR asks Elli | ActionCard. User confirms. |

**Elli integration:**
- Elli is aware of active tool = Calendar when user is on this page
- Conflict detection: "Mittwoch 14:00 ist belegt. Wie wäre 15:30?"
- Availability check: "Wann bin ich morgen frei?"
- Weekly overview: "Wie sieht meine Woche aus?"
- Event creation: "Erstelle einen Termin mit Anna am Freitag um 10:00."
- Reschedule: "Verschieb das Team-Meeting auf Donnerstag."
- Cancel: "Sage den Termin morgen ab."
- All create/update/cancel actions require explicit confirmation

**Empty state:**
| Condition | Display | CTA |
|-----------|---------|-----|
| Calendar not connected | Calendar icon (48px, `--text-tertiary`) + "Verbinde deinen Kalender." | "Google Calendar verbinden →" → `/w/[slug]/integrations/google_calendar` |
| Connected, no events | "Keine Termine diese Woche." | "Frag Elli, deinen Tag zu planen." → opens AISurface in Planner mode |
| Connection error | "Kalender-Verbindung unterbrochen." | "Neu verbinden →" → `/w/[slug]/integrations/google_calendar` |

### 8.4 Planner (`/w/[slug]/planner`)

**Question it answers:** "What work needs to be done?"

**Features:**
| Feature | Detail |
|---------|--------|
| Board view (default) | Kanban columns: Todo / Doing / Done / Blocked |
| Task cards | Title + status pill + priority indicator + assignee avatar + due date |
| Drag-and-drop | Between columns to update status |
| Manual task creation | "Add task" button at column top |
| Task detail (`/[taskId]`) | Full view: title, description, status, assignee, priority, due date, source badge, timestamps |

**Source badges:**
| Source | Badge | Meaning |
|--------|-------|---------|
| `manual` | No badge | Created by user directly |
| `elli` | "Elli" badge (accent) | Created by Elli in Planner mode |
| `integration` | Integration icon | Created via integration (future) |

**Elli integration:**
- Elli Planner mode generates task lists considering calendar + mail + existing tasks
- "Plan meine Woche." → structured list with priorities and due dates
- "Erstelle eine Aufgabe: [title]" → single task creation
- "Was ist noch offen?" → status summary
- All task creation/modification requires confirmation
- Elli never auto-creates tasks

**Empty state:**
| Condition | Display | CTA |
|-----------|---------|-----|
| No tasks | Planner icon (48px, `--text-tertiary`) + "Noch keine Aufgaben." | "Elli nach einem Plan fragen" (primary) → opens AISurface in Planner mode. "Aufgabe erstellen" (secondary) → inline creation form. |

### 8.5 Integrations (`/w/[slug]/integrations`)

**Question it answers:** "What services are connected to this workspace?"

**Tabs:**
| Tab | Content |
|-----|---------|
| Installed | Grid of IntegrationCards with status: Active / Error / Disabled |
| Available | Grid of catalog items with [Installieren] buttons |
| Beta | Same as Available with "Beta" badge |

**Integration detail (`/[key]`):**
| Section | Content |
|---------|---------|
| Header | Back link + icon (48px) + name + description |
| Permissions | Required scopes as bullet list |
| Status | Current status badge. If configured: "Verbunden als [email]" |
| Elli says | Glass panel with Elli contextual explanation of what this integration enables |
| Actions | [Installieren →] or [Verbindung testen] [Entfernen] |

**Empty state (no installed integrations):**
| Display | CTA |
|---------|-----|
| Puzzle icon (48px) + "Keine Integrationen verbunden." | "Fang mit Gmail an" (primary) → `/w/[slug]/integrations/gmail`. "Katalog durchsuchen" (secondary) → switches to Available tab. |

### 8.6 Team (`/w/[slug]/team`)

**Question it answers:** "Who has access to this workspace?"

| State | Display |
|-------|---------|
| Solo | Member list (just you) + "Lade dein Team ein" CTA |
| With members | Member list: avatar + name + email + role badge (Owner / Admin / Member / Guest) |
| Invite (`/invite`) | Email input + role selector (member / admin / guest) + [Einladung senden →] |

**Visibility:** Owner and Admin only. Members and guests do not see this in the Rail or have route access.

### 8.7 Settings (`/w/[slug]/settings`)

**Question it answers:** "How is this workspace configured?"

| Section | Content | Editable by |
|---------|---------|-------------|
| Workspace name | Text input | owner, admin |
| Slug | Display only (read-only) | — |
| Type | Display only | — |
| Accent color | Color picker (updates `--accent` live) | owner, admin |
| Logo | Upload area | owner, admin |
| Profile (`/profile`) | Display name, avatar, locale (DE/EN), theme preference | self |
| Billing (`/billing`) | Future: plan, usage, upgrade | owner |

### 8.8 Admin (`/w/[slug]/admin`)

**Question it answers:** "What are the dangerous operational controls?"

| Feature | Detail | Visibility |
|---------|--------|------------|
| Transfer ownership | Transfer to another admin | owner only |
| Delete workspace | Permanent deletion with confirmation | owner only |
| Audit log | Future: activity log | owner, admin |

**Not a Rail item.** Accessed from Settings page by owner/admin.

---

## 9. Provider Hierarchy

```
<html>
  <body>
    <AuthProvider>                          ← Root. Checks mf-s, calls whoami.
      {children}                            ← /signin, /onboarding live here (no shell)
    </AuthProvider>
  </body>
</html>

<AuthGuard>                                 ← /w layout. Redirects if unauthenticated.
  <ShellLayout>                             ← Renders Header + Rail + Canvas + StatusBar
    {children}                              ← /w page (workspace selector)
  </ShellLayout>
</AuthGuard>

<WorkspaceProvider slug={params.slug}>      ← /w/[slug] layout. key={params.slug}.
  <ElliProvider>                            ← AI state, scoped to workspace.
    <AISurface />                           ← Elli panel, always mountable.
    {children}                              ← Tool page (mail, calendar, etc.)
  </ElliProvider>
</WorkspaceProvider>
```

### Provider Responsibilities

| Provider | Owns | Does NOT own |
|----------|------|-------------|
| AuthProvider | user, authState, login(), logout() | Workspace data, Elli state |
| WorkspaceProvider | workspaces[], activeWorkspace, switchWorkspace(), accentColor, membership | Mail/calendar/task data, Elli conversations |
| ElliProvider | mode, isOpen, toggle(), sendMessage(), messages[], pendingAction, confirmAction(), dismissAction() | Workspace data, tool data |

### State Reset Matrix

| Event | AuthProvider | WorkspaceProvider | ElliProvider | Tool state |
|-------|-------------|-------------------|-------------|------------|
| Login | Initializes | — | — | — |
| Logout | Clears | Destroyed | Destroyed | Destroyed |
| Workspace switch | Unchanged | Remounts | Remounts (fresh) | Destroyed |
| Tool navigation | Unchanged | Unchanged | Unchanged (panel stays) | Previous destroyed, new initializes |
| AISurface toggle | Unchanged | Unchanged | isOpen toggles | Unchanged |

---

## 10. Screen-Level Question Map

Every screen answers exactly ONE question. If it tries to answer two, it is wrong.

| Route | Question | Answer format |
|-------|----------|--------------|
| `/signin` | "How do I get in?" | Auth form |
| `/onboarding` | "How do I set up?" | 3-step stepper |
| `/w` | "Which workspace?" | Workspace cards |
| `/w/[slug]` | "What's happening right now?" | Dashboard cards (calendar, mail, tasks) |
| `/w/[slug]/mail` | "What emails need attention?" | Thread list |
| `/w/[slug]/calendar` | "What's on my schedule?" | Week/day view |
| `/w/[slug]/planner` | "What work needs to be done?" | Kanban board |
| `/w/[slug]/planner/[taskId]` | "What is this task?" | Task detail |
| `/w/[slug]/integrations` | "What services are connected?" | Integration grid |
| `/w/[slug]/integrations/[key]` | "What does this integration do?" | Detail + config |
| `/w/[slug]/team` | "Who has access?" | Member list |
| `/w/[slug]/team/invite` | "Who should I add?" | Invite form |
| `/w/[slug]/settings` | "How is this configured?" | Settings form |
| `/w/[slug]/admin` | "What are the dangerous controls?" | Danger zone |

---

## 11. Forbidden Patterns

| # | Pattern | Why forbidden |
|---|---------|---------------|
| 1 | Hamburger menu | Rail is always visible. No responsive collapse. |
| 2 | Breadcrumbs | URL structure is flat enough. Rail active state is sufficient. |
| 3 | Global dashboard | Violates workspace isolation. No "all workspaces" view. |
| 4 | Modal navigation | Modals for confirmation only. Content at routes. |
| 5 | Toast for errors | Errors inline, next to the action. Toast for success only. |
| 6 | Cross-workspace data | No queries spanning workspaces. RLS prevents it. |
| 7 | localStorage for workspace state | URL slug is truth. localStorage for preferences only. |
| 8 | Client-side auth as security | Auth is Worker-validated. Client-side is UX optimization only. |
| 9 | Light backgrounds / white cards | Dark system. `--surface-0: #0a0a0c` is home. |
| 10 | Auto-execute AI actions | Every Elli action requires explicit confirmation. |
| 11 | Spinners | Skeleton lines only. No spinning indicators. |
| 12 | "Please wait" text | Skeletons or streaming. If > 3s, show progress context. |
| 13 | Bounce/spring animations | Measured motion only. 200–400ms ease-out. |
| 14 | Scale > 1.05 on hover | No playful scaling. |
| 15 | Depth > 3 route segments | `/w/[slug]/tool/[id]` is maximum. |
| 16 | Dead-end screens | Every screen has a next action. EmptyState requires `cta` prop. |

---

*End of Application Shell Definition*
*Grounded in: ELYRA_CORE_ARCHITECTURE_V2.md + ELYRA_CORE_IMPLEMENTATION_SPEC.md + ELLI_AI_SYSTEM_SPEC.md*
*Date: 2026-02-08*
