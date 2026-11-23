import { NextResponse, type NextRequest } from "next/server";
import { requireWorkspace } from "@/lib/api/requireAuth";
import { ensureGoogleAccessToken, GoogleTokenError } from "@/lib/google/tokenStore";
import { googleApiFetch, GoogleApiError } from "@/lib/google/http";
import { GOOGLE_DRIVE_READONLY_SCOPE } from "@/lib/google/scopes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DriveFile = {
  id?: string;
  name?: string;
  mimeType?: string;
  modifiedTime?: string;
  size?: string;
  webViewLink?: string;
  owners?: Array<{ displayName?: string; me?: boolean }>;
  shared?: boolean;
  starred?: boolean;
};

/**
 * GET /api/os/files?workspaceId=…&q=…
 * Files from the workspace's connected Google Drive (read-only, newest first).
 */
export async function GET(request: NextRequest) {
  const auth = await requireWorkspace(request, request.nextUrl.searchParams.get("workspaceId"));
  if (auth instanceof NextResponse) return auth;

  let accessToken: string;
  try {
    const token = await ensureGoogleAccessToken({
      workspaceId: auth.workspaceId,
      userId: auth.userId,
      requiredScopes: [GOOGLE_DRIVE_READONLY_SCOPE],
    });
    accessToken = token.accessToken;
  } catch (error) {
    if (error instanceof GoogleTokenError) {
      console.warn("[api/os/files] google token", error.code, error.message);
      const state = error.code === "not_connected" ? "not_connected" : error.code === "missing_scope" ? "missing_scope" : "expired";
      return NextResponse.json({ ok: true, connected: false, state, files: [] });
    }
    return NextResponse.json({ ok: false, error: "drive_unavailable" }, { status: 502 });
  }

  const q = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 100);
  const terms = ["trashed = false", "mimeType != 'application/vnd.google-apps.folder'"];
  if (q) terms.push(`name contains '${q.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`);

  const url = new URL("https://www.googleapis.com/drive/v3/files");
  url.searchParams.set("q", terms.join(" and "));
  url.searchParams.set("pageSize", "60");
  url.searchParams.set("orderBy", "modifiedTime desc");
  url.searchParams.set("fields", "files(id,name,mimeType,modifiedTime,size,webViewLink,owners(displayName,me),shared,starred)");
  url.searchParams.set("supportsAllDrives", "true");
  url.searchParams.set("includeItemsFromAllDrives", "true");

  try {
    const payload = await googleApiFetch<{ files?: DriveFile[] }>(url, accessToken);
    const files = (payload.files ?? [])
      .filter((f): f is Required<Pick<DriveFile, "id" | "name" | "mimeType">> & DriveFile => Boolean(f.id && f.name && f.mimeType))
      .map((f) => ({
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        modifiedTime: f.modifiedTime ?? null,
        size: f.size ? Number(f.size) : null,
        webViewLink: f.webViewLink ?? null,
        owner: f.owners?.[0]?.me ? null : (f.owners?.[0]?.displayName ?? null),
        shared: Boolean(f.shared),
        starred: Boolean(f.starred),
      }));
    return NextResponse.json({ ok: true, connected: true, files });
  } catch (error) {
    if (error instanceof GoogleApiError) console.warn("[api/os/files] drive api", error.status, error.code, error.message);
    if (error instanceof GoogleApiError && /has not been used|is disabled|accessNotConfigured|SERVICE_DISABLED/i.test(`${error.code ?? ""} ${error.message}`)) {
      return NextResponse.json({ ok: true, connected: false, state: "api_disabled", files: [], detail: error.message.slice(0, 300) });
    }
    if (error instanceof GoogleApiError && (error.status === 401 || error.status === 403)) {
      return NextResponse.json({ ok: true, connected: false, state: "expired", files: [], detail: error.message.slice(0, 300) });
    }
    return NextResponse.json({ ok: false, error: "drive_error" }, { status: 502 });
  }
}
