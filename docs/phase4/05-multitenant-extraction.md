# Phase 4 Multitenant Extraction Plan

## Hardcoded `fish-delish` touchpoints to audit
- `worker/src/index.ts`, `apiOrigin.js`, and `/services/api-gateway` contain hardcoded workspace IDs, domains, and default redirect URLs (`ws-default`, `app.elyra-core.app`, `api.elyra-core.app`).
- `mira-app/` assets (HTML/JS/modules) target `fish-delish` domains and text, which also drives Google OAuth helpers via the worker.
- `fish-delish-site/` is entirely branded for the customer, so any reusable workspace should live under a `workspaces/` configuration layer rather than duplicating this directory.

## Config layer concept
- Introduce a `tenantConfig` object (e.g., `config/tenants.ts`) that defines `workspaceId`, `dashboardDomain`, `assistantDomain`, `brandingName`, and allowed origins per tenant.
- Ensure worker endpoints, MERLIN shell (via `js/apiOrigin.js`), and VS Code tooling (`merlin-vscode/src/config.ts`) read from a shared config service that can resolve the current workspace context (personal, fish-delish, mira-os, etc.).
- Each tenant entry should expose template slots for `panelId`, `defaultUserKey`, and localizations so that brand-specific strings (like “Fish Delish”) can be swapped without touching code logic.

## Parameterization backlog
1. Extract workspace identifiers (`ws-default`) into the config layer and let the worker derive `DEFAULT_WORKSPACE_ID` from the active tenant.
2. Move domain references (`app.elyra-core.app`, `mira-assistant.elyra-core.app`, `api.elyra-core.app`) into tenant metadata so we can add `app.mira.os`, `merlin.mira.os`, `api.mira.os` later.
3. Centralize allowed origin lists in the worker and shell (already started via `getDashboardOriginOverrides`) so tenant config can append its own `allowedOrigins` array.
4. Keep UI templates branded per tenant by parameterizing `mira-app/index.html`/`fish-delish-site/index.html` with the tenant’s brand name and copy.

## MVP boundaries (keep fixed)
- `fish-delish` remains the default workspace during Phase 4; new tenants can share the configuration layer but do not yet have production routes.
- The marketing site (`elyra-core.app`) continues to live under the same domain until the DNS migration plan is executed.
- Google OAuth redirect URIs (`GOOGLE_REDIRECT_URI`) stay tied to `api.elyra-core.app` until Cloudflare Workers routes respect the new alias.

## Validation command
- `rg -n "fish-delish" worker/src/index.ts mira-app/js/apiOrigin.js fish-delish-site/index.html`
