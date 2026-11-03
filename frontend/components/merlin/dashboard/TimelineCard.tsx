import { CheckCircle } from "lucide-react";
import CollapsibleCard from "@/components/ui/CollapsibleCard";
import MerlinGlassCard from "@/components/merlin/MerlinGlassCard";

const TIMELINE = [
  {
    time: "09:30",
    title: "Prep alignment",
    meta: "Kitchen + floor · 15 min",
    reason: "Sets service tempo and assigns recovery buffers.",
  },
  {
    time: "11:00",
    title: "Supplier check-in",
    meta: "Operations · Inbox",
    reason: "Confirms delivery timing for lunch service.",
  },
  {
    time: "14:30",
    title: "Menu iteration review",
    meta: "Product · 30 min",
    reason: "Aligns seasonal updates with prep capacity.",
  },
  {
    time: "16:00",
    title: "Investor update draft",
    meta: "Leadership · Focus block",
    reason: "Keeps messaging ready before stakeholder sync.",
  },
];

const STATUS = {
  level: "ok",
  label: "OK",
  icon: <CheckCircle size={14} />,
} as const;

export default function TimelineCard() {
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
    <CollapsibleCard id="today-timeline" title="Today timeline" kicker="Merged view" defaultOpen badge={statusBadge}>
      <MerlinGlassCard hideHeader title="">
        <div className="timeline-card__intro">
          <p>Calendar, tasks, and mail merged into one explainable stream.</p>
        </div>
        <ul className="timeline-card__list">
          {TIMELINE.map((entry) => (
            <li key={`${entry.time}-${entry.title}`} className="timeline-card__item">
              <span className="timeline-card__time">{entry.time}</span>
              <div className="timeline-card__details">
                <p className="timeline-card__title">{entry.title}</p>
                <p className="timeline-card__meta">{entry.meta}</p>
                <p className="timeline-card__note">Why: {entry.reason}</p>
              </div>
            </li>
          ))}
        </ul>
      </MerlinGlassCard>
    </CollapsibleCard>
  );
}
