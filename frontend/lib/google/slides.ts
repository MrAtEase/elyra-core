import { googleApiFetch } from "@/lib/google/http";

export type GoogleSlidesPresentation = {
  presentationId: string;
  title: string;
  openUrl: string;
  firstSlideId?: string;
};

type SlidesCreateResponse = {
  presentationId?: string;
  title?: string;
  slides?: Array<{
    objectId?: string;
  }>;
};

type SlidesBatchUpdateResponse = {
  presentationId?: string;
  replies?: unknown[];
  writeControl?: Record<string, unknown>;
};

function openUrlForPresentation(presentationId: string): string {
  return `https://docs.google.com/presentation/d/${presentationId}/edit`;
}

export async function createSlidesPresentation(input: {
  accessToken: string;
  title: string;
}): Promise<GoogleSlidesPresentation> {
  const response = await googleApiFetch<SlidesCreateResponse>(
    "https://slides.googleapis.com/v1/presentations",
    input.accessToken,
    {
      method: "POST",
      body: JSON.stringify({ title: input.title.trim() }),
    },
  );
  if (!response.presentationId) {
    throw new Error("Google Slides create returned invalid payload.");
  }
  return {
    presentationId: response.presentationId,
    title: response.title?.trim() || input.title.trim(),
    openUrl: openUrlForPresentation(response.presentationId),
    ...(typeof response.slides?.[0]?.objectId === "string" ? { firstSlideId: response.slides[0].objectId } : {}),
  };
}

export async function batchUpdateSlides(input: {
  accessToken: string;
  presentationId: string;
  requests: Array<Record<string, unknown>>;
}): Promise<{
  presentationId: string;
  openUrl: string;
  replies: unknown[];
}> {
  const response = await googleApiFetch<SlidesBatchUpdateResponse>(
    `https://slides.googleapis.com/v1/presentations/${encodeURIComponent(input.presentationId)}:batchUpdate`,
    input.accessToken,
    {
      method: "POST",
      body: JSON.stringify({ requests: input.requests }),
    },
  );
  const presentationId = response.presentationId || input.presentationId;
  return {
    presentationId,
    openUrl: openUrlForPresentation(presentationId),
    replies: Array.isArray(response.replies) ? response.replies : [],
  };
}

export async function exportSlidesPdf(input: {
  accessToken: string;
  presentationId: string;
}): Promise<{
  presentationId: string;
  fileName: string;
  bytes: number;
  openUrl: string;
  exportUrl: string;
}> {
  const exportEndpoint = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(input.presentationId)}/export?mimeType=application/pdf`;
  const response = await fetch(exportEndpoint, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      Accept: "application/pdf",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const errorPayload = await response.json().catch(() => null);
    const message = typeof (errorPayload as { error?: { message?: string } } | null)?.error?.message === "string"
      ? (errorPayload as { error: { message: string } }).error.message
      : `Google Slides export failed (${response.status})`;
    throw new Error(message);
  }

  const bytes = (await response.arrayBuffer()).byteLength;
  const openUrl = openUrlForPresentation(input.presentationId);
  return {
    presentationId: input.presentationId,
    fileName: `slides-${input.presentationId}.pdf`,
    bytes,
    openUrl,
    exportUrl: openUrl.replace("/edit", "/export/pdf"),
  };
}
