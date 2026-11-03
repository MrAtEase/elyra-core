# Elyra Core — AI OS Canvas Deliverables

## Architecture
- Primary authenticated desktop is `frontend/app/w/[slug]/page.tsx` and renders `frontend/components/os/DesktopCanvas.tsx`.
- `DesktopCanvas` is now the OS shell: top bar, persistent Orb presence, dock, global intent line, orchestrator panel, and program windows.
- Window state is centralized in `frontend/components/os/windowing/WindowManagerProvider.tsx` and consumed via `frontend/components/os/WindowManager.tsx`.
- Program windows are rendered through `frontend/components/os/Window.tsx` (wrapper for `WindowFrame`).

## Orb Reuse (Exact Source)
- Original orb implementation reused unchanged from:
  - `frontend/components/orb2035/OrganicSphere.tsx`
  - `frontend/components/orb2035/organic/*`
- New wrapper: `frontend/components/orb/OrbPresence.tsx`
  - Adds position/scale and state hooks (`idle`, `thinking`, `running`, `error`) without editing orb internals.

## Window System
- Open/focus/minimize/close/maximize/drag/resize behavior is implemented in:
  - `frontend/components/os/windowing/WindowManagerProvider.tsx`
  - `frontend/components/os/windowing/WindowFrame.tsx`
- Persisted per workspace+user via localStorage keys:
  - `elyra.os.<workspaceId>.<userId>.layout.v1`
  - `elyra.os.<workspaceId>.<userId>.appearance.v1`
- Supported windows:
  - Mail
  - Calendar
  - Files
  - Docs
  - Slides
  - Build / Code
  - Marketplace
  - Settings

## Functional Programs
- Mail window (`frontend/components/os/apps/AppMailWindow.tsx`):
  - connection/setup state
  - thread list
  - open thread
  - draft reply via existing assistant call (`sendAssistantChatMessage`)
  - supervised send via existing send flow (`sendMail`)
- Calendar window (`frontend/components/os/apps/AppCalendarWindow.tsx`):
  - connection/setup state
  - upcoming event list
  - create event modal (`createCalendarEvent`)
  - quick “Schedule with Elyra” action via existing assistant call
- Marketplace window (`frontend/components/os/apps/AppMarketplaceWindow.tsx`):
  - categories (Communication, Docs, Dev, Business, Automations)
  - connect/disconnect state
  - permissions preview
  - open related app

## Identity / Workspace Mode
- Desktop top bar enforces business owner presentation for founder domain accounts:
  - `@elyra-core.app` shows business context and owner/system badge.
- Workspace switcher is available in top bar.
- Logout action is available in top-right profile menu.
- `/system` remains hidden from main dock/navigation and only appears in profile menu for system-capable roles.

## New / Updated Component Paths
- `frontend/components/os/DesktopCanvas.tsx`
- `frontend/components/os/WindowManager.tsx`
- `frontend/components/os/Window.tsx`
- `frontend/components/os/Dock.tsx`
- `frontend/components/os/IntentLine.tsx`
- `frontend/components/orb/OrbPresence.tsx`
- `frontend/components/os/apps/AppMailWindow.tsx`
- `frontend/components/os/apps/AppCalendarWindow.tsx`
- `frontend/components/os/apps/AppMarketplaceWindow.tsx`
- `frontend/components/os/apps/AppBuildWindow.tsx`
- `frontend/app/globals.css` (orb presence + OS polish additions)

## Extend Apps
1. Add new `AppId` in `frontend/components/os/windowing/windowTypes.ts`.
2. Add `AppDefinition` in `frontend/components/os/DesktopCanvas.tsx`.
3. Add dock icon/button in `frontend/components/os/Dock.tsx`.
4. Add slash command mapping in `frontend/components/os/IntentLine.tsx`.
5. Create app window component under `frontend/components/os/apps/` and map it in `DesktopCanvas` window renderer.
