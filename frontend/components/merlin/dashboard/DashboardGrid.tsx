import DailyBriefCard from "@/components/merlin/dashboard/DailyBriefCard";
import TimelineCard from "@/components/merlin/dashboard/TimelineCard";
import BlockersCard from "@/components/merlin/dashboard/BlockersCard";
import NudgesCard from "@/components/merlin/dashboard/NudgesCard";

export default function DashboardGrid() {
  return (
    <div className="dashboard-grid">
      <DailyBriefCard />
      <TimelineCard />
      <BlockersCard />
      <NudgesCard />
    </div>
  );
}
