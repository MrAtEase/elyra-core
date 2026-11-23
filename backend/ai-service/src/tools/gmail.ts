import { registerTool } from "./registry.js";
import { getGoogleAccessToken } from "./google-auth.js";
import { logger } from "../lib/logger.js";

const GMAIL_API = "https://www.googleapis.com/gmail/v1/users/me";

async function gmailFetch(
  accessToken: string,
  path: string,
  options?: RequestInit,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${GMAIL_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });
  return (await res.json()) as Record<string, unknown>;
}

registerTool("gmail.list", async (input, workspaceId) => {
  const token = await getGoogleAccessToken(workspaceId);
  if (!token) {
    return { text: "Gmail not connected. Please connect your Google account in Settings.", connected: false };
  }

  const query = (input["query"] as string) ?? "is:inbox";
  const maxResults = (input["maxResults"] as number) ?? 10;

  const listData = await gmailFetch(token, `/messages?q=${encodeURIComponent(query)}&maxResults=${maxResults}`);
  const messageIds = ((listData["messages"] as Array<{ id: string }>) ?? []).map((m) => m.id);

  // Fetch message details (batch simplified to sequential)
  const emails = [];
  for (const msgId of messageIds.slice(0, maxResults)) {
    const msg = await gmailFetch(token, `/messages/${msgId}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`);
    const headers = (msg["payload"] as Record<string, unknown>)?.["headers"] as Array<{ name: string; value: string }> | undefined;
    emails.push({
      id: msgId,
      threadId: msg["threadId"],
      snippet: msg["snippet"],
      subject: headers?.find((h) => h.name === "Subject")?.value ?? "",
      from: headers?.find((h) => h.name === "From")?.value ?? "",
      date: headers?.find((h) => h.name === "Date")?.value ?? "",
    });
  }

  logger.debug({ count: emails.length }, "gmail.list");
  return { emails, text: `Found ${emails.length} emails` };
});

registerTool("gmail.send", async (input, workspaceId) => {
  const token = await getGoogleAccessToken(workspaceId);
  if (!token) {
    return { text: "Gmail not connected.", connected: false };
  }

  const to = input["to"] as string;
  const subject = input["subject"] as string;
  const body = input["body"] as string;

  const raw = btoa(
    `To: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}`,
  )
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const result = await gmailFetch(token, "/messages/send", {
    method: "POST",
    body: JSON.stringify({ raw }),
  });

  return { messageId: result["id"], text: `Email sent to ${to}` };
});

registerTool("gmail.reply", async (input, workspaceId) => {
  const token = await getGoogleAccessToken(workspaceId);
  if (!token) {
    return { text: "Gmail not connected.", connected: false };
  }

  const threadId = input["threadId"] as string;
  const body = input["body"] as string;

  // Get thread to find last message
  const thread = await gmailFetch(token, `/threads/${threadId}?format=metadata`);
  const messages = (thread["messages"] as Array<Record<string, unknown>>) ?? [];
  const lastMsg = messages[messages.length - 1];
  const headers = (lastMsg?.["payload"] as Record<string, unknown>)?.["headers"] as Array<{ name: string; value: string }> | undefined;
  const subject = headers?.find((h) => h.name === "Subject")?.value ?? "";
  const from = headers?.find((h) => h.name === "From")?.value ?? "";

  const raw = btoa(
    `To: ${from}\r\nSubject: Re: ${subject}\r\nIn-Reply-To: ${lastMsg?.["id"]}\r\nReferences: ${lastMsg?.["id"]}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}`,
  )
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const result = await gmailFetch(token, "/messages/send", {
    method: "POST",
    body: JSON.stringify({ raw, threadId }),
  });

  return { messageId: result["id"], text: `Reply sent in thread ${threadId}` };
});
