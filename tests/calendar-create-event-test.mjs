#!/usr/bin/env node
/**
 * Integration test (manual): attempts to create a calendar event via the
 * deployed MERLIN Worker. This is NOT a unit test; it talks to a live
 * Worker and requires valid Google tokens for the default user.
 *
 * Usage:
 *   WORKER_BASE_URL="https://personal-assistant.fish-delish.workers.dev" \
 *     node tests/calendar-create-event-test.mjs
 */

(async function main() {
  const base = process.env.WORKER_BASE_URL;
  if (!base) {
    console.error('ERROR: Please set WORKER_BASE_URL env var (e.g. https://...workers.dev)');
    process.exit(2);
  }

  // Ensure fetch is available (Node 18+ has global fetch). If not, try to load node-fetch.
  if (typeof fetch === 'undefined') {
    try {
      const mod = await import('node-fetch');
      // node-fetch default export is a function
      globalThis.fetch = mod.default || mod;
    } catch (err) {
      console.error('fetch is not available and node-fetch could not be loaded:', err);
      process.exit(2);
    }
  }

  const url = base.replace(/\/+$/, '') + '/assistant/calendar/create-event';
  const start = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour in the future

  const body = {
    summary: 'MERLIN Test Event',
    start,
    durationMinutes: 60,
    description: 'Test event from CI script',
    includeMeet: true,
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    let json = null;
    try {
      json = await res.json();
    } catch (e) {
      const text = await res.text().catch(() => '<no-body>');
      console.log('Non-JSON response body:\n', text);
    }

    console.log('HTTP', res.status);
    console.log('RESPONSE:', JSON.stringify(json, null, 2));

    if (json && json.ok) {
      console.log('Calendar create: SUCCESS');
      process.exit(0);
    } else {
      console.error('Calendar create: FAILURE');
      process.exit(1);
    }
  } catch (err) {
    console.error('Request failed:', err);
    process.exit(1);
  }
})();
