# Risk Register

## What exists now
1. **External hosting drift** – `app.elyra-core.app` is served by the Next workspace in `fish-delish-site/`, but there is no CI/CD in this repo for that app; DNS must be kept in sync manually.
2. **Secrets & bindings** – The worker depends on `GOOGLE_*`, `OPENAI_API_KEY`, `NOTION_TOKEN`, and `ASSISTANT_KV`; missing bindings or keys cause immediate 500s in the fetch handler because the code assumes they exist.
3. **Monolithic UI** – `mira-app/js/mira.js` directly wires the nav wheel, context, theme controls, and modules, so changes to the DOM often ripple into the entire shell.

## Where in code
Worker deployment requires precise vars/kvs laid out in `worker/wrangler.toml`:

```toml
[vars]
GOOGLE_SCOPES = "openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/presentations https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly"
GOOGLE_REDIRECT_URI = "https://api.elyra-core.app/api/google/callback"
MAILCHANNELS_DOMAIN = "elyra-core.app"
MAIL_FROM = "assistant@elyra-core.app"
OPENAI_CHAT_MODEL = "gpt-5.2"
DASHBOARD_URL = "https://app.elyra-core.app"
[[kv_namespaces]]
binding = "ASSISTANT_KV"
id = "f941315e760f46a494dd17e1f9d967e2"
```

`mira-app/js/mira.js` carries deck + module wiring (see `ORBIT_DECK_MODULES`, `bindChromeUi()`, `initOrbitSplitView()`) so refactors must preserve the sequences there.

## How to verify
- Run `npm test` to ensure the knowledge graph mocks still pass (exercised in this audit).
- Hit `https://api.elyra-core.app/assistant/auth/whoami` after logging out to confirm the auth gate still enforces `AUTH_REQUIRED`.
- After deploying, run `npx wrangler tail --env production mira-assistant` or check the GitHub Action to watch for 500s caused by missing secrets.
- Open `mira-app/index.html` (legacy shell) and confirm that the nav wheel, assistant panel, and modules still render before enabling `Shell v2`.

## Known gaps
- There is no documented rollback process for the Next workspace or the `mira-app` shell; deployments are single-shot and rely on Git history to revert.
- Pages previews (`*.pages.dev`) and `workers.dev` routes are whitelisted manually; adding new domains requires manual updates to `STATIC_CORS_ORIGINS` or the env overrides.
- With the upcoming theme/system work, we currently lack automated tests covering theme persistence, so manual verification is the only guard.
