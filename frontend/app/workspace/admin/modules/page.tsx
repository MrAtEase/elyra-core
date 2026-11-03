"use client";

import { useEffect, useMemo, useState } from "react";

import SettingsPane from "@/components/merlin/settings/SettingsPane";
import {
  MODULE_CATEGORIES,
  MODULE_REGISTRY,
  type ModuleStatus,
} from "@/components/modules/registry";
import { useWorkspaceData } from "@/components/workspace/WorkspaceContext";
import { getWorkspaceModulesEndpoint } from "@/utils/auth-guard";

type ModuleStatusResponse = {
  id: string;
  status: ModuleStatus;
};

export default function WorkspaceModulesAdminPage() {
  const { data } = useWorkspaceData();
  const workspace = data?.activeWorkspace;
  const fallbackStatuses = useMemo<Record<string, ModuleStatus>>(() => {
    const map: Record<string, ModuleStatus> = {};
    MODULE_REGISTRY.forEach((module) => {
      map[module.id] = module.status;
    });
    return map;
  }, []);

  const [statusMap, setStatusMap] = useState<Record<string, ModuleStatus>>(fallbackStatuses);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!workspace?.id) {
      setStatusMap(fallbackStatuses);
      setError(null);
      return;
    }
    let canceled = false;
    setLoading(true);
    fetch(getWorkspaceModulesEndpoint(workspace.id), {
      credentials: "include",
    })
      .then(async (response) => {
        const payload = (await response.json()) as Record<string, any>;
        if (!response.ok || !payload?.ok) {
          throw new Error(payload?.error || "Unable to load modules.");
        }
        if (!canceled && Array.isArray(payload.modules)) {
          const next: Record<string, ModuleStatus> = { ...fallbackStatuses };
          for (const entry of payload.modules as ModuleStatusResponse[]) {
            if (entry?.id && entry?.status) {
              next[entry.id] = entry.status;
            }
          }
          setStatusMap(next);
        }
      })
      .catch((err) => {
        if (!canceled) {
          console.error(err);
          setStatusMap(fallbackStatuses);
          setError(err instanceof Error ? err.message : "Unable to load modules.");
        }
      })
      .finally(() => {
        if (!canceled) {
          setLoading(false);
        }
      });
    return () => {
      canceled = true;
    };
  }, [fallbackStatuses, workspace?.id]);

  const statusLabel = (value: ModuleStatus) => {
    switch (value) {
      case "connected":
        return "Connected";
      case "needs_connect":
        return "Needs connection";
      case "error":
        return "Error";
      default:
        return "Unknown";
    }
  };

  return (
    <SettingsPane
      eyebrow="Workspace · Modules"
      title="Modules & Integrations"
      description="Monitor connected modules and their status."
      scope="WORKSPACE"
    >
      {loading && <p>Loading module statuses...</p>}
      {error && <p className="settings-form__error">{error}</p>}
      <div className="settings-module-grid">
        {MODULE_CATEGORIES.map((category) => {
          const moduleEntries = MODULE_REGISTRY.filter(
            (entry) => entry.category === category.id
          );
          if (!moduleEntries.length) {
            return null;
          }
          return (
            <div key={category.id} className="settings-module-category">
              <div className="settings-module-category__header">
                <h3>{category.label}</h3>
                <span>{moduleEntries.length} modules</span>
              </div>
              {moduleEntries.map((module) => {
                const moduleStatus = statusMap[module.id] ?? module.status;
                return (
                  <div key={module.id} className="settings-module-row">
                    <div>
                      <p className="settings-module-row__label">{module.label}</p>
                      {module.provider && (
                        <p className="settings-module-row__meta">{module.provider}</p>
                      )}
                    </div>
                    <span className={`settings-status-chip settings-status-chip--${moduleStatus}`}>
                      {statusLabel(moduleStatus)}
                    </span>
                    <button className="settings-module-row__configure" type="button" disabled>
                      Configure
                    </button>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </SettingsPane>
  );
}
