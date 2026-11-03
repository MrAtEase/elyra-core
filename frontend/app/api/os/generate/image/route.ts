/**
 * POST /api/os/generate/image
 *
 * Generate images from a text prompt with an optional reference image for style guidance.
 *
 * Body:
 *   prompt                 — text description of the image to generate
 *   workspaceId            — required for auth check
 *   referenceImageBase64   — (optional) base64-encoded reference image (no data: prefix)
 *   referenceImageMimeType — (optional) MIME type of reference, e.g. "image/jpeg"
 *   aspectRatio            — (optional) "1:1" | "16:9" | "9:16" | "4:3" | "3:4"
 *
 * Response:
 *   { ok: true, images: Array<{ dataUrl: string, mimeType: string }> }
 */

import { NextRequest, NextResponse } from "next/server";
import { fetchWhoamiPayload, hasWorkspaceAccess } from "@/lib/api/whoamiClient";
import { generateImage, type AspectRatio } from "@/lib/imagen/client";

export const runtime = "nodejs";
export const maxDuration = 60;

type GenerateImageBody = {
  prompt?: string;
  workspaceId?: string;
  referenceImageBase64?: string;
  referenceImageMimeType?: string;
  aspectRatio?: AspectRatio;
};

const ALLOWED_ASPECT_RATIOS: AspectRatio[] = ["1:1", "16:9", "9:16", "4:3", "3:4"];

export async function POST(request: NextRequest) {
  // Parse body
  const body = (await request.json().catch(() => ({}))) as GenerateImageBody;

  const prompt = (body.prompt ?? "").trim();
  const workspaceId = (body.workspaceId ?? "").trim();
  const referenceImageBase64 = (body.referenceImageBase64 ?? "").trim() || undefined;
  const referenceImageMimeType = (body.referenceImageMimeType ?? "image/jpeg").trim();
  const aspectRatio: AspectRatio = ALLOWED_ASPECT_RATIOS.includes(body.aspectRatio as AspectRatio)
    ? (body.aspectRatio as AspectRatio)
    : "1:1";

  if (!prompt) {
    return NextResponse.json({ ok: false, error: "prompt is required." }, { status: 400 });
  }
  if (!workspaceId) {
    return NextResponse.json({ ok: false, error: "workspaceId is required." }, { status: 400 });
  }

  // Auth check
  const whoamiResult = await fetchWhoamiPayload(request).catch(() => null);
  if (!whoamiResult?.response.ok || !whoamiResult.payload) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }
  if (!hasWorkspaceAccess(whoamiResult.payload, workspaceId)) {
    return NextResponse.json({ ok: false, error: "No access to this workspace." }, { status: 403 });
  }

  // Generate images
  try {
    const images = await generateImage({
      prompt,
      ...(referenceImageBase64 ? { referenceImageBase64 } : {}),
      referenceImageMimeType,
      aspectRatio,
    });

    return NextResponse.json({ ok: true, images });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Image generation failed.";
    console.error("[/api/os/generate/image] Error:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
