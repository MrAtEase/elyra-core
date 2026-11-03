# MiraOS Phase 1 Contract

## Lifecycle States & Permissions
- `boot`: Core initialization only; no DOM or HUD work. Modules may register listeners but must not mutate state.
- `ready`: Core state is stable, UI may mount, diagnostics/capabilities reports are permitted, DOM probing is allowed.
- `interactive`: User-facing rendering and HUD/Holo layers can activate; policies are now enforced by lifecycle guards.
- `sleep`: Reserved for shutdown or background pause; no automatic lifecycle transitions occur in PHASE 1.

UI/Holo/HUD subsystems must wait for `MiraOS.lifecycle.get() === "ready"` before initializing anything that touches the DOM, and should only send user interaction jobs after `interactive` is announced. Use `MiraOS.lifecycle.on(state, handler)` to gate access.

## StateFabric Write Rules
- StateFabric (`MiraOS.stateFabric`) is the single source of truth. Direct writes outside approved facades/state-actions are deprecated.
- Approved writers are facades defined in `mira-app/os/` (`layoutFacade`, `features`, `facades`, `lifecycles`, etc.) and `stateActions` helpers.
- UI layers must treat `globalState` and `contextBus` as read-only mirrors. Any mutation attempt triggers a console warning in dev builds.
- Guarded paths (`layout`, `features`, `os.lifecycle`) reject unauthorized sources and log warnings (via `__MIRA_DEBUG`/`NODE_ENV`).

## Diagnostics Snapshot Guarantees
- `MiraOS.diagnostics.snapshot()` returns a JSON-safe object:
  - `lifecycle`: `{ state, history }`
  - `layout`, `features`, `theme`, `hud`, `activeModule`
  - `panels`: `{ total, registered, active }`
  - `domPresence`: sanitized counts/flags (`orbitDeckCount`, `hudRailCount`, etc.)
  - `capabilities`: output of `MiraOS.capabilities.list()`
+- Snapshots never include tokens, refresh tokens, headers, or bodies (`access_token`, `refresh_token`, `authorization`, `set-cookie` are explicitly prohibited).
- `dump()` pretty-prints the same safe structure, and `attachConsole()` emits throttled logs without leaking secrets.
- Trigger `os:diagnostics:snapshot` whenever `snapshot()` runs so bus listeners observe the same trimmed truth.

## Capabilities Registry Expectations
- Capabilities are declarative booleans derived from StateFabric, lifecycle state, and safe DOM/WebGL probes.
- Exposed API:
  - `MiraOS.capabilities.has(name)`
  - `MiraOS.capabilities.list()`
- Current entries (subject to future extension): `layout.holo`, `hud.enabled`, `hologram.available`, `panels.windowing`, `diagnostics.enabled`.
- Future HUD/Holo systems should poll `capabilities.list()` or `capabilities.has()` once lifecycle ≥ `ready` to decide which overlays can activate.

### Hooking Tips for Future Layers
- Diagnostics consumers: call `MiraOS.diagnostics.snapshot()` when you need the current truth; subscribe to `os:diagnostics:snapshot` for updates.
- Lifecycle-aware boot: listen to `MiraOS.lifecycle.on("ready", ...)` before touching DOM/persistence; upgrade to `interactive` only after Merlin/UI confirms readiness.
- Capabilities-driven modules should re-check the registry if they detect state changes (e.g., feature toggles, HUD gates) by subscribing to `os:state:updated` or the relevant StateFabric slices.
