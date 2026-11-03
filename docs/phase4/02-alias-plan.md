# Phase 4 Alias Plan

## Worker CORS updates
- `worker/src/index.ts` now keeps its original allowlist entries (`app.elyra-core.app`, `pitchdeck.elyra-core.app`, the Workers.dev preview) and adds the MERLIN shell domain (`mira-assistant.elyra-core.app`).
- Placeholder origins for the future `mira.os` rollout (`app.mira.os`, `shell.mira.os`, `merlin.mira.os`, `mira.os`) are also pre-seeded in the static allowlist so Cloudflare Pages traffic from the new hosts will be accepted once DNS/TLS is swapped.
- Requests can now include additional allowlist entries through environment overrides; the helper `getDashboardOriginOverrides` normalizes `DASHBOARD_URL_PRIMARY`, `DASHBOARD_URL`, and comma/array values from `DASHBOARD_URLS` and adds those origins before CORS validation.

## Environment alias strategy
- `DASHBOARD_URL` remains the default; existing deployments continue to work without any configuration change.
- New env vars:
  - `DASHBOARD_URL_PRIMARY` explicitly marks the canonical dashboard origin for MIRLIN-friendly tooling.
  - `DASHBOARD_URLS` accepts a comma-separated string (or an array in env config) of extra dashboard origins that should be allowed for CORS.
- The worker silently accepts both the legacy `DASHBOARD_URL` and the new fields, ensuring backwards compatibility while preparing for multi-domain rollouts.

## Validation command
- `git status -sb worker/src/index.ts docs/phase4/02-alias-plan.md`
