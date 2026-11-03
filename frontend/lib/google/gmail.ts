import { googleApiFetch } from "@/lib/google/http";

export type GmailListMessage = {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  preview: string;
  date: string;
  isRead: boolean;
  isStarred: boolean;
  hasAttachment: boolean;
  labels: string[];
};

export type GmailMessageHeader = {
  name: string;
  value: string;
};

export type GmailMessageDetail = GmailListMessage & {
  bodyText: string;
  bodyHtml?: string;
  headers: GmailMessageHeader[];
};

type GmailListResponse = {
  messages?: Array<{ id: string; threadId: string }>;
};

type GmailHeader = {
  name?: string;
  value?: string;
};

type GmailPayloadPart = {
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: {
    data?: string;
  };
  parts?: GmailPayloadPart[];
};

type GmailMessageResponse = {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmailPayloadPart;
};

function decodeBase64Url(input: string | undefined): string {
  if (!input) return "";
  try {
    return Buffer.from(input, "base64url").toString("utf8");
  } catch {
    return "";
  }
}

function normalizeHeaders(headers: GmailHeader[] | undefined): GmailMessageHeader[] {
  if (!Array.isArray(headers)) return [];
  return headers
    .map((header) => {
      if (!header || typeof header !== "object") return null;
      if (typeof header.name !== "string") return null;
      return {
        name: header.name,
        value: typeof header.value === "string" ? header.value : "",
      };
    })
    .filter((header): header is GmailMessageHeader => Boolean(header));
}

function findHeaderValue(
  headers: GmailMessageHeader[],
  name: string
): string | null {
  const target = name.toLowerCase();
  const found = headers.find(
    (header) => header.name.toLowerCase() === target && header.value.trim()
  );
  return found?.value?.trim() ?? null;
}

function flattenParts(payload: GmailPayloadPart | undefined): GmailPayloadPart[] {
  if (!payload) return [];
  const nested = Array.isArray(payload.parts)
    ? payload.parts.flatMap((part) => flattenParts(part))
    : [];
  return [payload, ...nested];
}

function hasAttachment(payload: GmailPayloadPart | undefined): boolean {
  return flattenParts(payload).some((part) => {
    const filename = part.filename?.trim();
    if (filename) return true;
    const attachmentId = (part.body as { attachmentId?: string } | undefined)
      ?.attachmentId;
    return typeof attachmentId === "string" && attachmentId.trim().length > 0;
  });
}

function extractBodyByMimeType(
  payload: GmailPayloadPart | undefined,
  mimeType: string
): string {
  if (!payload) return "";
  const parts = flattenParts(payload);
  const direct = parts.find(
    (part) => part.mimeType?.toLowerCase() === mimeType && part.body?.data
  );
  return decodeBase64Url(direct?.body?.data);
}

function extractBestBody(payload: GmailPayloadPart | undefined): {
  text: string;
  html: string | null;
} {
  const text = extractBodyByMimeType(payload, "text/plain");
  const html = extractBodyByMimeType(payload, "text/html");

  if (text.trim()) {
    return { text: text.trim(), html: html.trim() ? html : null };
  }

  if (html.trim()) {
    const fallbackText = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    return { text: fallbackText, html };
  }

  const inline = decodeBase64Url(payload?.body?.data);
  return { text: inline.trim(), html: null };
}

function normalizeDate(input: string | null, internalDate: string | undefined): string {
  if (input) {
    const parsed = Date.parse(input);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  if (internalDate) {
    const epochMs = Number(internalDate);
    if (Number.isFinite(epochMs)) return new Date(epochMs).toISOString();
  }
  return new Date(0).toISOString();
}

function normalizeSender(fromHeader: string | null): string {
  if (!fromHeader) return "Unknown sender";
  const match = fromHeader.match(/^(.*)<([^>]+)>$/);
  if (!match) return fromHeader;
  const displayName = match[1]?.trim().replace(/^"|"$/g, "");
  const email = match[2]?.trim();
  if (displayName) return displayName;
  return email || fromHeader;
}

function normalizeSubject(subjectHeader: string | null): string {
  return subjectHeader?.trim() || "(No subject)";
}

// ─── Gmail Batch-API ───────────────────────────────────────────────────────────
// Kombiniert N Metadaten-Requests in einem einzigen HTTP-Multipart-Request,
// statt wie bisher N separate Calls zu machen (N+1 → 2 HTTP-Requests gesamt).

const GMAIL_BATCH_ENDPOINT = "https://www.googleapis.com/batch/gmail/v1";

function buildBatchBody(messageIds: string[], boundary: string): string {
  const parts = messageIds.map(
    (id, i) =>
      `--${boundary}\r\n` +
      `Content-Type: application/http\r\n` +
      `Content-ID: <item${i}>\r\n\r\n` +
      `GET /gmail/v1/users/me/messages/${encodeURIComponent(id)}` +
      `?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date\r\n`
  );
  return parts.join("\r\n") + `\r\n--${boundary}--`;
}

function parseGmailBatchResponse(
  body: string,
  boundary: string
): GmailMessageResponse[] {
  const results: GmailMessageResponse[] = [];
  for (const rawPart of body.split(`--${boundary}`)) {
    // JSON-Body steht nach dem letzten doppelten CRLF im Part
    const jsonStart = rawPart.lastIndexOf("\r\n\r\n");
    if (jsonStart < 0) continue;
    const json = rawPart.slice(jsonStart + 4).trim();
    if (!json.startsWith("{")) continue;
    try {
      const obj = JSON.parse(json) as GmailMessageResponse;
      if (obj?.id) results.push(obj);
    } catch {
      // fehlerhaften Part überspringen
    }
  }
  return results;
}

async function batchFetchMessageSummaries(
  accessToken: string,
  messageIds: string[]
): Promise<GmailMessageResponse[]> {
  if (messageIds.length === 0) return [];

  // Für einzelne Messages lohnt sich kein Batch-Overhead
  if (messageIds.length === 1) {
    const url = new URL(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageIds[0]!)}` 
    );
    url.searchParams.set("format", "metadata");
    url.searchParams.set("metadataHeaders", "From");
    url.searchParams.set("metadataHeaders", "Subject");
    url.searchParams.set("metadataHeaders", "Date");
    try {
      const single = await googleApiFetch<GmailMessageResponse>(url, accessToken);
      return [single];
    } catch {
      return [];
    }
  }

  const boundary = `elyra_batch_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const batchBody = buildBatchBody(messageIds, boundary);

  const timeoutController = new AbortController();
  const timeout = setTimeout(() => timeoutController.abort(), 15_000);

  let responseText: string;
  let contentType: string | null;
  try {
    const res = await fetch(GMAIL_BATCH_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": `multipart/mixed; boundary="${boundary}"`,
      },
      body: batchBody,
      cache: "no-store",
      signal: timeoutController.signal,
    });

    if (!res.ok) {
      // Batch fehlgeschlagen → Fallback auf parallele Einzelrequests
      throw new Error(`Gmail batch HTTP ${res.status}`);
    }
    contentType = res.headers.get("content-type");
    responseText = await res.text();
  } catch {
    // Fallback: parallele Einzelrequests (altes Verhalten)
    const results = await Promise.all(
      messageIds.map(async (id) => {
        const url = new URL(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}`
        );
        url.searchParams.set("format", "metadata");
        url.searchParams.set("metadataHeaders", "From");
        url.searchParams.set("metadataHeaders", "Subject");
        url.searchParams.set("metadataHeaders", "Date");
        try {
          return await googleApiFetch<GmailMessageResponse>(url, accessToken);
        } catch {
          return null;
        }
      })
    );
    return results.filter((r): r is GmailMessageResponse => Boolean(r));
  } finally {
    clearTimeout(timeout);
  }

  // Response-Boundary aus dem Content-Type-Header lesen
  const responseBoundary =
    contentType?.match(/boundary="?([^";,\s]+)"?/)?.[1] ?? boundary;

  return parseGmailBatchResponse(responseText, responseBoundary);
}

export async function listGmailMessages(input: {
  accessToken: string;
  q?: string;
  limit?: number;
}): Promise<GmailListMessage[]> {
  const maxResults = Math.max(1, Math.min(40, Math.round(input.limit ?? 30)));
  const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
  url.searchParams.set("maxResults", String(maxResults));
  if (input.q && input.q.trim()) {
    url.searchParams.set("q", input.q.trim());
  }

  const listResponse = await googleApiFetch<GmailListResponse>(
    url,
    input.accessToken
  );
  const messageRefs = Array.isArray(listResponse.messages)
    ? listResponse.messages
    : [];

  // ── Batch statt N Einzelrequests ──────────────────────────────────────────
  const summaries = await batchFetchMessageSummaries(
    input.accessToken,
    messageRefs.map((ref) => ref.id)
  );

  const rows: GmailListMessage[] = summaries
    .filter((message): message is GmailMessageResponse => Boolean(message))
    .map((message) => {
      const headers = normalizeHeaders(message.payload?.headers);
      const labels = Array.isArray(message.labelIds) ? message.labelIds : [];
      const dateHeader = findHeaderValue(headers, "Date");
      const fromHeader = findHeaderValue(headers, "From");
      const subjectHeader = findHeaderValue(headers, "Subject");
      return {
        id: message.id,
        threadId: message.threadId,
        from: normalizeSender(fromHeader),
        subject: normalizeSubject(subjectHeader),
        preview: message.snippet ?? "",
        date: normalizeDate(dateHeader, message.internalDate),
        isRead: !labels.includes("UNREAD"),
        isStarred: labels.includes("STARRED"),
        hasAttachment: hasAttachment(message.payload),
        labels,
      };
    });

  return rows.sort((left, right) => Date.parse(right.date) - Date.parse(left.date));
}

export type GmailSentMessage = {
  messageId: string;
  threadId: string;
};

export async function sendGmailMessage(input: {
  accessToken: string;
  to: string;
  subject: string;
  body: string;
  cc?: string;
  bcc?: string;
  replyToThreadId?: string;
}): Promise<GmailSentMessage> {
  const lines: string[] = [
    `To: ${input.to}`,
    `Subject: ${input.subject}`,
    "Content-Type: text/plain; charset=UTF-8",
    "MIME-Version: 1.0",
  ];
  if (input.cc) lines.push(`Cc: ${input.cc}`);
  if (input.bcc) lines.push(`Bcc: ${input.bcc}`);
  lines.push("", input.body);
  const raw = Buffer.from(lines.join("\r\n")).toString("base64url");

  const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages/send");
  const body: Record<string, string> = { raw };
  if (input.replyToThreadId) {
    body.threadId = input.replyToThreadId;
  }

  const res = await fetch(url.toString(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Gmail send failed: ${res.status} ${text}`);
  }

  const sent = (await res.json()) as { id?: string; threadId?: string };
  return {
    messageId: sent.id ?? "",
    threadId: sent.threadId ?? "",
  };
}

export async function getGmailMessageDetail(input: {
  accessToken: string;
  messageId: string;
}): Promise<GmailMessageDetail> {
  const url = new URL(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(
      input.messageId
    )}`
  );
  url.searchParams.set("format", "full");

  const message = await googleApiFetch<GmailMessageResponse>(
    url,
    input.accessToken
  );
  const headers = normalizeHeaders(message.payload?.headers);
  const labels = Array.isArray(message.labelIds) ? message.labelIds : [];
  const body = extractBestBody(message.payload);
  const dateHeader = findHeaderValue(headers, "Date");
  const fromHeader = findHeaderValue(headers, "From");
  const subjectHeader = findHeaderValue(headers, "Subject");

  const detail: GmailMessageDetail = {
    id: message.id,
    threadId: message.threadId,
    from: normalizeSender(fromHeader),
    subject: normalizeSubject(subjectHeader),
    preview: message.snippet ?? "",
    date: normalizeDate(dateHeader, message.internalDate),
    isRead: !labels.includes("UNREAD"),
    isStarred: labels.includes("STARRED"),
    hasAttachment: hasAttachment(message.payload),
    labels,
    bodyText: body.text || message.snippet || "",
    headers,
  };
  if (body.html) {
    detail.bodyHtml = body.html;
  }
  return detail;
}
