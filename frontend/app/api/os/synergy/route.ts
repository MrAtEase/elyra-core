import { NextRequest, NextResponse } from "next/server";
import { fetchWhoamiPayload } from "@/lib/api/whoamiClient";
import { callGeminiText, geminiConfigured } from "@/lib/ai/geminiDirect";

export const runtime = "nodejs";
export const maxDuration = 90;

/** POST /api/os/synergy – { kpis, top: {sparen, seo_chance, paid_chance}, brand } → { markdown } */
export async function POST(request: NextRequest) {
  const who = await fetchWhoamiPayload(request).catch(() => null);
  if (!who?.response.ok) return NextResponse.json({ ok: false, error: "Nicht angemeldet." }, { status: 401 });
  if (!geminiConfigured()) return NextResponse.json({ ok: false, error: "GEMINI_API_KEY fehlt." }, { status: 503 });
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const data = JSON.stringify(body).slice(0, 14_000);
  try {
    const { text, model } = await callGeminiText({
      system: `Du bist Senior-Berater für Suchmaschinenmarketing (SEA + SEO). Du bekommst die Auswertung eines Abgleichs von Google-Ads-Suchbegriffen mit Google-Search-Console-Daten.
Schreibe eine kurze, konkrete Management-Einschätzung auf Deutsch in Markdown:
## Kernaussage (2–3 Sätze, mit den wichtigsten Zahlen)
## Sofort umsetzbar (3–5 Punkte, je mit Begriff und erwarteter Wirkung)
## Test-Plan (wie man das Pausieren bezahlter Begriffe sauber testet, z. B. 2–4 Wochen, Geo-/Zeit-Split, welche KPIs)
## SEO-Content-Ideen (aus den SEO-Chancen abgeleitet)
## Risiken
Nutze NUR die gelieferten Zahlen, erfinde keine. Markenbegriffe vorsichtig behandeln (Konkurrenz-Bidding).`,
      prompt: data,
      temperature: 0.3,
      maxOutputTokens: 2500,
    });
    return NextResponse.json({ ok: true, markdown: text.trim(), model });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "Fehler" }, { status: 502 });
  }
}
