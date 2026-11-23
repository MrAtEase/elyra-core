import { requireUser } from "@/lib/api/requireAuth";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const auth = await requireUser(request);
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json({
    ok: true,
    settings: {
      fastModel: "gemini-2.0-flash",
      deepModel: "claude-sonnet-4-20250514",
      graphMemory: true,
      budget: 200,
    }
  });
}

export async function POST(request: NextRequest) {
  const auth = await requireUser(request);
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json({ ok: true });
}
