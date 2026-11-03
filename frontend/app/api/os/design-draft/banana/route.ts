import { NextRequest, NextResponse } from "next/server";

function trimEnv(...keys: string[]): string {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return "";
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const webhook = trimEnv("BANANA2_DRAFT_WEBHOOK_URL", "BANANA_DRAFT_WEBHOOK_URL");

  if (webhook) {
    try {
      const upstream = await fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        cache: "no-store",
      });
      const payload = (await upstream.json().catch(() => null)) as
        | { draftUrl?: string; url?: string }
        | null;
      const draftUrl = (payload?.draftUrl ?? payload?.url ?? "").trim();
      if (upstream.ok && draftUrl) {
        return NextResponse.json({ ok: true, provider: "banana2", draftUrl, source: "webhook" });
      }
    } catch {
      // fallback to configured/default URL below
    }
  }

  const fallbackUrl = trimEnv(
    "BANANA2_DEFAULT_DRAFT_URL",
    "NEXT_PUBLIC_BANANA2_DEFAULT_DRAFT_URL",
  );
  if (fallbackUrl) {
    return NextResponse.json({
      ok: true,
      provider: "banana2",
      draftUrl: fallbackUrl,
      source: "configured-default",
    });
  }

  return NextResponse.json(
    {
      ok: false,
      code: "BANANA_DRAFT_GENERATOR_NOT_CONFIGURED",
      error:
        "No Banana draft generator configured. Set BANANA2_DRAFT_WEBHOOK_URL (recommended) or BANANA2_DEFAULT_DRAFT_URL.",
    },
    { status: 503 },
  );
}
