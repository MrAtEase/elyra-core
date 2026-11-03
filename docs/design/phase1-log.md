# Phase 1 Foundation Log

## Summary
- Added six audit docs (`docs/audit/00-current-state.md` through `docs/audit/06-risk-register.md`) capturing domains, auth, UI structure, modules, deploy pipeline, and up-to-date risks with paths/snippets.
- Built the new design foundation: a theme token layer with classic / holo modes, a persisted theme switcher, a lightweight dropdown trigger, and a theme engine that stores preferences under `mira.theme` / `mira.mode`.
- Introduced a feature-flagged `Shell v2` scaffold that listens to `?shell=v2` or the `localStorage.mira.shell` key, renders a three-column OS-like grid (rail + module canvas + inspector), and wires a layout engine that powers drag-resize handles plus inspector toggles.
- Added a lightweight panel registry plus placeholder inspector content so modules can register context-aware views without the shell knowing details, and shipped the new `docs/design/shortcuts.md` reference for `⌘B`/`⌘I`/`Esc`.
- Added a theme dropdown button in the header and wire-ups for toggling between `classic/light`, `classic/dark`, and `holo/dark` without breaking the legacy shell.
- Linked the new functionality back to the legacy `Merlin` engine by exposing `Merlin.setTheme`/`Merlin.getTheme`, registering the nav entries, and ensuring the new shell does not load unless `MIRA_SHELL_V2` is set or `?shell=v2` is present.

## Verification Steps
1. `npm test` (runs `TS_NODE_TRANSPILE_ONLY=1 node --require ts-node/register --test mira-os/tests/**/*.test.ts`). ✔ (1 pass, 2 skipped).
2. `curl -i -X POST https://api.elyra-core.app/assistant/auth/logout` → `200` with `set-cookie: mf-s=; Domain=.elyra-core.app; Max-Age=0`.
3. `curl -i https://api.elyra-core.app/assistant/auth/whoami` → `401`, JSON `{ "code": "AUTH_REQUIRED" ... }`.
4. `curl -iL "https://api.elyra-core.app/assistant/oauth/google/start?next=https%3A%2F%2Fapp.elyra-core.app%2Fworkspace"` → final redirect to Google consent page.
5. Manual checklist (see `docs/design/shortcuts.md`): legacy shell loads, `Shell v2` only activates with `?shell=v2` or `localStorage.mira.shell = "v2"`, the rail responds to `⌘B`/`Ctrl+B`, the inspector responds to `⌘I`/`Ctrl+I` + `Esc`, drag handles adjust column widths, theme dropdown toggles between presets, and the console stays clean while the shell resizes or themes change.

## Runbook Notes
- Rebuild the worker with `cd worker && npm ci && npm run build`, then `npx wrangler deploy` as GitHub Actions does.
- To refresh the theme foundation during development, open the theme dropdown action (`header button with 🎨`), select a preset, and confirm the `data-theme`/`data-mode` attributes on `<html>` match your choice.
- The new nav registry eagerly registers apps in `mira-app/js/os/navRegistry.js`, so adding a module there will surface it to Shell v2 once `Merlin.switchModule` is wired to that entry.
- The layout engine persists rail/inspector widths in `localStorage.mira.layout`, so adjust them and then re-open the shell to restore the last state.

## Rollback Instructions
1. **Disable Shell v2**: remove `localStorage.mira.shell` or set it to anything other than `"v2"`, avoid `?shell=v2`, and clear `MIRA_SHELL_V2` to fall back to the legacy layout.
2. **Undo theme overrides**: clear `localStorage.mira.theme` and `localStorage.mira.mode` to revert to `classic/light`, or reinstall the previous token defaults.
3. **Revert docs/tooling**: roll back `docs/audit/*`, `docs/design/*`, and the `mira-app` layout/theme files to drop the new experiences; restore `docs/design/shortcuts.md` if it was not desired.
