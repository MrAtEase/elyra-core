import { UI } from "@/components/merlin/designSystem";
import MerlinGlassCard from "@/components/merlin/MerlinGlassCard";

const METRICS = [
  { label: "Modules", value: "14" },
  { label: "Connected", value: "5" },
  { label: "Needs", value: "5" },
  { label: "Errors", value: "1" },
  { label: "Pipelines", value: "2" },
  { label: "Latency", value: "128ms" },
];

export default function SystemOverviewCard() {
  return (
    <MerlinGlassCard title="System Overview" kicker="System overview" className="system-overview-card">
      <div className="dashboard-card__metrics">
        {METRICS.map((metric) => (
          <div
            key={metric.label}
            className="dashboard-pill"
            style={{
              ...UI.chipStyle,
              padding: "0.75rem 1rem",
              justifyContent: "space-between",
              minWidth: "160px",
            }}
          >
            <span className="dashboard-pill__value">{metric.value}</span>
            <span className="dashboard-pill__label">{metric.label}</span>
          </div>
        ))}
      </div>
    </MerlinGlassCard>
  );
}
