import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({
    NEXT_PUBLIC_ASSISTANT_API_BASE: process.env.NEXT_PUBLIC_ASSISTANT_API_BASE ?? null,
    NEXT_PUBLIC_API_ORIGIN: process.env.NEXT_PUBLIC_API_ORIGIN ?? null,
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? null,
  });
}
