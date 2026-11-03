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
  const webhook = trimEnv("GOOGLE_STITCH_DRAFT_WEBHOOK_URL", "STITCH_DRAFT_WEBHOOK_URL");

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
        return NextResponse.json({ ok: true, provider: "google_stitch", draftUrl, source: "webhook" });
      }
    } catch {
      // fallback to configured/default URL below
    }
  }

  const fallbackUrl = trimEnv(
    "GOOGLE_STITCH_DEFAULT_DRAFT_URL",
    "NEXT_PUBLIC_GOOGLE_STITCH_DEFAULT_DRAFT_URL",
  );
  if (fallbackUrl) {
    return NextResponse.json({
      ok: true,
      provider: "google_stitch",
      draftUrl: fallbackUrl,
      source: "configured-default",
    });
  }

  return NextResponse.json(
    {
      ok: false,
      code: "STITCH_DRAFT_GENERATOR_NOT_CONFIGURED",
      error:
        "No Stitch draft generator configured. Set GOOGLE_STITCH_DRAFT_WEBHOOK_URL (recommended) or GOOGLE_STITCH_DEFAULT_DRAFT_URL.",
    },
    { status: 503 },
  );
}
