# UI Architecture Snapshot

## What exists now
- The static shell at `mira-app/index.html` renders a holo header, assistive left column (M.E.R.L.I.N input + awareness), a central module panel, and a right context pane; resizable split-view handles assistant/module/context orbits.
- `mira-app/js/mira.js` wires `MiraOS`, a command palette, notifications, module routing, and the `Merlin` assistant; the `modules/` directory adds entry points for Dashboard, Calendar, Tasks, Email, Documents, Slides, Knowledge, Planner, Settings, Dev Workspace, and Admin views.
- Existing navigation is a nav wheel tied to `MiraOS.deck` and legacy layout, so any new shell must sit behind a feature flag to avoid regression.

## Where in code
The earliest JavaScript constants define the deck ordering and aliases used by the wheel:

```js
const ORBIT_DECK_MODULES = [
  { id: "dashboard", label: "Dashboard" },
  { id: "calendar", label: "Calendar" },
  { id: "tasks", label: "Tasks" },
  { id: "email", label: "Email" },
  { id: "documents", label: "Documents" },
  { id: "dev", label: "Dev Workspace" },
];
const MODULE_ALIASES = {
  slides: "documents",
  docs: "documents",
  doc: "documents",
  mail: "email",
  emails: "email",
};
```

`bindChromeUi()` (around `mira-app/js/mira.js:4700+`) wires the modal, settings, and sessions controls, while `initOrbitSplitView()` keeps manual column resizing responsive.

## How to verify
1. Open `https://app.elyra-core.app` (legacy shell) and confirm the nav wheel loads, the assistant widget responds to typing, and modules mount within `#moduleRoot`.
2. Run the manual checklist: legacy shell loads, theme toggle doesn’t break layout, new shell flag-enabled view is hidden until activated, and context actions render per module selection.
3. Inspect `mira-app/js/mira.js` for errors in the console, particularly around `MiraOS.command` and `Merlin.switchModule` hooks.

## Known gaps
- The UI is tightly coupled to the legacy shell layout (nav wheel + 3-column split) so enhancements must be carefully feature-flagged before replacing the experience.
- There is no current documentation of how modules register themselves beyond comments; the nav wheel, command palette, and context panels are all orchestrated by `mira-app/js/mira.js`, making new layouts sensitive to DOM changes.
- Theme switching and `Shell v2` still need persisted state, new tokens, and a fallback (this audit is preparing that foundation).
