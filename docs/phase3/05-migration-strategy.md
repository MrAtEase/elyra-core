# Phase 3 Safe Migration Strategy

**Status / current mapping:** Phase 5 renaming work already moved the shell assets into `mira-app/`, so the repository, CI, and documentation all continue to point at `mira-app/` while the `merlin-shell/` name remains a Phase 3 target. Treat the references below as describing that future rename and keep `mira-app/` active in workflows, docs, and Cloudflare until the broader stack is ready for the next switch.

## Zero-downtime rename path
- **Immediate renames (post planning, pre-MVP)**
  - Introduce new directories as aliases and update references (e.g., create `workspaces/fish-delish-site` alongside `fish-delish-site` and begin pointing tooling at the new path). Internal references can be updated incrementally while the old folder stays until final switchover.
  - Update documentation (`docs/audit/*`, README) to mention `mira.os` and `M.E.R.L.I.N` without touching runtime code.
  - Rename `mira-app/` references in docs/workflows to `merlin-shell/` (aliasing via symlink if necessary) as long as build/deploy workflows still point to the old folder for now.
  - Introduce `platform-core/` or `mira-os/` alias for `mira-os/` components to signal platform neutral structure.
- **Rename steps to perform post-MVP / post-seed**
  - Switch the actual folder names (`fish-delish-site` → `workspaces/fish-delish-site`, `mira-assistant` → `merlin-shell`, `worker` → `merlin-api`) once consumers (CI, deploy scripts) are updated and there is capacity to handle the rename downtime (update `wrangler` configs, Cloudflare routes, etc.).
  - Update domain mappings: move `elyra-core.app` to `mira.os`, assign `merlin.mira.os` to the shell, and adjust DNS once rename is in place.
  - Rebrand `.github` workflows to the new directories and names after verifying alias coverage.
- **What must never be renamed until after funding/Big shifts**
  - Do not rename the canonical Cloudflare Worker (`worker`) or `wrangler.toml` until there is clarity on Cloudflare routes and domain ownership; the worker is the live backend and must keep existing names in prod until new domains/alias routes are confirmed.
  - Do not touch secret names (`CF_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `GOOGLE_*`, etc.) as they are tied to live environments.
  - Do not change runtime identifiers (e.g., `mira-assistant` worker name, `projectName: mira-assistant` in workflows) until verified with Cloudflare to avoid downtime.

## Migration safeguards
1. **Alias first**: Create new directories mirrored from old ones (e.g., `workspaces/fish-delish-site` replicates `fish-delish-site` with configuration symlinks). CI continues to point at old path until switch is complete.
2. **Documentation roll-forward**: All docs (including `docs/phase3/*`) should call out the new names to signal the upcoming transition; this reduces confusion among contributors.
3. **DNS/route dual-writing**: For domain changes, support both old and new domains (e.g., `elyra-core.app` and `mira.os`) for a time, directing them to the same Cloudflare Page/Worker and gradually updating marketing assets.
4. **Versioned release**: Bundle the rename with a minor release; ensure rollback steps exist in case Cloudflare route updates fail—keep the old domain/worker names until the release is proven stable.
