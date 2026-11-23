import { NextRequest, NextResponse } from "next/server";
import { fetchWhoamiPayload } from "@/lib/api/whoamiClient";
import { callGeminiText, geminiConfigured } from "@/lib/ai/geminiDirect";

export const runtime = "nodejs";
export const maxDuration = 120;

type In = { id: string; [k: string]: string };

/** POST /api/os/feed – { products: [{id,title,description,brand,…}], issues } → { suggestions: [{id,title,description,reason}] } */
export async function POST(request: NextRequest) {
  const who = await fetchWhoamiPayload(request).catch(() => null);
  if (!who?.response.ok) return NextResponse.json({ ok: false, error: "Nicht angemeldet." }, { status: 401 });
  if (!geminiConfigured()) return NextResponse.json({ ok: false, error: "GEMINI_API_KEY fehlt." }, { status: 503 });
  const body = (await request.json().catch(() => ({}))) as { products?: In[]; language?: string };
  const products = (body.products ?? []).slice(0, 15).map((p) => {
    const keep: Record<string, string> = {};
    for (const k of ["id", "title", "description", "brand", "product_type", "google_product_category", "color", "size", "material", "gender", "age_group", "gtin", "mpn", "price"]) if (p[k]) keep[k] = String(p[k]).slice(0, 1500);
    return keep;
  });
  if (products.length === 0) return NextResponse.json({ ok: false, error: "Keine Produkte übergeben." }, { status: 400 });
  try {
    const { text } = await callGeminiText({
      system: `Du optimierst Google-Shopping-Produktdaten (Merchant Center) für mehr Relevanz und Klickrate.
Regeln für "title": max. 150 Zeichen, die wichtigsten Infos in den ersten 70 Zeichen; Aufbau ungefähr: Marke + Produkttyp + wichtigste Merkmale (Material, Farbe, Größe, Variante, Zielgruppe). Keine Werbung („Top-Preis“, „Sale“, „!!!“), keine Großbuchstaben-Wörter, keine Preise.
Regeln für "description": 300–900 Zeichen, sachlich, Nutzen + Merkmale, nur Fakten aus den gelieferten Daten – NICHTS erfinden (keine Maße, Materialien oder Eigenschaften, die nicht in den Daten stehen). Keine Werbefloskeln, keine Links.
"reason": ein kurzer Satz, was verbessert wurde.
Sprache: ${body.language ?? "Deutsch"}. Antworte nur mit JSON: {"suggestions":[{"id":"…","title":"…","description":"…","reason":"…"}]}`,
      prompt: JSON.stringify(products),
      json: true,
      temperature: 0.3,
      maxOutputTokens: 8000,
      timeoutMs: 90_000,
    });
    const parsed = JSON.parse(text) as { suggestions?: Array<{ id?: string; title?: string; description?: string; reason?: string }> };
    const suggestions = (parsed.suggestions ?? [])
      .filter((s) => s.id && s.title)
      .map((s) => ({ id: String(s.id), title: String(s.title).slice(0, 150), description: String(s.description ?? "").slice(0, 5000), reason: String(s.reason ?? "") }));
    return NextResponse.json({ ok: true, suggestions });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "Fehler" }, { status: 502 });
  }
}
