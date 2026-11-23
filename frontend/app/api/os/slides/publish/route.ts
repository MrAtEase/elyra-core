import { NextRequest, NextResponse } from "next/server";
import { getWhoamiEndpoint } from "@/utils/auth-guard";
import type { WhoamiResponse } from "@/types/whoami";
import { resolveWorkerSessionHeaders } from "@/lib/auth/workerSessionHeaders";
import { normalizeWorkspaceId } from "@/lib/workspace/normalizeWorkspaceId";
import { ensureGoogleAccessToken } from "@/lib/google/tokenStore";
import { GOOGLE_PRESENTATIONS_SCOPE } from "@/lib/google/scopes";
import { batchUpdateSlides, createSlidesPresentation } from "@/lib/google/slides";

type PublishSlide = {
  title: string;
  body?: string;
  bullets?: string[];
};

type PublishRequest = {
  workspaceId?: string;
  title?: string;
  slides?: PublishSlide[];
};

function ensureText(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function isPublishSlide(value: unknown): value is PublishSlide {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return typeof row.title === "string";
}

async function fetchWhoami(request: NextRequest) {
  const headers = resolveWorkerSessionHeaders(request);
  const response = await fetch(getWhoamiEndpoint(), { method: "GET", headers, cache: "no-store" });
  const payload = await response.json().catch(() => null);
  return { response, payload } as { response: Response; payload: WhoamiResponse | null };
}

function activeWorkspaceId(payload: WhoamiResponse): string | null {
  return payload.activeWorkspace?.id || payload.session?.activeWorkspaceId || payload.workspaceId || null;
}

function collectWorkspaceCandidates(payload: WhoamiResponse): Set<string> {
  const values = new Set<string>();
  const add = (candidate: string | null | undefined) => {
    if (!candidate?.trim()) return;
    values.add(candidate);
    const normalized = normalizeWorkspaceId(candidate);
    if (normalized) values.add(normalized);
  };
  add(payload.activeWorkspace?.id);
  add(payload.activeWorkspace?.slug);
  add(payload.session?.activeWorkspaceId);
  add(payload.workspaceId);
  for (const workspace of payload.workspaces ?? []) {
    add(workspace.id);
    add(workspace.slug);
  }
  return values;
}

function buildDeckRequests(slides: PublishSlide[], firstSlideId?: string): Array<Record<string, unknown>> {
  const requests: Array<Record<string, unknown>> = [];

  if (firstSlideId) {
    requests.push({
      deleteObject: {
        objectId: firstSlideId,
      },
    });
  }

  slides.forEach((slide, index) => {
    const slideId = `slide_${index + 1}`;
    const titleId = `slide_${index + 1}_title`;
    const bodyId = `slide_${index + 1}_body`;
    const bodyLines = Array.isArray(slide.bullets) && slide.bullets.length > 0
      ? slide.bullets.map((bullet) => `• ${bullet}`)
      : [ensureText(slide.body)];
    const bodyText = bodyLines.filter(Boolean).join("\n");

    requests.push({
      createSlide: {
        objectId: slideId,
        insertionIndex: index,
        slideLayoutReference: {
          predefinedLayout: "BLANK",
        },
      },
    });
    requests.push({
      createShape: {
        objectId: titleId,
        shapeType: "TEXT_BOX",
        elementProperties: {
          pageObjectId: slideId,
          size: {
            width: { magnitude: 600, unit: "PT" },
            height: { magnitude: 70, unit: "PT" },
          },
          transform: {
            scaleX: 1,
            scaleY: 1,
            translateX: 40,
            translateY: 36,
            unit: "PT",
          },
        },
      },
    });
    requests.push({
      insertText: {
        objectId: titleId,
        insertionIndex: 0,
        text: slide.title.trim(),
      },
    });
    requests.push({
      updateTextStyle: {
        objectId: titleId,
        style: {
          bold: true,
          fontSize: { magnitude: index === 0 ? 28 : 24, unit: "PT" },
        },
        textRange: { type: "ALL" },
        fields: "bold,fontSize",
      },
    });

    if (bodyText) {
      requests.push({
        createShape: {
          objectId: bodyId,
          shapeType: "TEXT_BOX",
          elementProperties: {
            pageObjectId: slideId,
            size: {
              width: { magnitude: 600, unit: "PT" },
              height: { magnitude: 300, unit: "PT" },
            },
            transform: {
              scaleX: 1,
              scaleY: 1,
              translateX: 44,
              translateY: index === 0 ? 150 : 128,
              unit: "PT",
            },
          },
        },
      });
      requests.push({
        insertText: {
          objectId: bodyId,
          insertionIndex: 0,
          text: bodyText,
        },
      });
      requests.push({
        updateTextStyle: {
          objectId: bodyId,
          style: {
            fontSize: { magnitude: 16, unit: "PT" },
          },
          textRange: { type: "ALL" },
          fields: "fontSize",
        },
      });
    }
  });

  return requests;
}

export async function POST(request: NextRequest) {
  const { response, payload } = await fetchWhoami(request);
  if (!response.ok || !payload) {
    return NextResponse.json({ ok: false, error: "Unable to validate session." }, { status: response.status });
  }

  const body = (await request.json().catch(() => null)) as PublishRequest | null;
  const slides = Array.isArray(body?.slides) ? body.slides.filter(isPublishSlide) : [];
  const workspaceIdRaw = normalizeWorkspaceId(body?.workspaceId) ?? body?.workspaceId ?? null;
  const sessionWorkspaceIdRaw = activeWorkspaceId(payload);
  const sessionWorkspaceId = normalizeWorkspaceId(sessionWorkspaceIdRaw) ?? sessionWorkspaceIdRaw;
  const allowedWorkspaceIds = collectWorkspaceCandidates(payload);

  if (!sessionWorkspaceId || !workspaceIdRaw || (!allowedWorkspaceIds.has(workspaceIdRaw) && workspaceIdRaw !== sessionWorkspaceId)) {
    return NextResponse.json({ ok: false, error: "Workspace scope mismatch." }, { status: 403 });
  }

  if (!body?.title?.trim() || slides.length === 0) {
    return NextResponse.json({ ok: false, error: "Deck title and at least one slide are required." }, { status: 400 });
  }

  try {
    const token = await ensureGoogleAccessToken({
      workspaceId: workspaceIdRaw,
      requiredScopes: [GOOGLE_PRESENTATIONS_SCOPE],
    });
    const created = await createSlidesPresentation({
      accessToken: token.accessToken,
      title: body.title.trim(),
    });
    const requests = buildDeckRequests(slides, created.firstSlideId);
    const updated = await batchUpdateSlides({
      accessToken: token.accessToken,
      presentationId: created.presentationId,
      requests,
    });

    return NextResponse.json({
      ok: true,
      presentationId: updated.presentationId,
      openUrl: updated.openUrl,
      title: created.title,
      slidesApplied: slides.length,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to publish Google Slides deck." },
      { status: 500 },
    );
  }
}
