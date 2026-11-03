/**
 * GET /api/mail/imap/messages
 *
 * Unified mail messages endpoint — dynamically routes to Gmail or IMAP
 * depending on which integration is connected for the workspace.
 *
 * Fixes:
 *   1. No more hardcoded `icloud_imap` — detects Google vs IMAP from integrations table
 *   2. Improved `from` field parsing with multiple fallback levels
 *   3. Stable `id` with multiple fallback levels (never empty)
 *   4. In-flight deduplication + short response cache
 *   5. Always returns 200 with status discriminator (never 409)
 */

import { NextRequest, NextResponse } from "next/server";
import {
  fetchWhoamiPayload,
  getWhoamiUserId,
  hasWorkspaceAccess,
} from "@/lib/api/whoamiClient";
import { requestEmailIo } from "@/lib/emailIoClient";
import { getWorkspaceId } from "@/lib/api/workspaceRequest";
import { resolveImapCredentials, resolveCredentials } from "@/lib/integrations/resolveCredentials";
import { listGmailMessages } from "@/lib/google/gmail";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { createServerTimingTrace } from "@/lib/api/serverTiming";

export const runtime = "nodejs";

// ---------------------------------------------------------------------------
// In-flight dedupe + short cache
// ---------------------------------------------------------------------------
type MailMessagesPayload = {
  ok: true;
  status: "ready" | "needs_auth" | "error";
  mailbox: string;
  messages: Array<Record<string, unknown>>;
  retryAfterMs?: number;
  error?: string;
  errorCode?: string;
};

const responseCache = new Map<string, { expiresAt: number; payload: MailMessagesPayload }>();
const inflight = new Map<string, Promise<MailMessagesPayload>>();
const RESPONSE_TTL_MS = 60_000;

function lockKey(workspaceId: string, mailbox: string): string {
  return `${workspaceId}::${mailbox}`;
}

// ---------------------------------------------------------------------------
// Provider detection
// ---------------------------------------------------------------------------
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

    // Prefer connected rows; Google > imap > icloud_imap
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

// ---------------------------------------------------------------------------
// Robust `from` parsing
// ---------------------------------------------------------------------------
type RawEntry = Record<string, unknown>;

function extractFrom(entry: RawEntry): string {
  const raw = entry.from;

  // Object with name/address fields (RFC 5322 parsed object)
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    if (typeof obj.name === "string" && obj.name.trim()) return obj.name.trim();
    if (typeof obj.address === "string" && obj.address.trim()) return obj.address.trim();
    if (typeof obj.value === "string" && obj.value.trim()) return obj.value.trim();
  }

  // Plain string "Name <email>" or "email"
  if (typeof raw === "string" && raw.trim()) return raw.trim();

  // Envelope from array
  const envelope = entry.envelope as Record<string, unknown> | undefined;
  if (envelope && Array.isArray(envelope.from) && envelope.from.length > 0) {
    const ef = envelope.from[0] as Record<string, unknown>;
    if (typeof ef?.name === "string" && ef.name.trim()) return ef.name.trim();
    if (typeof ef?.address === "string" && ef.address.trim()) return ef.address.trim();
  }

  // Headers array
  if (Array.isArray(entry.headers)) {
    const fromHeader = (entry.headers as Array<{ name: string; value: string }>).find(
      (h) => h.name?.toLowerCase() === "from"
    );
    if (fromHeader?.value?.trim()) return fromHeader.value.trim();
  }

  return "";
}

function extractId(entry: RawEntry, index: number, date: string, subject: string): string {
  // Try all common id fields
  for (const key of ["id", "uid", "messageId", "message_id", "internalId"]) {
    const val = entry[key];
    if (val !== null && val !== undefined && String(val).trim()) {
      return String(val).trim();
    }
  }
  // Deterministic fallback: sha-ish from date+subject+index
  const hash = [date, subject, String(index)].join("|").split("").reduce((acc, c) => {
    return ((acc << 5) - acc + c.charCodeAt(0)) | 0;
  }, 0);
  return `local-${Math.abs(hash).toString(16)}-${index}`;
}

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------
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

function needsAuthPayload(mailbox: string, message: string): MailMessagesPayload {
  return { ok: true, status: "needs_auth", mailbox, messages: [], error: message };
}

function errorPayload(mailbox: string, message: string, code?: string): MailMessagesPayload {
  return { ok: true, status: "error", mailbox, messages: [], error: message, ...(code ? { errorCode: code } : {}) };
}

function cachedPayload(workspaceId: string, mailbox: string): MailMessagesPayload | null {
  const cached = responseCache.get(lockKey(workspaceId, mailbox));
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    responseCache.delete(lockKey(workspaceId, mailbox));
    return null;
  }
  return cached.payload;
}

function setCachedPayload(workspaceId: string, mailbox: string, payload: MailMessagesPayload) {
  responseCache.set(lockKey(workspaceId, mailbox), {
    expiresAt: Date.now() + RESPONSE_TTL_MS,
    payload,
  });
}

async function loadMailboxPayload(
  workspaceId: string,
  userId: string,
  mailbox: string,
  limit: number,
  request: NextRequest,
  timing: ReturnType<typeof createServerTimingTrace>
): Promise<MailMessagesPayload> {
  const provider = await timing.measure(
    "provider",
    detectMailProvider(workspaceId),
    "integration lookup"
  );

  // No mail integration connected yet — return actionable needs_auth immediately
  // instead of falling through to IMAP and wasting credentials lookups.
  if (!provider) {
    return needsAuthPayload(
      mailbox,
      "No mail integration connected. Go to Settings → Integrations to connect Gmail or IMAP.",
    );
  }

  if (provider === "google") {
    const credentials = await timing.measure(
      "credentials",
      resolveCredentials({
        provider: "google",
        workspaceId,
        userId,
      }),
      "google credentials"
    );
    if (!credentials.ok) {
      if (credentials.code === "needs_auth" || credentials.code === "missing_scopes") {
        return needsAuthPayload(mailbox, credentials.message);
      }
      return errorPayload(mailbox, credentials.message, credentials.code);
    }
    const gmailMessages = await timing.measure(
      "gmail_api",
      listGmailMessages({
        accessToken: credentials.accessToken,
        limit,
      }),
      "gmail list"
    );
    return { ok: true, status: "ready", mailbox, messages: gmailMessages as Array<Record<string, unknown>> };
  }

  const credentials = await timing.measure(
    "credentials",
    resolveImapCredentials(workspaceId, userId),
    "imap credentials"
  );

  if (!credentials.ok) {
    if (credentials.code === "needs_auth") {
      return needsAuthPayload(mailbox, credentials.message);
    }
    return errorPayload(mailbox, credentials.message, credentials.code);
  }

  const data = await timing.measure(
    "email_io",
    requestEmailIo("/icloud/threads", {
      method: "POST",
      body: {
        workspaceId,
        userId,
        provider: provider ?? "icloud_imap",
        folder: mailbox,
        limit,
        credentials: {
          email: credentials.email,
          appPassword: credentials.password,
          imapHost: credentials.imapHost,
          imapPort: credentials.imapPort,
        },
      },
      context: { provider: provider ?? "icloud_imap", reason: "mail/imap/messages" },
      request,
    }),
    "email-io threads"
  );

  const threadsRaw =
    data && typeof data === "object" && Array.isArray((data as { threads?: unknown[] }).threads)
      ? ((data as { threads: unknown[] }).threads as unknown[])
      : [];

  const messages = threadsRaw
    .filter((entry): entry is RawEntry => Boolean(entry && typeof entry === "object"))
    .map((entry, index) => {
      const date = toIsoDate(entry.date);
      const subject = String(entry.subject ?? "");
      const id = extractId(entry, index, date, subject);
      const from = extractFrom(entry) || "Unknown sender";
      return {
        id,
        threadId: id,
        from,
        subject,
        preview: String(entry.snippet ?? entry.preview ?? ""),
        date,
        isRead: !Boolean(entry.unread),
        isStarred: false,
        hasAttachment: false,
        labels: [],
      };
    });

  return { ok: true, status: "ready", mailbox, messages };
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------
export async function GET(request: NextRequest) {
  const timing = createServerTimingTrace("api/mail/imap/messages");
  const respond = (response: NextResponse, meta?: Record<string, unknown>) => {
    timing.log(meta);
    return timing.apply(response) as NextResponse;
  };

  const { response, payload } = await timing.measure("whoami", fetchWhoamiPayload(request), "worker auth");
  if (!response.ok || !payload) {
    return respond(NextResponse.json({ error: "authentication_required" }, { status: 401 }));
  }

  const resolvedWorkspace = getWorkspaceId(request, true);
  if (!resolvedWorkspace.ok) {
    return respond(NextResponse.json(
      { error: resolvedWorkspace.error, reason: resolvedWorkspace.reason },
      { status: resolvedWorkspace.status },
    ));
  }
  if (!resolvedWorkspace.workspaceId) {
    return respond(NextResponse.json({ error: "workspaceId_required" }, { status: 400 }));
  }
  const workspaceId = resolvedWorkspace.workspaceId;

  if (!hasWorkspaceAccess(payload, workspaceId)) {
    return respond(NextResponse.json({ error: "workspace_not_accessible" }, { status: 403 }));
  }

  const userId = getWhoamiUserId(payload);
  if (!userId) {
    return respond(NextResponse.json({ error: "user_id_missing" }, { status: 500 }));
  }

  const mailbox = request.nextUrl.searchParams.get("mailbox") ?? "INBOX";
  const limitParam = Number(request.nextUrl.searchParams.get("limit") ?? "");
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(50, limitParam) : 20;

  const cached = cachedPayload(workspaceId, mailbox);
  if (cached) {
    timing.mark("cache", "hit");
    return respond(NextResponse.json(cached), { workspaceId, cache: "hit", mailbox });
  }

  try {
    const cacheKey = lockKey(workspaceId, mailbox);
    const pending =
      inflight.get(cacheKey) ??
      loadMailboxPayload(workspaceId, userId, mailbox, limit, request, timing)
        .then((payload) => {
          setCachedPayload(workspaceId, mailbox, payload);
          inflight.delete(cacheKey);
          return payload;
        })
        .catch((error) => {
          inflight.delete(cacheKey);
          throw error;
        });

    if (!inflight.has(cacheKey)) {
      inflight.set(cacheKey, pending);
    }

    return respond(NextResponse.json(await timing.measure("mail_load", pending, "provider + mailbox")), {
      workspaceId,
      cache: "miss",
      mailbox,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unable to load inbox.";
    const isAuthErr = typeof msg === "string" && /auth|credential|login|password|connect/i.test(msg);
    if (isAuthErr) {
      return respond(NextResponse.json(
        needsAuthPayload(mailbox, "Mail connection failed. Please reconnect your mail integration.")
      ), { workspaceId, mailbox, mode: "needs_auth" });
    }
    return respond(NextResponse.json(errorPayload(mailbox, msg, "mail_fetch_error")), {
      workspaceId,
      mailbox,
      mode: "fetch_error",
    });
  }
}
