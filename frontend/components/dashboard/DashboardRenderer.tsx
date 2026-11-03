"use client";

import { useMemo } from "react";
import type { DashboardManifest, Permission } from "@/lib/dashboard/types";
import { isVisible } from "@/lib/dashboard/visibility";
import { renderDashboardModule } from "./ModuleRegistry";

export type DashboardUserContext = {
  activeWorkspace?: { id?: string; slug?: string; name?: string; type?: string } | null;
  membership?: { role?: string | null } | null;
  permissions?: Permission[] | Record<string, boolean> | null;
  features?: string[] | Record<string, boolean> | null;
};

type DashboardRendererProps = {
  manifest: DashboardManifest;
  userContext: DashboardUserContext;
};

const AREA_ORDER: Record<string, number> = {
  primary: 1,
  secondary: 2,
  full: 3,
};

const readStringValue = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const resolveRole = (userContext: DashboardUserContext) => {
  return (
    readStringValue(userContext.membership?.role) ||
    readStringValue((userContext.permissions as Record<string, unknown> | null)?.role) ||
    readStringValue((userContext.permissions as Record<string, unknown> | null)?.accessLevel)
  );
};

export default function DashboardRenderer({ manifest, userContext }: DashboardRendererProps) {
  const role = resolveRole(userContext);
  const visibilityContext = useMemo(
    () => ({
      role,
      permissions: userContext.permissions ?? null,
      features: userContext.features ?? null,
    }),
    [role, userContext.permissions, userContext.features]
  );

  const sortedModules = useMemo(
    () =>
      [...manifest.modules].sort((a, b) => {
        const areaDelta =
          (AREA_ORDER[a.placement.area] ?? 99) - (AREA_ORDER[b.placement.area] ?? 99);
        if (areaDelta !== 0) return areaDelta;
        return (a.placement.order ?? 0) - (b.placement.order ?? 0);
      }),
    [manifest.modules]
  );

  const visibleModules = useMemo(
    () =>
      sortedModules.filter((module) => isVisible(module.visibleIf, visibilityContext)),
    [sortedModules, visibilityContext]
  );

  return (
    <div className="dashboard-grid">
      {visibleModules.map((module) => {
        const content = renderDashboardModule(module);
        if (!content) return null;
        const isFullSpan =
          module.span === "full" || module.span === 2 || module.placement.area === "full";
        const key = `${module.kind}-${module.placement.area}-${module.placement.order}`;
        return (
          <div key={key} className={isFullSpan ? "dashboard-grid__activity" : undefined}>
            {content}
          </div>
        );
      })}
    </div>
  );
}
