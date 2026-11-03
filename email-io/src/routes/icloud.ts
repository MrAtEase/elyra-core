import { FastifyPluginAsync } from 'fastify';
import { EmailIoError } from '../errors/EmailIoError.js';
import {
  IcloudFoldersRequest,
  IcloudAppendRequest,
  IcloudSendRequest,
  IcloudThreadsRequest,
  IcloudSmtpCredentials,
  IcloudSendPayload,
} from '../types/mail.js';
import { appendMessage, listFolders, listThreads } from '../icloud/imap.js';
import { sendIcloudSmtpMail } from '../icloud/smtp.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEFAULT_CALDAV_BASE_URL = 'https://caldav.icloud.com';
const DEFAULT_CALDAV_RANGE_MS = 30 * 24 * 60 * 60 * 1000;

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

const safeTrim = (value?: unknown) => (typeof value === 'string' ? value.trim() : '');

const normalizeCaldavBaseUrl = (value?: unknown) => {
  const trimmed = safeTrim(value);
  if (!trimmed) return undefined;
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withProtocol);
    return `${url.origin}${url.pathname.replace(/\/+$/, '') || ''}`;
  } catch {
    throw new EmailIoError('INVALID_REQUEST', 'Invalid CalDAV serverUrl.', 400);
  }
};

const parsePortNumber = (value?: unknown) => {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : undefined;
};

type IcloudCredentialsPayload = {
  email: string;
  appPassword: string;
  imapHost?: string;
  imapPort?: number;
  caldavBaseUrl?: string;
};

type CaldavEvent = {
  href: string;
  etag?: string;
  data: string;
};

type CaldavCalendar = {
  href: string;
  name?: string;
};

type CaldavResolvedContext = {
  calendars: CaldavCalendar[];
  selected: CaldavCalendar | null;
  calendarUrl: string | null;
};

const tryBuildIcloudCredentialsFromSource = (source: any): IcloudCredentialsPayload | null => {
  const container = source?.credentials ?? source ?? {};

  const email = safeTrim(container.email ?? container.username);
  const appPassword = safeTrim(container.appPassword);

  if (!email || !EMAIL_RE.test(email) || !appPassword) {
    return null;
  }

  const imapHost = safeTrim(container.imapHost ?? container.imap_host) || undefined;
  const imapPort = parsePortNumber(container.imapPort ?? container.imap_port);
  const caldavBaseUrl = normalizeCaldavBaseUrl(
    container.serverUrl ?? container.caldavUrl ?? container.caldav_base_url ?? container.host
  );

  return { email, appPassword, imapHost, imapPort, caldavBaseUrl };
};

const buildIcloudCredentialsFromSource = (source: any): IcloudCredentialsPayload => {
  const credentials = tryBuildIcloudCredentialsFromSource(source);
  if (!credentials) {
    throw new EmailIoError(
      'MISSING_CREDENTIALS',
      'Missing iCloud credentials (email + appPassword).',
      400
    );
  }
  return credentials;
};

const wrapMailIoError = (err: unknown, fallback: string, statusCode = 502): never => {
  if (err instanceof EmailIoError) {
    throw err;
  }
  const message = typeof (err as any)?.message === 'string' ? (err as any).message : fallback;
  throw new EmailIoError('MAIL_IO_ERROR', message, statusCode);
};

const getSmtpCredentials = (body: IcloudSendRequest): IcloudSmtpCredentials => {
  const baseCredentials = buildIcloudCredentialsFromSource(body);
  const credentials = body?.credentials;
  const smtpHost = safeTrim(credentials?.smtpHost);
  const smtpPortRaw = credentials?.smtpPort;
  let smtpPort: number | undefined;
  if (smtpPortRaw !== undefined && smtpPortRaw !== null) {
    const portValue = Number(smtpPortRaw);
    if (!Number.isFinite(portValue) || portValue <= 0) {
      throw new EmailIoError('INVALID_REQUEST', 'smtpPort must be a positive number.', 400);
    }
    smtpPort = portValue;
  }
  const secure =
    typeof credentials?.secure === 'boolean'
      ? credentials.secure
      : typeof (credentials as any)?.smtpSecure === 'boolean'
        ? (credentials as any).smtpSecure
        : undefined;
  return {
    email: baseCredentials.email,
    appPassword: baseCredentials.appPassword,
    smtpHost: smtpHost || undefined,
    smtpPort,
    ...(secure !== undefined ? { secure } : {}),
  };
};

const getSendPayload = (body: IcloudSendRequest): IcloudSendPayload => {
  if (!body?.payload || typeof body.payload !== 'object') {
    throw new EmailIoError('INVALID_REQUEST', 'Missing send payload.', 400);
  }
  return body.payload;
};

const getAppendPayload = (body: IcloudAppendRequest) => {
  if (!body?.payload || typeof body.payload !== 'object') {
    throw new EmailIoError('INVALID_REQUEST', 'Missing append payload.', 400);
  }
  const folder = safeTrim(body.payload.folder);
  const rawMime = typeof body.payload.rawMime === 'string' ? body.payload.rawMime : '';
  if (!folder || !rawMime) {
    throw new EmailIoError(
      'INVALID_REQUEST',
      'payload.folder and payload.rawMime are required.',
      400
    );
  }
  return { folder, rawMime };
};

const normalizeLimit = (value?: unknown) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.min(200, Math.max(1, Math.round(parsed)));
};

const buildBasicAuthHeader = (email: string, appPassword: string) => {
  const encoded = Buffer.from(`${email}:${appPassword}`).toString('base64');
  return `Basic ${encoded}`;
};

const parseFirstHref = (xml: string): string | null => {
  const match = xml.match(HREF_RE);
  if (!match) return null;
  const href = match[1]?.trim();
  return href || null;
};

const parsePropertyHref = (xml: string, propertyName: string): string | null => {
  const propertyRe = new RegExp(
    `<(?:[\\w-]+:)?${propertyName}\\b[^>]*>[\\s\\S]*?<(?:[\\w-]+:)?href>([^<]+)</(?:[\\w-]+:)?href>[\\s\\S]*?</(?:[\\w-]+:)?${propertyName}>`,
    'i'
  );
  const match = xml.match(propertyRe);
  const href = match?.[1]?.trim();
  return href || null;
};

const parseDisplayName = (xml: string): string | undefined => {
  const match = xml.match(DISPLAYNAME_RE);
  const name = match?.[1]?.trim();
  return name || undefined;
};

const buildCaldavDiscoveryCandidates = (baseUrl: string) => {
  const rootUrl = new URL(baseUrl);
  if (!rootUrl.pathname || rootUrl.pathname === '') {
    rootUrl.pathname = '/';
  } else if (!rootUrl.pathname.endsWith('/')) {
    rootUrl.pathname = `${rootUrl.pathname}/`;
  }
  rootUrl.search = '';
  rootUrl.hash = '';

  const wellKnownUrl = new URL('/.well-known/caldav', rootUrl);
  return Array.from(new Set([rootUrl.toString(), wellKnownUrl.toString()]));
};

const formatCaldavDate = (value: Date): string => {
  return value.toISOString().replace(ISO_MILLIS_RE, 'Z').replace(ISO_STRIP_RE, '');
};

const normalizeDateRange = (from?: string, to?: string) => {
  const fromDate = from ? new Date(from) : null;
  const toDate = to ? new Date(to) : null;
  const hasFrom = fromDate instanceof Date && Number.isFinite(fromDate.getTime());
  const hasTo = toDate instanceof Date && Number.isFinite(toDate.getTime());
  if (hasFrom && hasTo) {
    return { start: fromDate!, end: toDate! };
  }
  if (hasFrom && !hasTo) {
    return { start: fromDate!, end: new Date(fromDate!.getTime() + DEFAULT_CALDAV_RANGE_MS) };
  }
  if (!hasFrom && hasTo) {
    return { start: new Date(toDate!.getTime() - DEFAULT_CALDAV_RANGE_MS), end: toDate! };
  }
  const now = new Date();
  return {
    start: new Date(now.getTime() - DEFAULT_CALDAV_RANGE_MS),
    end: new Date(now.getTime() + DEFAULT_CALDAV_RANGE_MS),
  };
};

const buildCalendarQuery = (range: { start: Date; end: Date }) => `<?xml version="1.0" encoding="utf-8" ?>
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

const MAX_CALDAV_REDIRECTS = 5;

const requestWebDavXml = async (
  url: string,
  init: { method: 'PROPFIND' | 'REPORT'; body: string; depth: string; authHeader: string }
) => {
  let currentUrl = url;
  for (let attempt = 0; attempt <= MAX_CALDAV_REDIRECTS; attempt += 1) {
    const resp = await fetch(currentUrl, {
      method: init.method,
      headers: {
        Accept: 'application/xml, text/xml;q=0.9, */*;q=0.1',
        Authorization: init.authHeader,
        Depth: init.depth,
        'content-type': 'text/xml; charset=utf-8',
      },
      body: init.body,
      redirect: 'manual',
    });

    if (resp.status >= 300 && resp.status < 400) {
      const location = resp.headers.get('location');
      if (!location) {
        throw new EmailIoError(
          'MAIL_IO_ERROR',
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
      const detail = snippet ? ` ${snippet}` : '';
      throw new EmailIoError(
        'MAIL_IO_ERROR',
        `CalDAV request failed (${resp.status}).${detail}`,
        resp.status
      );
    }
    return text;
  }

  throw new EmailIoError('MAIL_IO_ERROR', 'CalDAV redirect loop detected.', 508);
};

const fetchCaldavXml = async (url: string, init: { body: string; depth: string; authHeader: string }) =>
  requestWebDavXml(url, { ...init, method: 'PROPFIND' });

const fetchCaldavReport = async (url: string, init: { body: string; authHeader: string }) =>
  requestWebDavXml(url, { ...init, depth: '1', method: 'REPORT' });

const discoverPrincipalXml = async (baseUrl: string, authHeader: string) => {
  let lastError: unknown = null;
  for (const candidateUrl of buildCaldavDiscoveryCandidates(baseUrl)) {
    try {
      return await fetchCaldavXml(candidateUrl, {
        body: CURRENT_USER_PROPFIND,
        depth: '0',
        authHeader,
      });
    } catch (err: unknown) {
      const status = err instanceof EmailIoError ? err.statusCode : undefined;
      lastError = err;
      if (status === 400 || status === 404) {
        continue;
      }
      throw err;
    }
  }
  if (lastError) {
    throw lastError;
  }
  throw new EmailIoError('MAIL_IO_ERROR', 'Unable to resolve CalDAV principal.', 502);
};

const resolveCaldavContext = async (
  credentials: IcloudCredentialsPayload,
  options: { calendarId?: string; skipCalendarList?: boolean }
): Promise<CaldavResolvedContext> => {
  const authHeader = buildBasicAuthHeader(credentials.email, credentials.appPassword);
  const caldavBaseUrl = credentials.caldavBaseUrl ?? DEFAULT_CALDAV_BASE_URL;

  let principalXml: string;
  try {
    principalXml = await discoverPrincipalXml(caldavBaseUrl, authHeader);
  } catch (err: unknown) {
    if (err instanceof EmailIoError) {
      throw new EmailIoError(err.code, `CalDAV principal discovery failed. ${err.message}`, err.statusCode);
    }
    throw err;
  }

  const principalHref =
    parsePropertyHref(principalXml, 'current-user-principal') || parseFirstHref(principalXml);
  if (!principalHref) {
    throw new EmailIoError('MAIL_IO_ERROR', 'Unable to resolve CalDAV principal.', 502);
  }

  const principalUrl = new URL(principalHref, caldavBaseUrl).toString();
  let homeXml: string;
  try {
    homeXml = await fetchCaldavXml(principalUrl, {
      body: CALENDAR_HOME_PROPFIND,
      depth: '0',
      authHeader,
    });
  } catch (err: unknown) {
    if (err instanceof EmailIoError) {
      throw new EmailIoError(err.code, `CalDAV calendar-home lookup failed. ${err.message}`, err.statusCode);
    }
    throw err;
  }

  const homeHref = parsePropertyHref(homeXml, 'calendar-home-set') || parseFirstHref(homeXml);
  if (!homeHref) {
    throw new EmailIoError('MAIL_IO_ERROR', 'Unable to resolve CalDAV calendar home.', 502);
  }

  const homeUrl = new URL(homeHref, caldavBaseUrl).toString();
  if (options.skipCalendarList) {
    return {
      calendars: [],
      selected: null,
      calendarUrl: homeUrl,
    };
  }
  let calendarsXml: string;
  try {
    calendarsXml = await fetchCaldavXml(homeUrl, {
      body: CALENDAR_LIST_PROPFIND,
      depth: '1',
      authHeader,
    });
  } catch (err: unknown) {
    if (err instanceof EmailIoError) {
      throw new EmailIoError(err.code, `CalDAV calendar list lookup failed. ${err.message}`, err.statusCode);
    }
    throw err;
  }

  const calendars = extractCalendars(calendarsXml);
  if (!calendars.length) {
    return {
      calendars,
      selected: null,
      calendarUrl: null,
    };
  }

  const calendarId = safeTrim(options.calendarId);
  const selected =
    (calendarId
      ? calendars.find((entry) =>
          entry.href.includes(calendarId) ||
          (entry.name ? entry.name.toLowerCase() === calendarId.toLowerCase() : false)
        )
      : null) || calendars[0];

  return {
    calendars,
    selected,
    calendarUrl: new URL(selected.href, caldavBaseUrl).toString(),
  };
};

const extractCalendars = (xml: string): CaldavCalendar[] => {
  const blocks = xml.match(RESPONSE_BLOCK_RE) ?? [];
  const calendars: CaldavCalendar[] = [];
  for (const block of blocks) {
    if (!RESOURCE_CALENDAR_RE.test(block)) continue;
    const href = parseFirstHref(block);
    if (!href) continue;
    calendars.push({ href, name: parseDisplayName(block) });
  }
  return calendars;
};

const extractEvents = (xml: string): CaldavEvent[] => {
  const blocks = xml.match(RESPONSE_BLOCK_RE) ?? [];
  const events: CaldavEvent[] = [];
  for (const block of blocks) {
    const dataMatch = block.match(CALENDAR_DATA_RE);
    const data = dataMatch?.[1]?.trim();
    if (!data) continue;
    const href = parseFirstHref(block) || '';
    const etag = block.match(ETAG_RE)?.[1]?.trim();
    events.push({ href, data, ...(etag ? { etag } : {}) });
  }
  return events;
};

const fetchCaldavEvents = async (credentials: IcloudCredentialsPayload, options: { from?: string; to?: string; calendarId?: string }) => {
  const authHeader = buildBasicAuthHeader(credentials.email, credentials.appPassword);
  const context = await resolveCaldavContext(credentials, { calendarId: options.calendarId });
  if (!context.calendarUrl) {
    return [] as CaldavEvent[];
  }
  const range = normalizeDateRange(options.from, options.to);
  let reportXml: string;
  try {
    reportXml = await fetchCaldavReport(context.calendarUrl, {
      body: buildCalendarQuery(range),
      authHeader,
    });
  } catch (err: unknown) {
    if (err instanceof EmailIoError) {
      throw new EmailIoError(err.code, `CalDAV event query failed. ${err.message}`, err.statusCode);
    }
    throw err;
  }

  return extractEvents(reportXml);
};

const loadCaldavEventsFromSource = async (source: any) => {
  const credentials = tryBuildIcloudCredentialsFromSource(source);
  if (!credentials) {
    return [] as CaldavEvent[];
  }
  const container = source?.query ?? source ?? {};
  const from = safeTrim(container?.from) || undefined;
  const to = safeTrim(container?.to) || undefined;
  const calendarId = safeTrim(container?.calendarId) || undefined;
  return fetchCaldavEvents(credentials, { from, to, calendarId });
};

export const registerIcloudRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post<{ Body: IcloudFoldersRequest }>('/icloud/folders', async (request) => {
    try {
      const credentials = buildIcloudCredentialsFromSource(request.body);
      const folders = await listFolders(credentials);
      return { ok: true, folders };
    } catch (err: unknown) {
      wrapMailIoError(err, 'Mail I/O error.');
    }
  });

  fastify.post<{ Body: IcloudThreadsRequest }>('/icloud/threads', async (request) => {
    try {
      const credentials = buildIcloudCredentialsFromSource(request.body);
      const folder = safeTrim(request.body?.folder);
      const limit =
        typeof request.body?.limit === 'number' && Number.isFinite(request.body.limit)
          ? request.body.limit
          : undefined;
      const threads = await listThreads(credentials, folder || undefined, limit);
      return { ok: true, threads, folder: folder || 'INBOX' };
    } catch (err: unknown) {
      wrapMailIoError(err, 'Mail I/O error.');
    }
  });

  fastify.post<{ Body: IcloudSendRequest }>('/icloud/send', async (request) => {
    try {
      const credentials = getSmtpCredentials(request.body);
      const payload = getSendPayload(request.body);
      const result = await sendIcloudSmtpMail(credentials, payload);
      return {
        ok: true,
        messageId: result.messageId,
        accepted: result.accepted,
        rejected: result.rejected,
      };
    } catch (err: unknown) {
      wrapMailIoError(err, 'SMTP send failed.', 502);
    }
  });

  fastify.post<{ Body: IcloudAppendRequest }>('/icloud/append', async (request) => {
    try {
      const credentials = buildIcloudCredentialsFromSource(request.body);
      const payload = getAppendPayload(request.body);
      const result = await appendMessage(credentials, payload.folder, payload.rawMime);
      return {
        ok: true,
        folder: payload.folder,
        uid: result.uid,
      };
    } catch (err: unknown) {
      wrapMailIoError(err, 'IMAP append failed.', 502);
    }
  });

  fastify.get('/imap/labels', async (request) => {
    try {
      const credentials = buildIcloudCredentialsFromSource(request.query);
      const folders = await listFolders(credentials);
      const labels = folders.map((entry) => ({
        id: entry.id,
        name: entry.name,
      }));
      return { ok: true, labels };
    } catch (err: unknown) {
      wrapMailIoError(err, 'Mail I/O error.');
    }
  });

  fastify.get('/imap/threads', async (request) => {
    try {
      const credentials = buildIcloudCredentialsFromSource(request.query);
      const folder = safeTrim((request.query as any)?.label);
      const limit = normalizeLimit((request.query as any)?.limit);
      const threads = await listThreads(credentials, folder || undefined, limit);
      return { ok: true, threads, folder: folder || 'INBOX' };
    } catch (err: unknown) {
      wrapMailIoError(err, 'Mail I/O error.');
    }
  });

  fastify.get('/caldav/events', async (request) => {
    try {
      const events = await loadCaldavEventsFromSource(request.query);
      return Array.isArray(events) ? events : [];
    } catch (err: unknown) {
      console.error('[icloud/caldav] events failed', err);
      return [];
    }
  });

  fastify.post('/caldav/events', async (request) => {
    try {
      const events = await loadCaldavEventsFromSource(request.body);
      return Array.isArray(events) ? events : [];
    } catch (err: unknown) {
      console.error('[icloud/caldav] events failed', err);
      return [];
    }
  });

  fastify.post('/caldav/test', async (request) => {
    try {
      const credentials = buildIcloudCredentialsFromSource(request.body);
      const context = await resolveCaldavContext(credentials, { skipCalendarList: true });
      return {
        ok: true,
        calendarHomeUrl: context.calendarUrl,
        calendars: context.calendars.map((entry) => ({
          href: entry.href,
          name: entry.name ?? null,
        })),
      };
    } catch (err: unknown) {
      wrapMailIoError(err, 'CalDAV connection failed.', 502);
    }
  });
};
