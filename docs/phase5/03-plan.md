# Phase 5 Rename Plan

**Status / current mapping:** Phase 5 Commit B has already moved `mira-assistant/` into `mira-app/`, so this repo now ships the shell from `mira-app/` while the Cloudflare Pages project name remains `mira-assistant`. The checklist below keeps documentation, workflows, and manual steps aligned with that reality.

## Commit A – Prep & Alias (no folder rename yet)
- Update documentation that enumerates runtime domains and owners, starting with `docs/infra/domains.md`, `docs/infra/README.md`, and any infra glossaries that still describe `mira-app/` as the Pages root. Explicitly note that the Cloudflare Pages project now publishes `./mira-app` while the project name remains `mira-assistant`, and remind operators that any future change to the root directory must be made manually in the Pages UI before touching the other domains.
- Document the manual Cloudflare step in `docs/infra/domains.md` (and any relevant README) so operators know the Pages project root directory is currently `./mira-app`, that changing it requires the Pages UI, and that no other domains are touched. Include a short “Manual Cloudflare Step” callout explaining when to edit the Pages root directory field.
- Leave the shell folder in place, but add a “Transition alias” note describing how the new `mira-app/` name will be mirrored via documentation / redirect support (if needed) for the duration of Commit A. Capture any temporary mapping so the rename tasks stay coordinated without touching the live site.
- Drop a rollback hint that says “If Commit A introduces confusion, revert the docs and remove any transition notes before proceeding to Commit B.”

## Commit B – Rename & update references
- `git mv mira-assistant mira-app`.
- Update every reference collected in `docs/phase5/01-rename-scan.md` so that `mira-app/` paths, workflow directories, README tables, audit docs, scripts, and tests point at `mira-app/` (or mention both names if in the alias window). Pay special attention to relative links in `mira-app/index.html`, `js/`, `modules/`, and any `devworkspace` helper bundles so asset references still resolve.
- Update the Pages workflows so `directory` points at `./mira-app` and, if desired, rename `projectName` to `mira-app` once the Cloudflare project is ready. Keep the worker workflow untouched but note the Domains section to avoid touching `mira-assistant.elyra-core.app` yet.
- Update `package.json` tests, `docs/phase4/*`, and all other docs to match the new folder name, including the new alias explanation. Confirm previews/manual instructions refer to the renamed folder and highlight the manual Cloudflare step again.

## Rollback plan
- `git revert` the commits (A then B or just B if the rename is problematic) to restore `mira-assistant` references in the repo.
- In Cloudflare Pages (for `mira-app`/`mira-assistant` project), keep the current root directory pointing at `./mira-app`. If a rollback requires the previous layout, update the Pages root manually to `./mira-assistant` before re-deploying.
- Because the worker is unchanged, no Cloudflare Worker rollback is required, but verify that DNS/Routes still map `app.elyra-core.app` and `mira-assistant.elyra-core.app` to the expected resources after the revert.
