import { XCircle } from "lucide-react";
import CollapsibleCard from "@/components/ui/CollapsibleCard";
import MerlinGlassCard from "@/components/merlin/MerlinGlassCard";

const BLOCKERS = [
  {
    title: "Shift swap awaiting approval",
    note: "Two staff requests touch the same coverage window.",
    action: "Approve one swap or open a short backup shift.",
  },
  {
    title: "Menu update missing pricing sign-off",
    note: "Finance review is required before publishing.",
    action: "Route to finance or hold the menu draft.",
  },
  {
    title: "Vendor contract pending reply",
    note: "Response window is tight for the current rate lock.",
    action: "Reply today or delegate to ops.",
  },
];

const STATUS = {
  level: "critical",
  label: "Critical",
  icon: <XCircle size={14} />,
} as const;

export default function BlockersCard() {
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
    <CollapsibleCard id="blockers" title="Blockers & conflicts" kicker="Needs attention" defaultOpen badge={statusBadge}>
      <MerlinGlassCard hideHeader title="">
        <div className="blockers-card__status">
          <span className="blockers-card__badge">Conflicts</span>
          <span className="blockers-card__count">{BLOCKERS.length} conflicts</span>
        </div>
        <ul className="blockers-card__list">
          {BLOCKERS.map((item) => (
            <li key={item.title} className="blockers-card__item">
              <div>
                <p className="blockers-card__title">{item.title}</p>
                <p className="blockers-card__note">Why: {item.note}</p>
              </div>
              <p className="blockers-card__action">{item.action}</p>
            </li>
          ))}
        </ul>
      </MerlinGlassCard>
    </CollapsibleCard>
  );
}
