import MerlinGlassCard from "@/components/merlin/MerlinGlassCard";

const ACTIVITY_LOG = [
  { label: "Last intent", intent: "open planner crm", time: "2m ago" },
  { label: "Workflow", intent: "sync gmail", time: "12m ago" },
  { label: "System", intent: "export built", time: "1h ago" },
  { label: "Workflow", intent: "mirror payments", time: "2h ago" },
];

export default function ActivityCard() {
  return (
    <MerlinGlassCard title="Activity" kicker="Activity log" className="activity-card">
      <div className="dashboard-activity">
        {ACTIVITY_LOG.map((entry) => (
          <div className="dashboard-activity__row" key={`${entry.label}-${entry.intent}`}>
            <div>
              <span className="dashboard-activity__label">{entry.label}</span>
              <p className="dashboard-activity__intent">{entry.intent}</p>
            </div>
            <span className="dashboard-activity__timestamp">{entry.time}</span>
          </div>
        ))}
      </div>
    </MerlinGlassCard>
  );
}
