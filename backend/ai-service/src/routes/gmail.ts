import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { resolveAuthorizedWorkspaceId } from "../db/repos/workspace-access.js";
import { AuthError, ValidationError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import { getGoogleAccessToken } from "../tools/google-auth.js";

const GMAIL_API_BASE = "https://www.googleapis.com/gmail/v1/users/me";

type GmailHeader = {
  name?: string;
  value?: string;
};

type GmailBody = {
  data?: string;
  attachmentId?: string;
};

type GmailPart = {
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: GmailBody;
  parts?: GmailPart[];
};

type GmailMessage = {
  id?: string;
  threadId?: string;
  snippet?: string;
  labelIds?: string[];
  internalDate?: string;
  payload?: GmailPart;
};

type GmailMessagesListResponse = {
  messages?: Array<{ id?: string }>;
};

class GoogleApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = "GoogleApiError";
  }
}

const listQuerySchema = z.object({
  workspaceId: z.string().optional(),
  q: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

const detailQuerySchema = z.object({
  workspaceId: z.string().optional(),
});

function normalizeWorkspaceId(
  request: AuthenticatedRequest,
  workspaceIdFromQuery: string | undefined,
): string {
  const workspaceId = workspaceIdFromQuery?.trim() || request.workspaceId?.trim();
  if (!workspaceId) {
    throw new ValidationError("workspaceId is required");
  }
  return workspaceId;
}

async function resolveWorkspaceOrThrow(
  request: AuthenticatedRequest,
  requestedWorkspaceId: string,
): Promise<string> {
  const workspaceId = await resolveAuthorizedWorkspaceId(
    request.userId,
    requestedWorkspaceId,
  );
  if (!workspaceId) {
    throw new AuthError("No access to requested workspace");
  }
  return workspaceId;
}

async function gmailRequest<TResponse>(
  accessToken: string,
  path: string,
): Promise<TResponse> {
  const response = await fetch(`${GMAIL_API_BASE}${path}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });
  const payload = (await response.json().catch(() => null)) as unknown;

  const googleErrorMessage = (() => {
    if (!payload || typeof payload !== "object") return null;
    const error = (payload as { error?: unknown }).error;
    if (!error || typeof error !== "object") return null;
    const message = (error as { message?: unknown }).message;
    return typeof message === "string" ? message : null;
  })();

  if (!response.ok) {
    const message = googleErrorMessage ?? `Google API request failed (${response.status})`;
    throw new GoogleApiError(response.status, message, payload);
  }

  return payload as TResponse;
}

function decodeBase64Url(value: string): string {
  try {
    return Buffer.from(value, "base64url").toString("utf8");
  } catch {
    return "";
  }
}

function findHeader(
  headers: GmailHeader[] | undefined,
  headerName: string,
): string {
  const normalizedTarget = headerName.toLowerCase();
  const value = headers?.find(
    (header) => header.name?.toLowerCase() === normalizedTarget,
  )?.value;
  return typeof value === "string" ? value : "";
}

function collectMessageBodies(
  part: GmailPart | undefined,
): { text: string; html: string } {
  if (!part) {
    return { text: "", html: "" };
  }

  const pieces = { text: "", html: "" };
  const stack: GmailPart[] = [part];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;

    if (Array.isArray(current.parts) && current.parts.length > 0) {
      for (const nested of current.parts) {
        stack.push(nested);
      }
    }

    const data = current.body?.data;
    if (!data) continue;

    const decoded = decodeBase64Url(data);
    if (!decoded) continue;

    if (current.mimeType === "text/plain" && !pieces.text) {
      pieces.text = decoded;
      continue;
    }
    if (current.mimeType === "text/html" && !pieces.html) {
      pieces.html = decoded;
      continue;
    }
    if (!pieces.text) {
      pieces.text = decoded;
    }
  }

  return pieces;
}

function hasAttachment(part: GmailPart | undefined): boolean {
  if (!part) return false;
  const stack: GmailPart[] = [part];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;

    if (current.filename && current.filename.trim().length > 0) return true;
    if (current.body?.attachmentId) return true;
    if (Array.isArray(current.parts)) {
      for (const nested of current.parts) {
        stack.push(nested);
      }
    }
  }
  return false;
}

function normalizeDate(
  headers: GmailHeader[] | undefined,
  internalDate: string | undefined,
): string {
  const headerDate = findHeader(headers, "Date");
  const parsedHeaderDate = Date.parse(headerDate);
  if (Number.isFinite(parsedHeaderDate)) {
    return new Date(parsedHeaderDate).toISOString();
  }

  if (typeof internalDate === "string") {
    const timestamp = Number(internalDate);
    if (Number.isFinite(timestamp) && timestamp > 0) {
      return new Date(timestamp).toISOString();
    }
  }

  return new Date().toISOString();
}

function mapListMessage(message: GmailMessage) {
  const headers = message.payload?.headers;
  const labels = message.labelIds ?? [];
  return {
    id: message.id ?? "",
    from: findHeader(headers, "From"),
    subject: findHeader(headers, "Subject") || "(No subject)",
    preview: message.snippet ?? "",
    date: normalizeDate(headers, message.internalDate),
    isRead: !labels.includes("UNREAD"),
    isStarred: labels.includes("STARRED"),
    hasAttachment: hasAttachment(message.payload),
    labels,
  };
}

function mapDetailMessage(message: GmailMessage) {
  const headers = message.payload?.headers ?? [];
  const body = collectMessageBodies(message.payload);
  const labels = message.labelIds ?? [];
  return {
    id: message.id ?? "",
    threadId: message.threadId ?? "",
    from: findHeader(headers, "From"),
    subject: findHeader(headers, "Subject") || "(No subject)",
    preview: message.snippet ?? "",
    date: normalizeDate(headers, message.internalDate),
    bodyText: body.text || message.snippet || "",
    bodyHtml: body.html || "",
    isRead: !labels.includes("UNREAD"),
    isStarred: labels.includes("STARRED"),
    hasAttachment: hasAttachment(message.payload),
    labels,
    headers: headers
      .filter((header) => typeof header.name === "string")
      .map((header) => ({ name: header.name as string, value: header.value ?? "" })),
  };
}

function sendNotConnected(reply: FastifyReply) {
  return reply.status(409).send({
    error: "not_connected",
    message: "Google workspace is not connected",
  });
}

function handleGoogleApiError(reply: FastifyReply, error: unknown): void {
  if (error instanceof GoogleApiError) {
    if (error.status === 401 || error.status === 403) {
      sendNotConnected(reply);
      return;
    }
    throw new ValidationError(error.message);
  }
  throw error;
}

export async function gmailRoutes(app: FastifyInstance) {
  app.get("/v1/gmail/messages", async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((issue) => issue.message).join(", "));
    }

    const authRequest = request as AuthenticatedRequest;
    const requestedWorkspaceId = normalizeWorkspaceId(
      authRequest,
      parsed.data.workspaceId,
    );
    const workspaceId = await resolveWorkspaceOrThrow(authRequest, requestedWorkspaceId);

    const accessToken = await getGoogleAccessToken(workspaceId);
    if (!accessToken) {
      return sendNotConnected(reply);
    }

    const query = parsed.data.q?.trim() || "in:inbox";
    const limit = parsed.data.limit ?? 20;

    try {
      const list = await gmailRequest<GmailMessagesListResponse>(
        accessToken,
        `/messages?q=${encodeURIComponent(query)}&maxResults=${limit}`,
      );

      const messageIds = (list.messages ?? [])
        .map((entry) => entry.id ?? "")
        .filter((id) => Boolean(id));

      const messages = await Promise.all(
        messageIds.map(async (messageId) => {
          const message = await gmailRequest<GmailMessage>(
            accessToken,
            `/messages/${encodeURIComponent(
              messageId,
            )}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
          );
          return mapListMessage(message);
        }),
      );

      return reply.send({ messages });
    } catch (error) {
      logger.warn({ err: error, workspaceId }, "Gmail list request failed");
      handleGoogleApiError(reply, error);
      return undefined;
    }
  });

  app.get("/v1/gmail/messages/:id", async (request, reply) => {
    const params = request.params as { id?: string };
    const messageId = params.id?.trim();
    if (!messageId) {
      throw new ValidationError("message id is required");
    }

    const parsed = detailQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((issue) => issue.message).join(", "));
    }

    const authRequest = request as AuthenticatedRequest;
    const requestedWorkspaceId = normalizeWorkspaceId(
      authRequest,
      parsed.data.workspaceId,
    );
    const workspaceId = await resolveWorkspaceOrThrow(authRequest, requestedWorkspaceId);

    const accessToken = await getGoogleAccessToken(workspaceId);
    if (!accessToken) {
      return sendNotConnected(reply);
    }

    try {
      const message = await gmailRequest<GmailMessage>(
        accessToken,
        `/messages/${encodeURIComponent(messageId)}?format=full`,
      );

      return reply.send({
        message: mapDetailMessage(message),
      });
    } catch (error) {
      logger.warn({ err: error, workspaceId, messageId }, "Gmail detail request failed");
      handleGoogleApiError(reply, error);
      return undefined;
    }
  });
}
