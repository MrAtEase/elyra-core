import { NextResponse, type NextRequest } from "next/server";
import { requirePlatformOwner } from "@/lib/api/requireAuth";

export const dynamic = "force-dynamic";

// Shows which public API endpoints this instance is configured with. Platform owner only.
export async function GET(request: NextRequest) {
  const auth = await requirePlatformOwner(request);
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json({
    NEXT_PUBLIC_ASSISTANT_API_BASE: process.env.NEXT_PUBLIC_ASSISTANT_API_BASE ?? null,
    NEXT_PUBLIC_API_ORIGIN: process.env.NEXT_PUBLIC_API_ORIGIN ?? null,
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? null,
  });
}
