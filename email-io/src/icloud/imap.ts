import { ImapFlow } from 'imapflow';
import { EmailIoError } from '../errors/EmailIoError.js';
import type { IcloudCredentials } from '../types/mail.js';

const DEFAULT_IMAP_HOST = 'imap.mail.me.com';
const DEFAULT_IMAP_PORT = 993;
const DEFAULT_FOLDER = 'INBOX';
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 200;
const MAX_SNIPPET_LENGTH = 200;

type FolderEntry = {
  id: string;
  name: string;
};

type ThreadPreview = {
  id: string;
  from: string;
  subject: string;
  snippet: string;
  date: number;
  unread: boolean;
};

const readTimeoutEnv = (key: string): number | undefined => {
  const raw = Number(process.env[key] || '');
  if (!Number.isFinite(raw) || raw <= 0) {
    return undefined;
  }
  return Math.round(raw);
};

const normalizeFolder = (folder?: string | null) => {
  const value = (folder || '').trim();
  return value || DEFAULT_FOLDER;
};

const normalizeLimit = (limit?: number | null) => {
  const parsed = Number(limit);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_LIMIT;
  }
  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(parsed)));
};

const formatAddress = (address: any): string => {
  if (!address || typeof address !== 'object') {
    return '';
  }
  const name = typeof address.name === 'string' ? address.name.trim() : '';
  let email = typeof address.address === 'string' ? address.address.trim() : '';
  if (!email && typeof address.mailbox === 'string' && typeof address.host === 'string') {
    email = `${address.mailbox}@${address.host}`;
  }
  if (name && email) {
    return `${name} <${email}>`;
  }
  return name || email || '';
};

const normalizeSnippet = (value: unknown): string => {
  let text = '';
  if (typeof value === 'string') {
    text = value;
  } else if (value instanceof Uint8Array || Buffer.isBuffer(value)) {
    text = Buffer.from(value as Uint8Array).toString('utf8');
  } else if (value && typeof (value as any).toString === 'function') {
    text = (value as any).toString();
  }

  if (!text) {
    return '';
  }

  const collapsed = text
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[\r\n]+/g, ' ')
    .trim();

  if (collapsed.length <= MAX_SNIPPET_LENGTH) {
    return collapsed;
  }
  return collapsed.slice(0, MAX_SNIPPET_LENGTH).trim();
};

const extractBodySnippet = (bodyParts: any): string => {
  if (!bodyParts) return '';
  if (typeof (bodyParts as Map<string, any>).get === 'function') {
    return normalizeSnippet((bodyParts as Map<string, any>).get('TEXT'));
  }
  if (typeof bodyParts === 'object') {
    return normalizeSnippet((bodyParts as Record<string, any>)['TEXT']);
  }
  return '';
};

const buildImapClient = (credentials: IcloudCredentials) => {
  const host = credentials.imapHost || DEFAULT_IMAP_HOST;
  const port = Number.isFinite(credentials.imapPort || NaN)
    ? Number(credentials.imapPort)
    : DEFAULT_IMAP_PORT;
  const options: any = {
    host,
    port,
    secure: true,
    auth: {
      user: credentials.email,
      pass: credentials.appPassword,
    },
  };

  const socketTimeout = readTimeoutEnv('IMAP_SOCKET_TIMEOUT_MS');
  if (socketTimeout) {
    options.socketTimeout = socketTimeout;
  }
  const authTimeout = readTimeoutEnv('IMAP_AUTH_TIMEOUT_MS');
  if (authTimeout) {
    options.authTimeout = authTimeout;
  }
  const greetingTimeout = readTimeoutEnv('IMAP_GREETING_TIMEOUT_MS');
  if (greetingTimeout) {
    options.greetingTimeout = greetingTimeout;
  }

  return new ImapFlow(options);
};

const mapImapError = (error: unknown): EmailIoError => {
  const message = (error as any)?.message ? String((error as any).message) : String(error);
  const responseText = (error as any)?.responseText ? String((error as any).responseText) : '';
  const hint = `${message} ${responseText}`.trim();
  const authMatch = /auth|login|authentication/i.test(hint);
  const missingFolderMatch = /mailbox|folder|nonexistent|does not exist|not found/i.test(hint);

  if (authMatch) {
    return new EmailIoError('ICLOUD_AUTH_FAILED', 'iCloud authentication failed.', 401);
  }
  if (missingFolderMatch) {
    return new EmailIoError('ICLOUD_FOLDER_NOT_FOUND', 'Requested mailbox not found.', 404);
  }
  return new EmailIoError('MAIL_IO_ERROR', message || 'Mail I/O error.', 500);
};

export const listFolders = async (credentials: IcloudCredentials): Promise<FolderEntry[]> => {
  const client = buildImapClient(credentials);
  try {
    await client.connect();
    const folders: FolderEntry[] = [];
    const listed = await client.list();
    const values: any[] = Array.isArray(listed)
      ? listed
      : listed && typeof (listed as any).values === "function"
        ? Array.from((listed as any).values())
        : [];
    for (const mailbox of values) {
      const path = typeof mailbox?.path === 'string' ? mailbox.path.trim() : '';
      const name = path || (typeof mailbox?.name === 'string' ? mailbox.name.trim() : '');
      if (!name) continue;
      folders.push({ id: name, name });
    }
    return folders;
  } catch (err: unknown) {
    throw mapImapError(err);
  } finally {
    try {
      await client.logout();
    } catch {
      try {
        client.close();
      } catch {
        // ignore close errors
      }
    }
  }
};

export const listThreads = async (
  credentials: IcloudCredentials,
  folder?: string,
  limit?: number
): Promise<ThreadPreview[]> => {
  const client = buildImapClient(credentials);
  const mailboxName = normalizeFolder(folder);
  const maxResults = normalizeLimit(limit);
  try {
    await client.connect();
    const lock = await client.getMailboxLock(mailboxName);
    try {
    const uids = await client.search({ all: true });
    if (!Array.isArray(uids) || !uids.length) {
      return [];
    }
    const selected = [...uids].sort((a, b) => b - a).slice(0, maxResults);
    const threads: ThreadPreview[] = [];

    for await (const message of client.fetch(selected, {
      uid: true,
      envelope: true,
      flags: true,
      internalDate: true,
    })) {
      const uidValue = message.uid ?? message.id ?? '';
      const uid = uidValue ? String(uidValue) : '';
      if (!uid) {
        continue;
      }
      const envelope = message.envelope || {};
      const from = Array.isArray(envelope.from) && envelope.from.length
        ? formatAddress(envelope.from[0])
        : '';
      const subject = typeof envelope.subject === 'string' ? envelope.subject : '';
      const snippet = subject || '';
      const flags = message.flags;
      const hasSeen =
        flags instanceof Set
          ? flags.has('\\Seen')
          : Array.isArray(flags)
            ? flags.includes('\\Seen')
            : false;
      const dateValue = message.internalDate instanceof Date
        ? message.internalDate.getTime()
        : typeof message.internalDate === 'number'
          ? message.internalDate
          : Date.now();

      threads.push({
        id: uid,
        from,
        subject,
        snippet,
        date: dateValue,
        unread: !hasSeen,
      });
    }

    return threads.sort((a, b) => b.date - a.date);
    } finally {
      lock.release();
    }
  } catch (err: unknown) {
    throw mapImapError(err);
  } finally {
    try {
      await client.logout();
    } catch {
      try {
        client.close();
      } catch {
        // ignore close errors
      }
    }
  }
};

export const appendMessage = async (
  credentials: IcloudCredentials,
  folder: string,
  rawMime: string
): Promise<{ uid: number | null }> => {
  const client = buildImapClient(credentials);
  const mailboxName = (folder || "").trim();
  if (!mailboxName) {
    throw new EmailIoError('INVALID_REQUEST', 'payload.folder is required.', 400);
  }
  try {
    await client.connect();
    const result: any = await client.append(mailboxName, rawMime, {
      flags: ['\\Seen'],
    });
    const uid =
      typeof result?.uid === 'number' && Number.isFinite(result.uid)
        ? result.uid
        : null;
    return { uid };
  } catch (err: unknown) {
    throw mapImapError(err);
  } finally {
    try {
      await client.logout();
    } catch {
      try {
        client.close();
      } catch {
        // ignore close errors
      }
    }
  }
};
