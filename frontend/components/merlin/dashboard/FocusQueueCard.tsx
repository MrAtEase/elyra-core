import { AlertTriangle } from "lucide-react";
import CollapsibleCard from "@/components/ui/CollapsibleCard";
import MerlinGlassCard from "@/components/merlin/MerlinGlassCard";

const FOCUS_ITEMS = [
  {
    label: "Connect Slack (Comm)",
    badge: "Needs",
    status: "needs",
  },
  {
    label: "CRM pipeline needs review",
    badge: "Working",
    status: "working",
  },
  {
    label: "Calendar sync paused",
    badge: "Attention",
    status: "attention",
  },
];

const STATUS = {
  level: "attention",
  label: "Attention",
  icon: <AlertTriangle size={14} />,
} as const;

export default function FocusQueueCard() {
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
    <CollapsibleCard id="focus-queue" title="Focus queue" kicker="Focus queue" defaultOpen badge={statusBadge}>
      <MerlinGlassCard tone="focus" hideHeader title="">
        <ul className="dashboard-queue">
          {FOCUS_ITEMS.map((item) => (
            <li key={item.label} className="dashboard-queue__item">
              <span className={`dashboard-dot dashboard-dot--${item.status}`} aria-hidden="true" />
              <span className="dashboard-queue__label">{item.label}</span>
              <span className={`dashboard-queue__badge dashboard-queue__badge--${item.status}`}>
                {item.badge}
              </span>
            </li>
          ))}
        </ul>
      </MerlinGlassCard>
    </CollapsibleCard>
  );
}
