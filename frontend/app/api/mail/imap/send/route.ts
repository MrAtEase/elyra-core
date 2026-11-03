import { NextRequest, NextResponse } from "next/server";
import {
  fetchWhoamiPayload,
  getWhoamiUserId,
  hasWorkspaceAccess,
} from "@/lib/api/whoamiClient";
import { handleEmailIoApiError } from "@/lib/api/emailIoProxy";
import { requestEmailIo } from "@/lib/emailIoClient";
import { resolveCredentials } from "@/lib/integrations/resolveCredentials";
import { normalizeWorkspaceId } from "@/lib/workspace/normalizeWorkspaceId";

type MailSendRequest = {
  workspaceId: string;
  to: string[];
  subject: string;
  body: string;
  cc?: string[];
  bcc?: string[];
};

export async function POST(request: NextRequest) {
  const { response, payload } = await fetchWhoamiPayload(request);
  if (!response.ok || !payload) {
    return NextResponse.json({ error: "authentication_required" }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const { workspaceId, to, subject, body: text, cc, bcc } = body as MailSendRequest;
  const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId) ?? workspaceId;
  if (!normalizedWorkspaceId || !Array.isArray(to) || !subject || !text) {
    return NextResponse.json({ error: "workspaceId_to_subject_body_required" }, { status: 400 });
  }
  if (!hasWorkspaceAccess(payload, normalizedWorkspaceId)) {
    return NextResponse.json({ error: "workspace_not_accessible" }, { status: 403 });
  }
  const userId = getWhoamiUserId(payload);
  if (!userId) {
    return NextResponse.json({ error: "user_id_missing" }, { status: 500 });
  }
  try {
    const credentials = await resolveCredentials({
      provider: "imap",
      workspaceId: normalizedWorkspaceId,
      userId,
    });
    if (!credentials.ok) {
      return NextResponse.json(
        { error: credentials.code, message: credentials.message },
        { status: credentials.status }
      );
    }

    const data = await requestEmailIo("/smtp/send", {
      method: "POST",
      body: {
        userId,
        workspaceId: normalizedWorkspaceId,
        provider: "icloud_imap",
        payload: {
          to,
          subject,
          text,
          ...(cc && cc.length ? { cc } : {}),
          ...(bcc && bcc.length ? { bcc } : {}),
        },
      },
      context: { provider: "icloud_imap", reason: "mail/imap/send" },
      request,
    });
    return NextResponse.json(data);
  } catch (error: unknown) {
    return handleEmailIoApiError({
      route: "mail/imap/send",
      workspaceId: normalizedWorkspaceId,
      error,
    });
  }
}
