# Phase 4 Worker Rename Plan

## What stays live
- `mira-assistant` remains the worker bound to `api.elyra-core.app`. The existing `worker/wrangler.toml` and `.github/workflows/deploy-worker.yml` keep operating without change, ensuring zero downtime.
- Secrets, routes, and the Cloudflare project name remain untouched until we have sufficient confidence in the alias workflow.

## Alias creation (merlin-api)
1. Create a new Cloudflare Worker entry named `merlin-api` that uses the exact same code/dependencies. Keep its `wrangler` config pointing to the same `worker/src/index.ts` (possibly cloning `worker/wrangler.toml` into `worker/wrangler.merlin-api.toml`).
2. Ensure the alias worker carries the same KV bindings (`ASSISTANT_KV`) and environment variables (including the new `DASHBOARD_URLS` for aliases) by copying the secrets from the existing project.
3. Deploy the alias via `wrangler publish` and verify it responds on `workers.dev` before routing traffic.
4. Once the alias proves stable, gradually update Cloudflare Workers > Routes to map `api.elyra-core.app/*` to both `mira-assistant` and `merlin-api`, then retire the old route after testing.

## Manual Cloudflare checklist
- [ ] Create/use `merlin-api` worker in the dashboard and configure bindings/vars identical to `mira-assistant`.
- [ ] Add the alias `api.elyra-core.app/*` route for `merlin-api` (Cloudflare Workers > Routes) while keeping the existing route for `mira-assistant` active.
- [ ] Set the new worker name in any monitoring/alerts so the alias campaigns do not trigger false negatives.
- [ ] Once traffic is stable, remove the extra route and consider renaming the worker/route in a follow-up phase, documenting the final name change.

## Rollback plan
- If any alias deployment causes issues, revert to the previous alias-free state by removing the `merlin-api` route and re-running `wrangler publish` for `mira-assistant`.
- Keep the worker configuration files intact so `git checkout -- worker/wrangler.merlin-api.toml` restores the alias stub if needed.

## Validation command
- `git status -sb docs/phase4/04-worker-rename-plan.md`
