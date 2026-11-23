import type { MailIdentity } from "./mail-identity";
import type { MailProviderAdapter } from "./mail-provider";

type IcloudImapCredentials = {
  email: string;
  appPassword: string;
  imapHost?: string;
  imapPort?: number;
};

type IcloudSmtpCredentials = {
  email: string;
  appPassword: string;
  smtpHost?: string;
  smtpPort?: number;
  secure?: boolean;
};

type CredResult<T> =
  | { ok: true; credentials: T }
  | { ok: false; error: string; code: string; provider: string };

type IcloudProviderDependencies = {
  resolveImapCredentials: (
    env: any,
    workspaceId: string | null,
    identityId: string
  ) => Promise<CredResult<IcloudImapCredentials>>;
  resolveSmtpCredentials: (
    env: any,
    workspaceId: string | null,
    identityId: string
  ) => Promise<CredResult<IcloudSmtpCredentials>>;
  callEmailIo: (env: any, path: string, payload: any) => Promise<any>;
};

const SENT_FOLDER_CANDIDATES = ["Sent Messages", "Sent", "Gesendet"];

function normalizeMessageId(value: any): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("<") && trimmed.endsWith(">")) {
    const inner = trimmed.slice(1, -1).trim();
    return inner.length ? inner : null;
  }
  return trimmed;
}

function normalizeReferenceList(value: any): string[] {
  if (Array.isArray(value)) {
    return value
      .map((entry) => normalizeMessageId(entry))
      .filter((entry): entry is string => Boolean(entry));
  }
  if (typeof value === "string") {
    return value
      .split(/\s+/g)
      .map((entry) => normalizeMessageId(entry))
      .filter((entry): entry is string => Boolean(entry));
  }
  return [];
}

function buildReferencesChain(
  existing: string[] | undefined,
  messageId: string
): string {
  const refs = Array.isArray(existing) ? existing : [];
  const all = [...refs, messageId];
  return Array.from(new Set(all))
    .map((id) => `<${id}>`)
    .join(" ");
}

function buildReplyHeaders(replyToMessage: any): Record<string, string> | null {
  if (!replyToMessage || typeof replyToMessage !== "object") {
    return null;
  }
  const originalMessageId =
    normalizeMessageId(replyToMessage.originalMessageId) ??
    normalizeMessageId(replyToMessage.messageId);
  if (!originalMessageId) {
    return null;
  }
  const references = buildReferencesChain(
    normalizeReferenceList(replyToMessage.originalReferences ?? replyToMessage.references),
    originalMessageId
  );
  return {
    "In-Reply-To": `<${originalMessageId}>`,
    References: references,
  };
}

function sanitizeHeaderValue(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function generateMessageId(fromEmail: string): string {
  const domain = fromEmail.includes("@") ? fromEmail.split("@")[1] : "local";
  const nonce =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${nonce}@${domain || "local"}`;
}

function buildRawMime(options: {
  from: string;
  to: string[];
  cc?: string[];
  subject: string;
  text: string;
  messageId: string;
  date: string;
  headers?: Record<string, string> | null;
}): string {
  const lines: string[] = [];
  lines.push(`From: ${sanitizeHeaderValue(options.from)}`);
  lines.push(`To: ${sanitizeHeaderValue(options.to.join(", "))}`);
  if (options.cc && options.cc.length) {
    lines.push(`Cc: ${sanitizeHeaderValue(options.cc.join(", "))}`);
  }
  lines.push(`Subject: ${sanitizeHeaderValue(options.subject)}`);
  lines.push(`Date: ${sanitizeHeaderValue(options.date)}`);
  const normalizedMessageId = normalizeMessageId(options.messageId) || options.messageId;
  lines.push(`Message-ID: <${sanitizeHeaderValue(normalizedMessageId)}>`);
  if (options.headers?.["In-Reply-To"]) {
    lines.push(`In-Reply-To: ${sanitizeHeaderValue(options.headers["In-Reply-To"])}`);
  }
  if (options.headers?.References) {
    lines.push(`References: ${sanitizeHeaderValue(options.headers.References)}`);
  }
  lines.push("MIME-Version: 1.0");
  lines.push("Content-Type: text/plain; charset=UTF-8");
  lines.push("");
  lines.push(options.text);
  return lines.join("\r\n");
}

function resolveSentFolder(folders: any[]): string | null {
  if (!Array.isArray(folders)) return null;
  const normalized = folders
    .map((entry) => {
      const id = typeof entry?.id === "string" ? entry.id.trim() : "";
      const name = typeof entry?.name === "string" ? entry.name.trim() : "";
      const value = id || name;
      return value
        ? { id: value, name: value, lower: value.toLowerCase() }
        : null;
    })
    .filter((entry): entry is { id: string; name: string; lower: string } => Boolean(entry));
  for (const candidate of SENT_FOLDER_CANDIDATES) {
    const match = normalized.find((entry) => entry.lower === candidate.toLowerCase());
    if (match) {
      return match.id;
    }
  }
  return null;
}

export class MailNotConnectedError extends Error {
  provider: string | null;
  constructor(provider: string | null) {
    super("NOT_CONNECTED");
    this.provider = provider;
  }
}

export const isMailNotConnectedError = (err: any): err is MailNotConnectedError =>
  err instanceof MailNotConnectedError;

export function buildIcloudProvider(
  env: any,
  _userId: string,
  workspaceId: string | null,
  identity: MailIdentity,
  deps: IcloudProviderDependencies
): MailProviderAdapter {
  const resolveImap = async () => {
    const r = await deps.resolveImapCredentials(env, workspaceId, identity.id);
    if (!r.ok) throw new MailNotConnectedError("icloud");
    return r.credentials;
  };

  const resolveSmtp = async () => {
    const r = await deps.resolveSmtpCredentials(env, workspaceId, identity.id);
    if (!r.ok) throw new MailNotConnectedError("icloud");
    return r.credentials;
  };

  return {
    async listFolders() {
      const credentials = await resolveImap();
      const resp = await deps.callEmailIo(env, "/icloud/folders", {
        workspaceId,
        identityId: identity.id,
        credentials,
      });
      if (!resp || resp.ok !== true) {
        const err = new Error(resp?.message || resp?.error || "MAIL_IO_ERROR");
        (err as any).code = resp?.error || "MAIL_IO_ERROR";
        throw err;
      }
      return Array.isArray(resp.folders)
        ? resp.folders
            .map((f: any) => ({ id: String(f.id || ""), name: String(f.name || f.id || "") }))
            .filter((f: any) => f.id)
        : [];
    },

    async listThreads(opts: { folder?: string; limit: number }) {
      const credentials = await resolveImap();
      const resp = await deps.callEmailIo(env, "/icloud/threads", {
        workspaceId,
        identityId: identity.id,
        folder: opts.folder,
        limit: opts.limit,
        credentials,
      });
      if (!resp || resp.ok !== true) {
        const err = new Error(resp?.message || resp?.error || "MAIL_IO_ERROR");
        (err as any).code = resp?.error || "MAIL_IO_ERROR";
        throw err;
      }
      return Array.isArray(resp.threads) ? resp.threads : [];
    },

    async sendMail(payload: any) {
      const credentials = await resolveSmtp();
      const replyHeaders = buildReplyHeaders(payload?.replyToMessage);
      const smtpPayload = {
        to: Array.isArray(payload?.to) ? payload.to : [],
        cc: Array.isArray(payload?.cc) ? payload.cc : undefined,
        bcc: Array.isArray(payload?.bcc) ? payload.bcc : undefined,
        subject: typeof payload?.subject === "string" ? payload.subject : "",
        text: typeof payload?.bodyText === "string" ? payload.bodyText : "",
        ...(replyHeaders ? { headers: replyHeaders } : {}),
      };
      const resp = await deps.callEmailIo(env, "/icloud/send", {
        workspaceId,
        identityId: identity.id,
        credentials,
        payload: smtpPayload,
      });

      if (!resp || resp.ok !== true) {
        const code = typeof resp?.error === "string" ? resp.error : "MAIL_IO_ERROR";
        const err = new Error(resp?.message || code);
        (err as any).code = code === "ICLOUD_AUTH_FAILED" ? "ICLOUD_AUTH_FAILED" : "MAIL_IO_ERROR";
        throw err;
      }
      if ((env?.ICLOUD_SYNC_SENT || "").toString() === "true") {
        try {
          const imapCredentials = await resolveImap();
          const foldersResp = await deps.callEmailIo(env, "/icloud/folders", {
            workspaceId,
            identityId: identity.id,
            credentials: imapCredentials,
          });
          const sentFolder = resolveSentFolder(foldersResp?.folders);
          if (!sentFolder) {
            console.warn("[icloud] sent folder not found, skipping append");
          } else {
            const messageId =
              normalizeMessageId(resp?.messageId) || generateMessageId(credentials.email);
            const rawMime = buildRawMime({
              from: credentials.email,
              to: smtpPayload.to,
              cc: smtpPayload.cc,
              subject: smtpPayload.subject,
              text: smtpPayload.text,
              date: new Date().toUTCString(),
              messageId,
              headers: replyHeaders,
            });
            await deps.callEmailIo(env, "/icloud/append", {
              workspaceId,
              identityId: identity.id,
              credentials: imapCredentials,
              payload: {
                folder: sentFolder,
                rawMime,
              },
            });
          }
        } catch (err) {
          console.warn("[icloud] sent sync failed", err);
        }
      }
      return { id: resp.messageId ?? null, threadId: null };
    },

    async getThread() {
      throw new Error("ICLOUD_NOT_IMPLEMENTED");
    },

    async getMessage() {
      throw new Error("ICLOUD_NOT_IMPLEMENTED");
    },

    async trashThread() {
      throw new Error("ICLOUD_NOT_IMPLEMENTED");
    },
  };
}
