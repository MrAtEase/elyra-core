# 6–8 Weeks Roadmap
Each week builds toward a secure, integrated Fish Delish workspace + investor story. “Definition of Done” specifies measurable outputs. Critical path runs through the auth gate → Next deployment → Google integrations.

## Week 1 – Auth gate & token plumbing
- Deliverables: Worker gate that rejects unauthenticated `/assistant/*` requests, issues `mira_session` cookies, and records sessions in `ASSISTANT_KV`; update `worker/docs/SETUP.md` to document the login flow.
- Definition of Done: `worker/src/index.ts` returns 401 with `AUTH_REQUIRED`, `/assistant/oauth/google/callback` emits the cookie, and `curl` hit shows the new behavior.
- Dependencies: `GOOGLE_CLIENT_ID/SECRET`, KV namespace.

## Week 2 – UI + marketing gating
- Deliverables: Marketing `Login` CTA and MIRA overlay point to the new login endpoint; Next workspace gating (middleware or worker-facing) ensures `app.elyra-core.app` cannot render without a session (`fish-delish-site/index.html`, `mira-app/js/mira.js`, `fish-delish-site/app/*`).
- Definition of Done: Clicking “Login” hits OAuth, the worker redirects to `/workspace`, and the UI shows a blocking banner if the cookie is absent.
- Dependencies: Week 1, fresh worker build, and the `app` deployment path.

## Week 3 – Tasks & planner automation
- Deliverables: Planner panel calls `/assistant/tasks/list` and `/create`, plus email-driven task creation via `/assistant/email/createTasks`; add consent gating for task automation if required (`MerlinLayout`, `mira-app/js/mira.js`).
- Definition of Done: Task panel shows seeded tasks for each workspace, create/update buttons mutate the worker’s `taskStore` map, and email automation logs the created items.
- Dependencies: Auth gate (to allow worker calls) and Google/Calendars tokens.

## Week 4 – Google calendar + Drive/Slides integration
- Deliverables: Calendar events display (GET `/assistant/calendar/events`), creation/update flows hit Google Calendar, Drive list + upload works, slides are persisted via `/assistant/slides/*`, and the pitchdeck viewer pulls data from `/assistant/slide/list`. Capture these flows in both `mira-assistant` and `fish-delish-site` where relevant.
- Definition of Done: Calendar event CRUD works end-to-end, Drive list returns `items`, and a new slide deck appears under `slides:${user}:${workspace}` (validate via `wrangler kv:key list`).
- Dependencies: Working OAuth tokens, Google API quotas.

## Week 5 – Observability + pitchdeck experience
- Deliverables: Structured logging via `worker/src/logger.ts`, add `/assistant/ops/metrics`, and surface the pitchdeck preview on `pitchdeck.elyra-core.app` (or within the workspace if the domain is not ready).
- Definition of Done: Logs show request metadata, metrics endpoint returns uptime/last cron run, and a pitchdeck preview loads slides stored in KV.
- Dependencies: Worker reruns from Week 1–4, DNS for pitchdeck domain (or fallback to workspace page).

## Week 6 – DSGVO compliance + investor polish
- Deliverables: Consent banner + storage control in the UI (`mira-app/index.html`, `mira-app/js/mira.js`), plus a deletion endpoint that purges `google_tokens:*`, `slides:*`, `knowledge:*`, and `reminder:*`. Update the investor demo script (`09-investor-demo-script.md`) to reflect the finished flow.
- Definition of Done: Consent flag is persisted, protected endpoints refuse action until consent, and the audit endpoint returns the list of purged keys.
- Dependencies: KV access, auth gate, and clear documentation for the deletion feature.

## Weeks 7–8 – Buffer & optional polish
- Deliverables: Finish backlog stories that overflowed weeks 1–6 (e.g., Workspaces personalization, extra Planner heuristics, DS compliance docs). Harden the CI pipeline (run `npm ci`/`npm test` before each deploy) and rehearse the investor demo.
- Definition of Done: All Epic stories targeted in `08-backlog-epics-stories.md` have at least one regression test, the Next app is deployed via CI, and the investor runbook explains fallback paths.
- Dependencies: All previous weeks must be stable before optional refinements.

## Critical path
1. **Auth gate → Login**: Without worker session enforcement and cookie issuance, downstream features (planner, calendar, pitchdeck) cannot safely access real data.
2. **Next app build/deploy**: The workspace must be packaged/deployed once authentication is settled; otherwise the investor-facing experience is missing.
3. **Google + Drive integrations**: Calendar and Drive slides rely on valid tokens; until those flows are live, the “Fish Delish proof” lacks live context.

Monitor these three threads weekly and defer lower-priority polish (observability/DSGVO extras) if any slip occurs.
