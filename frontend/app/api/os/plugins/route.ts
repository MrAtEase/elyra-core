import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getWhoamiEndpoint } from "@/utils/auth-guard";
import type { WhoamiResponse } from "@/types/whoami";
import { installOrUpdatePlugin, listWorkspacePlugins, removePlugin, rollbackPlugin } from "@/lib/orb-os/plugins/store";
import { resolveWorkerSessionHeaders } from "@/lib/auth/workerSessionHeaders";

const bodySchema = z.object({
  action: z.enum(["install", "update", "remove", "rollback"]),
  plugin_id: z.string().min(1),
  version: z.string().optional(),
  manifest: z.unknown().optional(),
});

async function whoami(request: NextRequest) {
  const headers = resolveWorkerSessionHeaders(request);
  const response = await fetch(getWhoamiEndpoint(), { method: "GET", headers, cache: "no-store" });
  const payload = (await response.json().catch(() => null)) as WhoamiResponse | null;
  return { response, payload };
}

export async function GET(request: NextRequest) {
  const { response, payload } = await whoami(request);
  if (!response.ok || !payload) {
    return NextResponse.json({ ok: false, error: "AUTH_REQUIRED" }, { status: response.status });
  }

  const workspaceId = payload.activeWorkspace?.id || payload.session?.activeWorkspaceId || payload.workspaceId;
  if (!workspaceId) {
    return NextResponse.json({ ok: false, error: "WORKSPACE_REQUIRED" }, { status: 400 });
  }

  const data = await listWorkspacePlugins(workspaceId);
  return NextResponse.json({ ok: true, workspace_id: workspaceId, ...data });
}

export async function POST(request: NextRequest) {
  const { response, payload } = await whoami(request);
  if (!response.ok || !payload) {
    return NextResponse.json({ ok: false, error: "AUTH_REQUIRED" }, { status: response.status });
  }

  const workspaceId = payload.activeWorkspace?.id || payload.session?.activeWorkspaceId || payload.workspaceId;
  if (!workspaceId) {
    return NextResponse.json({ ok: false, error: "WORKSPACE_REQUIRED" }, { status: 400 });
  }

  const role = (payload.membership?.role || "member").toLowerCase();
  if (!(["owner", "admin", "system_owner"].includes(role))) {
    return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
  }

  const actorUserId = payload.user?.id || payload.userId || payload.userKey || null;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "INVALID_INPUT", details: parsed.error.issues }, { status: 400 });
  }

  try {
    if (parsed.data.action === "install" || parsed.data.action === "update") {
      const installed = await installOrUpdatePlugin({
        workspaceId,
        actorUserId,
        action: parsed.data.action,
        manifest: parsed.data.manifest,
      });
      return NextResponse.json({ ok: true, plugin: installed });
    }

    if (parsed.data.action === "remove") {
      await removePlugin({
        workspaceId,
        pluginId: parsed.data.plugin_id,
        actorUserId,
      });
      return NextResponse.json({ ok: true });
    }

    await rollbackPlugin({
      workspaceId,
      pluginId: parsed.data.plugin_id,
      toVersion: parsed.data.version ?? "",
      actorUserId,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "PLUGIN_OPERATION_FAILED",
        message: error instanceof Error ? error.message : "Plugin operation failed",
      },
      { status: 409 },
    );
  }
}
