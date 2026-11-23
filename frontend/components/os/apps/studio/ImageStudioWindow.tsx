"use client";

import { useCallback, useRef, useState } from "react";
import { AlertCircle, Download, ImagePlus, Loader2, Sparkles, Trash2, Upload, Wand2 } from "lucide-react";
import { withSupabaseAuthorization } from "@/lib/auth/clientAuthHeaders";

// ── Types ─────────────────────────────────────────────────────────────────────

type AspectRatio = "1:1" | "16:9" | "9:16" | "4:3" | "3:4";

type GeneratedImage = {
  dataUrl: string;
  mimeType: string;
};

type GenerateResponse = {
  ok: boolean;
  images?: GeneratedImage[];
  error?: string;
};

const ASPECT_RATIO_OPTIONS: { value: AspectRatio; label: string }[] = [
  { value: "1:1", label: "Square (1:1)" },
  { value: "16:9", label: "Landscape (16:9)" },
  { value: "9:16", label: "Portrait (9:16)" },
  { value: "4:3", label: "Photo (4:3)" },
  { value: "3:4", label: "Portrait Photo (3:4)" },
];

type Props = {
  workspaceId: string;
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function ImageStudioWindow({ workspaceId }: Props) {
  const [prompt, setPrompt] = useState("");
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("1:1");
  const [referenceFile, setReferenceFile] = useState<{ name: string; base64: string; mimeType: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [images, setImages] = useState<GeneratedImage[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load reference image from file picker
  const handleReferenceFile = useCallback((files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      // Strip the "data:image/...;base64," prefix — we need raw base64
      const base64 = dataUrl.split(",")[1] ?? "";
      setReferenceFile({ name: file.name, base64, mimeType: file.type });
    };
    reader.readAsDataURL(file);
  }, []);

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim()) return;
    setLoading(true);
    setError(null);
    setImages([]);

    try {
      const headers = await withSupabaseAuthorization({ "Content-Type": "application/json" });

      const res = await fetch("/api/os/generate/image", {
        method: "POST",
        headers,
        body: JSON.stringify({
          prompt: prompt.trim(),
          workspaceId,
          aspectRatio,
          referenceImageBase64: referenceFile?.base64 ?? undefined,
          referenceImageMimeType: referenceFile?.mimeType ?? undefined,
        }),
      });

      const data = (await res.json()) as GenerateResponse;

      if (!data.ok || !data.images?.length) {
        throw new Error(data.error ?? "Generation failed with no images returned.");
      }

      setImages(data.images);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Image generation failed.");
    } finally {
      setLoading(false);
    }
  }, [prompt, aspectRatio, referenceFile, workspaceId]);

  const handleDownload = useCallback((image: GeneratedImage, index: number) => {
    const ext = image.mimeType.split("/")[1] ?? "png";
    const a = document.createElement("a");
    a.href = image.dataUrl;
    a.download = `elyra-image-${Date.now()}-${index + 1}.${ext}`;
    a.click();
  }, []);

  return (
    <div className="flex h-full w-full overflow-hidden bg-[color:var(--bg-surface)] text-[color:var(--text-primary)]">
      {/* ── Left panel: Controls ────────────────────────────────────────────── */}
      <aside
        className="flex w-72 shrink-0 flex-col gap-0 overflow-y-auto border-r"
        style={{ borderColor: "var(--os-border-soft)" }}
      >
        {/* Header */}
        <div
          className="flex items-center gap-2 border-b px-4 py-3"
          style={{ borderColor: "var(--os-border-soft)" }}
        >
          <Wand2 size={15} className="text-fuchsia-400 shrink-0" />
          <span className="text-sm font-semibold tracking-tight">Image Studio</span>
        </div>

        <div className="flex flex-col gap-4 p-4">
          {/* Prompt */}
          <div className="flex flex-col gap-1.5">
            <label className="flex items-center gap-1.5 text-xs font-medium text-[color:var(--text-secondary)]">
              <Sparkles size={11} className="text-fuchsia-400" />
              Describe your image
            </label>
            <textarea
              rows={5}
              placeholder="A futuristic city skyline at golden hour, photorealistic, wide angle..."
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              disabled={loading}
              className="w-full resize-none rounded-lg border bg-[color:var(--bg-elevated)] px-2.5 py-1.5 text-xs leading-relaxed placeholder:text-[color:var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-fuchsia-400/40 disabled:opacity-50"
              style={{ borderColor: "var(--os-border-soft)" }}
            />
          </div>

          {/* Aspect ratio */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-[color:var(--text-secondary)]">Aspect ratio</label>
            <select
              value={aspectRatio}
              onChange={(e) => setAspectRatio(e.target.value as AspectRatio)}
              disabled={loading}
              className="w-full rounded-lg border bg-[color:var(--bg-elevated)] px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-fuchsia-400/40 disabled:opacity-50"
              style={{ borderColor: "var(--os-border-soft)" }}
            >
              {ASPECT_RATIO_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {/* Reference image */}
          <div className="flex flex-col gap-1.5">
            <label className="flex items-center gap-1.5 text-xs font-medium text-[color:var(--text-secondary)]">
              <ImagePlus size={11} />
              Reference photo (optional)
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={(e) => handleReferenceFile(e.target.files)}
              disabled={loading}
              className="hidden"
            />
            {referenceFile ? (
              <div
                className="flex items-center justify-between rounded-lg border px-2.5 py-2 text-xs"
                style={{ borderColor: "var(--os-border-soft)", background: "var(--bg-elevated)" }}
              >
                <span className="min-w-0 truncate text-[color:var(--text-secondary)]" title={referenceFile.name}>
                  {referenceFile.name}
                </span>
                <button
                  type="button"
                  onClick={() => setReferenceFile(null)}
                  disabled={loading}
                  className="ml-2 shrink-0 text-[color:var(--text-muted)] transition hover:text-red-400"
                >
                  <Trash2 size={11} />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={loading}
                className="flex items-center justify-center gap-2 rounded-lg border bg-[color:var(--bg-elevated)] px-2.5 py-2 text-xs transition hover:border-fuchsia-400/30 disabled:opacity-50"
                style={{ borderColor: "var(--os-border-soft)", color: "var(--text-secondary)" }}
              >
                <Upload size={12} />
                Upload reference photo
              </button>
            )}
            {referenceFile && (
              <p className="text-[10px] text-[color:var(--text-muted)]">
                Elly will use this photo as a style/composition reference for the generated image.
              </p>
            )}
          </div>

          {/* Generate button */}
          <button
            type="button"
            onClick={() => void handleGenerate()}
            disabled={loading || !prompt.trim()}
            className="flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-40"
            style={{
              background:
                !loading && prompt.trim()
                  ? "linear-gradient(135deg, #c026d3, #7c3aed)"
                  : "var(--bg-elevated)",
              color: !loading && prompt.trim() ? "#fff" : "var(--text-muted)",
            }}
          >
            {loading ? (
              <><Loader2 size={14} className="animate-spin" /> Generating…</>
            ) : (
              <><Wand2 size={14} /> Generate Image</>
            )}
          </button>

          {/* Error */}
          {error && (
            <div
              className="flex items-start gap-2 rounded-lg border p-2.5 text-xs"
              style={{ borderColor: "rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.08)", color: "#fca5a5" }}
            >
              <AlertCircle size={12} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>
      </aside>

      {/* ── Right panel: Image output ───────────────────────────────────────── */}
      <main className="flex flex-1 flex-col items-center justify-center overflow-y-auto p-6">
        {loading ? (
          <div className="flex flex-col items-center gap-3 text-[color:var(--text-muted)]">
            <Loader2 size={28} className="animate-spin text-fuchsia-400" />
            <p className="text-sm">Generating your image…</p>
            <p className="text-xs">This usually takes 5–15 seconds.</p>
          </div>
        ) : images.length > 0 ? (
          <div className="flex w-full max-w-2xl flex-col gap-4">
            {images.map((image, index) => (
              <div
                key={index}
                className="group relative overflow-hidden rounded-2xl border shadow-2xl"
                style={{ borderColor: "var(--os-border-soft)" }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={image.dataUrl}
                  alt={`Generated image ${index + 1}`}
                  className="w-full object-contain"
                  style={{ maxHeight: "640px" }}
                />
                {/* Hover overlay with download button */}
                <div className="absolute inset-0 flex items-end justify-end p-3 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    type="button"
                    onClick={() => handleDownload(image, index)}
                    className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold backdrop-blur-md"
                    style={{ background: "rgba(0,0,0,0.7)", color: "#fff" }}
                  >
                    <Download size={12} />
                    Download
                  </button>
                </div>
              </div>
            ))}
            <p className="text-center text-[10px] text-[color:var(--text-muted)]">
              {images.length} image{images.length > 1 ? "s" : ""} generated · Hover to download
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4 text-center">
            <div
              className="flex h-20 w-20 items-center justify-center rounded-3xl"
              style={{ background: "linear-gradient(135deg, rgba(192,38,211,0.15), rgba(124,58,237,0.15))" }}
            >
              <Wand2 size={36} className="text-fuchsia-400" />
            </div>
            <div>
              <p className="text-sm font-semibold">Create with Elly</p>
              <p className="mt-1 max-w-xs text-xs text-[color:var(--text-muted)]">
                Describe the image you want to create. Optionally upload a reference photo for style guidance.
              </p>
            </div>
            <div className="mt-2 flex flex-col items-start gap-1.5 rounded-xl border p-3 text-left text-[10px] text-[color:var(--text-muted)]" style={{ borderColor: "var(--os-border-soft)", background: "var(--bg-elevated)" }}>
              <p className="font-semibold text-[color:var(--text-secondary)]">Example prompts</p>
              <p>• A minimalist logo for a tech startup, clean white background</p>
              <p>• Product photo of a coffee mug on a marble surface, studio lighting</p>
              <p>• Abstract watercolor painting with blue and purple tones</p>
              <p>• Futuristic UI dashboard screenshot, dark theme, sci-fi style</p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
