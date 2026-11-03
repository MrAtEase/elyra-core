# Phase 5 Rename Decision

- **New folder name:** `mira-app/`
- **Why:** The Pages project already goes by `mira-app` in the Cloudflare dashboard and serves the app available at `app.elyra-core.app`. Aligning the repo folder with that name makes the ownership clearer for future ops and matches public branding.
- **Scope:** Only the static shell folder is renamed (`mira-app/` → `mira-app/`). The backend worker (`mira-assistant`) and the domains (`app.elyra-core.app`, `api.elyra-core.app`, and `mira-assistant.elyra-core.app` during the alias phase) stay on their current identifiers during the transition. After the rename, only the Pages root directory will point at `mira-app/` while the custom domains remain untouched until the manual Cloudflare change.
