# Investor Demo Script (10 minutes)
Show fish‑delish.pt → login → MIRA workspace, highlighting Fish Delish as the proof of concept and Mira/Merlin as the adaptable platform.

1. **00:00–01:30 – Marketing hook on `elyra-core.app`**
   - Load `fish-delish-site/index.html` (local file mirrors the marketing hero and the top-right `Login` link to `https://mira-assistant.elyra-core.app`). Point out the story: the restaurant brand (“Taste of Croatia in Portugal”) funnels executives to the AI workspace.
   - Mention that the `Login` CTA triggers the Cloudflare Worker OAuth flow (`api.elyra-core.app/assistant/oauth/google/start`) and that the same worker powers the `app` domain via `worker/src/index.ts`.

2. **01:30–03:00 – Authentication + entry into the workspace**
   - Click “Login” and walk through the Google consent screen (explain that `GOOGLE_SCOPES`/`GOOGLE_REDIRECT_URI` are defined in `worker/wrangler.toml:9-18`). After redirect, show the MIRA shell (`mira-app/index.html`) with the holographic header and the nav wheel (`mira-app/js/mira.js` renders the dashboard/tasks/calendar icons).
   - If Google tokens aren’t configured, mention the fallback: the worker returns a 401 with `{ code: "AUTH_REQUIRED" }`, the banner in `mira-app/js/mira.js:5146-5160` shows “Reconnect required,” and you can demonstrate this by hitting `curl https://api.elyra-core.app/assistant/dashboard/summary` without a session.

3. **03:00–05:00 – Merlin dashboard & assistant**
   - Show the `Merlin` panel from `components/merlin/MerlinLayout.tsx` (workspace, planner, dev, knowledge, etc.). Click “Planner,” “Dev,” and “Knowledge” to highlight the structure, referencing the placeholders and the `Merlin` nav labels in `mira-app/index.html:22-145`.
   - Trigger a quick chat via `/assistant/chat` (the worker’s `chat` route uses OpenAI, see `worker/src/index.ts:3600-3745`). Paste a prompt like “Summarize today’s investor tasks” and show the reply; mention that the same worker can fallback to safe text if `OPENAI_API_KEY` is missing.

4. **05:00–07:00 – Automated email, calendar, and tasks**
   - Open the assistant’s email panel and highlight how `/assistant/email/summarize`, `/assistant/email/createTasks`, and `/assistant/email/priority` synthesize context from Gmail (see `worker/src/index.ts:3700-4200`). If Gmail isn’t connected, demonstrate the fallback by sending a `curl -X POST https://api.elyra-core.app/assistant/email/tasks -d '{"email":{"subject":"Investor follow-up"}}'` and explaining the heuristic TODOs.
   - Show the calendar or task panel calling `/assistant/calendar/events` and `/assistant/tasks/list`; highlight how the worker resolves `userKey` (default `paul`, `worker/src/index.ts:717-756`) and refreshes tokens before hitting Google (`refreshGoogleAccessTokenIfNeeded`).

5. **07:00–08:30 – Pitchdeck/Slides + Drive knowledge**
   - Mention the Pitchdeck feature: the worker exposes `/assistant/slides/create` and `/assistant/drive/files` (see `worker/src/index.ts:4300-4570`), the UI can store `.mira-deck.json`, and the `pitchdeck.elyra-core.app` domain is already whitelisted in the worker’s CORS allowlist (`worker/src/index.ts:667-693`). Show the deck preview and emphasize the idea of “generate a deck from planning notes.”
   - Highlight the knowledge panel’s ability to surface Notion/Drive links (driven by `/assistant/email/knowledgeLinks` and `listKnowledgeItems`). If Notion tokens are missing, the worker logs the failure but still returns empty arrays; mention this as a safe fallback.

6. **08:30–10:00 – Closing narrative: Fish Delish proof + Mira/Merlin platform**
   - Reiterate that every screen ties back to Fish Delish: marketing, login, workspace, tasks, calendar, investor-ready decks.
   - Close with the platform pitch: the same worker+Mira shell can be re-skinned for any vertical because `worker/src/index.ts` already exposes REST endpoints, `mira-app/js/merlin-client.js` abstracts the API origin, and `fish-delish-site/app` can become the next configurable workspace.
   - Include a brief “If integrations are missing” fallback: mention the commands in `worker/docs/SETUP.md` (curl health, memo, Notion task tests) and show that even without Google/Notion, the worker returns stubbed dashboard stats (`buildDashboardSummary`) so the UI never breaks.
