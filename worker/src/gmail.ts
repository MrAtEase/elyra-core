import { base64url } from './rfc822';
const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1";

export async function listInbox(accessToken: string) {
  const r = await fetch(`${GMAIL_BASE}/users/me/messages?maxResults=10&q=label:INBOX is:unread newer_than:7d`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!r.ok) throw new Error(await r.text());
  const { messages } = await r.json();
  if (!messages) return [];
  const full = await Promise.all(messages.map(async (m: any) => {
    const rr = await fetch(`${GMAIL_BASE}/users/me/messages/${m.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return rr.json();
  }));
  return full;
}

export async function sendEmail(accessToken: string, { to, subject, text }: { to: string; subject: string; text: string; }) {
  const raw = [
    `To: ${to}`,
    `Subject: ${subject}`,
    "Content-Type: text/plain; charset=UTF-8",
    "",
    text
  ].join("\r\n");
  const body = { raw: base64url(raw) };
  const r = await fetch(`${GMAIL_BASE}/users/me/messages/send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
