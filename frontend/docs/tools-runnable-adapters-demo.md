# Runnable Adapters Demo (Web, Weather, Translate)

## Demo prompts
1. `Research the latest browser rendering performance trends and provide sources.`
- Expected tool flow: `web.search` -> `web.fetch` -> `web.extract` -> `web.summarize`

2. `Get a 5-day forecast for Berlin in metric.`
- Expected tool flow: `weather.getForecast`

3. `Translate this to German: We can ship the MVP next week.`
- Expected tool flow: `translate.text`

## Expected artifact outputs

### `web.search`
- artifact type: `research_report`
- ui card hint: `card.research_report`
- payload highlights: result list (title/url/source/snippet)

### `web.fetch`
- artifact type: `research_report`
- ui card hint: `card.research_report`
- payload highlights: `url`, `status`, `content_type`

### `web.extract`
- artifact type: `research_report`
- ui card hint: `card.research_report`
- payload highlights: `title`, `key_points`, extracted `text`

### `web.summarize`
- artifact type: `research_report`
- ui card hint: `card.research_report`
- payload highlights: `summary`, `citations[]`

### `weather.getForecast`
- artifact type: `weather_forecast`
- ui card hint: `card.weather_forecast`
- payload highlights: `location`, `forecast[]`

### `translate.text`
- artifact type: `translation_result`
- ui card hint: `card.translation_result`
- payload highlights: `source_lang`, `target_lang`, `translated_text`

## Error handling behavior
- All adapters return safe errors (no secrets/raw upstream internals).
- Upstream failures map to user-safe messages with retryability metadata.
- Rate-limit failures return `TOOL_RATE_LIMITED`.
- Timeout failures return `TOOL_TIMEOUT`.

## Cache and rate limit
- Cache TTL and rate limits come from `toolCatalogMeta` in `lib/orb-os/tools/schemas.ts`.
- Caching is workspace-scoped and argument-keyed.
- Rate limiting is workspace+tool scoped (per-minute window).
