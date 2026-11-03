import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
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
  return NextResponse.json({ ok: true });
}
