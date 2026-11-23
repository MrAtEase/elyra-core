import { NextResponse, type NextRequest } from "next/server";
import { requirePlatformOwner } from "@/lib/api/requireAuth";
import { forwardToWorker } from "@/lib/api/workerProxy";

export const dynamic = "force-dynamic";

/** Customer overview for the platform owner: metadata only, never content. */
export async function GET(request: NextRequest) {
  const auth = await requirePlatformOwner(request);
  if (auth instanceof NextResponse) return auth;
  return forwardToWorker(request, "/assistant/platform/customers", { method: "GET" });
}
