export type MailMessageDirection = "inbound" | "outbound";

export type MailMessage = {
  id: string;
  threadId: string;
  date: string;
  from: string;
  fromEmail?: string | null;
  to: string[];
  cc: string[];
  subject?: string;
  snippet?: string;
  textPlain?: string;
  textHtml?: string;
  direction: MailMessageDirection;
};

import type { EllyIntentId } from "@/lib/assistant/intents";

export type MailThread = {
  id: string;
  subject?: string;
  participants: string[];
  messages: MailMessage[];
};

export type EllyDraftTone = "concise" | "friendly" | "formal" | "elly";

export type EllyDraftSource = {
  messageId: string;
  quote: string;
  reason: string;
  timestamp?: string | null;
};

export type EllyDraftResponse = {
  to: string[];
  cc: string[];
  subject: string;
  body: string;
  sources: EllyDraftSource[];
};

export type EllyResult = {
  intentId: EllyIntentId;
  raw: string;
  draft?: EllyDraftResponse;
};
