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

import type { MerlinIntentId } from "@/lib/merlin/intents";

export type MailThread = {
  id: string;
  subject?: string;
  participants: string[];
  messages: MailMessage[];
};

export type MerlinDraftTone = "concise" | "friendly" | "formal" | "merlin";

export type MerlinDraftSource = {
  messageId: string;
  quote: string;
  reason: string;
  timestamp?: string | null;
};

export type MerlinDraftResponse = {
  to: string[];
  cc: string[];
  subject: string;
  body: string;
  sources: MerlinDraftSource[];
};

export type MerlinResult = {
  intentId: MerlinIntentId;
  raw: string;
  draft?: MerlinDraftResponse;
};
