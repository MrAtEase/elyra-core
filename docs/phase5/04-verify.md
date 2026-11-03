# Phase 5 Verification

1. **Static-folder check** – After renaming `mira-app/` to `mira-app/`, run `ls mira-app/index.html` (and any other entry points) to ensure the root HTML still exists and that relative asset paths remain valid. If there is a `package.json` `build` script specific to the shell, run it after the rename; otherwise treat the shell as a static bundle and verify that `index.html`, `css/`, `js/`, and `modules/` folders still deploy as expected.
2. **npm/build step (worker)** – There is a top-level `npm run build` (which builds the worker). Run it once to confirm the worker still builds, even though the rename only affects the Pages shell; this guards against untracked references sneaking into worker code.
3. **Contract check** – Mention `./scripts/contract-check.sh` as the contractual verification step; do not run it now, but keep it on the checklist so the next phase runner executes it if any service contracts change alongside the rename.
