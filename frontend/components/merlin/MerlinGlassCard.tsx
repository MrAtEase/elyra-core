import type { ReactNode } from "react";
import { FuturaCard, type FuturaCardStatus } from "../ui/FuturaCard";

type Tone = "default" | "focus" | "warn" | "error";
type StatusLevel = "ok" | "attention" | "critical" | "info";

type StatusIndicator = FuturaCardStatus;

interface MerlinGlassCardProps {
  title: string;
  kicker?: string;
  tone?: Tone;
  className?: string;
  children: ReactNode;
  status?: StatusIndicator;
  hideHeader?: boolean;
  // New props to enable expandability and overlay content from FuturaCard
  isExpandable?: boolean;
  isExpanded?: boolean;
  onExpandToggle?: () => void;
  hasOverlayContent?: boolean;
}

const TONE_ACCENTS: Record<Tone, string> = {
  default: "color-mix(in srgb, var(--accent) 45%, transparent)",
  focus: "color-mix(in srgb, var(--accent) 55%, transparent)",
  warn: "color-mix(in srgb, #f4c768 55%, transparent)",
  error: "color-mix(in srgb, #f29a9a 55%, transparent)",
};

export default function MerlinGlassCard({
  title,
  kicker,
  tone = "default",
  className = "",
  children,
  status,
  hideHeader = false,
  isExpandable = false,
  isExpanded = false,
  onExpandToggle,
  hasOverlayContent = false,
}: MerlinGlassCardProps) {
  // customStyle was used for --merlin-glass-accent in the old CSS.
  // FuturaCard now uses its own tone-based CSS variables.
  // We can pass it as a style prop if needed for specific overrides,
  // but for now, rely on FuturaCard's internal tone handling.

  const combinedClassName = ["merlinGlassCard", className].filter(Boolean).join(" ");

  return (
    <FuturaCard
      className={combinedClassName}
      title={title}
      {...(kicker != null ? { kicker } : {})}
      tone={tone}
      {...(status != null ? { status } : {})}
      hideHeader={hideHeader}
      isExpandable={isExpandable}
      isExpanded={isExpanded}
      {...(onExpandToggle ? { onExpandToggle } : {})}
      hasOverlayContent={hasOverlayContent}
    >
      {children}
    </FuturaCard>
  );
}
