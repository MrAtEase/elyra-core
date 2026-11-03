# Panel System Audit

## Registry & adapter flow
- Each `mira-app/modules/*-panel.js` imports the panel registry (`registerPanel`, `mountLegacyModule`, `attachOsListeners`) and publishes a normalized config (`mount`, `unmount`, optional metadata). Native modules explicitly register before any UI rendering.
- When the shell loads a module, `ensurePanelAdapter(moduleId, moduleImport)` confirms a registration exists and, if it does not, registers a legacy fallback that routes through `mountLegacyModule`.

## Canonical lifecycle contract (PHASE 2)
- The new contract lives in `mira-app/os/panels.js` and exposes `MiraOS.panels.register`, `mount`, `unmount`, `refresh`, and `getState`. Module wrappers keep importing `registerPanel`, which delegates to the same shared registry so module metadata stays centralized.
- `mount` now enforces invariants: it waits for `os.lifecycle` to reach `ready`, prevents double mounts without an explicit `unmount`, records the host descriptor, and twice-dirties the `os.panels` snapshot for diagnostics (`stateFabric` now tracks `os.panels.entries`, `os.panels.mounted`, and `os.panels.activePanel`).
- `unmount` is idempotent, releases the stored context, and clears the active panel reference. `refresh` either runs when the lifecycle is `interactive` (or the panel opts into `capabilities.allowRefreshBeforeInteractive`) or re-queues the reason until the OS forwards `interactive`/`sleep` events via the lifecycle listener.
- Any error bubbling from `mount`, `unmount`, or `refresh` is captured into the entry’s state and emitted on the OS bus as `os:panel:error`, keeping diagnostics JSON-safe and privacy-safe.

## Host selection & DOM creation
- The shell still owns the DOM host: `Merlin.cacheDom()` targets `#moduleRoot`, `#contextRoot`, and header placeholders, while `Merlin.mountModule()` clears the module container, creates a `.module-shell-content` buffer, and passes that host to `MiraOS.panels.mount(...)`.
- Modules never reach into DOM roots themselves; all module rendering helpers run inside the host that the contract supplies, ensuring there is a single canonical path for host allocation and cleanup.

## Refresh & lifecycle gating
- Refresh calls can be issued before a panel is mounted or before the lifecycle hits `interactive`. In either case, the contract queues the request, drains the queue after the panel has been mounted, and re-drains it when the lifecycle emits `interactive`/`sleep`. Panels that need earlier refreshes opt into `capabilities.allowRefreshBeforeInteractive`.

## Diagnostics & state visibility
- `stateFabric` exposes panel status under `os.panels.*`, so HUD/debug subsystems can snapshot the active/mounted list plus the last error per panel. `MiraOS.panels.getState(id)` mirrors the same data structure for programmatic checks.
- The OS now owns a lightweight window abstraction (`MiraOS.windows`) that maps semantic regions (`main`, `side`, `overlay`, etc.) to DOM hosts, instantiates a `.module-shell-content`-style window for each panel mount, and keeps `os.windows` in sync with the active window, count, and panel-to-window mapping.
