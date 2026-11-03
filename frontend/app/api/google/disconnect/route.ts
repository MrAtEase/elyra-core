import { NextRequest, NextResponse } from "next/server";
import { getGoogleAuthContext } from "@/lib/google/auth";
import { disconnectGoogleTokens } from "@/lib/google/tokenStore";
import { getWorkspaceId } from "@/lib/api/workspaceRequest";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const resolved = getWorkspaceId(request, false);
    if (!resolved.ok) {
      return NextResponse.json(
        { ok: false, error: resolved.error, reason: resolved.reason, hint: resolved.hint },
        { status: resolved.status }
      );
    }
    const requestedWorkspaceId = resolved.workspaceId;
    const auth = await getGoogleAuthContext(request, requestedWorkspaceId);
    if (!auth.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: auth.message,
          loginUrl: auth.loginUrl ?? "/signin",
        },
        { status: auth.status }
      );
    }

    await disconnectGoogleTokens({
      workspaceId: auth.context.workspaceId,
      userId: auth.context.userId,
    });

    return NextResponse.json({
      ok: true,
      workspaceId: auth.context.workspaceId,
      disconnected: true,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unable to disconnect Google integration.";
    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      { status: 503 }
    );
  }
}
