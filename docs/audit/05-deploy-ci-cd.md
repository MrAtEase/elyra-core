# Deploy Pipeline & CI/CD

## What exists now
- `.github/workflows/deploy-worker.yml` responds to pushes under `worker/**` and publishes the Worker, so deployment is gated on a single workflow that checks out the repo, sets Node 20, installs dependencies inside `worker/`, builds, and runs `wrangler deploy`.
- The worker uses `wrangler.toml`/`wrangler.personal-assistant-dev..toml` to target `mira-assistant` and `personal-assistant-dev`, both of which compile `worker/src/index.ts` and rely on `ASSISTANT_KV`, `GOOGLE_*`, `OPENAI_*`, and `MIRA_*` env vars.

## Where in code
The deploy workflow is explicit about each step, including the working directory and secrets:

```yaml
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - name: Install deps
        working-directory: worker
        run: npm ci
      - name: Build worker
        working-directory: worker
        run: npm run build
      - name: Deploy worker
        working-directory: worker
        run: npx wrangler deploy
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
```

## How to verify
1. Run `npm ci && npm run build` inside the `worker/` directory locally to ensure the TypeScript compilation succeeds before invoking `npx wrangler deploy`.
2. Use `npx wrangler tail` pointing to `mira-assistant` after a deploy to confirm the logs stream and the cron fires (`*/10 * * * *`).
3. Confirm GitHub Actions reports `deploy-worker` success after any change under `worker/**` via the workflow run history.

## Known gaps
- No workflow currently builds or deploys the Next workspace under `fish-delish-site/`, so `app.elyra-core.app` relies on an external pipeline and is not covered by this repo’s CI.
- There is no automatic smoke test after deploy (e.g., `curl`ing `/assistant/auth/whoami`), so operator verification is manual.
- Secrets like `GOOGLE_CLIENT_ID/SECRET` and `OPENAI_API_KEY` are managed outside the repo; missing values will break the worker at runtime unless the environment is seeded per `worker/docs/SETUP.md`.
