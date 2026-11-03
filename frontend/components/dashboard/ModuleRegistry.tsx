import type { ReactElement } from "react";
import MerlinGlassCard from "@/components/merlin/MerlinGlassCard";
import DailyBriefCard from "@/components/merlin/dashboard/DailyBriefCard";
import TimelineCard from "@/components/merlin/dashboard/TimelineCard";
import BlockersCard from "@/components/merlin/dashboard/BlockersCard";
import NudgesCard from "@/components/merlin/dashboard/NudgesCard";
import FocusQueueCard from "@/components/merlin/dashboard/FocusQueueCard";
import type { DashboardModule } from "@/lib/dashboard/types";

type ModuleComponent = (props: Record<string, unknown>) => ReactElement | null;

type ModuleMap = Record<string, ModuleComponent>;

const MODULE_COMPONENTS: ModuleMap = {
  focus_queue: () => <FocusQueueCard />,
  daily_brief: () => <DailyBriefCard />,
  today_timeline: () => <TimelineCard />,
  blockers: () => <BlockersCard />,
  nudges: () => <NudgesCard />,
};

const NotImplemented = ({ kind }: { kind: string }) => {
  if (process.env.NODE_ENV === "production") {
    return null;
  }

  return (
    <MerlinGlassCard title="Not implemented" kicker="Dashboard module" tone="warn">
      <p>Module &quot;{kind}&quot; is not wired yet.</p>
    </MerlinGlassCard>
  );
};

export const resolveModuleComponent = (kind: string) => {
  const component = MODULE_COMPONENTS[kind];
  if (component) return component;
  return process.env.NODE_ENV === "production" ? null : () => <NotImplemented kind={kind} />;
};

export const renderDashboardModule = (module: DashboardModule) => {
  const ModuleComponent = resolveModuleComponent(module.kind);
  if (!ModuleComponent) return null;
  return <ModuleComponent {...(module.config ?? {})} />;
};

export default function ModuleRegistry({ module }: { module: DashboardModule }) {
  return renderDashboardModule(module);
}
