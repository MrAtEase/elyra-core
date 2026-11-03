# ELYRA CORE — Implementation Specification

> 7 Deliverables · No Code · Design Thinking + Architecture
> Grounded in: ELYRA_CORE_ARCHITECTURE_V2.md + Logo/Brand Identity Reference

---

## Deliverable 1: Information Architecture

### 1.1 Public Site (Marketing — future)

```
elyra-core.app/
├── /                    → Hero + value prop + CTA ("Get started")
├── /features            → Feature grid (workspace, Elli, integrations, planner)
├── /pricing             → Tier cards (Starter / Pro / Enterprise)
├── /about               → Team, vision, manifesto
├── /legal/privacy       → Privacy policy
├── /legal/terms         → Terms of service
└── /blog                → (future) content marketing
```

**Navigation (public):**
- Sticky header: wordmark "elyra core" (lowercase, wide tracking) | Features | Pricing | About | [Sign in] | [Get started →]
- Footer: Legal links, socials, "Built in Germany"
- No Orb on public pages — text-only brand mark

### 1.2 App (Authenticated)

```
app.elyra-core.app/  (or same domain with /w prefix)
├── /signin              → Auth entry point
├── /auth/callback       → OAuth callback (transient)
├── /onboarding          → 3-step stepper (new users only)
├── /w                   → Workspace selector (multi-workspace users)
└── /w/[slug]/           → Workspace shell (all tools live here)
    ├── (home)           → Dashboard: greeting, summaries, Elli prompt
    ├── /mail            → Email inbox (read-only initially)
    ├── /calendar        → Calendar view (read-only initially)
    ├── /planner         → Task planner (Elli-generated + manual)
    │   └── /[taskId]    → Task detail
    ├── /integrations    → Marketplace (catalog + installed)
    │   └── /[key]       → Integration detail + config
    ├── /team            → Team members (owner/admin)
    │   └── /invite      → Invite flow
    ├── /settings        → Workspace settings
    │   ├── /profile     → User profile within workspace
    │   └── /billing     → Billing (future)
    └── /admin           → Workspace admin (owner/admin only)
```

### 1.3 Workspace-Aware Navigation

**Primary navigation = Rail (left vertical bar, 64px)**

| Position | Item | Icon | Route | Visibility |
|----------|------|------|-------|------------|
| Top | Home | `Home` | `/w/[slug]` | Always |
| | Mail | `Mail` | `/w/[slug]/mail` | Always |
| | Calendar | `Calendar` | `/w/[slug]/calendar` | Always |
| | Planner | `ListChecks` | `/w/[slug]/planner` | Always |
| | Integrations | `Puzzle` | `/w/[slug]/integrations` | Always |
| Bottom | Team | `Users` | `/w/[slug]/team` | owner, admin |
| | Settings | `Settings` | `/w/[slug]/settings` | Always |

**Header (top bar, 56px):**
- Left: Orb (24px, live, accent-colored) + "elyra core" wordmark
- Center: WorkspaceSelector dropdown (shows active workspace name + accent dot)
- Right: Elli trigger (Orb button, click → AISurface), User avatar + menu

**Workspace switching:**
- URL is truth: navigating to `/w/other-slug` switches workspace
- POST `/assistant/workspaces/:slug/switch` updates session
- All tool state resets (React key on workspace ID forces remount)
- Accent color transitions via CSS custom property (`--accent`)

**StatusBar (bottom, 32px):**
- Left: Workspace name + type badge
- Center: Sync status indicator
- Right: Elli status ("listening" / "thinking" / idle)

### 1.4 Information Hierarchy

```
Level 0: Authentication boundary (signed in / signed out)
Level 1: Workspace selection (which workspace am I in?)
Level 2: Tool selection (which tool am I using?)
Level 3: Content (what am I looking at within the tool?)
Level 4: Detail (specific item — task, thread, event, integration)
```

Every piece of data is scoped to Level 1 (workspace). No data leaks between workspaces. Elli is aware of the current Level 2 (tool context) and adjusts behavior.

---

## Deliverable 2: Page-by-Page Structure

### 2.1 Marketing Pages (future scope)

#### Landing Page (`/`)
```
┌─────────────────────────────────────────────────┐
│ Header: wordmark | nav | [Sign in] [Get started]│
├─────────────────────────────────────────────────┤
│ HERO                                            │
│ "Your AI-native operating system."              │
│ Subline: "Workspace. Email. Calendar. Tasks.    │
│ One platform. One copilot."                     │
│ [Get started →]  [See how it works]             │
│ Background: Orb (large, centered, ambient glow) │
├─────────────────────────────────────────────────┤
│ FEATURE GRID (2x2)                              │
│ ┌──────────────┐ ┌──────────────┐               │
│ │ Workspace    │ │ Elli AI      │               │
│ │ Everything   │ │ Your copilot │               │
│ │ in one place │ │ understands  │               │
│ └──────────────┘ │ context      │               │
│ ┌──────────────┐ └──────────────┘               │
│ │ Integrations │ ┌──────────────┐               │
│ │ Gmail, Cal,  │ │ Multi-tenant │               │
│ │ Notion, more │ │ Scale from 1 │               │
│ └──────────────┘ │ to franchise │               │
│                  └──────────────┘               │
├─────────────────────────────────────────────────┤
│ CTA BAND                                        │
│ "Start building your system."                   │
│ [Create your workspace →]                       │
├─────────────────────────────────────────────────┤
│ FOOTER                                          │
│ elyra core · Privacy · Terms · Built in Germany │
└─────────────────────────────────────────────────┘
```

### 2.2 App Pages

#### Sign In (`/signin`)

| Element | Detail |
|---------|--------|
| Layout | Full-screen, centered card (480px), glass panel |
| Background | `--surface-0` with radial gradient (accent at 3% opacity) |
| Brand | "elyra core" wordmark, `--text-xl` |
| Subtitle | "Sign in to your workspace" `--text-secondary` |
| Primary CTA | "Continue with Google" (full-width, Google icon) |
| Divider | Thin line with "or" |
| Alt auth | Email input + "Continue" button |
| Footer | "Don't have an account? Get started" link |
| Orb | NOT visible. Clean, corporate. |

#### Auth Callback (`/auth/callback`)

| State | Display |
|-------|---------|
| Loading | Centered: Orb (48px, working animation) + "Authenticating..." |
| Error | Orb shifts error color + "Authentication failed" + error detail + "Try again" button |
| Success | Instant redirect (no visible state) |

#### Onboarding (`/onboarding`)

| Step | Content | Elli Behavior |
|------|---------|---------------|
| 1: Welcome | Orb (gentle pulse) + "Willkommen bei Elyra Core." + role selection radios | Elli introduces herself |
| 2: Workspace | Name input + type toggle (Personal/Company) | Elli explains workspaces |
| 3: Ready | Workspace confirmed + 3 suggested first tasks (checkboxes) | Elli shows confidence glow |

**Empty-state behavior:** Onboarding is never skippable. If `onboarding.state !== 'complete'`, user is always redirected here.

#### Workspace Selector (`/w`)

| Condition | Behavior |
|-----------|----------|
| 0 workspaces | Redirect to `/onboarding` |
| 1 workspace | Auto-redirect to `/w/[slug]` (never show selector) |
| 2+ workspaces | Show selector: Orb (120px) + "Choose your workspace" + workspace cards |

**Workspace card:** Glass panel, 200px. Accent color bar (4px top). Name + type badge + member count. Click navigates.

#### Workspace Home (`/w/[slug]`)

```
┌─ Header ─────────────────────────────────────┐
│ Orb  elyra core   [Workspace ▾]   Elli  [AV] │
├── Rail ──┬── Canvas ─────────────────────────┤
│  ● Home  │ "Guten Morgen, Paul."             │
│    Mail  │ "Here's what's happening in [WS]" │
│    Cal   │                                    │
│    Plan  │ ┌─Upcoming──┐┌─Inbox────┐┌─Tasks─┐│
│    Integ │ │ Event 1   ││ Mail 1   ││ T 1   ││
│          │ │ Event 2   ││ Mail 2   ││ T 2   ││
│  ─────── │ │ Event 3   ││ Mail 3   ││ T 3   ││
│    Team  │ │ View →    ││ View →   ││ View →││
│    Sett  │ └───────────┘└──────────┘└───────┘│
│          │                                    │
│          │ ┌─ Elli prompt ──────────────────┐ │
│          │ │ "Ask Elli anything about [WS]" │ │
│          │ └────────────────────────────[→]──┘ │
├── StatusBar ─────────────────────────────────┤
│ [WS Name] · Company    ●synced    Elli: idle │
└──────────────────────────────────────────────┘
```

**Empty states (per card):**

| Card | Empty state | CTA |
|------|-------------|-----|
| Upcoming | "No events this week." | "Connect your calendar →" or "View Calendar →" |
| Inbox | "All caught up." + Elli suggestion | "Connect email →" or "View Mail →" |
| Tasks | "No tasks yet." | "Ask Elli to create a plan" button |

**All empty states include a next action. No dead ends.**

#### Mail (`/w/[slug]/mail`)

| State | Display |
|-------|---------|
| No integration | EmptyState: mail icon + "Connect your email to get started" + [Connect Gmail →] |
| Connected, empty | "All caught up. No new messages." |
| Connected, populated | Thread list: From + Subject + Date + unread dot. Click → thread detail. |
| Error | ErrorState: "Mail connection lost" + [Reconnect] |

#### Calendar (`/w/[slug]/calendar`)

| State | Display |
|-------|---------|
| No integration | EmptyState: calendar icon + "Connect your calendar" + [Connect Google Calendar →] |
| Connected, empty | "No events this week." + "Ask Elli to plan your day" |
| Connected, populated | Week view (default). Event blocks with time + title + source indicator. |

#### Planner (`/w/[slug]/planner`)

| State | Display |
|-------|---------|
| Empty | "No tasks yet." + "Ask Elli to create a plan for you" button + manual "Add task" |
| Populated | Kanban columns: Todo / Doing / Done / Blocked. TaskCards with drag support. |
| Task detail (`/[taskId]`) | Full-width: title, description, status, assignee, priority, due date, source badge |

#### Integrations (`/w/[slug]/integrations`)

| Tab | Content |
|-----|---------|
| Installed | Grid of IntegrationCards with status badges (Active/Error/Disabled) |
| Available | Grid of catalog items with [Install] buttons |
| Beta | Same as Available but with "Beta" badge |

**Integration detail (`/[key]`):**
- Back link + icon + name + description
- Required permissions list
- Status section (connected as / not installed)
- "Elli says" glass panel with contextual AI explanation
- Action buttons: [Install →] or [Test Connection] [Remove]

#### Team (`/w/[slug]/team`)

| State | Display |
|-------|---------|
| Solo | Member list (just you) + "Invite your team" CTA |
| With members | Member list: avatar + name + email + role badge. Owner/Admin see [Invite] |
| Invite (`/invite`) | Email input + role selector + [Send invite →] |

#### Settings (`/w/[slug]/settings`)

| Section | Content |
|---------|---------|
| Workspace | Name, slug (read-only), type, accent color picker, logo upload |
| Profile (`/profile`) | Display name, avatar, locale (DE/EN), theme preference |
| Billing (`/billing`) | Future: plan details, usage, upgrade CTA |

#### Admin (`/w/[slug]/admin`)

- Visible only to owner/admin roles
- Workspace danger zone: transfer ownership, delete workspace
- Audit log (future)
- RLS boundary: server-side role check before rendering

---

## Deliverable 3: UX Principles (Enforced)

### DO

| # | Principle | Enforcement |
|---|-----------|-------------|
| 1 | **Every screen has a next action.** No dead ends, no blank pages. | EmptyState component always requires a `cta` prop |
| 2 | **Workspace is king.** Every data query, every API call, every AI conversation is scoped to `workspace_id`. | RLS policies + API middleware + React context |
| 3 | **URL is truth.** The slug in the URL determines the active workspace. No hidden state. | `/w/[slug]` route structure, middleware enforces |
| 4 | **Progressive disclosure.** A solo founder sees 5 nav items. A franchise admin sees hierarchy. Same platform. | Role-based visibility in Rail config |
| 5 | **Elli is always available.** Not a feature — a presence. The Orb is always in the header, one click from conversation. | AISurface component mounted at shell level |
| 6 | **Dark first.** `--surface-0: #0a0a0c` is home. Light mode is out of scope. | No light mode tokens, no theme toggle |
| 7 | **German first, English always.** Default locale is DE. All strings exist in both. UI never shows raw keys. | i18n system with fallback chain: user locale → DE → EN |
| 8 | **Errors are actionable.** Every error message tells the user what happened AND what to do next. | ErrorState component requires `message` + `action` props |
| 9 | **Loading is graceful.** Skeletons, not spinners. Streaming, not waiting. | LoadingState with skeleton lines, SSE for Elli |
| 10 | **Motion is measured.** No bouncing, no scale > 1.05, no playful animations. Everything is 200–400ms ease-out. | Motion tokens enforced in design system |

### DON'T

| # | Anti-pattern | Why |
|---|-------------|-----|
| 1 | **Don't show global data.** No cross-workspace queries, no "all workspaces" view in tools. | Violates workspace isolation |
| 2 | **Don't use modals for navigation.** Modals are for confirmations and destructive actions only. | Route-based navigation is more accessible, bookmarkable |
| 3 | **Don't use toast for errors.** Errors belong inline, next to the action that caused them. Toast is for success confirmations only. | Toasts are ephemeral — errors need persistent visibility |
| 4 | **Don't auto-execute AI actions.** Every Elli action proposal requires explicit user confirmation. | Safety guardrail — `requiresConfirmation: true` |
| 5 | **Don't use localStorage for workspace state.** URL slug is truth. localStorage is for preferences only (theme, locale). | Prevents stale state, enables shareable URLs |
| 6 | **Don't use client-side auth checks as security.** Auth is validated server-side (Worker session middleware). Client-side is UX only. | Security boundary is the API, not the UI |
| 7 | **Don't show "Please wait".** Use skeletons or streaming. If something takes > 3s, show progress context. | "Please wait" is a dead interaction |
| 8 | **Don't blame the user in error copy.** Say "Connection failed" not "You entered wrong credentials". | Tone: calm authority, never patronizing |
| 9 | **Don't add light backgrounds, white cards, or high-contrast chrome.** This is a dark system platform. | Brand consistency, reduces eye strain |
| 10 | **Don't nest navigation deeper than 3 levels.** `/w/[slug]/tool/[id]` is the max depth. | Cognitive load, URL length, breadcrumb sanity |

---

## Deliverable 4: Motion & Interaction Rules

### 4.1 Timing Tokens

| Token | Value | Use |
|-------|-------|-----|
| `--duration-instant` | 100ms | Hover states, focus rings |
| `--duration-fast` | 200ms | Default transitions (opacity, color, background) |
| `--duration-normal` | 300ms | Layout shifts, panel slides |
| `--duration-slow` | 400ms | Accent color transitions, workspace switch |
| `--duration-orb` | 600ms | Orb morphing, state changes |
| `--ease-default` | `ease-out` | Most transitions |
| `--ease-panel` | `cubic-bezier(0.32, 0.72, 0, 1)` | AISurface slide, panel reveals |
| `--ease-orb` | `cubic-bezier(0.4, 0, 0.2, 1)` | Orb animations |

### 4.2 Orb States

| State | Rotation | Pulse | Color | Trigger |
|-------|----------|-------|-------|---------|
| Idle | 20s cycle | 4s cycle, subtle | Workspace accent | Default |
| Listening | 12s cycle | 2s cycle | Accent brightened | AISurface open, no input |
| Thinking | 8s cycle | 1s cycle, brighter | Accent + white shimmer | Elli processing |
| Success | Normal | Brief flash | `--success` → accent | Action completed |
| Error | Slower | Irregular | Shifts toward `--error` | Error state |
| Working | 8s cycle | Continuous brightness | Accent intensified | Background operation |

### 4.3 Interaction Patterns

#### Rail Navigation
- Hover: icon color `--text-secondary` → `--text-primary` (100ms)
- Active: background `--surface-3`, accent bar left (3px), icon `--accent` (200ms)
- Tooltip appears after 400ms hover delay
- No scale effects

#### Workspace Switching
1. User selects new workspace from dropdown
2. Accent color transitions (`--duration-slow`, ease-in-out)
3. Canvas content fades out (150ms), remounts, fades in (200ms)
4. Orb color morphs to new accent (`--duration-orb`)
5. StatusBar updates workspace name

#### AISurface Panel
- Opens: slides from right, 300ms `--ease-panel`, backdrop dims
- Closes: reverse slide, 200ms
- Never covers Rail — pushes or overlays Canvas only
- Input focus auto-set on open

#### Button Interactions
- Hover: `brightness(1.1)` for primary, `background: --surface-2` for secondary (100ms)
- Active/Press: `brightness(0.95)` for primary (instant)
- Focus: accent ring (`--accent-ring`, 2px offset) (instant)
- Disabled: `opacity: 0.4`, cursor `not-allowed`

#### Cards
- Hover: border `--border-subtle` → `--border-default` (150ms)
- No lift/shadow on hover (not a playful UI)
- Click: `--surface-2` background flash (100ms)

#### Loading States
- Skeleton lines: subtle pulse animation (1.5s cycle, opacity 0.3 → 0.7)
- Content replaces skeleton with fade-in (200ms)
- No spinners anywhere in the app

#### Toast Notifications
- Enter: slide up from bottom-right (300ms `--ease-panel`)
- Auto-dismiss: 5s, fade out (200ms)
- Hover pauses auto-dismiss timer
- Max 3 toasts stacked

#### Onboarding Step Transitions
- Step content: cross-fade (200ms out, 200ms in)
- Progress dots: accent fill slides (300ms)
- Orb responds to step (see Orb States)

### 4.4 Forbidden Motions

- No bounce/spring animations
- No scale transforms > 1.05
- No CSS `animation-timing-function: ease-in` (feels sluggish)
- No parallax scrolling
- No page transition animations (route changes are instant)
- No confetti, particles, or celebratory animations
- No auto-playing videos or hero animations on marketing

---

## Deliverable 5: Example Copy

### 5.1 Headlines & Sublines

| Location | DE | EN |
|----------|----|----|
| Landing hero | "Dein AI-natives Betriebssystem." | "Your AI-native operating system." |
| Landing sub | "Workspace. E-Mail. Kalender. Aufgaben. Eine Plattform. Ein Copilot." | "Workspace. Email. Calendar. Tasks. One platform. One copilot." |
| Sign in title | "Bei deinem Workspace anmelden" | "Sign in to your workspace" |
| Onboarding step 1 | "Willkommen bei Elyra Core." | "Welcome to Elyra Core." |
| Onboarding step 2 | "Wie heißt dein Workspace?" | "What's your workspace called?" |
| Onboarding step 3 | "Alles klar. Dein Workspace ist bereit." | "All set. Your workspace is ready." |
| Workspace home | "Guten Morgen, Paul." | "Good morning, Paul." |
| Workspace sub | "Was passiert gerade in [Name]." | "Here's what's happening in [Name]." |

### 5.2 Microcopy

| Context | DE | EN |
|---------|----|----|
| Empty inbox | "Alles erledigt. Keine neuen E-Mails." | "All caught up. No new emails." |
| Empty tasks | "Noch keine Aufgaben. Frag Elli nach einem Plan." | "No tasks yet. Ask Elli for a plan." |
| Empty calendar | "Keine Termine diese Woche." | "No events this week." |
| Integration installed | "Gmail ist verbunden." | "Gmail is connected." |
| Integration error | "Verbindung fehlgeschlagen. Bitte erneut versuchen." | "Connection failed. Please try again." |
| Workspace switch | "Wechsel zu [Name]..." | "Switching to [Name]..." |
| Session expired | "Deine Sitzung ist abgelaufen. Bitte erneut anmelden." | "Your session has expired. Please sign in again." |
| Action confirm | "Soll Elli das ausführen?" | "Should Elli execute this?" |
| Action done | "Erledigt." | "Done." |
| Loading auth | "Authentifizierung..." | "Authenticating..." |
| Auth failed | "Authentifizierung fehlgeschlagen." | "Authentication failed." |
| Retry | "Erneut versuchen" | "Try again" |
| Connection lost | "Elyra kann den Server nicht erreichen." | "Elyra can't reach the server." |
| Elli placeholder | "Frag Elli..." | "Ask Elli..." |
| Invite sent | "Einladung gesendet." | "Invite sent." |
| Task created | "Aufgabe erstellt." | "Task created." |
| Workspace created | "Workspace erstellt." | "Workspace created." |

### 5.3 Elli Responses (Conversational)

**Onboarding intro (DE):**
> "Ich bin Elli, dein AI-Copilot. Ich kenne deinen Workspace, deine E-Mails, deinen Kalender — und helfe dir, den Überblick zu behalten."

**Onboarding intro (EN):**
> "I'm Elli, your AI copilot. I know your workspace, your emails, your calendar — and I help you stay on top of things."

**First workspace greeting (DE):**
> "Willkommen in deinem neuen Workspace. Ich empfehle dir drei Dinge zum Start: E-Mail verbinden, Kalender verbinden, und deinen ersten Task erstellen."

**Integration explanation (DE):**
> "Wenn du Gmail verbindest, kann ich deine E-Mails lesen und dir Zusammenfassungen geben. Ich sende nichts ohne deine Bestätigung."

**Planner mode output (DE):**
> "Hier ist mein Vorschlag für deine Woche:"
> - "Investor-Deck finalisieren (Priorität: hoch)"
> - "Team-Meeting am Mittwoch vorbereiten"
> - "Notion-Integration aktivieren"
> "Soll ich diese Tasks erstellen?"

**Action proposal (DE):**
> "Ich möchte eine E-Mail an team@fish.de senden mit dem Betreff 'Wochenplan KW23'. Soll ich das tun?"

**Error recovery (DE):**
> "Die Verbindung zu Gmail ist unterbrochen. Das liegt wahrscheinlich daran, dass der Token abgelaufen ist. Du kannst die Verbindung unter Integrationen erneuern."

**Tone rules for Elli:**
- First person always: "Ich kann..." never "Elli kann..."
- Matches user language automatically
- Professional but warm, never patronizing
- Concise: one sentence > two sentences
- When unsure: asks for clarification instead of guessing

### 5.4 Button Labels

| Action | DE | EN |
|--------|----|----|
| Primary CTA | "Los geht's" | "Get started" |
| Continue | "Weiter" | "Continue" |
| Back | "Zurück" | "Back" |
| Save | "Speichern" | "Save" |
| Cancel | "Abbrechen" | "Cancel" |
| Delete | "Löschen" | "Delete" |
| Confirm | "Bestätigen" | "Confirm" |
| Dismiss | "Ablehnen" | "Dismiss" |
| Install | "Installieren" | "Install" |
| Connect | "Verbinden" | "Connect" |
| Disconnect | "Trennen" | "Disconnect" |
| Test connection | "Verbindung testen" | "Test connection" |
| Invite | "Einladen" | "Invite" |
| Sign out | "Abmelden" | "Sign out" |
| Create workspace | "Workspace erstellen" | "Create workspace" |

---

## Deliverable 6: Component Philosophy

### 6.1 Core Principles

**1. Server Components first, Client Components only when needed.**
Every page and layout starts as a Server Component. Client boundaries (`'use client'`) are introduced only for:
- Interactive state (forms, toggles, dropdowns)
- Browser APIs (localStorage, IntersectionObserver)
- Event handlers (onClick, onChange)
- Real-time updates (SSE, WebSocket)

**2. Composition over configuration.**
Components accept `children` and slots, not props-driven conditional rendering. A `Card` does not have `variant="with-header"` — it composes `<Card><CardHeader /><CardBody /></Card>`.

**3. One component, one file, one responsibility.**
- `ShellHeader.tsx` renders the header. It does not manage auth state.
- `Rail.tsx` renders navigation. It does not fetch workspaces.
- `AISurface.tsx` renders the panel. It does not manage Elli sessions.

**4. State lives at the right level.**
```
                Shell Level (mounted once)
                ├── AuthProvider (user, auth state)
                ├── WorkspaceProvider (workspaces, active workspace)
                └── ElliProvider (AI state, panel state)

                Page Level (remounts on route change)
                ├── Mail state (threads, selected thread)
                ├── Calendar state (events, view mode)
                ├── Planner state (tasks, filters)
                └── Integrations state (catalog, installed)
```
No global mail/calendar/tasks state. Each tool page manages its own data lifecycle.

**5. The Orb is immutable.**
`OrganicSphere.tsx` is the existing Three.js Orb implementation. It stays as-is. Other components communicate with it via props (`state`, `accentColor`), never by modifying its internals.

**6. Design tokens are the API between design and code.**
All visual decisions (colors, spacing, typography, motion) are expressed as CSS custom properties in `tokens.css`. Components reference tokens, never raw values. Accent color changes happen by updating `--accent` on the workspace shell — all components react automatically.

### 6.2 Component Categories

| Category | Location | Description | Examples |
|----------|----------|-------------|----------|
| **Shell** | `components/shell/` | Layout skeleton, always mounted | ShellLayout, ShellHeader, Rail, Canvas, StatusBar, AISurface |
| **Providers** | `components/providers/` | React context providers, state management | AuthProvider, WorkspaceProvider, ElliProvider |
| **Elli** | `components/elli/` | AI interface components | ElliPanel, ElliMessage, ElliActionCard, ElliModeSelector |
| **Workspace** | `components/workspace/` | Workspace-level views | WorkspaceHome, WorkspaceOnboarding |
| **Tools** | `components/{mail,calendar,planner}/` | Tool-specific components, self-contained | MailList, MailThread, CalendarWeek, TaskBoard, TaskCard |
| **Integrations** | `components/integrations/` | Marketplace UI | MarketplaceList, IntegrationCard, IntegrationDetail |
| **UI** | `components/ui/` | Shared primitives, no business logic | Button, Input, Card, Badge, Avatar, Modal, Toast, Tooltip |
| **Orb** | `components/orb2035/` | Three.js organic sphere | OrganicSphere (keep as-is) |

### 6.3 Component Sizing Guidelines

| Size | Lines | When |
|------|-------|------|
| Tiny | < 30 | Pure presentational wrappers (`Canvas.tsx`, `Badge.tsx`) |
| Small | 30–80 | Single-purpose UI (`NavItem.tsx`, `IntegrationCard.tsx`) |
| Medium | 80–150 | Feature components (`Rail.tsx`, `ShellHeader.tsx`, `ElliPanel.tsx`) |
| Large | 150–250 | Complex interactive (`AISurface.tsx`, `MarketplaceList.tsx`) |
| Too large | > 250 | Decompose. No component should exceed 250 lines. |

### 6.4 Data Flow

```
User Action
    → React Event Handler
    → Provider method (e.g., sendMessage())
    → fetch() to Worker API
    → Worker validates session (D1)
    → Worker queries/mutates (Supabase)
    → Response (JSON or SSE)
    → Provider updates state
    → React re-renders
```

No direct Supabase access from the frontend. The Worker API is the single data gateway. This ensures:
- Session validation at the edge
- RLS enforcement on every query
- CORS control
- Rate limiting
- Consistent error shapes

---

## Deliverable 7: Next.js Implementation Plan

### 7.1 App Router Structure

```
frontend/
├── app/
│   ├── layout.tsx                    # Root: <html>, <body>, fonts, global providers
│   ├── page.tsx                      # / → Server redirect logic
│   ├── globals.css                   # Imports tokens.css
│   ├── signin/
│   │   └── page.tsx                  # Client: Supabase Auth UI
│   ├── auth/
│   │   └── callback/
│   │       └── route.ts             # Server Route: OAuth callback → exchange → redirect
│   ├── onboarding/
│   │   └── page.tsx                  # Client: 3-step stepper
│   ├── w/
│   │   ├── layout.tsx               # Server: ShellLayout wrapper (renders header + rail + canvas)
│   │   ├── page.tsx                 # Server: workspace selector (fetches workspaces)
│   │   └── [slug]/
│   │       ├── layout.tsx           # Client: WorkspaceProvider (sets active workspace)
│   │       ├── page.tsx             # Server: workspace home (dashboard)
│   │       ├── mail/
│   │       │   └── page.tsx         # Client: mail inbox
│   │       ├── calendar/
│   │       │   └── page.tsx         # Client: calendar view
│   │       ├── planner/
│   │       │   ├── page.tsx         # Client: task board
│   │       │   └── [taskId]/
│   │       │       └── page.tsx     # Client: task detail
│   │       ├── integrations/
│   │       │   ├── page.tsx         # Server: marketplace list
│   │       │   └── [key]/
│   │       │       └── page.tsx     # Client: integration detail + config
│   │       ├── team/
│   │       │   ├── page.tsx         # Server: team list
│   │       │   └── invite/
│   │       │       └── page.tsx     # Client: invite form
│   │       ├── settings/
│   │       │   ├── page.tsx         # Client: workspace settings
│   │       │   └── profile/
│   │       │       └── page.tsx     # Client: user profile
│   │       └── admin/
│   │           └── page.tsx         # Client: admin panel
│   ├── help/
│   │   └── page.tsx
│   └── system/
│       └── diagnostics/
│           └── page.tsx
├── components/                       # (as described in Component Philosophy)
├── lib/
│   ├── api.ts                       # Fetch wrapper (handles mf-s cookie, error shapes, 401 redirect)
│   ├── i18n/
│   │   ├── translations.ts          # String catalog (existing, extended)
│   │   ├── useI18n.ts               # Hook: returns t() function
│   │   └── locales.ts               # Supported locales config
│   └── hooks/
│       ├── useWorkspace.ts          # Reads from WorkspaceProvider
│       ├── useAuth.ts               # Reads from AuthProvider
│       └── useElli.ts               # Reads from ElliProvider
├── styles/
│   └── tokens.css                   # Design tokens (updated to match V2 spec)
├── middleware.ts                     # Root redirect + legacy route redirect
└── next.config.ts                   # Rewrites for /assistant/* → Worker API
```

### 7.2 Provider Hierarchy

```tsx
// app/layout.tsx (Root)
<html>
  <body>
    <AuthProvider>           {/* Checks mf-s cookie, calls whoami */}
      {children}
    </AuthProvider>
  </body>
</html>

// app/w/layout.tsx (Shell)
<AuthGuard>                  {/* Redirects to /signin if unauthenticated */}
  <ShellLayout>              {/* Renders header + rail + canvas grid */}
    {children}
  </ShellLayout>
</AuthGuard>

// app/w/[slug]/layout.tsx (Workspace)
<WorkspaceProvider slug={params.slug}>  {/* Sets active workspace, fetches membership */}
  <ElliProvider>                         {/* AI state, scoped to workspace */}
    <AISurface />                        {/* Elli slide-over panel */}
    {children}                           {/* Canvas content (page) */}
  </ElliProvider>
</WorkspaceProvider>
```

**Key:** AuthProvider wraps everything. WorkspaceProvider and ElliProvider are nested inside the workspace layout. When the slug changes (workspace switch), both providers remount with fresh state.

### 7.3 Middleware

```
middleware.ts handles:
1. / → check mf-s cookie → /w (has session) or /signin (no session)
2. /workspace/* → redirect to /w/* (legacy route migration)
3. All other routes → pass through

Matcher: ['/', '/workspace/:path*']
```

The middleware does NOT validate the session — it only checks cookie existence. The Worker API validates on every request.

### 7.4 API Consumption Pattern

```typescript
// lib/api.ts
const API_BASE = '/assistant'  // Proxied to Worker via next.config.ts rewrites

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',  // Sends mf-s cookie
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  })

  if (res.status === 401) {
    window.location.href = '/signin?reason=session_expired'
    throw new Error('Session expired')
  }

  if (!res.ok) {
    const error = await res.json()
    throw new ApiError(error.code, error.message || 'Unknown error')
  }

  return res.json()
}
```

**Next.js rewrite (next.config.ts):**
```
/assistant/:path* → https://api.elyra-core.app/assistant/:path*
```
This keeps the Worker API on its own domain while avoiding CORS issues for the frontend.

### 7.5 Workspace Switching

```
1. User clicks WorkspaceSelector → selects "Fish GmbH"
2. UI calls: POST /assistant/workspaces/fish-gmbh/switch
3. Worker updates session.active_workspace_id in D1
4. Worker returns updated WhoamiResponse
5. Frontend navigates to /w/fish-gmbh (Next.js router.push)
6. [slug] layout remounts → WorkspaceProvider receives new slug
7. WorkspaceProvider fetches fresh workspace data
8. CSS --accent updates → all components react
9. Orb color morphs (600ms)
10. Canvas content remounts with new workspace scope
```

**React key pattern:** The `[slug]/layout.tsx` uses `key={params.slug}` to force full remount on workspace switch. This ensures zero stale state.

### 7.6 Elli Integration

```
AISurface (slide-over panel) is mounted at [slug]/layout.tsx level.
It is always available within any workspace route.

Chat flow:
1. User types message → ElliProvider.sendMessage(text)
2. POST /assistant/workspaces/:slug/elli/chat (SSE stream)
3. EventSource receives:
   - event: message → append to messages[]
   - event: action → set pendingAction
   - event: task → add to task suggestions
   - event: done → mark session complete
4. ElliPanel renders messages in real-time (streaming)
5. ActionCards appear inline for confirmations

Mode switching:
- ElliModeSelector in panel header
- Changes mode in ElliProvider state
- Next message includes mode in request body
- System prompt adjusts server-side
```

### 7.7 Migration Strategy (from current codebase)

| Phase | What | Detail |
|-------|------|--------|
| **Phase 1** | Route migration | Create `/app/w/[slug]/` structure. Set up middleware. Redirect old `/workspace/` routes. |
| **Phase 2** | Shell decomposition | Split `WorkspaceShell.tsx` (1092 lines) into 7 shell components. Split `WorkspaceContext.tsx` (1574 lines) into 3 providers. |
| **Phase 3** | Design tokens | Update `tokens.css` to match V2 design system (colors, typography, spacing, motion). |
| **Phase 4** | API layer | Migrate Worker to Hono router. Add new workspace/integrations/elli/tasks routes. Scope existing routes under `/assistant/workspaces/:slug/`. |
| **Phase 5** | Supabase schema | Deploy Postgres schema (profiles, workspaces, workspace_members, etc.). Set up RLS policies. Extend D1 with 0004 migration. |
| **Phase 6** | Tool pages | Build mail, calendar, planner, integrations pages. Each is self-contained with own state. |
| **Phase 7** | Elli system | Build ElliProvider, AISurface, ElliPanel. Implement SSE streaming. Wire up action proposals. |
| **Phase 8** | Onboarding | Rebuild onboarding stepper as 3-step flow. Wire to workspace creation API. |

**Parallel work:** Phases 3 (tokens) and 4 (API) can run in parallel. Phase 5 (schema) must complete before Phase 6 (tool pages) and Phase 7 (Elli).

### 7.8 Non-Negotiable Technical Constraints

1. **No direct Supabase access from frontend.** All data flows through the Worker API.
2. **mf-s cookie is the session token.** HttpOnly, Secure, SameSite=None. No JWT in localStorage.
3. **D1 is the edge auth cache.** Supabase Postgres is the source of truth.
4. **Server Components by default.** `'use client'` only when interactive state is required.
5. **No external CSS frameworks.** Design system is custom, built on CSS custom properties.
6. **No Redux, Zustand, or Jotai.** React Context is sufficient for the 3-provider model.
7. **Orb implementation is frozen.** `OrganicSphere.tsx` is not modified. Communicate via props only.
8. **All API responses follow `{ ok: boolean, ...data }` shape.** Consistent error contract.
9. **Rate limiting on Elli endpoints.** 20 messages/minute per user per workspace.
10. **i18n is mandatory.** Every user-facing string goes through the translation system.

---

*End of Implementation Specification*
*Grounded in: ELYRA_CORE_ARCHITECTURE_V2.md · Logo/Brand Identity Reference (6 images)*
*Date: 2026-02-08*
