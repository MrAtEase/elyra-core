import { NextRequest, NextResponse } from "next/server";
import { getGoogleAuthContext } from "@/lib/google/auth";
import { GoogleConfigError } from "@/lib/google/env";
import { GoogleApiError } from "@/lib/google/http";
import { GOOGLE_TASKS_READONLY_SCOPE } from "@/lib/google/scopes";
import { ensureGoogleAccessToken, GoogleTokenError } from "@/lib/google/tokenStore";
import { listGoogleOpenTasks } from "@/lib/google/tasks";
import { getWorkspaceId } from "@/lib/api/workspaceRequest";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const resolved = getWorkspaceId(request, false);
  if (!resolved.ok) {
    return NextResponse.json(
      { ok: false, error: resolved.error, reason: resolved.reason, hint: resolved.hint },
      { status: resolved.status }
    );
  }

  const auth = await getGoogleAuthContext(request, resolved.workspaceId);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.message, loginUrl: auth.loginUrl ?? "/signin" },
      { status: auth.status }
    );
  }

  try {
    const token = await ensureGoogleAccessToken({
      workspaceId: auth.context.workspaceId,
      userId: auth.context.userId,
      requiredScopes: [GOOGLE_TASKS_READONLY_SCOPE],
    });

    const tasks = await listGoogleOpenTasks({
      accessToken: token.accessToken,
      maxLists: 5,
      maxTasksPerList: 10,
    });

    return NextResponse.json({
      ok: true,
      workspaceId: auth.context.workspaceId,
      count_open: tasks.length,
      tasks: tasks.slice(0, 50),
    });
  } catch (error) {
    if (error instanceof GoogleTokenError) {
      return NextResponse.json(
        { ok: false, error: error.message, code: error.code },
        { status: error.status }
      );
    }
    if (error instanceof GoogleApiError) {
      return NextResponse.json(
        { ok: false, error: error.message, code: error.code },
        { status: error.status }
      );
    }
    if (error instanceof GoogleConfigError) {
      return NextResponse.json(
        { ok: false, error: error.issues.join(" | "), code: "config_error" },
        { status: 500 }
      );
    }
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unable to load Google tasks.",
      },
      { status: 500 }
    );
  }
}
