# Phase 4 Folder Rename Decision

## Chosen approach: soft alias
- The `mira-app/` directory currently powers the Cloudflare Pages jobs (`deploy-mira.yml` and `deploy-site.yml`). Renaming it right now would require manual changes in the Cloudflare dashboard (project name and publish directory) and risks breaking the existing workflow during the transition.
- We therefore keep the folder name as-is at the filesystem level but treat it as the MERLIN shell in documentation. When the time comes, we can introduce a `merlin-shell/` alias directory and update Pages workflows/docstrings in a single commit that toggles both the repo and the dashboard.
- New terminology references (docs, README) will call this asset the MERLIN shell, creating a conceptual rename without touching the CI/deploy assets.

## Validation command
- `git status -sb docs/phase4/03-folder-rename-decision.md`
