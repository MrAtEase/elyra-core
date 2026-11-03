# CI/CD Analysis

## Existing workflows
- `.github/workflows/deploy-mira.yml` and `deploy-site.yml` both target the `mira-assistant` Cloudflare Pages project; they run on `push` to `main` when files under `mira-app/**` change. The first uses `CF_API_TOKEN`/`CF_ACCOUNT_ID`, the second uses `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID`, yet both publish `directory: ./mira-app` to `projectName: mira-assistant`. This duplicates the same deployment (see the two workflow files) and can lead to redundant builds or secret mismatch issues if the token names are not both populated.
- `.github/workflows/deploy-worker.yml` checks out the repo, installs Node 20, globally installs Wrangler, and then runs `cd worker && wrangler deploy`. Crucially it never runs `npm ci` or `npm install` within `worker/` before `wrangler deploy`, so the worker’s TypeScript sources (and `ts-node`/`typescript` dependencies defined in `worker/package.json`) will be missing in a clean checkout. This makes `wrangler deploy` fail when invoked from GitHub Actions unless `node_modules` is accidentally checked in. Add `npm ci` (or `npm install`) before deploy to ensure reproducible builds tied to `worker/package-lock.json`.

## Lockfiles and reproducibility
- Lockfiles exist for the root workspace (`package-lock.json`), the Next app (`fish-delish-site/package-lock.json`), and the worker (`worker/package-lock.json`), satisfying Cloudflare’s `npm ci` requirement as long as the CI workflows actually run `npm ci` against each subproject before building/deploying.
- The GitHub Actions currently never run `npm ci` inside `worker/`, nor do they run any `npm ci` for `fish-delish-site`. That means the reproducibility guarantee provided by the lockfiles is not realized and the workspace app may never be built/deployed.

## Gaps and risks
1. **Next workspace not deployed**: There is no workflow building or publishing `fish-delish-site/`. Without a build, `app.elyra-core.app` cannot stay in sync with the repo. Add a dedicated workflow that runs `cd fish-delish-site && npm ci && npm run build` and then deploys the `.next` output via Cloudflare Pages, Vercel, or a worker.
2. **Worker deploy lacks build/test**: `deploy-worker.yml` should invoke `npm ci && npm run build` inside `worker/` before `wrangler deploy` to ensure TypeScript artifacts exist and tests pass. Right now `wrangler deploy` runs without build artifacts, which will fail in a clean environment or produce stale code.
3. **Duplicate Pages workflows**: Having two workflows (`deploy-mira`/`deploy-site`) targeting the same directory/project but with different secrets is confusing and increases churn. Consolidate into one workflow, or clearly differentiate them (e.g., one for staging with a different `projectName`).
4. **No lint/test gate**: Aside from the `miraos:test-*` scripts in the root `package.json`, no workflow invokes them. Consider running `npm test` (the root script executes `ts-node` tests) before deployment so regressions in `mira-os/tests` are caught.

## Recommendations
- Add `npm ci` steps before any deployment. For the worker: `cd worker && npm ci && npm run build` before `wrangler deploy`. For the Next app: `cd fish-delish-site && npm ci && npm run build`, then deploy (e.g., via Cloudflare Pages with its own workflow).
- Remove redundant Pages workflow or parameterize it for separate environments (e.g., `staging` vs `production`). Keep a single set of secrets to reduce mistakes.
- Hook the root `npm test` script into CI (`ts-node` tests under `mira-os/tests`). This uncovers regressions in the OS fabric before pushing to production.
- Document the required secrets explicitly (`CF_API_TOKEN`, `CLOUDFLARE_API_TOKEN`, account IDs, Google/Notion keys) so CI owners know what to populate in the repository settings.
