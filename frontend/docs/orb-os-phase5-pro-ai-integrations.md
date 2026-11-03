# Phase 5 — Pro AI Integrationen

## Scope
- Web Research: `web.search`, `web.fetch`, `web.extract`, `web.summarize` (mit citations)
- Weather: `weather.getForecast`
- Translate: `translate.text`
- Google Drive + Slides
- Gmail + Calendar + Tasks

## Tool Schemas
- Implementiert in: `lib/orb-os/tools/schemas.ts`
- Enthält Input/Output Schemas, Rate Limits, Cache TTL, Risk Level.

## Planner Regeln
- Weather/Translate intents müssen Tool-Nutzung erzwingen:
  - `weather_intent_must_use_tool`
  - `translate_intent_must_use_tool`
- Definiert in `plannerMustUseRules` (`lib/orb-os/tools/schemas.ts`).

## Assistant Rendering
- Assistant Surface rendert Toolcards dynamisch via:
  - `orb_quick_actions`
  - `tool_registry`
- Zeigt Risk/Status Badges und Approvals in Side Panels.

## Google OAuth + Artifact Flows (Definition)
- Workspace-bound Tokens.
- Drive Tools:
  - `drive.search`, `drive.move`, `drive.createFolder`, `drive.upload`
- Slides Tools:
  - `slides.create`, `slides.batchUpdate`, `slides.exportPdf`
- Pitch Deck Flow:
  1. Research + Summaries
  2. Slides Create
  3. Batch Update
  4. Export PDF
  5. Artifact + Open Link

## Gmail/Calendar/Tasks (Definition)
- Gmail:
  - `gmail.search`, `gmail.getThread`, `gmail.createDraft`, `gmail.send`
- Calendar:
  - `calendar.list`, `calendar.create`, `calendar.findFreeSlots`
- Tasks:
  - `tasks.create`, `tasks.assign`, `tasks.due`, `tasks.list`
- Policy:
  - writes -> approval möglich
  - auth missing -> `waiting_for_auth`
