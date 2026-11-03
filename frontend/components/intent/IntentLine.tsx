"use client";

import { Paperclip, Sparkles } from "lucide-react";
import { Button } from "@/components/os/primitives";

const CHIPS = ["Write", "Schedule", "Summarize", "Generate image", "Translate", "Plan"];

export default function IntentLine({
  inputId,
  value,
  onChange,
  onSubmit,
  onOpen,
}: {
  inputId?: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onOpen?: () => void;
}) {
  return (
    <section className="ec-intent-line" aria-label="Intent line">
      <div className="ec-intent-line__chips">
        {CHIPS.map((chip) => (
          <button key={chip} type="button" onClick={() => onChange(`${chip}: `)}>
            {chip}
          </button>
        ))}
      </div>
      <div className="ec-intent-line__input-wrap">
        <Sparkles size={16} />
        <input
          id={inputId}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="/mail draft a response for the top thread and ask for confirmation"
          onFocus={onOpen}
          onKeyDown={(event) => {
            if (event.key === "Enter") onSubmit();
          }}
        />
        <div className="ec-intent-line__actions">
          <button type="button" aria-label="Attach context" title="Attach context">
            <Paperclip size={15} />
          </button>
          <Button onClick={onSubmit}>Run</Button>
        </div>
      </div>
      <p className="ec-intent-line__hint">Natural language + slash commands. External writes stay supervised.</p>
    </section>
  );
}
