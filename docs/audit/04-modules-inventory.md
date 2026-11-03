# Module Inventory (Mail/Calendar/Tasks/Docs/Knowledge/Dev/Slides)

## What exists now
| Module | Entry file | Key entry point / endpoint |
| --- | --- | --- |
| Dashboard | `mira-app/modules/dashboard-panel.js` | `registerPanel("dashboard", …)` builds cards, fetches fusion data via `/assistant` helpers.
| Calendar | `mira-app/modules/calendar-panel.js` | Calendar view pulls events from `/assistant/calendar` and renders within the context panel.
| Tasks | `mira-app/modules/tasks-panel.js` | Tasks queue uses `/assistant/tasks/*` routes and is joined with planner nudges.
| Mail | `mira-app/modules/email-panel.js` | Calls `/assistant/email/*` and exposes message threading + Merlin actions.
| Documents / Slides / Knowledge | `mira-app/modules/documents-panel.js`, `slides-panel.js`, `knowledge-panel.js` | Documents + Slides modules share `panel` registration; Knowledge uses semantic helpers and `worker` endpoints.
| Planner / Dev Workspace / Admin / Settings | `planner-panel.js`, `devworkspace-panel.js`, `admin-panel.js`, `settings-panel.js` | System modules render workspaces, toggles, and admin tables via `Merlin` commands.

## Where in code
Each panel registers via `registerPanel` when its module file loads. The shell imports them at the top of `mira-app/js/mira.js`:

```js
import "../modules/dashboard-panel.js";
import "../modules/calendar-panel.js";
import "../modules/tasks-panel.js";
import "../modules/email-panel.js";
import "../modules/documents-panel.js";
import "../modules/slides-panel.js";
import "../modules/knowledge-panel.js";
import "../modules/planner-panel.js";
import "../modules/settings-panel.js";
import "../modules/devworkspace-panel.js";
import "../modules/admin-panel.js";
```

`Merlin.router`, `Merlin.dashboard`, and the `stateActions.js` helpers wire the modules into `#moduleRoot`, while shared helpers like `contextBus.js`, `notifications.js`, and `toolRouter.js` coordinate API calls.

## How to verify
1. Click each nav wheel item (`Dashboard`, `Calendar`, `Tasks`, `Mail`, etc.) and confirm the module card renders in `#moduleRoot` and populates data from the worker.
2. Trigger Merlin actions (e.g., “Summarize priorities”) to exercise `/assistant` endpoints and ensure panels receive context updates.
3. Inspect `Merlin.context` cards in the right column – selecting mail items or tasks should swap content via `contextBus.js`.

## Known gaps
- Module registration is centralized inside `mira-app/js/mira.js`, so adding new entries currently requires editing this file instead of a plugin-friendly registry (the upcoming nav registry addresses that).
- Planner, Dev, Admin, and Settings panels are not surfaced in the header wheel, so they can only be reached via command palette or toolbar actions, making discoverability low.
- No automated tests cover module pipelines, so regressions in module rendering must be confirmed manually or instrumented via future UI tests.
