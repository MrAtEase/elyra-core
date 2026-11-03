import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getWhoamiEndpoint } from "@/utils/auth-guard";
import type { WhoamiResponse } from "@/types/whoami";
import { buildBootstrapContractFromDb } from "@/lib/orb-os/contracts/store";
import { resolveWorkerSessionHeaders } from "@/lib/auth/workerSessionHeaders";

const querySchema = z.object({
  integration_id: z.string().min(1),
});

async function fetchWhoami(request: NextRequest) {
  const headers = resolveWorkerSessionHeaders(request);
  const response = await fetch(getWhoamiEndpoint(), { method: "GET", headers, cache: "no-store" });
  const payload = await response.json().catch(() => null);
  return { response, payload } as { response: Response; payload: WhoamiResponse | null };
}

export async function GET(request: NextRequest) {
  const { response, payload } = await fetchWhoami(request);
  if (!response.ok || !payload) {
    return NextResponse.json({ ok: false, error: "AUTH_REQUIRED" }, { status: response.status });
  }

  const workspaceId = payload.activeWorkspace?.id || payload.session?.activeWorkspaceId || payload.workspaceId;
  if (!workspaceId) {
    return NextResponse.json({ ok: false, error: "WORKSPACE_REQUIRED" }, { status: 400 });
  }

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({ integration_id: url.searchParams.get("integration_id") });
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "INVALID_INPUT", details: parsed.error.issues }, { status: 400 });
  }

  const userId = payload.user?.id || payload.userId || payload.userKey || null;
  const contract = await buildBootstrapContractFromDb(workspaceId, { userId, seedIfMissing: true });
  const integration = contract.integration_status.find((entry) => entry.integration_id === parsed.data.integration_id);
  if (!integration) {
    return NextResponse.json({ ok: false, error: "INTEGRATION_NOT_FOUND" }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    diagnosis: {
      integration_id: integration.integration_id,
      state: integration.state,
      checks: [
        { id: "connected_flag", label: "Connected flag", ok: integration.connected },
        { id: "health_score", label: "Health score >= 0.6", ok: integration.health_score >= 0.6 },
        { id: "scopes_present", label: "Scopes present", ok: integration.scopes.length > 0 },
      ],
      safe_error_details: integration.error_message_safe,
      error_code: integration.error_code,
      suggested_next_action:
        integration.state === "connected"
          ? "No action required"
          : integration.reauth_url
            ? "Reconnect integration"
            : "Contact admin",
    },
  });
}
