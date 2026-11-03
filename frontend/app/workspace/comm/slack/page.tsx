import { getModuleByRoute } from "@/components/modules/registry";

const MODULE_ROUTE = "/workspace/comm/slack";

export default function SlackPage() {
  const module = getModuleByRoute(MODULE_ROUTE);

  if (!module) {
    return (
      <section className="workspace-main-panel">
        <div className="workspace-main-panel__header">
          <p className="workspace-main-panel__eyebrow">Communication · Slack</p>
          <p className="workspace-main-panel__desc">Slack support is still rolling out for this workspace.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="workspace-main-panel">
      <div className="workspace-main-panel__header">
        <p className="workspace-main-panel__eyebrow">Communication · {module.provider ?? module.label}</p>
        <p className="workspace-main-panel__desc">Status: {module.status.replace("_", " ")}</p>
      </div>
      <div className="workspace-main-panel__status-card">
        <p>Slack ist verbunden, aber noch im Early Access. Page folgt bald.</p>
      </div>
    </section>
  );
}
