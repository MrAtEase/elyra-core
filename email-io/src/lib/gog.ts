import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export interface GogGmailMessage {
  id: string;
  threadId: string;
  snippet: string;
}

export async function listGmailMessages(limit: number = 10): Promise<GogGmailMessage[]> {
  const account = process.env.GOG_ACCOUNT || 'elly@elyra-core.app';
  try {
    const { stdout } = await execAsync(`gog gmail list --account ${account} --limit ${limit} --json`);
    return JSON.parse(stdout);
  } catch (error) {
    console.error('Error calling gog gmail list:', error);
    throw new Error('Failed to retrieve Gmail messages via gog');
  }
}

export async function getGmailMessage(messageId: string): Promise<any> {
  const account = process.env.GOG_ACCOUNT || 'elly@elyra-core.app';
  try {
    const { stdout } = await execAsync(`gog gmail get ${messageId} --account ${account} --json`);
    return JSON.parse(stdout);
  } catch (error) {
    console.error(`Error calling gog gmail get for ${messageId}:`, error);
    throw new Error(`Failed to retrieve Gmail message ${messageId} via gog`);
  }
}

export async function sendGmailMessage(to: string, subject: string, body: string): Promise<{ id: string }> {
  const account = process.env.GOG_ACCOUNT || 'elly@elyra-core.app';
  try {
    // Escaping simple body for shell, though complex cases might need better handling
    const { stdout } = await execAsync(
      `gog gmail send --account ${account} --to "${to}" --subject "${subject}" --body "${body}" --json`
    );
    return JSON.parse(stdout);
  } catch (error) {
    console.error('Error calling gog gmail send:', error);
    throw new Error('Failed to send Gmail message via gog');
  }
}
