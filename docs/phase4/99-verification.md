# Phase 4 Verification & Rollback

## Command checks
Run these simple checks after each tweak to guarantee the existing routes respond before any rename:
1. `curl -I https://elyra-core.app`
2. `curl -I https://app.elyra-core.app`
3. `curl -I https://mira-assistant.elyra-core.app`
4. `curl -I https://api.elyra-core.app`
5. `curl -I https://api.elyra-core.app/status`
6. `curl -I https://api.elyra-core.app/assistant/dashboard/summary?workspaceId=ws-default`

## UI smoke tests
- Visit `https://elyra-core.app` and click the “Login” CTA; ensure it points at `https://mira-assistant.elyra-core.app` without opening a broken link.
- Open `https://mira-assistant.elyra-core.app` (expect a 522 until the shell is fully healthy) and verify the console still references `https://api.elyra-core.app` for MERLIN API calls.
- Navigate to `https://app.elyra-core.app/workspace` (or the workspace URL you host) and confirm the marketing shell, workspace dashboards, and MERLIN controls still render after adding origin aliases.
- Run a sanity check against the worker API: `curl https://api.elyra-core.app/assistant/health` (if available) or other `/status` endpoints to confirm the worker still responds with JSON.

## Rollback actions
1. If a rename or alias change behaves unexpectedly, `git checkout -- worker/src/index.ts docs/phase4/*` to drop the new plan docs/code and rerun the previous head commit.
2. Revert the incremental commit(s) with `git revert <hash>` if they have already been pushed.
3. In Cloudflare, undo any route/worker alias edits and rerun `wrangler deploy` for the original `mira-assistant` worker.
4. If documentation states a dashboard change was planned, log the rollback in the Cloudflare checklist and mark the rename as incomplete.

## Validation command
- `git status -sb docs/phase4/99-verification.md`
