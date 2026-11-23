import { registerTool } from "./registry.js";
import { getGoogleAccessToken } from "./google-auth.js";
import { logger } from "../lib/logger.js";

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3/files";
const GOOGLE_DOC_MIME = "application/vnd.google-apps.document";

async function driveFetch(
  accessToken: string,
  path: string,
  options?: RequestInit,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${DRIVE_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  return (await response.json()) as Record<string, unknown>;
}

registerTool("drive.list", async (input, workspaceId) => {
  const token = await getGoogleAccessToken(workspaceId);
  if (!token) {
    return { text: "Google Drive not connected. Please connect your Google account in Settings.", connected: false };
  }

  const query = typeof input["query"] === "string" ? input["query"] : "";
  const rawMaxResults = Number(input["maxResults"]);
  const maxResults = Number.isFinite(rawMaxResults)
    ? Math.max(1, Math.min(Math.trunc(rawMaxResults), 100))
    : 20;

  const params = new URLSearchParams({
    pageSize: String(maxResults),
    fields: "files(id,name,mimeType,modifiedTime,webViewLink,parents)",
    orderBy: "modifiedTime desc",
  });
  if (query.trim()) {
    params.set("q", query);
  }

  const data = await driveFetch(token, `/files?${params.toString()}`);
  const files = ((data["files"] as Array<Record<string, unknown>>) ?? []).map((file) => ({
    id: file["id"],
    name: file["name"],
    mimeType: file["mimeType"],
    modifiedTime: file["modifiedTime"],
    webViewLink: file["webViewLink"],
  }));

  logger.debug({ count: files.length }, "drive.list");
  return { files, text: `Found ${files.length} files in Drive` };
});

registerTool("drive.create", async (input, workspaceId) => {
  const token = await getGoogleAccessToken(workspaceId);
  if (!token) {
    return { text: "Google Drive not connected.", connected: false };
  }

  const name = typeof input["name"] === "string" ? input["name"].trim() : "";
  const content = typeof input["content"] === "string" ? input["content"] : "";
  const mimeType =
    typeof input["mimeType"] === "string" && input["mimeType"].trim()
      ? input["mimeType"]
      : GOOGLE_DOC_MIME;

  if (!name) {
    return { text: "Missing required field: name" };
  }

  const metadata = { name, mimeType };

  if (mimeType === GOOGLE_DOC_MIME) {
    const created = await driveFetch(token, "/files", {
      method: "POST",
      body: JSON.stringify(metadata),
    });

    const fileId = created["id"];
    return {
      fileId,
      text: `Created Google Doc: ${name}`,
      webViewLink: typeof fileId === "string" ? `https://docs.google.com/document/d/${fileId}/edit` : null,
      note: content
        ? "Document content insertion is not implemented yet; created empty document."
        : undefined,
    };
  }

  const boundary = `elyra_boundary_${Date.now()}`;
  const body = [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify({ name, mimeType }),
    `--${boundary}`,
    "Content-Type: text/plain",
    "",
    content,
    `--${boundary}--`,
  ].join("\r\n");

  const response = await fetch(`${DRIVE_UPLOAD_API}?uploadType=multipart`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  const created = (await response.json()) as Record<string, unknown>;

  return {
    fileId: created["id"],
    text: `Created file: ${name}`,
    webViewLink: created["webViewLink"],
  };
});
