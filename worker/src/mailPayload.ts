export type MailSendPayload = {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  bodyText: string;
  bodyHtml?: string;
  replyToMessage?: {
    originalMessageId: string;
    originalReferences?: string[];
  };
};

function normalizeRecipients(value: any): string[] {
  if (!value) {
    return [];
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
      .filter((entry) => entry.length > 0);
  }
  return [];
}

function normalizeStringField(value: any): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}

function normalizeMessageId(value: any): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith('<') && trimmed.endsWith('>')) {
    const inner = trimmed.slice(1, -1).trim();
    return inner.length ? inner : undefined;
  }
  return trimmed;
}

function normalizeReferences(value: any): string[] {
  if (Array.isArray(value)) {
    return value
      .map((entry) => normalizeMessageId(entry))
      .filter((entry): entry is string => Boolean(entry));
  }
  if (typeof value === 'string') {
    return value
      .split(/\s+/g)
      .map((entry) => normalizeMessageId(entry))
      .filter((entry): entry is string => Boolean(entry));
  }
  return [];
}

function normalizeReplyToMessage(value: any):
  | { originalMessageId: string; originalReferences?: string[] }
  | null
  | undefined {
  if (!value) return undefined;
  if (typeof value !== 'object') return null;
  const originalMessageId =
    normalizeMessageId((value as any).originalMessageId) ??
    normalizeMessageId((value as any).messageId);
  if (!originalMessageId) {
    return null;
  }
  const originalReferences = normalizeReferences(
    (value as any).originalReferences ?? (value as any).references
  );
  return {
    originalMessageId,
    ...(originalReferences.length ? { originalReferences } : {}),
  };
}

export function normalizeMailSendPayload(payload: any): MailSendPayload | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const to = normalizeRecipients(payload.to);
  if (!to.length) {
    return null;
  }
  const subject = normalizeStringField(payload.subject);
  if (!subject) {
    return null;
  }
  const bodyText = normalizeStringField(payload.bodyText);
  if (!bodyText) {
    return null;
  }
  const cc = normalizeRecipients(payload.cc);
  const bcc = normalizeRecipients(payload.bcc);
  const bodyHtml = normalizeStringField(payload.bodyHtml);
  const replyToMessage = normalizeReplyToMessage(payload.replyToMessage);
  if (replyToMessage === null) {
    return null;
  }
  return {
    to,
    subject,
    bodyText,
    ...(cc.length ? { cc } : {}),
    ...(bcc.length ? { bcc } : {}),
    ...(bodyHtml ? { bodyHtml } : {}),
    ...(replyToMessage ? { replyToMessage } : {}),
  };
}

export function isValidMailSendPayload(payload: any): payload is MailSendPayload {
  return normalizeMailSendPayload(payload) !== null;
}
