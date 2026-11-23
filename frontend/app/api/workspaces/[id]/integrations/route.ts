/**
 * GET /api/workspaces/[id]/integrations
 *
 * Single Source of Truth: forwards to the Cloudflare Worker integration
 * status endpoint, which itself calls the internal token bridge to resolve
 * real credential presence without a legacy DB split.
 *
 * Falls back to the local buildRuntimeIntegrationStatus() when the Worker
 * is unreachable (e.g. during local dev without wrangler running).
 */

import { NextRequest, NextResponse } from "next/server";
import { requireWorkspaceAccessFromPath } from "@/app/api/workspaces/_utils";
import { buildRuntimeIntegrationStatus } from "@/lib/orb-os/contracts/integrationStatus";

export const runtime = "nodejs";

function mapState(
  state: "connected" | "needs_auth" | "degraded" | "disconnected" | "error" | "disabled" | string,
): "connected" | "needs_auth" | "error" | "disabled" {
  if (state === "connected") return "connected";
  if (state === "needs_auth") return "needs_auth";
  if (state === "degraded" || state === "error") return "error";
  return "disabled";
}

function resolveWorkerBase(): string {
  return (
    process.env.NEXT_PUBLIC_ASSISTANT_API_BASE ||
    process.env.ASSISTANT_API_BASE ||
    ""
  ).replace(/\/$/, "");
}

function resolveInternalSecret(): string {
  return (
    process.env.ELYRA_INTERNAL_SECRET ||
    process.env.INTERNAL_API_SECRET ||
    process.env.INTERNAL_API_KEY ||
    ""
  ).trim();
}

type WorkerIntegrationEntry = {
  integrationKey: string;
  connected: boolean;
  state: string;
  scopes?: string[];
  health?: string;
  lastCheckedAt?: string;
  reauthUrl?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
};

type WorkerStatusResponse = {
  ok: boolean;
  workspaceId: string;
  integrations: WorkerIntegrationEntry[];
  fromCache?: boolean;
};

async function fetchFromWorker(
  workspaceId: string,
  request: NextRequest,
): Promise<WorkerStatusResponse | null> {
  const base = resolveWorkerBase();
  if (!base) return null;

  const secret = resolveInternalSecret();
  const url = `${base}/v1/os/workspaces/${encodeURIComponent(workspaceId)}/integrations/status`;

  try {
    // Forward session cookie so the Worker can resolve the user
    const cookieHeader = request.headers.get("cookie") ?? "";
    const authHeader = request.headers.get("authorization") ?? "";

    const res = await fetch(url, {
      method: "GET",
      headers: {
        ...(cookieHeader ? { cookie: cookieHeader } : {}),
        ...(authHeader ? { authorization: authHeader } : {}),
        ...(secret ? { "x-internal-secret": secret } : {}),
        "content-type": "application/json",
      },
      cache: "no-store",
    });

    if (!res.ok) return null;
    const data = (await res.json()) as WorkerStatusResponse;
    if (!data?.ok) return null;
    return data;
  } catch {
    return null;
  }
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const auth = await requireWorkspaceAccessFromPath(request, id);
  if (!auth.ok) return auth.response;

  const workspaceId = auth.workspaceId;

  // ── Try Worker (Single Source of Truth) ──────────────────────────────────
  const workerData = await fetchFromWorker(workspaceId, request);
  if (workerData) {
    return NextResponse.json(
      {
        ok: true,
        workspaceId,
        integrations: workerData.integrations.map((entry) => ({
          integrationKey: entry.integrationKey,
          status: mapState(entry.state),
          state: entry.state,
          connected: entry.connected,
          scopes: Array.isArray(entry.scopes) ? entry.scopes : [],
          errorCode: entry.errorCode ?? null,
          errorMessage: entry.errorMessage ?? null,
          lastHealthCheckAt: entry.lastCheckedAt ?? new Date().toISOString(),
          reauthUrl: entry.reauthUrl ?? null,
        })),
        fromWorker: true,
        fromCache: workerData.fromCache ?? false,
      },
      {
        headers: {
          // Allow the CDN/edge to cache for 30s; clients may serve stale up to 60s
          "Cache-Control": "private, s-maxage=30, stale-while-revalidate=60",
        },
      },
    );
  }

  // ── Fallback: local Supabase-based status (when Worker unreachable) ───────
  const userId =
    auth.payload.user?.id || auth.payload.userId || auth.payload.userKey || null;
  const status = await buildRuntimeIntegrationStatus(workspaceId, userId);

  return NextResponse.json(
    {
      ok: true,
      workspaceId,
      integrations: status.map((entry) => ({
        integrationKey: entry.integration_id,
        status: mapState(entry.state),
        state: entry.state,
        connected: entry.connected,
        scopes: entry.scopes,
        errorCode: entry.error_code,
        errorMessage: entry.error_message_safe,
        lastHealthCheckAt: entry.last_refresh_at,
        reauthUrl: entry.reauth_url,
      })),
      fromWorker: false,
      fromCache: false,
    },
    {
      headers: {
        "Cache-Control": "private, s-maxage=30, stale-while-revalidate=60",
      },
    },
  );
}
