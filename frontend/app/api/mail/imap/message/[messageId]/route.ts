import { NextRequest, NextResponse } from "next/server";
import {
  fetchWhoamiPayload,
  getWhoamiUserId,
  hasWorkspaceAccess,
} from "@/lib/api/whoamiClient";
import { requestEmailIo } from "@/lib/emailIoClient";
import { getWorkspaceId } from "@/lib/api/workspaceRequest";
import { resolveImapCredentials, resolveCredentials } from "@/lib/integrations/resolveCredentials";
import { getGmailMessageDetail } from "@/lib/google/gmail";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
const MAIL_DETAIL_CACHE_TTL_MS = 60_000;

type MailMessageDetailPayload =
  | { ok: true; message: Record<string, unknown> }
  | { error: string; code?: string };

const mailDetailCache = new Map<string, { expiresAt: number; payload: MailMessageDetailPayload }>();
const mailDetailInflight = new Map<string, Promise<MailMessageDetailPayload>>();

type RawEntry = Record<string, unknown>;

function toIsoDate(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  return new Date().toISOString();
}

function extractFrom(entry: RawEntry): string {
  const raw = entry.from;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    if (typeof obj.name === "string" && obj.name.trim()) return obj.name.trim();
    if (typeof obj.address === "string" && obj.address.trim()) return obj.address.trim();
    if (typeof obj.value === "string" && obj.value.trim()) return obj.value.trim();
  }
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  const envelope = entry.envelope as Record<string, unknown> | undefined;
  if (envelope && Array.isArray(envelope.from) && envelope.from.length > 0) {
    const ef = envelope.from[0] as Record<string, unknown>;
    if (typeof ef?.name === "string" && ef.name.trim()) return ef.name.trim();
    if (typeof ef?.address === "string" && ef.address.trim()) return ef.address.trim();
  }
  if (Array.isArray(entry.headers)) {
    const h = (entry.headers as Array<{ name: string; value: string }>).find(
      (h) => h.name?.toLowerCase() === "from"
    );
    if (h?.value?.trim()) return h.value.trim();
  }
  return "";
}

async function detectMailProvider(workspaceId: string): Promise<"google" | "imap" | "icloud_imap" | null> {
  try {
    const supabase = getSupabaseAdminClient();
    const { data: rows } = await supabase
      .from("integrations")
      .select("provider, status")
      .eq("workspace_id", workspaceId)
      .in("provider", ["google", "imap", "icloud_imap"])
      .order("updated_at", { ascending: false });
    if (!Array.isArray(rows) || rows.length === 0) return null;
    const connected = (rows as Array<{ provider: string; status: string }>).filter(
      (r) => r.status === "connected"
    );
    const pool = connected.length > 0 ? connected : (rows as Array<{ provider: string; status: string }>);
    if (pool.some((r) => r.provider === "google")) return "google";
    if (pool.some((r) => r.provider === "imap")) return "imap";
    if (pool.some((r) => r.provider === "icloud_imap")) return "icloud_imap";
    return null;
  } catch {
    return null;
  }
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ messageId: string }> }
) {
  const { response, payload } = await fetchWhoamiPayload(request);
  if (!response.ok || !payload) {
    return NextResponse.json({ error: "authentication_required" }, { status: 401 });
  }

  const resolvedWorkspace = getWorkspaceId(request, true);
  if (!resolvedWorkspace.ok) {
    return NextResponse.json(
      { error: resolvedWorkspace.error, reason: resolvedWorkspace.reason, hint: resolvedWorkspace.hint },
      { status: resolvedWorkspace.status }
    );
  }
  if (!resolvedWorkspace.workspaceId) {
    return NextResponse.json({ error: "workspaceId_required" }, { status: 400 });
  }
  const workspaceId = resolvedWorkspace.workspaceId;

  if (!hasWorkspaceAccess(payload, workspaceId)) {
    return NextResponse.json({ error: "workspace_not_accessible" }, { status: 403 });
  }

  const userId = getWhoamiUserId(payload);
  if (!userId) {
    return NextResponse.json({ error: "user_id_missing" }, { status: 500 });
  }

  const { messageId: rawMessageId } = await context.params;
  let messageId = rawMessageId ?? "";
  try { messageId = decodeURIComponent(messageId); } catch { /* keep raw */ }

  if (!messageId) {
    return NextResponse.json({ error: "message_id_required" }, { status: 400 });
  }

  try {
    const key = `${workspaceId}::${messageId}`;
    const cached = mailDetailCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return NextResponse.json(cached.payload, { status: 200 });
    }

    const pending =
      mailDetailInflight.get(key) ??
      (async () => {
        const provider = await detectMailProvider(workspaceId);

        if (provider === "google") {
          const credentials = await resolveCredentials({ provider: "google", workspaceId, userId });
          if (!credentials.ok) {
            const payload: MailMessageDetailPayload = { error: credentials.message, code: credentials.code };
            mailDetailCache.set(key, { expiresAt: Date.now() + MAIL_DETAIL_CACHE_TTL_MS, payload });
            mailDetailInflight.delete(key);
            return payload;
          }
          const detail = await getGmailMessageDetail({
            accessToken: credentials.accessToken,
            messageId,
          });
          const payload: MailMessageDetailPayload = { ok: true, message: detail as Record<string, unknown> };
          mailDetailCache.set(key, { expiresAt: Date.now() + MAIL_DETAIL_CACHE_TTL_MS, payload });
          mailDetailInflight.delete(key);
          return payload;
        }

        const credentials = await resolveImapCredentials(workspaceId, userId);
        if (!credentials.ok) {
          const payload: MailMessageDetailPayload = { error: credentials.message, code: credentials.code };
          mailDetailCache.set(key, { expiresAt: Date.now() + MAIL_DETAIL_CACHE_TTL_MS, payload });
          mailDetailInflight.delete(key);
          return payload;
        }

        const data = await requestEmailIo("/icloud/threads", {
          method: "POST",
          body: {
            workspaceId,
            userId,
            provider: provider ?? "icloud_imap",
            folder: "INBOX",
            limit: 100,
            credentials: {
              email: credentials.email,
              appPassword: credentials.password,
              imapHost: credentials.imapHost,
              imapPort: credentials.imapPort,
            },
          },
          context: { provider: provider ?? "icloud_imap", reason: "mail/imap/message" },
          request,
        });

        const threadsRaw =
          data && typeof data === "object" && Array.isArray((data as { threads?: unknown[] }).threads)
            ? ((data as { threads: unknown[] }).threads as unknown[])
            : [];

        const thread = (threadsRaw as RawEntry[]).find(
          (entry) =>
            String(entry.id ?? "") === messageId ||
            String(entry.uid ?? "") === messageId ||
            String(entry.messageId ?? "") === messageId
        );

        if (!thread) {
          const payload: MailMessageDetailPayload = {
            ok: true,
            message: {
              id: messageId,
              threadId: messageId,
              from: "",
              subject: "Message preview unavailable",
              preview: "",
              date: new Date().toISOString(),
              isRead: true,
              isStarred: false,
              hasAttachment: false,
              labels: [],
              bodyText: "Message details are temporarily unavailable. Refresh inbox and try again.",
              headers: [],
            },
          };
          mailDetailCache.set(key, { expiresAt: Date.now() + MAIL_DETAIL_CACHE_TTL_MS, payload });
          mailDetailInflight.delete(key);
          return payload;
        }

        const from = extractFrom(thread) || "Unknown sender";
        const payload: MailMessageDetailPayload = {
          ok: true,
          message: {
            id: String(thread.id ?? thread.uid ?? messageId),
            threadId: String(thread.id ?? thread.uid ?? messageId),
            from,
            subject: String(thread.subject ?? ""),
            preview: String(thread.snippet ?? thread.preview ?? ""),
            date: toIsoDate(thread.date),
            isRead: !Boolean(thread.unread),
            isStarred: false,
            hasAttachment: false,
            labels: [],
            bodyText: String(thread.body ?? thread.bodyText ?? thread.snippet ?? thread.preview ?? ""),
            headers: Array.isArray(thread.headers) ? thread.headers : [],
          },
        };
        mailDetailCache.set(key, { expiresAt: Date.now() + MAIL_DETAIL_CACHE_TTL_MS, payload });
        mailDetailInflight.delete(key);
        return payload;
      })().catch((error) => {
        mailDetailInflight.delete(key);
        throw error;
      });

    if (!mailDetailInflight.has(key)) {
      mailDetailInflight.set(key, pending);
    }

    return NextResponse.json(await pending, { status: 200 });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unable to load message.";
    return NextResponse.json({ error: msg }, { status: 200 });
  }
}
