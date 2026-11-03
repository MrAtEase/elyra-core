"use client";

import { forwardRef, useImperativeHandle, useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { type IntentAttachment } from "@/components/os/kernel/types";
import { ArrowUp, ImagePlus, Loader2, RotateCcw, X } from "lucide-react";

/** Handle exposed via forwardRef — allows parent to programmatically focus the input. */
export type IntentLineHandle = { focus: () => void };
/** Re-export so WorkspaceOS can import attachment type from a single location. */
export type { IntentAttachment as IntentLineAttachment } from "@/components/os/kernel/types";
import { SHELL_LAYERS } from "@/components/os/shell/layers";
import { checkAiServiceHealth } from "@/components/os/kernel/aiClient";

function AiStatusDot() {
  const [online, setOnline] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      const ok = await checkAiServiceHealth();
      if (!cancelled) setOnline(ok);
    };
    void check();
    const interval = setInterval(() => { void check(); }, 30_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  if (online === null) return null;

  return (
    <div
      title={online ? "AI: connected (Gemini)" : "AI: disconnected"}
      className="absolute right-[52px] top-1/2 -translate-y-1/2 flex items-center gap-1 select-none pointer-events-none"
    >
      <span
        className={`block h-1.5 w-1.5 rounded-full transition-colors duration-700 ${
          online ? "bg-emerald-400 shadow-[0_0_4px_rgba(52,211,153,0.8)]" : "bg-red-400 shadow-[0_0_4px_rgba(248,113,113,0.8)]"
        }`}
      />
    </div>
  );
}


type IntentLineProps = {
  onSubmit: (text: string, attachments?: IntentAttachment[], provider?: string) => void;
  onClear?: () => void;
  accent: string;
  busy?: boolean;
  rightInset?: number;
};

function withAlpha(hex: string, alpha: number): string {
  const normalized = hex.trim().replace("#", "");
  const expanded = normalized.length === 3
    ? normalized
        .split("")
        .map((part) => `${part}${part}`)
        .join("")
    : normalized;

  if (expanded.length !== 6) return `rgba(255, 255, 255, ${alpha})`;

  const value = Number.parseInt(expanded, 16);
  if (Number.isNaN(value)) return `rgba(255, 255, 255, ${alpha})`;

  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;

  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

const IntentLine = forwardRef<IntentLineHandle, IntentLineProps>(function IntentLine(
  { onSubmit, onClear, accent, busy = false, rightInset = 0 },
  ref
) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
  const [attachments, setAttachments] = useState<IntentAttachment[]>([]);

  const focusBorder = useMemo(() => withAlpha(accent, 0.52), [accent]);
  const focusGlow = useMemo(() => withAlpha(accent, 0.26), [accent]);

  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus(),
  }));

  const [provider, setProvider] = useState("gemini");

  const submit = () => {
    if (busy) return;
    const trimmed = value.trim();
    if (!trimmed && attachments.length === 0) return;
    onSubmit(trimmed, attachments, provider);
    setValue("");
    setAttachments([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter") return;
    if (event.shiftKey) return;
    event.preventDefault();
    submit();
  };

  const onFilesSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const fileList = event.target.files;
    if (!fileList?.length) return;

    const nextFiles = Array.from(fileList).slice(0, 4);
    const loaded = await Promise.all(
      nextFiles.map(
        (file) =>
          new Promise<IntentAttachment | null>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => {
              const result = typeof reader.result === "string" ? reader.result : "";
              const base64 = result.includes(",") ? result.split(",")[1] ?? "" : "";
              if (!base64) {
                resolve(null);
                return;
              }
              resolve({
                id: `${file.name}-${file.lastModified}-${file.size}`,
                name: file.name,
                mimeType: file.type || "application/octet-stream",
                sizeBytes: file.size,
                dataBase64: base64,
              });
            };
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(file);
          }),
      ),
    );

    setAttachments((current) => {
      const merged = [...current];
      for (const item of loaded) {
        if (!item) continue;
        if (merged.some((existing) => existing.id === item.id)) continue;
        merged.push(item);
      }
      return merged.slice(0, 4);
    });
  };

  const clearIntent = () => {
    setValue("");
    setAttachments([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    onClear?.();
  };

  return (
    <div
      className="pointer-events-none fixed bottom-0 left-0 px-4 pb-[max(env(safe-area-inset-bottom),18px)] sm:px-6"
      style={{ zIndex: SHELL_LAYERS.intentLine, right: `${rightInset}px` }}
    >
      <div
        className="pointer-events-auto mx-auto w-full max-w-[960px] rounded-[28px] border px-3 py-[7px] backdrop-blur-xl transition duration-500"
        style={{
          background: "color-mix(in srgb, var(--bg-elevated, #1a1e2e) 88%, transparent)",
          borderColor: focused ? focusBorder : "var(--border-focus, var(--border-subtle, #2a2d36))",
          boxShadow: focused
            ? `0 24px 60px rgba(5, 9, 18, 0.56), 0 0 0 1px ${focusBorder}, 0 0 20px ${focusGlow}`
            : "0 22px 52px rgba(5, 9, 18, 0.46)",
        }}
      >
        <div className="relative flex flex-col gap-2">
          {attachments.length > 0 ? (
            <div className="flex flex-wrap gap-1 px-1 pt-1">
              {attachments.map((attachment) => (
                <span
                  key={attachment.id}
                  className="inline-flex max-w-[220px] items-center gap-1 rounded-full border px-2 py-1 text-[10px]"
                  style={{
                    borderColor: "var(--border-subtle)",
                    background: "color-mix(in srgb, var(--bg-surface, var(--panel, #11131a)) 82%, transparent)",
                    color: "var(--text-secondary)",
                  }}
                  title={attachment.name}
                >
                  <span className="truncate">{attachment.name}</span>
                  <button
                    type="button"
                    onClick={() => setAttachments((current) => current.filter((item) => item.id !== attachment.id))}
                    className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full text-[color:var(--text-muted)] transition hover:text-[color:var(--text-primary)]"
                    aria-label={`Remove ${attachment.name}`}
                  >
                    <X size={9} />
                  </button>
                </span>
              ))}
            </div>
          ) : null}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,.txt,.md,.json,.csv,.pdf"
            onChange={(event) => {
              void onFilesSelected(event);
            }}
            disabled={busy}
            className="hidden"
          />
          <div className="relative flex items-end gap-2">
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            disabled={busy}
            className="h-10 rounded-full border px-3 text-[11px] font-medium outline-none transition duration-500"
            style={{
              borderColor: "var(--border-subtle)",
              background: "color-mix(in srgb, var(--bg-surface, var(--panel, #1a1e2e)) 88%, transparent)",
              color: "var(--text-secondary)",
              appearance: "none",
            }}
          >
            <option value="gemini">Gemini</option>
            <option value="claude">Claude</option>
            <option value="openai">OpenAI</option>
          </select>
          <button
            type="button"
            disabled={busy}
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border text-[color:var(--text-secondary)] transition duration-500 hover:text-[color:var(--text-primary)] disabled:cursor-wait disabled:opacity-60"
            style={{
              borderColor: "var(--border-subtle)",
              background: "color-mix(in srgb, var(--bg-surface, var(--panel, #11131a)) 88%, transparent)",
            }}
            aria-label="Upload screenshot or data"
            title="Upload screenshot or data"
          >
            <ImagePlus size={15} />
          </button>
          <textarea
            ref={inputRef}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder="Ask Elly anything..."
            aria-label="Intent input"
            className="max-h-28 min-h-[40px] flex-1 resize-none rounded-2xl border px-3 py-2 text-sm text-[color:var(--text-primary)] outline-none transition duration-500 placeholder:text-[color:var(--text-muted)]"
            style={{
              borderColor: "var(--border-subtle)",
              background: "color-mix(in srgb, var(--bg-surface, var(--panel, #11131a)) 88%, transparent)",
            }}
          />
          <button
            type="button"
            disabled={busy}
            onClick={clearIntent}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border text-[color:var(--text-secondary)] transition duration-500 hover:text-[color:var(--text-primary)] disabled:cursor-wait disabled:opacity-60"
            style={{
              borderColor: "var(--border-subtle)",
              background: "color-mix(in srgb, var(--bg-surface, var(--panel, #11131a)) 88%, transparent)",
            }}
            aria-label="Clear intent history"
            title="Clear history"
          >
            <RotateCcw size={15} />
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={submit}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border text-white transition duration-500 hover:brightness-105 disabled:cursor-wait disabled:opacity-100"
            style={{
              backgroundColor: withAlpha(accent, 0.88),
              borderColor: withAlpha(accent, 0.5),
              boxShadow: `0 10px 24px ${withAlpha(accent, 0.2)}`,
            }}
            aria-label="Submit intent"
          >
            {busy ? <Loader2 size={15} className="animate-spin text-white/90" /> : <ArrowUp size={16} />}
          </button>
        </div>
        </div>
      </div>
    </div>
  );
});

export default IntentLine;
