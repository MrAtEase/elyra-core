import nodemailer from "nodemailer";
import { EmailIoError } from "../errors/EmailIoError.js";
import type { IcloudSmtpCredentials, IcloudSendPayload } from "../types/mail.js";

const DEFAULT_SMTP_HOST = "smtp.mail.me.com";
const DEFAULT_SMTP_PORT = 587;

export type SmtpSendResult = {
  messageId: string | null;
  accepted: string[];
  rejected: string[];
};

function numEnv(key: string): number | undefined {
  const n = Number(process.env[key] || "");
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function normalizeList(list?: unknown): string[] {
  if (!Array.isArray(list)) return [];
  return list.map((v) => (typeof v === "string" ? v.trim() : "")).filter(Boolean);
}

function normalizeHeaders(value?: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const entries = Object.entries(value as Record<string, unknown>)
    .map(([key, val]) => [String(key), typeof val === "string" ? val.trim() : ""] as const)
    .filter(([, val]) => val.length > 0);
  if (!entries.length) return undefined;
  return Object.fromEntries(entries);
}

export async function sendIcloudSmtpMail(
  credentials: IcloudSmtpCredentials,
  payload: IcloudSendPayload
): Promise<SmtpSendResult> {
  const to = normalizeList(payload?.to);
  const cc = normalizeList(payload?.cc);
  const bcc = normalizeList(payload?.bcc);
  const headers = normalizeHeaders(payload?.headers);

  if (!to.length) throw new EmailIoError("INVALID_REQUEST", "payload.to is required.", 400);
  if (typeof payload?.subject !== "string") {
    throw new EmailIoError("INVALID_REQUEST", "payload.subject must be a string.", 400);
  }
  if (typeof payload?.text !== "string" || payload.text.trim().length === 0) {
    throw new EmailIoError("INVALID_REQUEST", "payload.text is required.", 400);
  }

  const host = credentials.smtpHost || DEFAULT_SMTP_HOST;
  const port = Number.isFinite(credentials.smtpPort as any)
    ? Number(credentials.smtpPort)
    : DEFAULT_SMTP_PORT;
  const secure = credentials.secure === true; // default false -> STARTTLS

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    requireTLS: !secure,
    auth: { user: credentials.email, pass: credentials.appPassword },
    connectionTimeout: numEnv("SMTP_CONNECTION_TIMEOUT_MS"),
    greetingTimeout: numEnv("SMTP_GREETING_TIMEOUT_MS"),
    socketTimeout: numEnv("SMTP_SOCKET_TIMEOUT_MS"),
  });

  try {
    const info = await transporter.sendMail({
      from: credentials.email,
      to,
      ...(cc.length ? { cc } : {}),
      ...(bcc.length ? { bcc } : {}),
      subject: payload.subject,
      text: payload.text, // plain text only
      ...(headers ? { headers } : {}),
    });

    const accepted = Array.isArray(info.accepted) ? info.accepted.map(String) : [];
    const rejected = Array.isArray(info.rejected) ? info.rejected.map(String) : [];

    return {
      messageId: info.messageId ? String(info.messageId) : null,
      accepted,
      rejected,
    };
  } catch (err: any) {
    const msg = String(err?.message || err || "");
    if (/auth|login|invalid|credentials|authentication/i.test(msg)) {
      throw new EmailIoError("ICLOUD_AUTH_FAILED", "iCloud authentication failed.", 401);
    }
    throw new EmailIoError("MAIL_IO_ERROR", "SMTP send failed.", 502);
  } finally {
    try {
      transporter.close();
    } catch {}
  }
}
