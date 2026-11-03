// src/index.ts
export default {
  async fetch(request: Request, env: any, ctx: any) {
    const url = new URL(request.url);
    const pathname = url.pathname.replace(/\/+$/, '') || '/';

    // Debug echo endpoint
    if (pathname === '/__debug/echo') {
      const text = await request.text().catch(() => '');
      const headersObj: Record<string,string> = {};
      for (const [k,v] of request.headers.entries()) headersObj[k] = v;
      return new Response(JSON.stringify({
        ok: true,
        path: pathname,
        method: request.method,
        headers: headersObj,
        bodySnippet: text.slice(0, 200)
      }, null, 2), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Always respond JSON for /status and /health (so Accept: application/json works)
    if (pathname === '/status' || pathname === '/health') {
      return new Response(JSON.stringify({
        status: 'ok',
        path: pathname,
        when: new Date().toISOString()
      }, null, 2), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    // Root landing page (HTML)
    if (pathname === '/') {
      return new Response(`<!doctype html>
<html>
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Personal Assistant</title>
  <style>
    body{font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; padding: 24px; line-height:1.5}
    h1{margin-top:0}
    code, pre{background:#f6f8fa; padding:2px 6px; border-radius:6px}
    ul{margin:0; padding-left:18px}
    a{color:#2563eb; text-decoration:none}
    a:hover{text-decoration:underline}
  </style>
  </head>
  <body>
        <h1>Personal Assistant</h1>
        <p>Status: ready</p>
        <ul>
          <li><a href="/auth/google/start">Link Google (OAuth)</a></li>
          <li><a href="/email/inbox">Show inbox (last 10 unread)</a></li>
          <li><a href="/calendar/upcoming">Upcoming events</a></li>
        </ul>
      </body>
</html>`, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }

    // POST /mail/test - simple mail test handler (expects JSON { to: "email" })
    if (pathname === '/mail/test' && request.method === 'POST') {
      try {
        const json = await request.json();
        const to = json?.to;
        if (!to) return new Response(JSON.stringify({ error: 'to required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

        // If you have a MailChannels or other provider, insert real sending logic here.
        // For now we respond success and log to stdout (visible in wrangler tail).
        console.log('mail/test called, to=', to);

        return new Response(JSON.stringify({ ok: true, to }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      } catch (e) {
        return new Response(JSON.stringify({ error: 'invalid json', detail: String(e) }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      }
    }

    // POST /notion/create-task - minimal forwarder to Notion (requires NOTION_TOKEN & database_id in body)
    if (pathname === '/notion/create-task' && request.method === 'POST') {
      try {
        const body = await request.json();
        const { database_id, title, due, note } = body || {};
        if (!database_id || !title) return new Response(JSON.stringify({ error: 'database_id and title required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

        const notionToken = env.NOTION_TOKEN;
        if (!notionToken) return new Response(JSON.stringify({ error: 'NOTION_TOKEN not set in Worker secrets' }), { status: 500, headers: { 'Content-Type': 'application/json' } });

        // Basic create page payload for Notion API (simple properties) - adapt to your DB schema
        const payload: any = {
          parent: { database_id },
          properties: {
            Name: { title: [{ text: { content: title } }] }
          }
        };
        if (note) payload.properties.Note = { rich_text: [{ text: { content: note } }] };
        if (due) payload.properties.Due = { date: { start: due } };

        const res = await fetch('https://api.notion.com/v1/pages', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${notionToken}`,
            'Notion-Version': env.NOTION_API_VERSION || '2022-06-28',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        });

        const text = await res.text();
        let parsed: any = text;
        try { parsed = JSON.parse(text); } catch (_) {}

        if (!res.ok) return new Response(JSON.stringify({ error: 'notion returned error', status: res.status, body: parsed }), { status: 502, headers: { 'Content-Type': 'application/json' } });

        return new Response(JSON.stringify({ ok: true, id: parsed?.id || null, raw: parsed }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      } catch (e) {
        return new Response(JSON.stringify({ error: 'invalid json or request failed', detail: String(e) }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      }
    }

    // Fallback: Not found
    return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=UTF-8' } });
  }
};
