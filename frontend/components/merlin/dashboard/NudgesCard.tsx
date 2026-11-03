import { Info } from "lucide-react";
import CollapsibleCard from "@/components/ui/CollapsibleCard";
import MerlinGlassCard from "@/components/merlin/MerlinGlassCard";

const NUDGES = [
  {
    title: "Consider a short recovery block",
    note: "Tomorrow stacks high-focus work without downtime.",
  },
  {
    title: "Draft the vendor reply from the timeline",
    note: "Keeps the reply contextual and reduces back-and-forth.",
  },
  {
    title: "Let Merlin summarize the last three meetings",
    note: "Keeps team context aligned without another sync.",
  },
];

const STATUS = {
  level: "info",
  label: "Info",
  icon: <Info size={14} />,
} as const;

export default function NudgesCard() {
  const statusBadge = (
    <span className={`merlinGlassCard__status merlinGlassCard__status--${STATUS.level}`}>
      {STATUS.icon ? (
        <span className="merlinGlassCard__statusIcon" aria-hidden="true">
          {STATUS.icon}
        </span>
      ) : null}
      <span>{STATUS.label}</span>
    </span>
  );

  return (
    <CollapsibleCard id="gentle-nudges" title="Gentle nudges" kicker="Optional" defaultOpen badge={statusBadge}>
      <MerlinGlassCard hideHeader title="">
        <ul className="nudges-card__list">
          {NUDGES.map((item) => (
            <li key={item.title} className="nudges-card__item">
              <p className="nudges-card__title">{item.title}</p>
              <p className="nudges-card__note">Why: {item.note}</p>
            </li>
          ))}
        </ul>
        <p className="nudges-card__footer">Merlin suggests, you decide. Every nudge is explainable.</p>
      </MerlinGlassCard>
    </CollapsibleCard>
  );
}
