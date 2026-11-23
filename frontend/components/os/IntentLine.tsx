"use client";

import { Paperclip, Search, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import type { AppId } from "@/components/os/windowing/windowTypes";

type LegacySubmit = (() => void) | ((value: string) => void);

type IntentLineProps = {
  inputId?: string;
  value?: string;
  onChange?: (value: string) => void;
  onSubmit?: LegacySubmit;
  onOpen?: () => void;
  onOpenApp?: (appId: AppId) => void;
};

const COMMANDS: Array<{ command: string; appId: AppId }> = [
  { command: "/mail", appId: "mail" },
  { command: "/calendar", appId: "calendar" },
  { command: "/files", appId: "files" },
  { command: "/drive", appId: "files" },
  { command: "/slides", appId: "slides" },
  { command: "/doc", appId: "docs" },
  { command: "/docs", appId: "docs" },
  { command: "/build", appId: "build" },
  { command: "/settings", appId: "settings" },
  { command: "/marketplace", appId: "marketplace" },
  { command: "/translate", appId: "docs" },
  { command: "/image", appId: "docs" },
  { command: "/plan", appId: "calendar" },
  { command: "/run", appId: "build" },
];

const CHIPS = ["Summarize", "Translate", "Draft", "Plan", "Run"];

export default function IntentLine({ inputId, value, onChange, onSubmit, onOpen, onOpenApp }: IntentLineProps) {
  const [internalValue, setInternalValue] = useState("");
  const resolvedValue = value ?? internalValue;

  const slashSuggestions = useMemo(() => {
    const normalized = resolvedValue.trim().toLowerCase();
    if (!normalized.startsWith("/")) return [];
    return COMMANDS.filter((item) => item.command.startsWith(normalized || "/"));
  }, [resolvedValue]);

  const setValue = (next: string) => {
    if (typeof value === "string") {
      onChange?.(next);
      return;
    }
    setInternalValue(next);
    onChange?.(next);
  };

  const submit = () => {
    const first = resolvedValue.trim().split(/\s+/)[0]?.toLowerCase();
    const command = COMMANDS.find((item) => item.command === first);
    if (command) {
      onOpenApp?.(command.appId);
    }
    if (onSubmit) {
      (onSubmit as (value: string) => void)(resolvedValue);
    }
  };

  return (
    <section className="pointer-events-auto w-[min(920px,calc(100vw-24px))]">
      <div className="rounded-2xl border border-white/15 bg-[#090d16]/82 p-3 shadow-[0_30px_60px_rgba(0,0,0,0.55)] backdrop-blur-xl">
        <div className="mb-2 flex flex-wrap gap-2">
          {CHIPS.map((chip) => (
            <button
              key={chip}
              type="button"
              onClick={() => setValue(`${chip.toLowerCase()} `)}
              className="rounded-full border border-white/12 bg-white/[0.04] px-3 py-1 text-xs text-white/85 hover:bg-white/[0.08]"
            >
              {chip}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/35 px-3 py-2">
          <Search size={15} className="text-white/65" />
          <input
            id={inputId}
            value={resolvedValue}
            onFocus={onOpen}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                submit();
              }
            }}
            className="h-8 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/45"
            placeholder="Ask Elyra... / Type / for commands"
          />
          <button
            type="button"
            aria-label="Attach"
            title="Attach (coming soon)"
            className="grid h-8 w-8 place-items-center rounded-md border border-white/12 bg-white/[0.04] text-white/75"
          >
            <Paperclip size={14} />
          </button>
          <button
            type="button"
            onClick={submit}
            className="inline-flex h-8 items-center gap-1 rounded-md border border-white/12 bg-white/[0.1] px-3 text-xs font-semibold tracking-wide text-white"
          >
            <Sparkles size={13} /> Run
          </button>
        </div>
        {slashSuggestions.length > 0 ? (
          <div className="mt-2 rounded-xl border border-white/10 bg-black/40 p-2 text-xs text-white/85">
            <p className="mb-1 px-2 uppercase tracking-[0.2em] text-white/45">Commands</p>
            <div className="grid gap-1">
              {slashSuggestions.map((item) => (
                <button
                  key={item.command}
                  type="button"
                  onClick={() => {
                    setValue(`${item.command} `);
                    onOpenApp?.(item.appId);
                  }}
                  className="rounded-md px-2 py-1 text-left hover:bg-white/[0.08]"
                >
                  {item.command}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
