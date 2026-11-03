"use client";

import { useMemo } from "react";
import { Mic, Send } from "lucide-react";

import { DEFAULT_ATTACHMENTS, QUICK_COMMANDS } from "@/components/orchestrator/mock";
import type { IntentState } from "@/components/orchestrator/types";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/button";

type IntentDockProps = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onQuickCommand: (command: string) => void;
  state: IntentState;
  disabled?: boolean;
};

const stateLabelMap: Record<IntentState, string> = {
  idle: "Idle",
  listening: "Listening",
  thinking: "Reasoning...",
  plan_ready: "Plan ready",
  executing: "Executing",
};

const placeholderByState: Record<IntentState, string> = {
  idle: "Was moechtest du als Naechstes tun?",
  listening: "Ich hoere zu...",
  thinking: "Reasoning...",
  plan_ready: "Plan ist bereit. Du kannst ihn anpassen.",
  executing: "Ich fuehre die Schritte aus...",
};

export default function IntentDock({ value, onChange, onSubmit, onQuickCommand, state, disabled }: IntentDockProps) {
  const quickCommands = useMemo(() => QUICK_COMMANDS, []);

  return (
    <section className="intentDock" aria-label="Intent line">
      <div className="intentDock__meta">
        <Badge variant="neutral">Intent Line</Badge>
        <Badge variant={state === "executing" ? "info" : "neutral"}>{stateLabelMap[state]}</Badge>
      </div>

      <div className="intentDock__composer">
        <button type="button" className="intentDock__mic" aria-label="Voice input (soon)">
          <Mic size={16} />
        </button>
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholderByState[state]}
          disabled={disabled}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              onSubmit();
            }
          }}
        />
        <Button size="sm" onClick={onSubmit} disabled={disabled || !value.trim()}>
          <Send size={14} />
          <span>Plan</span>
        </Button>
      </div>

      <div className="intentDock__chips">
        {quickCommands.map((chip) => (
          <button key={chip.id} type="button" onClick={() => onQuickCommand(chip.command)}>
            {chip.label}
          </button>
        ))}
      </div>

      <div className="intentDock__attachments">
        {DEFAULT_ATTACHMENTS.map((item) => (
          <span key={item.id}>{item.label}</span>
        ))}
      </div>
    </section>
  );
}
