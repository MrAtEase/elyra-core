import { NextRequest, NextResponse } from "next/server";
import { getGoogleAuthContext } from "@/lib/google/auth";
import { ensureGoogleAccessToken, loadStoredGoogleTokens } from "@/lib/google/tokenStore";
import { parseScopeString } from "@/lib/google/scopes";
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
        { status: auth.status },
      );
    }

    const body = (await request.json().catch(() => null)) as { required_scopes?: string[] | string } | null;
    const requiredScopes = Array.isArray(body?.required_scopes)
      ? body.required_scopes
      : parseScopeString(typeof body?.required_scopes === "string" ? body.required_scopes : null);

    const refreshed = await ensureGoogleAccessToken({
      workspaceId: auth.context.workspaceId,
      userId: auth.context.userId,
      requiredScopes,
    });
    const stored = await loadStoredGoogleTokens(auth.context.workspaceId, auth.context.userId);

    return NextResponse.json({
      ok: true,
      workspaceId: auth.context.workspaceId,
      refreshed: true,
      scopes: refreshed.scopes,
      expires_at_ms: refreshed.expiresAtMs,
      has_refresh_token: Boolean(stored?.refreshToken),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to refresh Google token.";
    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      { status: 503 },
    );
  }
}
