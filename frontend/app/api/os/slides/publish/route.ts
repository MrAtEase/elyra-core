import { NextRequest, NextResponse } from "next/server";
import { requireWorkspace } from "@/lib/api/requireAuth";
import { ensureGoogleAccessToken } from "@/lib/google/tokenStore";
import { GOOGLE_PRESENTATIONS_SCOPE } from "@/lib/google/scopes";
import { batchUpdateSlides, createSlidesPresentation, writeSpeakerNotes } from "@/lib/google/slides";
import { buildThemedDeckRequests, type ExportSlide } from "@/lib/google/slidesDeckExport";

type PublishSlide = ExportSlide;

type PublishRequest = {
  workspaceId?: string;
  title?: string;
  theme?: string;
  slides?: PublishSlide[];
};

function isPublishSlide(value: unknown): value is PublishSlide {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return typeof row.title === "string";
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as PublishRequest | null;
  const auth = await requireWorkspace(request, typeof body?.workspaceId === "string" ? body.workspaceId : null);
  if (auth instanceof NextResponse) return auth;
  const slides = Array.isArray(body?.slides) ? body.slides.filter(isPublishSlide) : [];

  if (!body?.title?.trim() || slides.length === 0) {
    return NextResponse.json({ ok: false, error: "Titel und mindestens eine Folie sind nötig." }, { status: 400 });
  }

  try {
    const token = await ensureGoogleAccessToken({
      workspaceId: auth.workspaceId,
      userId: auth.userId,
      requiredScopes: [GOOGLE_PRESENTATIONS_SCOPE],
    });
    const created = await createSlidesPresentation({
      accessToken: token.accessToken,
      title: body.title.trim(),
    });
    const { requests, notes } = buildThemedDeckRequests({
      slides,
      deckTitle: body.title.trim(),
      ...(typeof body.theme === "string" ? { theme: body.theme } : {}),
      ...(created.firstSlideId ? { firstSlideId: created.firstSlideId } : {}),
    });
    const updated = await batchUpdateSlides({
      accessToken: token.accessToken,
      presentationId: created.presentationId,
      requests,
    });
    // Speaker notes are a nice-to-have; never fail the export because of them.
    await writeSpeakerNotes({ accessToken: token.accessToken, presentationId: created.presentationId, notes }).catch(() => undefined);

    return NextResponse.json({
      ok: true,
      presentationId: updated.presentationId,
      openUrl: updated.openUrl,
      title: created.title,
      slidesApplied: slides.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/has not been used in project|it is disabled/i.test(message)) {
      const project = /project (\d+)/.exec(message)?.[1];
      return NextResponse.json(
        {
          ok: false,
          code: "api_disabled",
          error: "Die Google Slides API ist im Google-Cloud-Projekt noch nicht aktiviert.",
          enableUrl: `https://console.cloud.google.com/apis/library/slides.googleapis.com${project ? `?project=${project}` : ""}`,
        },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { ok: false, error: message || "Export nach Google Slides fehlgeschlagen." },
      { status: 500 },
    );
  }
}
