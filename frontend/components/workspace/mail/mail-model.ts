export type MailThreadRecord = {
  id: string;
  workspace_id: string;
  integration_id: string | null;
  external_id: string;
  subject: string | null;
  snippet: string | null;
  from_email: string | null;
  to_emails: unknown;
  last_message_at: string | null;
  raw: Record<string, unknown> | null;
  created_at: string;
  updated_at: string | null;
};

export type MailThread = {
  id: string;
  workspaceId: string;
  integrationId: string | null;
  externalId: string;
  subject: string | null;
  snippet: string | null;
  fromEmail: string | null;
  toEmails: string[];
  lastMessageAt: string | null;
  raw: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string | null;
};

const safeTimestamp = (value: string | null | undefined): number => {
  if (!value) {
    return 0;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const isMailThreadRecordShape = (value: unknown): value is MailThreadRecord =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as MailThreadRecord).id === "string" &&
  typeof (value as MailThreadRecord).workspace_id === "string" &&
  typeof (value as MailThreadRecord).external_id === "string" &&
  typeof (value as MailThreadRecord).created_at === "string";

const isMailThreadRecordArray = (value: unknown): value is MailThreadRecord[] =>
  Array.isArray(value) && value.every(isMailThreadRecordShape);

const toEmails = (payload: unknown): string[] => {
  if (!Array.isArray(payload)) {
    return [];
  }
  return payload.filter((item): item is string => typeof item === "string");
};

export const normalizeMailThread = (record: MailThreadRecord): MailThread => ({
  id: record.id,
  workspaceId: record.workspace_id,
  integrationId: record.integration_id,
  externalId: record.external_id,
  subject: record.subject,
  snippet: record.snippet,
  fromEmail: record.from_email,
  toEmails: toEmails(record.to_emails),
  lastMessageAt: record.last_message_at,
  raw: record.raw,
  createdAt: record.created_at,
  updatedAt: record.updated_at,
});

export const sortMailThreads = (threads: MailThread[]): MailThread[] =>
  [...threads].sort((a, b) => {
    const aStamp =
      safeTimestamp(a.lastMessageAt) || safeTimestamp(a.updatedAt) || safeTimestamp(a.createdAt);
    const bStamp =
      safeTimestamp(b.lastMessageAt) || safeTimestamp(b.updatedAt) || safeTimestamp(b.createdAt);
    if (aStamp === bStamp) {
      return a.id.localeCompare(b.id);
    }
    return bStamp - aStamp;
  });

export { isMailThreadRecordArray };
