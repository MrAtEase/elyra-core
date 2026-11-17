/**
 * Holds the message history of the chat thread that is currently open in the AI dock.
 * The dock (AIDock) writes it, the kernel reads it when submitting a new intent, so
 * Elli gets the context of exactly this thread — and "+ New" really starts fresh.
 */
export type ThreadHistoryMessage = { role: "user" | "assistant"; content: string };

const MAX_MESSAGES = 12;
const MAX_CHARS_PER_MESSAGE = 1500;

let activeThreadId: string | null = null;
let history: ThreadHistoryMessage[] = [];

export function setActiveThreadHistory(threadId: string, messages: ThreadHistoryMessage[]): void {
  activeThreadId = threadId;
  history = messages.slice(-MAX_MESSAGES).map((m) => ({
    role: m.role,
    content: m.content.slice(0, MAX_CHARS_PER_MESSAGE),
  }));
}

export function getActiveThreadHistory(): { threadId: string | null; messages: ThreadHistoryMessage[] } {
  return { threadId: activeThreadId, messages: [...history] };
}
