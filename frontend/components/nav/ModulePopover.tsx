"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
import type { NavItem } from "@/lib/dashboard/types";
import { ModuleRegistryItem, getModuleByRoute } from "@/components/modules/registry";

type ModulePopoverProps = {
  category?: NavItem | null;
  modules: ModuleRegistryItem[];
  activeModuleRoute?: string;
  onRequestConnect: (module: ModuleRegistryItem) => void;
  open: boolean;
  style?: CSSProperties;
  onPointerEnter?: () => void;
  onPointerLeave?: () => void;
};

const STATUS_CLASSES: Record<string, string> = {
  connected: "workspace-module-popover__dot--connected",
  needs_connect: "workspace-module-popover__dot--pending",
  error: "workspace-module-popover__dot--error",
  unknown: "workspace-module-popover__dot--unknown",
};

export default function ModulePopover({
  category,
  modules,
  activeModuleRoute,
  onRequestConnect,
  open,
  style,
  onPointerEnter,
  onPointerLeave,
}: ModulePopoverProps) {
  if (!category || !open || modules.length === 0) {
    return null;
  }

  const sortedModules = [...modules].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
  const activeModule = activeModuleRoute ? getModuleByRoute(activeModuleRoute) : null;
  const currentIntegration =
    activeModule && activeModule.category === category.id ? activeModule : null;

  return (
    <aside
      className="workspace-module-popover"
      aria-label={`${category.label} integrations`}
      style={style}
      onMouseEnter={onPointerEnter}
      onMouseLeave={onPointerLeave}
    >
      <div className="workspace-module-popover__header">
        <div className="workspace-module-popover__titles">
          <span className="workspace-module-popover__title">{category.label}</span>
          {currentIntegration && (
            <span className="workspace-module-popover__current">
              <span className="workspace-module-popover__current-arrow" aria-hidden="true">
                →
              </span>
              <span className="workspace-module-popover__current-label">
                {currentIntegration.label}
              </span>
              {currentIntegration.badge && (
                <span className="workspace-module-popover__current-badge">
                  {currentIntegration.badge}
                </span>
              )}
            </span>
          )}
        </div>
        <span className="workspace-module-popover__hint">Integrationen</span>
      </div>
      <div className="workspace-module-popover__list">
        {sortedModules.map((module) => {
          const isActive = module.route === activeModuleRoute;
          const labelContent = (
            <>
              <span
                className={`workspace-module-popover__dot ${STATUS_CLASSES[module.status] ?? ""}`}
                aria-label={`Status ${module.status}`}
              />
              <span className="workspace-module-popover__label">{module.label}</span>
              {module.badge && (
                <span className="workspace-module-popover__badge">{module.badge}</span>
              )}
            </>
          );

          if (module.status === "needs_connect" && module.provider) {
            return (
              <button
                type="button"
                key={module.id}
                onClick={() => onRequestConnect(module)}
                className={`workspace-module-popover__item ${isActive ? "is-active" : ""}`}
              >
                {labelContent}
              </button>
            );
          }

          return (
            <Link
              href={module.route}
              key={module.id}
              className={`workspace-module-popover__item ${isActive ? "is-active" : ""}`}
            >
              {labelContent}
            </Link>
          );
        })}
      </div>
    </aside>
  );
}
