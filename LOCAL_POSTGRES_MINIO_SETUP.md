# Local Build: Worker + Wrangler + Next

## 1) Start local infra

```bash
docker compose up -d
```

Services from `docker-compose.yml`:
- Postgres: `127.0.0.1:5432` (`elyra` / `elyra` / `elyra`)
- MinIO API: `127.0.0.1:9000`
- MinIO Console: `http://localhost:9001`

Create the bucket once in MinIO UI: `vision-2035`.

## 2) Worker env for `wrangler dev`

Use `worker/.dev.vars` (copy from `worker/.dev.vars.example` if needed) and set at least:

```bash
DATABASE_URL=postgres://elyra:elyra@127.0.0.1:5432/elyra

S3_ENDPOINT=http://127.0.0.1:9000
S3_ACCESS_KEY=minio
S3_SECRET_KEY=minio12345
S3_BUCKET=vision-2035
S3_REGION=us-east-1

MODEL_PROVIDER=openai
OPENAI_API_KEY=sk-...

FF_MULTI_WORKSPACE=0
FF_MAIL=0
FF_CALENDAR=0
```

## 3) Migrate + seed (Vision 2035)

From repo root:

```bash
pnpm db:migrate
pnpm db:seed
```

Implemented scripts:
- `db:migrate` -> `worker/scripts/migrate.mjs`
- `db:seed` -> `worker/scripts/seed-vision-2035.mjs`

Seed behavior is idempotent and enforces exactly one workspace (`vision-2035`).

## 4) Start Worker locally

```bash
pnpm --filter worker dev
# or
node ./scripts/run-worker-dev.mjs
# or
cd worker && wrangler dev --env dev
```

Expected local URL:
- Worker API: `http://127.0.0.1:8787`

## 5) Start Next frontend

Set in `frontend/.env.local`:

```bash
NEXT_PUBLIC_ASSISTANT_API_BASE=http://127.0.0.1:8787
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8787
```

Run:

```bash
pnpm --filter frontend dev
```

Open:
- Frontend: `http://localhost:3000`
- API: `http://127.0.0.1:8787`

## 10-minute checklist

1. `docker compose up -d`
2. `worker/.dev.vars` configured
3. `pnpm db:migrate && pnpm db:seed`
4. `wrangler dev --env dev`
5. `frontend/.env.local` API base set to `127.0.0.1`
6. `pnpm --filter frontend dev`
7. Browser check: desktop loads, Orb visible, windows move, API calls succeed
