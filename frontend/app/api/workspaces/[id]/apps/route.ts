import { NextRequest, NextResponse } from "next/server";
import { requireWorkspaceAccessFromPath } from "@/app/api/workspaces/_utils";
import { buildBootstrapContractFromDb } from "@/lib/orb-os/contracts/store";
import { resolveAppsSurfaceEntries } from "@/lib/orb-os/contracts/rendering";

function dotForStatus(status: string): "green" | "amber" | "red" | "gray" {
  if (status === "connected") return "green";
  if (status === "needs_auth" || status === "needs_scope") return "amber";
  if (status === "degraded" || status === "policy_blocked") return "red";
  return "gray";
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const auth = await requireWorkspaceAccessFromPath(request, id);
  if (!auth.ok) return auth.response;

  const userId =
    auth.payload.user?.id || auth.payload.userId || auth.payload.userKey || null;
  const contract = await buildBootstrapContractFromDb(auth.workspaceId, {
    userId,
    seedIfMissing: true,
  });
  const entries = resolveAppsSurfaceEntries({
    workspaceId: auth.workspaceId,
    manifests: contract.app_manifest,
    installedApps: contract.installed_apps,
    integrationStatus: contract.integration_status,
    toolRegistry: contract.tool_registry,
  });

  return NextResponse.json({
    ok: true,
    workspaceId: auth.workspaceId,
    apps: entries.map((entry) => ({
      appKey: entry.app_id,
      name: entry.name,
      category: entry.category,
      icon: entry.icon_name,
      launchHint: entry.launch_hint,
      status: entry.status,
      dot: dotForStatus(entry.status),
      sourceAppId: entry.source_app_id,
      scopeHints: entry.scope_hints,
    })),
  });
}

