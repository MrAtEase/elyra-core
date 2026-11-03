import { Info } from "lucide-react";
import CollapsibleCard from "@/components/ui/CollapsibleCard";
import MerlinGlassCard from "@/components/merlin/MerlinGlassCard";

const SIGNALS = [
  {
    label: "Focus",
    value: "Lunch coverage, vendor renewal, investor update",
    note: "Operations, vendor, and investor work stay explainable and scoped.",
  },
];

const ENERGY_STATE = {
  label: "Steady",
  level: 3,
  note: "Based on recovery windows and meeting density.",
};

const RISK_STATE = {
  label: "Time compression",
  note: "Tomorrow stacks high-focus work without buffer.",
};

const PRIORITIES = [
  {
    title: "Stabilize lunch coverage",
    reason: "Two shift swaps are still unconfirmed for service hours.",
  },
  {
    title: "Finalize the investor update",
    reason: "Needs a concise narrative before the next board sync.",
  },
  {
    title: "Lock the vendor renewal",
    reason: "Pricing protection depends on a timely response.",
  },
];

const SUGGESTIONS = [
  {
    title: "Protect a prep buffer before lunch",
    reason: "Reduces context switching during peak service.",
  },
  {
    title: "Batch admin replies together",
    reason: "Keeps headspace free for planning and hiring.",
  },
];

const STATUS = {
  level: "info",
  label: "Info",
  icon: <Info size={14} />,
} as const;

export default function DailyBriefCard() {
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
    <CollapsibleCard id="daily-brief" title="Daily brief" kicker="Merlin" defaultOpen badge={statusBadge}>
      <MerlinGlassCard hideHeader title="">
        <div className="brief-card__signals">
          {SIGNALS.map((signal) => (
            <div key={signal.label} className="brief-card__signal">
              <div>
                <p className="brief-card__signalLabel">{signal.label}</p>
                <p className="brief-card__signalValue">{signal.value}</p>
              </div>
              <p className="brief-card__signalNote">{signal.note}</p>
            </div>
          ))}
        </div>

        <div className="brief-card__energy">
          <div className="brief-card__energyMeta">
            <p className="brief-card__energyLabel">Energy</p>
            <p className="brief-card__energyValue">{ENERGY_STATE.label}</p>
          </div>
          <div
            className="brief-card__energyMeter"
            role="img"
            aria-label={`Energy is ${ENERGY_STATE.label.toLowerCase()} at level ${ENERGY_STATE.level} of 5`}
          >
            {Array.from({ length: 5 }, (_, index) => index + 1).map((step) => (
              <span
                key={step}
                className={`brief-card__energyMeterBar ${step <= ENERGY_STATE.level ? "is-active" : ""}`}
              />
            ))}
          </div>
          <p className="brief-card__energyNote">{ENERGY_STATE.note}</p>
        </div>

        <div className="brief-card__risk">
          <div className="brief-card__riskMeta">
            <span className="brief-card__riskBadge">{RISK_STATE.label}</span>
            <p className="brief-card__riskLabel">Risk</p>
          </div>
          <p className="brief-card__riskNote">{RISK_STATE.note}</p>
        </div>

        <div className="brief-card__section">
          <p className="brief-card__label">Priorities</p>
          <ul className="brief-card__list">
            {PRIORITIES.map((item, index) => (
              <li key={item.title} className="brief-card__item">
                <span className="brief-card__priorityRank">{index + 1}</span>
                <div>
                  <p className="brief-card__title">{item.title}</p>
                  <p className="brief-card__note">Why: {item.reason}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="brief-card__section">
          <p className="brief-card__label">Suggestions</p>
          <ul className="brief-card__list">
            {SUGGESTIONS.map((item) => (
              <li key={item.title} className="brief-card__item">
                <p className="brief-card__title">{item.title}</p>
                <p className="brief-card__note">Why: {item.reason}</p>
              </li>
            ))}
          </ul>
        </div>
      </MerlinGlassCard>
    </CollapsibleCard>
  );
}
