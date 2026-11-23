import { NextRequest, NextResponse } from "next/server";
import { supabaseAdminClient } from "@/lib/supabase/admin";
import { getWhoamiEndpoint } from "@/utils/auth-guard";
import type { WhoamiResponse } from "@/types/whoami";
import { forwardToWorkerOs, isWorkerBackboneMode, WorkerProxyError } from "@/lib/orb-os/runtime/workerProxy";
import { resolveWorkerAuthorizationHeader, resolveWorkerCookieHeader, resolveWorkerSessionHeaders } from "@/lib/auth/workerSessionHeaders";

async function fetchWhoami(request: NextRequest) {
  const headers = resolveWorkerSessionHeaders(request);
  const response = await fetch(getWhoamiEndpoint(), {
    method: "GET",
    headers,
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null);
  return { response, payload } as {
    response: Response;
    payload: WhoamiResponse | null;
  };
}

function parseUserId(whoami: WhoamiResponse): string | null {
  return whoami.user?.id || whoami.userId || whoami.userKey;
}


export async function POST(request: NextRequest) {
  // 1. Authenticate the user
  const { response: whoamiResponse, payload: whoamiPayload } = await fetchWhoami(request);

  if (!whoamiResponse.ok || !whoamiPayload) {
    return NextResponse.json(
      { error: "Unable to validate session" },
      { status: whoamiResponse.status }
    );
  }

  const userId = parseUserId(whoamiPayload);
  if (!userId) {
    return NextResponse.json({ error: "Invalid user session" }, { status: 401 });
  }

  // 2. Parse the request body
  const { intent, workspace_id } = await request.json();

  if (!intent || typeof intent !== 'string') {
    return NextResponse.json({ error: "Missing or invalid 'intent'" }, { status: 400 });
  }
  if (!workspace_id || typeof workspace_id !== 'string') {
    return NextResponse.json({ error: "Missing or invalid 'workspace_id'" }, { status: 400 });
  }

  if (isWorkerBackboneMode()) {
    try {
      const payload = await forwardToWorkerOs({
        path: "/v1/os/runs",
        method: "POST",
        cookieHeader: resolveWorkerCookieHeader(request),
        authorizationHeader: resolveWorkerAuthorizationHeader(request),
        body: {
          intent_text: intent,
        },
      }) as { run?: { id: string } };
      return NextResponse.json({ run_id: payload.run?.id ?? null, local_execution_allowed: false });
    } catch (error) {
      if (error instanceof WorkerProxyError) {
        return NextResponse.json(
          error.payload ?? {
            ok: false,
            error_code: "BACKBONE_UNAVAILABLE",
            message: "Degraded mode active. Worker backbone unavailable. Local run writes are disabled.",
          },
          { status: error.status },
        );
      }
      return NextResponse.json(
        {
          ok: false,
          error_code: "BACKBONE_UNAVAILABLE",
          message: "Degraded mode active. Worker backbone unavailable. Local run writes are disabled.",
        },
        { status: 503 },
      );
    }
  }

  // 3. Create the new orchestration run in the database (legacy local mode)
  try {
    const { data, error } = await supabaseAdminClient
      .from("orchestration_runs")
      .insert({
        intent,
        workspace_id,
        user_id: userId,
        status: "thinking",
      })
      .select("id")
      .single();

    if (error) {
      console.error("Failed to create orchestration run:", error);
      return NextResponse.json(
        { error: "Failed to create orchestration run", details: error.message },
        { status: 500 }
      );
    }

    // 4. Return the ID of the new run
    return NextResponse.json({ run_id: data.id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("CRITICAL: Failed to create orchestration run (unhandled):", msg);
    return NextResponse.json(
      { error: "System failure during run creation", details: msg },
      { status: 503 }
    );
  }
}
