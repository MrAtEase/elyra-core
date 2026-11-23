import test from "node:test";
import assert from "node:assert/strict";
import { runRunnableToolAdapter, RunnableToolError, resetRunnableToolStateForTests } from "@/lib/orb-os/tools/runnableAdapters";

function signal() {
  return new AbortController().signal;
}

test("web.search returns normalized results and uses cache", async () => {
  resetRunnableToolStateForTests();
  const originalFetch = global.fetch;
  let calls = 0;

  global.fetch = (async () => {
    calls += 1;
    return new Response(
      JSON.stringify({
        Heading: "AI",
        AbstractURL: "https://example.com/ai",
        AbstractText: "Artificial intelligence overview.",
        RelatedTopics: [
          { Text: "AI topic - snippet", FirstURL: "https://example.com/topic" },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;

  const args = { query: "ai agents", locale: "en-US", max_results: 3 };
  const first = await runRunnableToolAdapter({ workspaceId: "ws-1", toolName: "web.search", args, signal: signal() });
  const second = await runRunnableToolAdapter({ workspaceId: "ws-1", toolName: "web.search", args, signal: signal() });

  assert.equal(Array.isArray((first as { results?: unknown[] }).results), true);
  assert.equal(((first as { results: unknown[] }).results).length > 0, true);
  assert.deepEqual(second, first);
  assert.equal(calls, 1);

  global.fetch = originalFetch;
});

test("web.fetch surfaces safe upstream errors", async () => {
  resetRunnableToolStateForTests();
  const originalFetch = global.fetch;

  global.fetch = (async () => new Response("nope", { status: 500 })) as typeof fetch;

  await assert.rejects(
    () =>
      runRunnableToolAdapter({
        workspaceId: "ws-1",
        toolName: "web.fetch",
        args: { url: "https://example.com", timeout_ms: 2000 },
        signal: signal(),
      }),
    (error: unknown) => {
      assert.equal(error instanceof RunnableToolError, true);
      assert.equal((error as RunnableToolError).code, "TOOL_EXECUTION_FAILED");
      assert.equal((error as RunnableToolError).status, 502);
      return true;
    },
  );

  global.fetch = originalFetch;
});

test("web.extract and web.summarize generate key points and citations", async () => {
  resetRunnableToolStateForTests();

  const extract = await runRunnableToolAdapter({
    workspaceId: "ws-1",
    toolName: "web.extract",
    args: {
      html: "<html><head><title>Spec</title></head><body><h1>Elyra</h1><p>Automation improves reliability.</p><p>Policies protect access.</p></body></html>",
      mode: "facts",
    },
    signal: signal(),
  });

  assert.equal((extract as { title?: string }).title, "Spec");
  assert.equal(Array.isArray((extract as { key_points?: unknown[] }).key_points), true);

  const summarize = await runRunnableToolAdapter({
    workspaceId: "ws-1",
    toolName: "web.summarize",
    args: {
      query: "What is Elyra?",
      extracted_docs: [
        {
          url: "https://example.com/elyra",
          title: "Elyra Overview",
          text: "Elyra is an AI-native operating system with tool execution, approvals and artifact persistence.",
        },
      ],
      include_citations: true,
      max_words: 120,
    },
    signal: signal(),
  });

  assert.equal(typeof (summarize as { summary?: string }).summary, "string");
  assert.equal(Array.isArray((summarize as { citations?: unknown[] }).citations), true);
  assert.equal(((summarize as { citations?: unknown[] }).citations ?? []).length > 0, true);
});

test("weather.getForecast resolves location and returns forecast rows", async () => {
  resetRunnableToolStateForTests();
  const originalFetch = global.fetch;

  global.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("geocoding-api.open-meteo.com")) {
      return new Response(
        JSON.stringify({
          results: [{ latitude: 52.52, longitude: 13.405, name: "Berlin", country: "Germany" }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({
        daily: {
          time: ["2026-02-24", "2026-02-25"],
          temperature_2m_max: [8, 9],
          temperature_2m_min: [2, 3],
          precipitation_probability_max: [20, 35],
          weathercode: [1, 61],
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;

  const result = await runRunnableToolAdapter({
    workspaceId: "ws-1",
    toolName: "weather.getForecast",
    args: { location: "Berlin", units: "metric", days: 2 },
    signal: signal(),
  });

  const forecast = (result as { forecast?: unknown[] }).forecast;
  assert.equal(Array.isArray(forecast), true);
  assert.equal((forecast ?? []).length, 2);

  global.fetch = originalFetch;
});

test("translate.text returns translated_text", async () => {
  resetRunnableToolStateForTests();
  const originalFetch = global.fetch;

  global.fetch = (async () =>
    new Response(JSON.stringify([[ ["Hallo Welt", "Hello world", null, null] ], null, "en"]), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;

  const result = await runRunnableToolAdapter({
    workspaceId: "ws-1",
    toolName: "translate.text",
    args: { text: "Hello world", source_lang: "en", target_lang: "de" },
    signal: signal(),
  });

  assert.equal((result as { translated_text?: string }).translated_text, "Hallo Welt");

  global.fetch = originalFetch;
});

test("rate limit blocks excessive calls", async () => {
  resetRunnableToolStateForTests();
  const originalFetch = global.fetch;

  global.fetch = (async () =>
    new Response(JSON.stringify({ Heading: "AI", RelatedTopics: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;

  const args = { query: "rate limit", locale: "en-US", max_results: 1 };
  for (let index = 0; index < 30; index += 1) {
    await runRunnableToolAdapter({ workspaceId: "ws-rl", toolName: "web.search", args, signal: signal() });
  }

  await assert.rejects(
    () => runRunnableToolAdapter({ workspaceId: "ws-rl", toolName: "web.search", args, signal: signal() }),
    (error: unknown) => {
      assert.equal(error instanceof RunnableToolError, true);
      assert.equal((error as RunnableToolError).code, "TOOL_RATE_LIMITED");
      return true;
    },
  );

  global.fetch = originalFetch;
});
