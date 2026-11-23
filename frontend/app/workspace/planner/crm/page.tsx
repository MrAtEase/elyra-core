import { getModuleByRoute } from "@/components/modules/registry";

const MODULE_ROUTE = "/workspace/planner/crm";

export default function PlannerCRMPage() {
  const module = getModuleByRoute(MODULE_ROUTE);

  if (!module) {
    return (
      <section className="workspace-main-panel">
        <div className="workspace-main-panel__header">
          <p className="workspace-main-panel__eyebrow">Planner · CRM</p>
          <p className="workspace-main-panel__desc">
            CRM views are not available in this workspace yet.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="workspace-main-panel">
      <div className="workspace-main-panel__header">
        <p className="workspace-main-panel__eyebrow">Planner · {module.provider ?? module.label}</p>
        <p className="workspace-main-panel__desc">Status: {module.status.replace("_", " ")}</p>
      </div>
      <div className="workspace-main-panel__status-card">
        <p>CRM-Daten werden bald in der Planner-Ansicht auftauchen. Wir stimmen das Dashboard gerade ab.</p>
      </div>
    </section>
  );
}
