import type { MailIdentity, MailProvider } from "./mail-identity";

export interface MailProviderAdapter {
  listFolders(): Promise<Array<{ id: string; name: string }>>;
  listThreads(opts: { folder?: string; limit: number }): Promise<any[]>;
  getThread(threadId: string): Promise<any | null>;
  getMessage(messageId: string): Promise<any>;
  sendMail(payload: any): Promise<any>;
  trashThread?(threadId: string): Promise<void>;
}

export type MailProviderBuilder = (
  env: any,
  userId: string,
  workspaceId: string | null,
  identity: MailIdentity
) => MailProviderAdapter;

export async function resolveMailProvider(
  env: any,
  userId: string,
  workspaceId: string | null,
  identity: MailIdentity,
  builders: Record<MailProvider, MailProviderBuilder | undefined>
): Promise<MailProviderAdapter | null> {
  const builder = builders[identity.provider];
  if (!builder) {
    return null;
  }
  return builder(env, userId, workspaceId, identity);
}
