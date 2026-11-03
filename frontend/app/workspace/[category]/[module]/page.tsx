import { MODULE_REGISTRY, getCategoryById, getModuleByRoute } from "@/components/modules/registry";
import WorkScopeBadge from "@/components/workspace/WorkScopeBadge";

type ModulePageParams = {
  category: string;
  module: string;
};

type ModulePageProps = {
  params: ModulePageParams | Promise<ModulePageParams>;
};

export function generateStaticParams(): ModulePageParams[] {
  return MODULE_REGISTRY.map((entry) => {
    const [, categorySegment, moduleSegment] = entry.route.split("/").filter(Boolean);
    return {
      category: categorySegment ?? entry.category,
      module: moduleSegment ?? entry.id,
    };
  });
}

export default async function ModuleFallbackPage({ params }: ModulePageProps) {
  const { category, module: moduleId } = await params;
  const route = `/workspace/${category}/${moduleId}`;
  const module = getModuleByRoute(route);
  const workCategories = new Set(["calendar", "mail", "tasks", "docs"]);

  if (!module) {
    return (
      <section className="workspace-main-panel">
      <div className="workspace-main-panel__header">
        <p className="workspace-main-panel__eyebrow">Workspace</p>
        <p className="workspace-main-panel__desc">This lens is not available in this workspace.</p>
      </div>
      </section>
    );
  }

  return (
    <section className="workspace-main-panel">
      <div className="workspace-main-panel__header">
        <p className="workspace-main-panel__eyebrow">
          {getCategoryById(module.category)?.label ?? module.category} · {module.provider ?? module.label}
        </p>
        <p className="workspace-main-panel__desc">
          Status: {module.status.replace("_", " ")} · This lens is inactive for this workspace.
        </p>
        {workCategories.has(module.category) ? <WorkScopeBadge /> : null}
      </div>
      <div className="workspace-main-panel__status-card">
        <p>
          {module.badge ? `${module.badge} · ` : ""}
          Connect a provider or request access to activate this lens. Merlin will explain the source once connected.
        </p>
      </div>
    </section>
  );
}
