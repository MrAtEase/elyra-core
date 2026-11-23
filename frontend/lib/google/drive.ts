import { googleApiFetch } from "@/lib/google/http";

export type GoogleDriveFile = {
  id: string;
  name: string;
  mimeType: string;
  webViewLink: string | null;
  parents: string[];
};

type DriveListResponse = {
  files?: Array<{
    id?: string;
    name?: string;
    mimeType?: string;
    webViewLink?: string;
    parents?: string[];
  }>;
};

type DriveFileResponse = {
  id?: string;
  name?: string;
  mimeType?: string;
  webViewLink?: string;
  parents?: string[];
};

function mapDriveFile(file: DriveFileResponse): GoogleDriveFile | null {
  if (!file.id || !file.name || !file.mimeType) return null;
  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    webViewLink: file.webViewLink ?? null,
    parents: Array.isArray(file.parents) ? file.parents.filter(Boolean) : [],
  };
}

export async function searchDriveFiles(input: {
  accessToken: string;
  query: string;
  folderId?: string | null;
  limit?: number;
}): Promise<GoogleDriveFile[]> {
  const limit = Math.max(1, Math.min(100, Math.round(input.limit ?? 20)));
  const url = new URL("https://www.googleapis.com/drive/v3/files");
  const terms: string[] = ["trashed = false"];
  if (input.query.trim()) {
    const q = input.query.trim().replace(/'/g, "\\'");
    terms.push(`(name contains '${q}')`);
  }
  if (input.folderId?.trim()) {
    terms.push(`'${input.folderId.trim().replace(/'/g, "\\'")}' in parents`);
  }
  url.searchParams.set("q", terms.join(" and "));
  url.searchParams.set("pageSize", String(limit));
  url.searchParams.set("fields", "files(id,name,mimeType,webViewLink,parents)");
  url.searchParams.set("supportsAllDrives", "true");
  url.searchParams.set("includeItemsFromAllDrives", "true");

  const response = await googleApiFetch<DriveListResponse>(url, input.accessToken);
  return (response.files ?? []).map(mapDriveFile).filter((file): file is GoogleDriveFile => Boolean(file));
}

export async function createDriveFolder(input: {
  accessToken: string;
  name: string;
  parentFolderId?: string | null;
}): Promise<GoogleDriveFile> {
  const body: Record<string, unknown> = {
    name: input.name.trim(),
    mimeType: "application/vnd.google-apps.folder",
  };
  if (input.parentFolderId?.trim()) {
    body.parents = [input.parentFolderId.trim()];
  }

  const response = await googleApiFetch<DriveFileResponse>(
    "https://www.googleapis.com/drive/v3/files?fields=id,name,mimeType,webViewLink,parents&supportsAllDrives=true",
    input.accessToken,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
  const mapped = mapDriveFile(response);
  if (!mapped) throw new Error("Google Drive create folder returned invalid payload.");
  return mapped;
}

async function getFileParents(accessToken: string, fileId: string): Promise<string[]> {
  const response = await googleApiFetch<DriveFileResponse>(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,parents&supportsAllDrives=true`,
    accessToken,
  );
  return Array.isArray(response.parents) ? response.parents.filter(Boolean) : [];
}

export async function moveDriveFile(input: {
  accessToken: string;
  fileId: string;
  targetFolderId: string;
}): Promise<GoogleDriveFile> {
  const currentParents = await getFileParents(input.accessToken, input.fileId);
  const url = new URL(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(input.fileId)}`,
  );
  url.searchParams.set("addParents", input.targetFolderId);
  if (currentParents.length > 0) {
    url.searchParams.set("removeParents", currentParents.join(","));
  }
  url.searchParams.set("fields", "id,name,mimeType,webViewLink,parents");
  url.searchParams.set("supportsAllDrives", "true");

  const response = await googleApiFetch<DriveFileResponse>(url, input.accessToken, { method: "PATCH" });
  const mapped = mapDriveFile(response);
  if (!mapped) throw new Error("Google Drive move file returned invalid payload.");
  return mapped;
}

function inferContent(input: string): string {
  if (input.startsWith("text:")) return input.slice("text:".length);
  if (input.startsWith("data:text/plain;base64,")) {
    try {
      return Buffer.from(input.slice("data:text/plain;base64,".length), "base64").toString("utf8");
    } catch {
      return input;
    }
  }
  return input;
}

export async function uploadDriveFile(input: {
  accessToken: string;
  folderId?: string | null;
  fileName: string;
  mimeType: string;
  contentRef: string;
}): Promise<GoogleDriveFile> {
  const metadata: Record<string, unknown> = {
    name: input.fileName.trim(),
    mimeType: input.mimeType.trim(),
  };
  if (input.folderId?.trim()) {
    metadata.parents = [input.folderId.trim()];
  }

  const boundary = `elyra-${Math.random().toString(36).slice(2)}`;
  const metadataPart = JSON.stringify(metadata);
  const contentPart = inferContent(input.contentRef);
  const multipartBody =
    `--${boundary}\r\n` +
    "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
    `${metadataPart}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${input.mimeType}\r\n\r\n` +
    `${contentPart}\r\n` +
    `--${boundary}--`;

  const response = await googleApiFetch<DriveFileResponse>(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,webViewLink,parents&supportsAllDrives=true",
    input.accessToken,
    {
      method: "POST",
      headers: {
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body: multipartBody,
    },
  );
  const mapped = mapDriveFile(response);
  if (!mapped) throw new Error("Google Drive upload returned invalid payload.");
  return mapped;
}
