/**
 * Embedded email-io handler for Vercel production.
 *
 * Replicates the iCloud IMAP/SMTP/CalDAV endpoints from the local Fastify
 * email-io service (port 3001) so they work in production without a separate
 * server.  Vercel Node.js serverless functions support real TCP, so imapflow
 * and nodemailer work fine in a stateless (connect → fetch → close) pattern.
 *
 * Auth: x-internal-api-key header === process.env.INTERNAL_API_KEY
 *
 * Routes (POST unless noted):
 *   POST /icloud/folders   → list IMAP mailboxes
 *   POST /icloud/threads   → list thread previews from a folder
 *   POST /icloud/send      → send via SMTP
 *   POST /icloud/append    → append raw MIME to a folder
 *   POST /caldav/events    → fetch CalDAV events in a date range
 *   POST /caldav/test      → verify CalDAV connectivity
 *   GET  /health           → liveness probe
 *
 * Local dev: EMAIL_IO_BASE_URL=http://localhost:3001   → Fastify handles it
 * Production: EMAIL_IO_BASE_URL=https://app.elyra-core.app/api/internal/email-io
 */

import { NextRequest, NextResponse } from "next/server";
// Type-only imports so turbopack does not try to statically bundle these
// CJS-only packages at build time.  Actual values are loaded via require()
// inside the functions that need them (lazy, runtime-only).
import type { ImapFlow as ImapFlowType } from "imapflow";
import type nodemailerType from "nodemailer";

/* eslint-disable @typescript-eslint/no-require-imports */
function requireImapFlow(): typeof ImapFlowType {
  return require("imapflow").ImapFlow as typeof ImapFlowType;
}
function requireNodemailer(): typeof nodemailerType {
  return require("nodemailer") as typeof nodemailerType;
}
/* eslint-enable @typescript-eslint/no-require-imports */

export const runtime = "nodejs";

// ─── Tiny error class ─────────────────────────────────────────────────────────

class EmailIoError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 500
  ) {
    super(message);
    this.name = "EmailIoError";
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

type IcloudCredentials = {
  email: string;
  appPassword: string;
  imapHost?: string;
  imapPort?: number;
  caldavBaseUrl?: string;
};

type IcloudSmtpCredentials = {
  email: string;
  appPassword: string;
  smtpHost?: string;
  smtpPort?: number;
  secure?: boolean;
};

type IcloudSendPayload = {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  text: string;
  headers?: Record<string, string>;
};

type CaldavCalendar = { href: string; name?: string };
type CaldavEvent = { href: string; etag?: string; data: string };

// ─── Auth ─────────────────────────────────────────────────────────────────────

/**
 * Derive a stable internal API key from TOKEN_ENCRYPTION_KEY when no explicit
 * INTERNAL_API_KEY is set.  Keeps parity with emailIoClient.ts so that no
 * additional Vercel env vars are needed in production.
 */
function derivedInternalKey(): string {
  const enc = process.env.TOKEN_ENCRYPTION_KEY ?? "";
  return enc.length >= 16 ? enc.slice(0, 32) : "";
}

function checkAuth(request: NextRequest): boolean {
  const key = request.headers.get("x-internal-api-key");
  const expected = process.env.INTERNAL_API_KEY ?? derivedInternalKey();
  return Boolean(expected && key && key === expected);
}

// ─── IMAP helpers ─────────────────────────────────────────────────────────────

const DEFAULT_IMAP_HOST = "imap.mail.me.com";
const DEFAULT_IMAP_PORT = 993;
const DEFAULT_FOLDER = "INBOX";
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 200;

function readTimeoutEnv(key: string): number | undefined {
  const raw = Number(process.env[key] ?? "");
  return Number.isFinite(raw) && raw > 0 ? Math.round(raw) : undefined;
}

function normalizeFolder(folder?: string | null): string {
  return ((folder ?? "").trim()) || DEFAULT_FOLDER;
}

function normalizeImapLimit(limit?: number | null): number {
  const parsed = Number(limit);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(parsed)));
}

function formatAddress(address: unknown): string {
  if (!address || typeof address !== "object") return "";
  const a = address as Record<string, unknown>;
  const name = typeof a["name"] === "string" ? a["name"].trim() : "";
  let email = typeof a["address"] === "string" ? a["address"].trim() : "";
  if (!email && typeof a["mailbox"] === "string" && typeof a["host"] === "string") {
    email = `${a["mailbox"]}@${a["host"]}`;
  }
  if (name && email) return `${name} <${email}>`;
  return name || email || "";
}

function buildImapClient(credentials: IcloudCredentials): ImapFlowType {
  const host = credentials.imapHost ?? DEFAULT_IMAP_HOST;
  const port = Number.isFinite(credentials.imapPort as number)
    ? Number(credentials.imapPort)
    : DEFAULT_IMAP_PORT;
  const options: Record<string, unknown> = {
    host,
    port,
    secure: true,
    auth: { user: credentials.email, pass: credentials.appPassword },
    logger: false,
  };
  const socketTimeout = readTimeoutEnv("IMAP_SOCKET_TIMEOUT_MS");
  if (socketTimeout) options["socketTimeout"] = socketTimeout;
  const authTimeout = readTimeoutEnv("IMAP_AUTH_TIMEOUT_MS");
  if (authTimeout) options["authTimeout"] = authTimeout;
  const greetingTimeout = readTimeoutEnv("IMAP_GREETING_TIMEOUT_MS");
  if (greetingTimeout) options["greetingTimeout"] = greetingTimeout;
  const ImapFlow = requireImapFlow();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new (ImapFlow as any)(options) as ImapFlowType;
}

function mapImapError(error: unknown): EmailIoError {
  const message = (error as { message?: string })?.message
    ? String((error as { message: string }).message)
    : String(error);
  const responseText = (error as { responseText?: string })?.responseText
    ? String((error as { responseText: string }).responseText)
    : "";
  const hint = `${message} ${responseText}`.trim();
  if (/auth|login|authentication/i.test(hint)) {
    return new EmailIoError("ICLOUD_AUTH_FAILED", "iCloud authentication failed.", 401);
  }
  if (/mailbox|folder|nonexistent|does not exist|not found/i.test(hint)) {
    return new EmailIoError("ICLOUD_FOLDER_NOT_FOUND", "Requested mailbox not found.", 404);
  }
  return new EmailIoError("MAIL_IO_ERROR", message || "Mail I/O error.", 500);
}

async function imapLogout(client: ImapFlowType) {
  try {
    await client.logout();
  } catch {
    try { client.close(); } catch { /* ignore */ }
  }
}

async function listFolders(credentials: IcloudCredentials): Promise<{ id: string; name: string }[]> {
  const client = buildImapClient(credentials);
  try {
    await client.connect();
    const listed = await client.list();
    const values: unknown[] = Array.isArray(listed)
      ? listed
      : listed && typeof (listed as { values?: () => unknown }).values === "function"
        ? Array.from((listed as { values: () => Iterable<unknown> }).values())
        : [];
    const folders: { id: string; name: string }[] = [];
    for (const mailbox of values) {
      const mb = mailbox as { path?: string; name?: string };
      const path = typeof mb?.path === "string" ? mb.path.trim() : "";
      const name = path || (typeof mb?.name === "string" ? mb.name.trim() : "");
      if (!name) continue;
      folders.push({ id: name, name });
    }
    return folders;
  } catch (err) {
    throw mapImapError(err);
  } finally {
    await imapLogout(client);
  }
}

async function listThreads(
  credentials: IcloudCredentials,
  folder?: string,
  limit?: number
): Promise<{ id: string; from: string; subject: string; snippet: string; date: number; unread: boolean }[]> {
  const client = buildImapClient(credentials);
  const mailboxName = normalizeFolder(folder);
  const maxResults = normalizeImapLimit(limit);
  try {
    await client.connect();
    const lock = await client.getMailboxLock(mailboxName);
    try {
      const uids = await client.search({ all: true });
      if (!Array.isArray(uids) || !uids.length) return [];
      const selected = [...uids].sort((a, b) => b - a).slice(0, maxResults);
      const threads: { id: string; from: string; subject: string; snippet: string; date: number; unread: boolean }[] = [];

      for await (const message of client.fetch(selected, {
        uid: true,
        envelope: true,
        flags: true,
        internalDate: true,
      })) {
        const uidValue = message.uid ?? (message as unknown as { id?: number }).id ?? 0;
        const uid = uidValue ? String(uidValue) : "";
        if (!uid) continue;

        const envelope = message.envelope ?? {};
        const from =
          Array.isArray(envelope.from) && envelope.from.length
            ? formatAddress(envelope.from[0])
            : "";
        const subject = typeof envelope.subject === "string" ? envelope.subject : "";
        // flags is Set<string> per imapflow types; use has() directly
        const hasSeen = message.flags?.has("\\Seen") ?? false;
        const dateValue =
          message.internalDate instanceof Date
            ? message.internalDate.getTime()
            : typeof message.internalDate === "number"
              ? message.internalDate
              : Date.now();

        threads.push({ id: uid, from, subject, snippet: subject || "", date: dateValue, unread: !hasSeen });
      }
      return threads.sort((a, b) => b.date - a.date);
    } finally {
      lock.release();
    }
  } catch (err) {
    throw mapImapError(err);
  } finally {
    await imapLogout(client);
  }
}

async function appendMessage(
  credentials: IcloudCredentials,
  folder: string,
  rawMime: string
): Promise<{ uid: number | null }> {
  const client = buildImapClient(credentials);
  const mailboxName = folder.trim();
  if (!mailboxName) throw new EmailIoError("INVALID_REQUEST", "payload.folder is required.", 400);
  try {
    await client.connect();
    // imapflow append: (path, content, flags?, idate?)
    const result = await client.append(mailboxName, rawMime, ["\\Seen"]) as { uid?: number } | null;
    const uid =
      typeof result?.uid === "number" && Number.isFinite(result.uid) ? result.uid : null;
    return { uid };
  } catch (err) {
    throw mapImapError(err);
  } finally {
    await imapLogout(client);
  }
}

// ─── SMTP helpers ─────────────────────────────────────────────────────────────

const DEFAULT_SMTP_HOST = "smtp.mail.me.com";
const DEFAULT_SMTP_PORT = 587;

function numEnv(key: string): number | undefined {
  const n = Number(process.env[key] ?? "");
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function normalizeList(list?: unknown): string[] {
  if (!Array.isArray(list)) return [];
  return list.map((v) => (typeof v === "string" ? v.trim() : "")).filter(Boolean);
}

function normalizeHeaders(value?: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const entries = Object.entries(value as Record<string, unknown>)
    .map(([k, v]) => [String(k), typeof v === "string" ? v.trim() : ""] as [string, string])
    .filter(([, v]) => v.length > 0);
  return entries.length ? Object.fromEntries(entries) : undefined;
}

async function sendIcloudSmtpMail(
  credentials: IcloudSmtpCredentials,
  payload: IcloudSendPayload
): Promise<{ messageId: string | null; accepted: string[]; rejected: string[] }> {
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

  const host = credentials.smtpHost ?? DEFAULT_SMTP_HOST;
  const port = Number.isFinite(credentials.smtpPort as number)
    ? Number(credentials.smtpPort)
    : DEFAULT_SMTP_PORT;
  const secure = credentials.secure === true;

  const nodemailer = requireNodemailer();
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    requireTLS: !secure,
    auth: { user: credentials.email, pass: credentials.appPassword },
    connectionTimeout: numEnv("SMTP_CONNECTION_TIMEOUT_MS"),
    greetingTimeout: numEnv("SMTP_GREETING_TIMEOUT_MS"),
    socketTimeout: numEnv("SMTP_SOCKET_TIMEOUT_MS"),
  } as Parameters<typeof nodemailer.createTransport>[0]);

  try {
    const info = await transporter.sendMail({
      from: credentials.email,
      to,
      ...(cc.length ? { cc } : {}),
      ...(bcc.length ? { bcc } : {}),
      subject: payload.subject,
      text: payload.text,
      ...(headers ? { headers } : {}),
    });
    return {
      messageId: info.messageId ? String(info.messageId) : null,
      accepted: Array.isArray(info.accepted) ? info.accepted.map(String) : [],
      rejected: Array.isArray(info.rejected) ? info.rejected.map(String) : [],
    };
  } catch (err: unknown) {
    const msg = String((err as { message?: string })?.message ?? err ?? "");
    if (/auth|login|invalid|credentials|authentication/i.test(msg)) {
      throw new EmailIoError("ICLOUD_AUTH_FAILED", "iCloud authentication failed.", 401);
    }
    throw new EmailIoError("MAIL_IO_ERROR", "SMTP send failed.", 502);
  } finally {
    try { transporter.close(); } catch { /* ignore */ }
  }
}

// ─── CalDAV helpers ───────────────────────────────────────────────────────────

const DEFAULT_CALDAV_BASE_URL = "https://caldav.icloud.com";
const DEFAULT_CALDAV_RANGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_CALDAV_REDIRECTS = 5;

const RESPONSE_BLOCK_RE = /<(?:[\w-]+:)?response\b[\s\S]*?<\/(?:[\w-]+:)?response>/gi;
const HREF_RE = /<(?:[\w-]+:)?href>([^<]+)<\/(?:[\w-]+:)?href>/i;
const DISPLAYNAME_RE = /<(?:[\w-]+:)?displayname>([^<]+)<\/(?:[\w-]+:)?displayname>/i;
const RESOURCE_CALENDAR_RE = /<(?:[\w-]+:)?calendar\b/i;
const CALENDAR_DATA_RE = /<(?:[\w-]+:)?calendar-data[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?calendar-data>/i;
const ETAG_RE = /<(?:[\w-]+:)?getetag>([^<]+)<\/(?:[\w-]+:)?getetag>/i;
const ISO_STRIP_RE = /[-:]/g;
const ISO_MILLIS_RE = /\.\d{3}Z$/;

const CURRENT_USER_PROPFIND = `<?xml version="1.0" encoding="utf-8" ?>
<d:propfind xmlns:d="DAV:">
  <d:prop>
    <d:current-user-principal/>
  </d:prop>
</d:propfind>`;

const CALENDAR_HOME_PROPFIND = `<?xml version="1.0" encoding="utf-8" ?>
<d:propfind xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <cal:calendar-home-set/>
  </d:prop>
</d:propfind>`;

const CALENDAR_LIST_PROPFIND = `<?xml version="1.0" encoding="utf-8" ?>
<d:propfind xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:displayname/>
    <d:resourcetype/>
  </d:prop>
</d:propfind>`;

function buildBasicAuthHeader(email: string, appPassword: string): string {
  return `Basic ${Buffer.from(`${email}:${appPassword}`).toString("base64")}`;
}

function parseFirstHref(xml: string): string | null {
  return xml.match(HREF_RE)?.[1]?.trim() ?? null;
}

function parsePropertyHref(xml: string, propertyName: string): string | null {
  const re = new RegExp(
    `<(?:[\\w-]+:)?${propertyName}\\b[^>]*>[\\s\\S]*?<(?:[\\w-]+:)?href>([^<]+)</(?:[\\w-]+:)?href>[\\s\\S]*?</(?:[\\w-]+:)?${propertyName}>`,
    "i"
  );
  return xml.match(re)?.[1]?.trim() ?? null;
}

function parseDisplayName(xml: string): string | undefined {
  return xml.match(DISPLAYNAME_RE)?.[1]?.trim() || undefined;
}

function formatCaldavDate(value: Date): string {
  return value.toISOString().replace(ISO_MILLIS_RE, "Z").replace(ISO_STRIP_RE, "");
}

function normalizeDateRange(from?: string, to?: string) {
  const fromDate = from ? new Date(from) : null;
  const toDate = to ? new Date(to) : null;
  const hasFrom = fromDate instanceof Date && Number.isFinite(fromDate.getTime());
  const hasTo = toDate instanceof Date && Number.isFinite(toDate.getTime());
  if (hasFrom && hasTo) return { start: fromDate!, end: toDate! };
  if (hasFrom) return { start: fromDate!, end: new Date(fromDate!.getTime() + DEFAULT_CALDAV_RANGE_MS) };
  if (hasTo) return { start: new Date(toDate!.getTime() - DEFAULT_CALDAV_RANGE_MS), end: toDate! };
  const now = new Date();
  return {
    start: new Date(now.getTime() - DEFAULT_CALDAV_RANGE_MS),
    end: new Date(now.getTime() + DEFAULT_CALDAV_RANGE_MS),
  };
}

function buildCalendarQuery(range: { start: Date; end: Date }): string {
  return `<?xml version="1.0" encoding="utf-8" ?>
<cal:calendar-query xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:getetag/>
    <cal:calendar-data/>
  </d:prop>
  <cal:filter>
    <cal:comp-filter name="VCALENDAR">
      <cal:comp-filter name="VEVENT">
        <cal:time-range start="${formatCaldavDate(range.start)}" end="${formatCaldavDate(range.end)}" />
      </cal:comp-filter>
    </cal:comp-filter>
  </cal:filter>
</cal:calendar-query>`;
}

function buildCaldavDiscoveryCandidates(baseUrl: string): string[] {
  const root = new URL(baseUrl);
  if (!root.pathname || root.pathname === "") root.pathname = "/";
  else if (!root.pathname.endsWith("/")) root.pathname = `${root.pathname}/`;
  root.search = "";
  root.hash = "";
  const wellKnown = new URL("/.well-known/caldav", root);
  return Array.from(new Set([root.toString(), wellKnown.toString()]));
}

async function requestWebDavXml(
  url: string,
  init: { method: "PROPFIND" | "REPORT"; body: string; depth: string; authHeader: string }
): Promise<string> {
  let currentUrl = url;
  for (let attempt = 0; attempt <= MAX_CALDAV_REDIRECTS; attempt++) {
    const resp = await fetch(currentUrl, {
      method: init.method,
      headers: {
        Accept: "application/xml, text/xml;q=0.9, */*;q=0.1",
        Authorization: init.authHeader,
        Depth: init.depth,
        "content-type": "text/xml; charset=utf-8",
      },
      body: init.body,
      redirect: "manual",
    });

    if (resp.status >= 300 && resp.status < 400) {
      const location = resp.headers.get("location");
      if (!location) {
        throw new EmailIoError(
          "MAIL_IO_ERROR",
          `CalDAV redirect missing location (${resp.status}).`,
          resp.status
        );
      }
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }

    const text = await resp.text();
    if (!resp.ok) {
      const snippet = text.trim().slice(0, 240);
      throw new EmailIoError(
        "MAIL_IO_ERROR",
        `CalDAV request failed (${resp.status}).${snippet ? ` ${snippet}` : ""}`,
        resp.status
      );
    }
    return text;
  }
  throw new EmailIoError("MAIL_IO_ERROR", "CalDAV redirect loop detected.", 508);
}

const fetchCaldavXml = (url: string, init: { body: string; depth: string; authHeader: string }) =>
  requestWebDavXml(url, { ...init, method: "PROPFIND" });

const fetchCaldavReport = (url: string, init: { body: string; authHeader: string }) =>
  requestWebDavXml(url, { ...init, depth: "1", method: "REPORT" });

async function discoverPrincipalXml(baseUrl: string, authHeader: string): Promise<string> {
  let lastError: unknown = null;
  for (const candidateUrl of buildCaldavDiscoveryCandidates(baseUrl)) {
    try {
      return await fetchCaldavXml(candidateUrl, {
        body: CURRENT_USER_PROPFIND,
        depth: "0",
        authHeader,
      });
    } catch (err) {
      const status = err instanceof EmailIoError ? err.statusCode : undefined;
      lastError = err;
      if (status === 400 || status === 404) continue;
      throw err;
    }
  }
  if (lastError) throw lastError;
  throw new EmailIoError("MAIL_IO_ERROR", "Unable to resolve CalDAV principal.", 502);
}

function extractCalendars(xml: string): CaldavCalendar[] {
  const blocks = xml.match(RESPONSE_BLOCK_RE) ?? [];
  const calendars: CaldavCalendar[] = [];
  for (const block of blocks) {
    if (!RESOURCE_CALENDAR_RE.test(block)) continue;
    const href = parseFirstHref(block);
    if (!href) continue;
    const name = parseDisplayName(block);
    calendars.push({ href, ...(name !== undefined ? { name } : {}) });
  }
  return calendars;
}

function extractEvents(xml: string): CaldavEvent[] {
  const blocks = xml.match(RESPONSE_BLOCK_RE) ?? [];
  const events: CaldavEvent[] = [];
  for (const block of blocks) {
    const dataMatch = block.match(CALENDAR_DATA_RE);
    const data = dataMatch?.[1]?.trim();
    if (!data) continue;
    const href = parseFirstHref(block) ?? "";
    const etag = block.match(ETAG_RE)?.[1]?.trim();
    events.push({ href, data, ...(etag ? { etag } : {}) });
  }
  return events;
}

async function resolveCaldavContext(
  credentials: IcloudCredentials,
  options: { calendarId?: string; skipCalendarList?: boolean }
): Promise<{ calendars: CaldavCalendar[]; selected: CaldavCalendar | null; calendarUrl: string | null }> {
  const authHeader = buildBasicAuthHeader(credentials.email, credentials.appPassword);
  const caldavBaseUrl = credentials.caldavBaseUrl ?? DEFAULT_CALDAV_BASE_URL;

  const principalXml = await discoverPrincipalXml(caldavBaseUrl, authHeader);
  const principalHref =
    parsePropertyHref(principalXml, "current-user-principal") ?? parseFirstHref(principalXml);
  if (!principalHref) throw new EmailIoError("MAIL_IO_ERROR", "Unable to resolve CalDAV principal.", 502);

  const principalUrl = new URL(principalHref, caldavBaseUrl).toString();
  const homeXml = await fetchCaldavXml(principalUrl, {
    body: CALENDAR_HOME_PROPFIND,
    depth: "0",
    authHeader,
  });
  const homeHref =
    parsePropertyHref(homeXml, "calendar-home-set") ?? parseFirstHref(homeXml);
  if (!homeHref) throw new EmailIoError("MAIL_IO_ERROR", "Unable to resolve CalDAV calendar home.", 502);

  const homeUrl = new URL(homeHref, caldavBaseUrl).toString();
  if (options.skipCalendarList) {
    return { calendars: [], selected: null, calendarUrl: homeUrl };
  }

  const calendarsXml = await fetchCaldavXml(homeUrl, {
    body: CALENDAR_LIST_PROPFIND,
    depth: "1",
    authHeader,
  });
  const calendars = extractCalendars(calendarsXml);
  if (!calendars.length) return { calendars, selected: null, calendarUrl: null };

  const calendarId = (options.calendarId ?? "").trim();
  const selected =
    (calendarId
      ? calendars.find(
          (e) =>
            e.href.includes(calendarId) ||
            (e.name ? e.name.toLowerCase() === calendarId.toLowerCase() : false)
        )
      : null) ?? calendars[0];

  if (!selected) return { calendars, selected: null, calendarUrl: null };
  return {
    calendars,
    selected,
    calendarUrl: new URL(selected.href, caldavBaseUrl).toString(),
  };
}

// ─── Credential extraction ────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function safeTrim(value?: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parsePortNumber(value?: unknown): number | undefined {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : undefined;
}

function normalizeCaldavBaseUrl(value?: unknown): string | undefined {
  const trimmed = safeTrim(value);
  if (!trimmed) return undefined;
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withProtocol);
    return `${url.origin}${url.pathname.replace(/\/+$/, "") || ""}`;
  } catch {
    return undefined;
  }
}

function tryBuildIcloudCredentials(source: unknown): IcloudCredentials | null {
  const s = source as Record<string, unknown> | null | undefined;
  const container = (s?.["credentials"] as Record<string, unknown> | undefined) ?? s ?? {};
  const email = safeTrim((container["email"] ?? container["username"]) as unknown);
  const appPassword = safeTrim(container["appPassword"] as unknown);
  if (!email || !EMAIL_RE.test(email) || !appPassword) return null;
  const imapHost = safeTrim(container["imapHost"] ?? container["imap_host"]) || undefined;
  const imapPort = parsePortNumber(container["imapPort"] ?? container["imap_port"]);
  const caldavBaseUrl = normalizeCaldavBaseUrl(
    container["serverUrl"] ?? container["caldavUrl"] ?? container["caldav_base_url"] ?? container["host"]
  );
  // exactOptionalPropertyTypes: only spread if value is defined (not undefined)
  return {
    email,
    appPassword,
    ...(imapHost !== undefined ? { imapHost } : {}),
    ...(imapPort !== undefined ? { imapPort } : {}),
    ...(caldavBaseUrl !== undefined ? { caldavBaseUrl } : {}),
  };
}

function buildIcloudCredentials(source: unknown): IcloudCredentials {
  const creds = tryBuildIcloudCredentials(source);
  if (!creds) {
    throw new EmailIoError("MISSING_CREDENTIALS", "Missing iCloud credentials (email + appPassword).", 400);
  }
  return creds;
}

function getSmtpCredentials(body: unknown): IcloudSmtpCredentials {
  const base = buildIcloudCredentials(body);
  const b = body as Record<string, unknown> | undefined;
  const creds = b?.["credentials"] as Record<string, unknown> | undefined;
  const smtpHost = safeTrim(creds?.["smtpHost"]) || undefined;
  const smtpPortRaw = creds?.["smtpPort"];
  let smtpPort: number | undefined;
  if (smtpPortRaw !== undefined && smtpPortRaw !== null) {
    const p = Number(smtpPortRaw);
    if (!Number.isFinite(p) || p <= 0) {
      throw new EmailIoError("INVALID_REQUEST", "smtpPort must be a positive number.", 400);
    }
    smtpPort = p;
  }
  const secure =
    typeof creds?.["secure"] === "boolean"
      ? creds["secure"]
      : typeof creds?.["smtpSecure"] === "boolean"
        ? (creds["smtpSecure"] as boolean)
        : undefined;
  // exactOptionalPropertyTypes: only spread if value is defined
  return {
    email: base.email,
    appPassword: base.appPassword,
    ...(smtpHost !== undefined ? { smtpHost } : {}),
    ...(smtpPort !== undefined ? { smtpPort } : {}),
    ...(secure !== undefined ? { secure } : {}),
  };
}

// ─── Error response helper ────────────────────────────────────────────────────

function errorResponse(err: unknown, fallback = "Internal error.", defaultStatus = 500): NextResponse {
  if (err instanceof EmailIoError) {
    return NextResponse.json(
      { ok: false, error: err.code, message: err.message },
      { status: err.statusCode }
    );
  }
  const message =
    typeof (err as { message?: string })?.message === "string"
      ? (err as { message: string }).message
      : fallback;
  return NextResponse.json({ ok: false, error: "MAIL_IO_ERROR", message }, { status: defaultStatus });
}

// ─── Route handlers ───────────────────────────────────────────────────────────

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  if (!checkAuth(request)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const { path } = await context.params;
  const routePath = path.join("/");

  if (routePath === "health") {
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  if (!checkAuth(request)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const { path } = await context.params;
  const routePath = path.join("/");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  // ── POST /icloud/folders ──────────────────────────────────────────────────
  if (routePath === "icloud/folders") {
    try {
      const credentials = buildIcloudCredentials(body);
      const folders = await listFolders(credentials);
      return NextResponse.json({ ok: true, folders });
    } catch (err) {
      return errorResponse(err, "Mail I/O error.");
    }
  }

  // ── POST /icloud/threads ──────────────────────────────────────────────────
  if (routePath === "icloud/threads") {
    try {
      const credentials = buildIcloudCredentials(body);
      const b = body as Record<string, unknown> | null;
      const folder = safeTrim(b?.["folder"]) || undefined;
      const limit =
        typeof b?.["limit"] === "number" && Number.isFinite(b["limit"] as number)
          ? (b["limit"] as number)
          : undefined;
      const threads = await listThreads(credentials, folder, limit);
      return NextResponse.json({ ok: true, threads, folder: folder ?? "INBOX" });
    } catch (err) {
      return errorResponse(err, "Mail I/O error.");
    }
  }

  // ── POST /icloud/send ─────────────────────────────────────────────────────
  if (routePath === "icloud/send") {
    try {
      const credentials = getSmtpCredentials(body);
      const b = body as Record<string, unknown> | null;
      const payload = b?.["payload"];
      if (!payload || typeof payload !== "object") {
        return NextResponse.json(
          { ok: false, error: "INVALID_REQUEST", message: "Missing send payload." },
          { status: 400 }
        );
      }
      const result = await sendIcloudSmtpMail(credentials, payload as IcloudSendPayload);
      return NextResponse.json({
        ok: true,
        messageId: result.messageId,
        accepted: result.accepted,
        rejected: result.rejected,
      });
    } catch (err) {
      return errorResponse(err, "SMTP send failed.", 502);
    }
  }

  // ── POST /icloud/append ───────────────────────────────────────────────────
  if (routePath === "icloud/append") {
    try {
      const credentials = buildIcloudCredentials(body);
      const b = body as Record<string, unknown> | null;
      const payload = b?.["payload"] as Record<string, unknown> | undefined;
      const folder = safeTrim(payload?.["folder"]);
      const rawMime = typeof payload?.["rawMime"] === "string" ? payload["rawMime"] : "";
      if (!folder || !rawMime) {
        return NextResponse.json(
          { ok: false, error: "INVALID_REQUEST", message: "payload.folder and payload.rawMime are required." },
          { status: 400 }
        );
      }
      const result = await appendMessage(credentials, folder, rawMime);
      return NextResponse.json({ ok: true, folder, uid: result.uid });
    } catch (err) {
      return errorResponse(err, "IMAP append failed.", 502);
    }
  }

  // ── POST /caldav/events ───────────────────────────────────────────────────
  if (routePath === "caldav/events") {
    try {
      const credentials = tryBuildIcloudCredentials(body);
      if (!credentials) return NextResponse.json([]);
      const b = body as Record<string, unknown> | null;
      const container = (b?.["query"] as Record<string, unknown> | undefined) ?? b ?? {};
      const from = safeTrim(container["from"]) || undefined;
      const to = safeTrim(container["to"]) || undefined;
      const calendarId = safeTrim(container["calendarId"]) || undefined;
      const authHeader = buildBasicAuthHeader(credentials.email, credentials.appPassword);
      // exactOptionalPropertyTypes: only pass calendarId if defined
      const context = await resolveCaldavContext(credentials, {
        ...(calendarId !== undefined ? { calendarId } : {}),
      });
      if (!context.calendarUrl) return NextResponse.json([]);
      const range = normalizeDateRange(from, to);
      const reportXml = await fetchCaldavReport(context.calendarUrl, {
        body: buildCalendarQuery(range),
        authHeader,
      });
      return NextResponse.json(extractEvents(reportXml));
    } catch (err) {
      console.error("[email-io/caldav] events failed", err);
      return NextResponse.json([]);
    }
  }

  // ── POST /caldav/test ─────────────────────────────────────────────────────
  if (routePath === "caldav/test") {
    try {
      const credentials = buildIcloudCredentials(body);
      const ctx = await resolveCaldavContext(credentials, { skipCalendarList: true });
      return NextResponse.json({
        ok: true,
        calendarHomeUrl: ctx.calendarUrl,
        calendars: ctx.calendars.map((e) => ({ href: e.href, name: e.name ?? null })),
      });
    } catch (err) {
      return errorResponse(err, "CalDAV connection failed.", 502);
    }
  }

  return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
}
