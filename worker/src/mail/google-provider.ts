import type { MailProviderAdapter } from "./mail-provider";
import type { MailIdentity } from "./mail-identity";

type GoogleProviderDependencies = {
  fetchInbox: (
    env: any,
    userId: string,
    workspaceId: string | null | undefined,
    limit: number,
    folder?: string
  ) => Promise<any[]>;
  fetchLabels: (
    env: any,
    userId: string,
    workspaceId: string | null | undefined
  ) => Promise<any[]>;
  fetchThread: (
    env: any,
    userId: string,
    workspaceId: string | null | undefined,
    threadId: string
  ) => Promise<any>;
  fetchMessage: (
    env: any,
    userId: string,
    workspaceId: string | null | undefined,
    messageId: string
  ) => Promise<any>;
  sendMail: (
    env: any,
    userId: string,
    workspaceId: string | null | undefined,
    payload: any
  ) => Promise<any>;
  trashThread: (
    env: any,
    userId: string,
    workspaceId: string | null | undefined,
    threadId: string
  ) => Promise<void>;
};

export function buildGoogleProvider(
  env: any,
  userId: string,
  workspaceId: string | null,
  _identity: MailIdentity,
  dependencies: GoogleProviderDependencies
): MailProviderAdapter {
  return {
    async listFolders() {
      const labels = await dependencies.fetchLabels(env, userId, workspaceId);
      return labels
        .filter((entry) => entry && typeof entry === "object")
        .map((entry) => ({
          id: (entry.id || "").toString(),
          name: (entry.name || entry.id || "").toString(),
        }))
        .filter((entry) => entry.id);
    },

    async listThreads(opts: { folder?: string; limit: number }) {
      const inbox = await dependencies.fetchInbox(
        env,
        userId,
        workspaceId,
        opts.limit,
        opts.folder
      );
      if (!Array.isArray(inbox)) {
        return [];
      }
      return inbox
        .map((entry: any) => {
          if (!entry || typeof entry !== "object") {
            return null;
          }
          const id = (entry.id || entry.threadId)?.toString() || "";
          if (!id) {
            return null;
          }
          return {
            id,
            from: (entry.from || entry.fromName || entry.fromAddress || "").toString(),
            subject: (entry.subject || "").toString(),
            snippet: (entry.snippet || entry.body || "").toString(),
            date: (entry.date || entry.receivedAt || "").toString(),
            unread: Boolean(entry.unread),
          };
        })
        .filter((item): item is { id: string; from: string; subject: string; snippet: string; date: string; unread: boolean } => Boolean(item));
    },

    async getThread(threadId: string) {
      if (!threadId) {
        return null;
      }
      return dependencies.fetchThread(env, userId, workspaceId, threadId);
    },

    async getMessage(messageId: string) {
      if (!messageId) {
        return null;
      }
      return dependencies.fetchMessage(env, userId, workspaceId, messageId);
    },

    async sendMail(payload: any) {
      return dependencies.sendMail(env, userId, workspaceId, payload);
    },

    async trashThread(threadId: string) {
      if (!threadId) return;
      return dependencies.trashThread(env, userId, workspaceId, threadId);
    },
  };
}
