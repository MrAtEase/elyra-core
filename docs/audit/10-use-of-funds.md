# Use of Funds (6–8 week sprint)

## Team roles + deliverables
1. **Senior Staff Engineer / Platform Lead** ($10k–$16k per week)
   - Drives the Cloudflare Worker auth gate, session cookie handling, and the `app.elyra-core.app` Next deployment pipeline (see `docs/03-auth-login-flow.md`, `08-backlog-epics-stories.md` for detailed stories). Also owns CI fixes (`deploy-worker.yml`, `npm ci`, package-lock validation) and writes the metrics endpoint (`worker/src/index.ts`).
2. **Frontend Engineer (Next + MIRA shell)** ($8k–$12k per week)
   - Implements the workspace gating/consent flows, wires the planner/tasks panels (`fish-delish-site/components/merlin/MerlinLayout.tsx`), and adds the pitchdeck preview page (`pitchdeck.elyra-core.app`). Updates the marketing `index.html` and MIRA UI based on the new auth flow.
3. **Product/AI Integrations PM** ($6k–$10k per week)
   - Coordinates Google/Drive/Notion integrations (ensures `GOOGLE_*`, `NOTION_TOKEN`, `MIRA_TASKS_DB_ID` are provisioned), defines acceptance criteria for the planner/pitchdeck stories, and validates the investor demo script.
4. **DevOps/Compliance Lead** ($7k–$11k per week)
   - Manages Cloudflare secrets, KV namespaces, observability configuration (`wrangler.toml`), and the DSGVO epic (consent banner + deletion endpoint). Also updates `worker/docs/SETUP.md` with the new privacy controls.

## Burn estimate (6–8 weeks)
- Assume a 4-person crew at median rates (ca. $10k/week avg). Over 6 weeks → ~$240k; over 8 weeks → ~$320k. Include 20% buffer for unforeseen compliance/integration work.

## What must be finished before Store 1 opening (time pressure)
1. **Secure login gate** (Auth Epic) so the public marketing page links to an actual authenticated workspace (per `03-auth-login-flow.md`). Without this, guests can roam the internal dashboard, which is unacceptable on day one.
2. **Workspace deployment pipeline** for `app.elyra-core.app` (Next app) and `mira-assistant` shell so the store team can hand off the digital workspace to guests. This includes CI fixes and a reproducible build (`06-ci-cd-analysis.md`).
3. **Google + Drive integrations** for pitch materials and calendar context (the Fish Delish proof relies on the `/assistant/email` and `/assistant/drive` endpoints described in `05-api-worker-analysis.md`). Without these, investors see placeholders instead of live data.
4. **DSGVO consent + deletion flows** (see `08-backlog-epics-stories.md` – the privacy endpoint and banner must be in place before any real user data is stored).

## Optional / nice-to-have
- **Planner automation polish** (auto-plan tasks from email threads, slack connectors) beyond the MVP tasks list; can be deferred until after Store 1 because fallback heuristics already exist.
- **Pitchdeck domain (pitchdeck.elyra-core.app)** hooking to a dedicated viewer; currently only the backend CORS entry exists, so the frontend shell can be added once core auth/calendars are stable.
- **Enhanced observability dashboards** (structured logs + `/assistant/ops/metrics` endpoint) to support investor demos, but not strictly required for launch since Cloudflare logs already capture invocation data.
