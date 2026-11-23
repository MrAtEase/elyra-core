import { NextRequest, NextResponse } from "next/server";
import { requireWorkspaceAccessFromPath } from "@/app/api/workspaces/_utils";
import { disconnectGoogleTokens } from "@/lib/google/tokenStore";
import { upsertWorkspaceIntegrationConnection } from "@/lib/integrations/store";

function mapIntegrationKey(value: string): "google_workspace" | "imap_smtp" | "figma" | "banana2" | "google_stitch" | "twentyfirst" | "unknown" {
  const key = value.toLowerCase();
  if (key === "google_workspace" || key === "google") return "google_workspace";
  if (key === "imap_smtp" || key === "imap" || key === "icloud_imap") return "imap_smtp";
  if (key === "figma") return "figma";
  if (key === "banana2" || key === "banana") return "banana2";
  if (key === "google_stitch" || key === "stitch") return "google_stitch";
  if (key === "twentyfirst" || key === "21st" || key === "21st_dev" || key === "21st.dev") return "twentyfirst";
  return "unknown";
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string; key: string }> },
) {
  const { id, key } = await context.params;
  const auth = await requireWorkspaceAccessFromPath(request, id);
  if (!auth.ok) return auth.response;

  const integration = mapIntegrationKey(key);
  const userId =
    auth.payload.user?.id || auth.payload.userId || auth.payload.userKey || null;

  if (integration === "google_workspace") {
    await disconnectGoogleTokens({
      workspaceId: auth.workspaceId,
      userId,
    });
    return NextResponse.json({ ok: true, workspaceId: auth.workspaceId, integrationKey: "google_workspace" });
  }

  if (integration === "imap_smtp") {
    await upsertWorkspaceIntegrationConnection({
      workspaceId: auth.workspaceId,
      provider: "imap",
      userId,
      status: "disconnected",
      lastHealthCheckAt: new Date().toISOString(),
      errorCode: null,
    });
    await upsertWorkspaceIntegrationConnection({
      workspaceId: auth.workspaceId,
      provider: "icloud_imap",
      userId,
      status: "disconnected",
      lastHealthCheckAt: new Date().toISOString(),
      errorCode: null,
    });
    return NextResponse.json({ ok: true, workspaceId: auth.workspaceId, integrationKey: "imap_smtp" });
  }

  if (integration === "figma" || integration === "banana2" || integration === "google_stitch" || integration === "twentyfirst") {
    return NextResponse.json({ ok: true, workspaceId: auth.workspaceId, integrationKey: integration });
  }

  return NextResponse.json(
    { ok: false, error: "unsupported_integration_key", hint: `Unsupported integration key: ${key}` },
    { status: 400 },
  );
}
