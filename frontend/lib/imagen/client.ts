/**
 * Image generation client for Elyra.
 *
 * Primary path: Gemini image generation API
 *   Model: gemini-3.1-flash-image (Nano Banana 2) with fallbacks (or IMAGEN_GEMINI_MODEL env var)
 *   Auth: GEMINI_API_KEY (same key used for text generation)
 *
 * Fallback path: Vertex AI Imagen (when IMAGEN_PROJECT_ID is set)
 *   Model: imagen-3.0-generate-002 (or IMAGEN_MODEL env var)
 *   Auth: Google ADC / gcloud access token
 *
 * Usage:
 *   const images = await generateImage({ prompt: "...", referenceImageBase64: "..." });
 *   // images[0].dataUrl → "data:image/png;base64,..."
 */

import { execFile } from "node:child_process";

// ── Types ────────────────────────────────────────────────────────────────────

export type AspectRatio = "1:1" | "16:9" | "9:16" | "4:3" | "3:4";

export type GenerateImageInput = {
  /** Text prompt describing the image to generate */
  prompt: string;
  /** Optional base64-encoded reference image for style guidance (no data: prefix) */
  referenceImageBase64?: string;
  /** MIME type of the reference image, e.g. "image/jpeg" */
  referenceImageMimeType?: string;
  /** Desired aspect ratio (Imagen only; Gemini uses fixed square) */
  aspectRatio?: AspectRatio;
  /** AbortSignal for cancellation */
  signal?: AbortSignal;
};

export type GeneratedImage = {
  /** data: URL ready to use in <img src> */
  dataUrl: string;
  mimeType: string;
};

// ── Gemini image generation (primary) ────────────────────────────────────────

async function generateWithGemini(input: GenerateImageInput): Promise<GeneratedImage[]> {
  const apiKey = process.env.GEMINI_API_KEY ?? "";
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured.");

  // Current Gemini image models ("Nano Banana"); older 2.0/2.5 image models are gone for new keys.
  const models = [
    process.env.IMAGEN_GEMINI_MODEL?.trim() || "gemini-3.1-flash-image",
    "gemini-3.1-flash-lite-image",
    "gemini-nano-banana-2.1",
  ].filter((m, i, a) => a.indexOf(m) === i);

  const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [
    { text: input.prompt },
  ];

  // Optional style reference image
  if (input.referenceImageBase64) {
    parts.push({
      inlineData: {
        mimeType: input.referenceImageMimeType ?? "image/jpeg",
        data: input.referenceImageBase64,
      },
    });
  }

  const body = {
    contents: [{ role: "user", parts }],
    generationConfig: {
      responseModalities: ["IMAGE", "TEXT"],
    },
  };

  let res: Response | null = null;
  let lastError = "";
  for (const model of models) {
    const attempt = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify(body),
        signal: input.signal ?? null,
      },
    );
    if (attempt.ok) {
      res = attempt;
      break;
    }
    lastError = `${model} (${attempt.status}): ${(await attempt.text().catch(() => "")).slice(0, 300)}`;
    // Overloaded / unavailable / not allowed → try the next image model
    if (![404, 429, 503, 400, 403].includes(attempt.status)) break;
  }
  if (!res) {
    throw new Error(`Gemini image generation failed: ${lastError}`);
  }

  const json = (await res.json()) as {
    candidates?: Array<{
      content?: {
        parts?: Array<{
          text?: string;
          inlineData?: { mimeType?: string; data?: string };
        }>;
      };
    }>;
  };

  const images: GeneratedImage[] = [];
  for (const candidate of json.candidates ?? []) {
    for (const part of candidate.content?.parts ?? []) {
      if (part.inlineData?.data && part.inlineData.mimeType) {
        images.push({
          dataUrl: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`,
          mimeType: part.inlineData.mimeType,
        });
      }
    }
  }

  if (images.length === 0) {
    throw new Error("Gemini returned no images. The model may have refused the prompt.");
  }

  return images;
}

// ── Vertex AI Imagen (fallback) ───────────────────────────────────────────────

let _vertexTokenCache: { value: string; expiresAt: number } | null = null;

async function getVertexAccessToken(): Promise<string> {
  const now = Date.now();
  if (_vertexTokenCache && now < _vertexTokenCache.expiresAt - 90_000) {
    return _vertexTokenCache.value;
  }

  // Try ADC JSON file first
  const adcFile =
    process.env.GOOGLE_APPLICATION_CREDENTIALS ??
    `${process.env.HOME ?? ""}/.config/gcloud/application_default_credentials.json`;

  try {
    const adcJson = await import("node:fs").then((fs) =>
      JSON.parse(fs.readFileSync(adcFile, "utf8") as string) as Record<string, unknown>,
    );
    if (adcJson.type === "service_account") {
      // Service account — exchange for access token
      const tokenUrl = (adcJson.token_uri as string | undefined) ?? "https://oauth2.googleapis.com/token";
      const { createSign } = await import("node:crypto");
      const now2 = Math.floor(Date.now() / 1000);
      const payload = btoa(
        JSON.stringify({ alg: "RS256", typ: "JWT" }),
      ) + "." + btoa(JSON.stringify({
        iss: adcJson.client_email,
        scope: "https://www.googleapis.com/auth/cloud-platform",
        aud: tokenUrl,
        exp: now2 + 3600,
        iat: now2,
      }));
      const sign = createSign("RSA-SHA256");
      sign.update(payload);
      const sig = sign.sign(adcJson.private_key as string, "base64")
        .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
      const jwt = `${payload}.${sig}`;
      const tokenRes = await fetch(tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
      });
      if (tokenRes.ok) {
        const data = (await tokenRes.json()) as { access_token?: string; expires_in?: number };
        if (data.access_token) {
          _vertexTokenCache = {
            value: data.access_token,
            expiresAt: now + (data.expires_in ?? 3600) * 1000,
          };
          return data.access_token;
        }
      }
    } else if (adcJson.type === "authorized_user") {
      // User credentials — refresh token flow
      const refreshRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `client_id=${adcJson.client_id}&client_secret=${adcJson.client_secret}&refresh_token=${adcJson.refresh_token}&grant_type=refresh_token`,
      });
      if (refreshRes.ok) {
        const data = (await refreshRes.json()) as { access_token?: string; expires_in?: number };
        if (data.access_token) {
          _vertexTokenCache = {
            value: data.access_token,
            expiresAt: now + (data.expires_in ?? 3600) * 1000,
          };
          return data.access_token;
        }
      }
    }
  } catch {
    // Fall through to gcloud
  }

  // Fallback: gcloud CLI
  return new Promise<string>((resolve, reject) => {
    execFile("gcloud", ["auth", "print-access-token"], { timeout: 10_000 }, (err, stdout) => {
      if (err) return reject(new Error(`gcloud auth failed: ${err.message}`));
      const token = (stdout ?? "").trim();
      if (!token) return reject(new Error("gcloud returned empty access token."));
      _vertexTokenCache = { value: token, expiresAt: now + 55 * 60 * 1000 };
      resolve(token);
    });
  });
}

async function generateWithVertexImagen(input: GenerateImageInput): Promise<GeneratedImage[]> {
  const project = process.env.IMAGEN_PROJECT_ID;
  const location = process.env.IMAGEN_LOCATION ?? "us-central1";
  const model = process.env.IMAGEN_MODEL ?? "imagen-3.0-generate-002";

  if (!project) throw new Error("IMAGEN_PROJECT_ID is not configured for Vertex AI Imagen.");

  const token = await getVertexAccessToken();

  const aspectRatioMap: Record<string, string> = {
    "1:1": "1:1",
    "16:9": "16:9",
    "9:16": "9:16",
    "4:3": "4:3",
    "3:4": "3:4",
  };

  const requestBody: Record<string, unknown> = {
    instances: [
      {
        prompt: input.prompt,
        ...(input.referenceImageBase64
          ? {
              referenceImages: [
                {
                  referenceType: "REFERENCE_TYPE_STYLE",
                  referenceImage: {
                    bytesBase64Encoded: input.referenceImageBase64,
                    mimeType: input.referenceImageMimeType ?? "image/jpeg",
                  },
                },
              ],
            }
          : {}),
      },
    ],
    parameters: {
      sampleCount: 1,
      aspectRatio: aspectRatioMap[input.aspectRatio ?? "1:1"] ?? "1:1",
    },
  };

  const endpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/${model}:predict`;

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(requestBody),
    signal: input.signal ?? null,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Vertex AI Imagen failed (${res.status}): ${errText}`);
  }

  const json = (await res.json()) as {
    predictions?: Array<{ bytesBase64Encoded?: string; mimeType?: string }>;
  };

  const images: GeneratedImage[] = (json.predictions ?? [])
    .filter((pred) => pred.bytesBase64Encoded)
    .map((pred) => ({
      dataUrl: `data:${pred.mimeType ?? "image/png"};base64,${pred.bytesBase64Encoded!}`,
      mimeType: pred.mimeType ?? "image/png",
    }));

  if (images.length === 0) {
    throw new Error("Vertex AI Imagen returned no images.");
  }

  return images;
}

// ── Public entry point ────────────────────────────────────────────────────────

/**
 * Generate one or more images from a text prompt.
 *
 * Tries Gemini image generation first (simple API key).
 * Falls back to Vertex AI Imagen if IMAGEN_PROJECT_ID is set.
 */
export async function generateImage(input: GenerateImageInput): Promise<GeneratedImage[]> {
  const apiKey = process.env.GEMINI_API_KEY ?? "";
  const hasVertexConfig = Boolean(process.env.IMAGEN_PROJECT_ID);

  if (apiKey) {
    try {
      return await generateWithGemini(input);
    } catch (err) {
      if (!hasVertexConfig) throw err;
      console.warn(
        `[generateImage] Gemini image generation failed (${err instanceof Error ? err.message : String(err)}). Trying Vertex AI Imagen…`,
      );
    }
  }

  if (hasVertexConfig) {
    return generateWithVertexImagen(input);
  }

  throw new Error(
    "Image generation is not configured. Set GEMINI_API_KEY or IMAGEN_PROJECT_ID + Google ADC credentials.",
  );
}
