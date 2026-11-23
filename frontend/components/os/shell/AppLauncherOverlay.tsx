"use client";

import { selectToolboxTool, type ToolAppId } from "@/components/os/apps/toolbox/ToolboxWindow";
import { useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AppWindow,
  CalendarDays,
  CheckSquare,
  BarChart3,
  CloudSun,
  Compass,
  FileText,
  Globe,
  Languages,
  Mail,
  Network,
  Plus,
  Search,
  Settings,
  Sparkles,
  Workflow,
  Target,
  Guitar,
  Spade,
  Plug,
  Radar,
  GitMerge,
  ShoppingBag,
  Newspaper,
} from "lucide-react";
import type { AppId } from "@/components/os/kernel/types";
import {
  SHELL_LAYER_DATA_ATTR,
  SHELL_LAYERS,
} from "@/components/os/shell/layers";
import type { ResolvedAppsSurfaceEntry } from "@/lib/orb-os/contracts/rendering";
import { APP_CATEGORY_ORDER, appCategoryLabel, listLauncherApps } from "@/components/os/kernel/appRegistry";
import { usePlatformOwner, useVisibleWorkspaces } from "@/components/os/kernel/workspaceModel";
import { OPTIONAL_APP_IDS, isItemInstalled } from "@/lib/marketplace/catalog";
import { nativeAppIcon } from "@/components/os/shell/DesktopSurface";
import type { AppManifest, InstalledApp, IntegrationStatus, ToolRegistryItem } from "@/lib/orb-os/contracts/types";
import { withSupabaseAuthorization } from "@/lib/auth/clientAuthHeaders";
import { openMiniApp, useMarketplace } from "@/lib/marketplace/client";
import { MARKETPLACE_ICONS } from "@/components/os/apps/marketplace/icons";

const APP_ICONS_BY_NAME: Record<string, ComponentType<{ size?: number; className?: string }>> = {
  ...MARKETPLACE_ICONS,
  radar: Radar,
  "git-merge": GitMerge,
  "shopping-bag": ShoppingBag,
  "newspaper": Newspaper,
  "workflow": Workflow,
  plug: Plug,
  mail: Mail,
  calendar: CalendarDays,
  tasks: CheckSquare,
  files: FileText,
  graph: Network,
  builder: Workflow,
  slides: AppWindow,
  settings: Settings,
  google: AppWindow,
  globe: Globe,
  "cloud-sun": CloudSun,
  languages: Languages,
  chart: BarChart3,
  target: Target,
  guitar: Guitar,
  spade: Spade,
};

type LauncherItem = {
  app: ResolvedAppsSurfaceEntry;
  isOpen: boolean;
};

type AppLauncherOverlayProps = {
  open: boolean;
  accent: string;
  role: string | null;
  workspaceId: string;
  manifests: AppManifest[];
  installedApps: InstalledApp[];
  toolRegistry: ToolRegistryItem[];
  integrationStatus: IntegrationStatus[];
  googleConnectionState: "connected" | "needs_auth" | "needs_scope" | "degraded" | "disconnected";
  openAppIds: AppId[];
  onOpenApp: (appId: AppId) => void;
  onFocusIntent: () => void;
  onClose: () => void;
  onAppsChanged?: () => Promise<void> | void;
};

function lookupIcon(iconName: string) {
  return APP_ICONS_BY_NAME[iconName] ?? nativeAppIcon(iconName);
}

function roleCanInstall(role: string | null, app: AppManifest) {
  if (!role) return false;
  return app.install_constraints.roles_allowed.includes(role.toLowerCase());
}

function scoreRecommendation(app: AppManifest) {
  const rating = app.marketplace?.rating ?? 0;
  const reviewCount = app.marketplace?.review_count ?? 0;
  const quickActionScore = Math.min(3, app.quick_actions.length) * 0.45;
  const authPenalty = app.auth_requirements.length > 0 ? -0.3 : 0;
  return rating * 2 + quickActionScore + Math.log10(reviewCount + 1) + authPenalty;
}

function AppTile({
  item,
  isOpen,
  accent,
  onClick,
}: {
  item: ResolvedAppsSurfaceEntry;
  isOpen: boolean;
  accent: string;
  onClick: () => void;
}) {
  const Icon = lookupIcon(item.icon_name);
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex flex-col items-center gap-2 rounded-2xl p-3 transition duration-200 hover:bg-[color:var(--bg-surface-soft)] ${
        item.status === "connected" ? "" : "opacity-70"
      }`}
    >
      <div className="grid h-14 w-14 place-items-center rounded-2xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface)] transition group-hover:-translate-y-0.5 group-hover:border-[color:var(--os-border-strong)] group-hover:bg-[color:var(--bg-surface-hover)]">
        <Icon size={22} className="text-[color:var(--text-secondary)]" />
      </div>
      <span className="text-[11px] font-medium text-[color:var(--text-secondary)]">{item.name}</span>
      <div className="flex items-center gap-1">
        {isOpen ? <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: accent }} /> : <span className="h-1.5 w-1.5 rounded-full bg-transparent" aria-hidden />}
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            item.status === "connected"
              ? "bg-emerald-500"
              : item.status === "needs_auth" || item.status === "needs_scope"
                ? "bg-amber-500"
                : item.status === "policy_blocked"
                  ? "bg-rose-500"
                  : "bg-[var(--muted)]"
          }`}
        />
      </div>
    </button>
  );
}

function RecommendedInstallCard({
  app,
  canInstall,
  blockedReason,
  loading,
  onInstall,
}: {
  app: AppManifest;
  canInstall: boolean;
  blockedReason: string | null;
  loading: boolean;
  onInstall: () => void;
}) {
  const Icon = lookupIcon(app.icon.name);
  const risk = app.risk_tags[0] ?? "read_only";
  const requiresAuth = app.auth_requirements.some((req) => req.mode === "required");

  return (
    <article className="rounded-2xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface)]/82 p-3 shadow-[0_6px_20px_rgba(25,40,72,0.06)]">
      <div className="flex items-start gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface-soft)]">
          <Icon size={18} className="text-[color:var(--text-secondary)]" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-[color:var(--text-primary)]">{app.name}</h3>
          <p className="mt-0.5 line-clamp-2 text-[11px] text-[color:var(--text-muted)]">
            {app.description ?? "Install from manifest pack"}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <span className="rounded-full border border-[color:var(--os-border-soft)] px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-[color:var(--text-secondary)]">
              {app.category}
            </span>
            <span className="rounded-full border border-[color:var(--os-border-soft)] px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-[color:var(--text-secondary)]">
              {risk}
            </span>
            {requiresAuth ? (
              <span className="rounded-full border border-amber-300/45 bg-amber-100/55 px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-amber-900">
                Needs auth
              </span>
            ) : null}
          </div>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between">
        {blockedReason ? (
          <p className="text-[11px] text-[color:var(--text-muted)]">{blockedReason}</p>
        ) : (
          <p className="text-[11px] text-[color:var(--text-muted)]">Ready to install</p>
        )}
        <button
          type="button"
          onClick={onInstall}
          disabled={!canInstall || loading}
          className="inline-flex items-center gap-1 rounded-full border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface-soft)] px-2.5 py-1 text-[11px] font-medium text-[color:var(--text-secondary)] transition hover:border-[color:var(--os-border-strong)] hover:text-[color:var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-45"
        >
          <Plus size={12} />
          {loading ? "Installing..." : "Install"}
        </button>
      </div>
    </article>
  );
}

export default function AppLauncherOverlay({
  open,
  accent,
  role,
  workspaceId,
  manifests,
  installedApps,
  toolRegistry,
  integrationStatus,
  googleConnectionState,
  openAppIds,
  onOpenApp,
  onFocusIntent,
  onClose,
  onAppsChanged,
}: AppLauncherOverlayProps) {
  const searchRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [installingByApp, setInstallingByApp] = useState<Record<string, boolean>>({});

  const [mcpServers, setMcpServers] = useState<Array<{ id: string; name: string; status: string; enabled: boolean }>>([]);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/os/mcp?workspaceId=${encodeURIComponent(workspaceId)}`, { credentials: "include", cache: "no-store", headers: await withSupabaseAuthorization() });
        const data = (await res.json().catch(() => null)) as { servers?: Array<{ id: string; name: string; status: string; enabled: boolean }> } | null;
        if (!cancelled) setMcpServers(data?.servers ?? []);
      } catch { /* MCP optional */ }
    })();
    return () => { cancelled = true; };
  }, [workspaceId]);

  const market = useMarketplace(workspaceId);

  // One shared app list for the launcher and the Apps tab (same registry, same rules).
  const visibleWorkspaces = useVisibleWorkspaces();
  const platformOwner = usePlatformOwner();
  const launcherItems = useMemo<LauncherItem[]>(() => {
    const kind = (visibleWorkspaces.find((w) => w.id === workspaceId) ?? visibleWorkspaces[0])?.kind ?? "individual";
    const optional = new Set<string>(OPTIONAL_APP_IDS);
    const native = listLauncherApps(kind, { platformOwner })
      .filter((app) => !optional.has(app.id) || isItemInstalled(market.installed, app.id))
      .map((app) => ({
        app: {
          app_id: app.id,
          source_app_id: "elyra_native",
          name: app.name,
          category: appCategoryLabel(app.category),
          icon_name: app.id,
          launch_hint: app.id,
          status: "connected" as const,
          scope_hints: [],
        } as ResolvedAppsSurfaceEntry,
        isOpen: openAppIds.includes(app.id),
      }));
    const mcp = mcpServers.filter((m) => m.enabled).map((m) => ({
      app: {
        app_id: `mcp_${m.id}`, source_app_id: "mcp", name: m.name, category: "Verbundene Dienste", icon_name: "plug",
        launch_hint: "toolbox" as const, tool_id: "mcp", mcp_server_id: m.id,
        status: (m.status === "connected" ? "connected" : m.status === "error" ? "degraded" : "needs_auth") as ResolvedAppsSurfaceEntry["status"],
        scope_hints: [],
      } as ResolvedAppsSurfaceEntry,
      isOpen: false,
    }));
    return [...native, ...mcp];
  }, [workspaceId, visibleWorkspaces, platformOwner, openAppIds, mcpServers, market.installed]);

  const installedLauncherItems = launcherItems;

  const filteredInstalledItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return installedLauncherItems;
    return installedLauncherItems.filter((item) => {
      const app = item.app;
      const matchesName = app.name.toLowerCase().includes(q);
      const matchesCategory = app.category.toLowerCase().includes(q);
      const matchesScope = app.scope_hints.some((scope) => scope.toLowerCase().includes(q));
      return matchesName || matchesCategory || matchesScope;
    });
  }, [installedLauncherItems, search]);

  const recommendedItems = useMemo(() => {
    const uninstalled = manifests.filter(
      (manifest) =>
        manifest.surfaces.includes("apps_surface") &&
        !installedApps.some((entry) => entry.app_id === manifest.app_id && entry.installed),
    );
    return uninstalled
      .sort((a, b) => scoreRecommendation(b) - scoreRecommendation(a))
      .slice(0, 4);
  }, [manifests, installedApps]);

  const suggestionChips = useMemo(() => {
    const q = search.trim().toLowerCase();
    const fromCategories = manifests.map((manifest) => manifest.category);
    const fromActions = manifests.flatMap((manifest) => manifest.quick_actions.map((action) => action.label));
    const candidates = [...fromCategories, ...fromActions];
    const unique: string[] = [];
    for (const candidate of candidates) {
      const normalized = candidate.trim();
      if (!normalized) continue;
      if (q && normalized.toLowerCase().includes(q)) continue;
      if (!unique.includes(normalized)) unique.push(normalized);
      if (unique.length >= 5) break;
    }
    return unique;
  }, [manifests, search]);

  const showRecommendedEmpty = search.trim().length === 0 && installedLauncherItems.length === 0;
  const showNoResults = search.trim().length > 0 && filteredInstalledItems.length === 0;

  useEffect(() => {
    if (!open) {
      setSearch("");
      setError(null);
      return;
    }
    const timeout = window.setTimeout(() => {
      searchRef.current?.focus();
    }, 60);
    return () => window.clearTimeout(timeout);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const handleInstall = async (appId: string) => {
    setError(null);
    setInstallingByApp((prev) => ({ ...prev, [appId]: true }));
    try {
      const headers = await withSupabaseAuthorization({
        "content-type": "application/json",
        "x-workspace-id": workspaceId,
      });
      const response = await fetch("/api/os/workspace-admin/apps", {
        method: "PATCH",
        credentials: "include",
        headers,
        body: JSON.stringify({
          app_id: appId,
          action: "install",
        }),
      });
      const payload = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error ?? "Unable to install app");
      }
      await onAppsChanged?.();
    } catch (installError) {
      setError(installError instanceof Error ? installError.message : "Unable to install app");
    } finally {
      setInstallingByApp((prev) => ({ ...prev, [appId]: false }));
    }
  };

  return (
    <AnimatePresence>
      {open ? (
        <div
          className="fixed inset-0"
          style={{ zIndex: SHELL_LAYERS.overlay }}
          {...{ [SHELL_LAYER_DATA_ATTR]: "apps" }}
        >
          <motion.button
            type="button"
            className="absolute inset-0 border-0 bg-black/42 p-0 backdrop-blur-[2px]"
            onClick={onClose}
            aria-label="Close app launcher"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            {...{ [SHELL_LAYER_DATA_ATTR]: "apps" }}
          />

          <div className="absolute inset-0 lg:right-[360px]">
            <motion.section
              initial={{ opacity: 0, y: 20, scale: 0.985 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 14, scale: 0.985 }}
              transition={{ type: "spring", damping: 30, stiffness: 360 }}
              className="absolute left-1/2 top-[78px] max-h-[calc(100vh-190px)] w-[min(680px,calc(100%-32px))] -translate-x-1/2 overflow-y-auto overscroll-contain rounded-3xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-elevated)]/90 p-5 shadow-[0_34px_84px_rgba(16,42,86,0.24)] backdrop-blur-2xl"
              {...{ [SHELL_LAYER_DATA_ATTR]: "apps" }}
              style={{ WebkitBackdropFilter: "blur(26px) saturate(1.15)", backdropFilter: "blur(26px) saturate(1.15)" }}
              role="dialog"
              aria-modal="true"
              aria-label="System launcher"
            >
              <header className="rounded-2xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface)] px-3 py-2.5">
                <div className="flex items-center gap-2 text-xs text-[color:var(--text-muted)]">
                  <Search size={14} />
                  <input
                    ref={searchRef}
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Apps, Aktionen oder Werkzeuge suchen"
                    className="h-9 flex-1 bg-transparent text-sm text-[color:var(--text-primary)] outline-none placeholder:text-[color:var(--text-muted)]"
                  />
                </div>
              </header>

              {error ? (
                <div className="mt-3 rounded-xl border border-amber-300/40 bg-amber-100/60 px-3 py-2 text-xs text-amber-900">
                  {error}
                </div>
              ) : null}

              <div className="mt-4 space-y-4">
                {showRecommendedEmpty ? (
                  <section>
                    <div className="mb-2.5 flex items-center gap-2 text-[12px] font-medium uppercase tracking-[0.12em] text-[color:var(--text-muted)]">
                      <Sparkles size={14} />
                      Recommended apps
                    </div>
                    <div className="grid gap-2.5 sm:grid-cols-2">
                      {recommendedItems.map((item) => {
                        const canInstall = roleCanInstall(role, item);
                        const blockedReason = canInstall ? null : "Owner or admin role required";
                        return (
                          <RecommendedInstallCard
                            key={item.app_id}
                            app={item}
                            canInstall={canInstall}
                            blockedReason={blockedReason}
                            loading={Boolean(installingByApp[item.app_id])}
                            onInstall={() => handleInstall(item.app_id)}
                          />
                        );
                      })}
                    </div>
                  </section>
                ) : null}

                {!showRecommendedEmpty ? (
                  [...APP_CATEGORY_ORDER.map((group) => group.label), "Verbundene Dienste"].map((groupLabel) => {
                    const groupItems = filteredInstalledItems.filter((entry) => entry.app.category === groupLabel);
                    if (groupItems.length === 0) return null;
                    return (
                  <section key={groupLabel}>
                    <div className="mb-2.5 flex items-center gap-2 text-[12px] font-medium uppercase tracking-[0.12em] text-[color:var(--text-muted)]">
                      <Compass size={14} />
                      {groupLabel}
                    </div>
                    <div className="grid grid-cols-3 gap-1 sm:grid-cols-4 lg:grid-cols-6">
                      {groupItems.map((item) => {
                        const launchApp = item.app.launch_hint;
                        return (
                          <AppTile
                            key={`${item.app.source_app_id}:${item.app.app_id}`}
                            item={item.app}
                            isOpen={item.isOpen}
                            accent={accent}
                            onClick={() => {
                              if (launchApp) {
                                if (item.app.mcp_server_id) {
                                  try { window.sessionStorage.setItem("elyra:mcp-server", item.app.mcp_server_id); } catch { /* ignore */ }
                                  window.dispatchEvent(new CustomEvent("elyra:mcp-server", { detail: item.app.mcp_server_id }));
                                }
                                if (launchApp === "toolbox" && item.app.tool_id) selectToolboxTool(item.app.tool_id as ToolAppId);
                                onOpenApp(launchApp);
                              } else {
                                onFocusIntent();
                              }
                              onClose();
                            }}
                          />
                        );
                      })}
                    </div>
                  </section>
                    );
                  })
                ) : null}

                {market.miniApps.length > 0 && !search.trim() ? (
                  <section>
                    <div className="mb-2.5 flex items-center gap-2 text-[12px] font-medium uppercase tracking-[0.12em] text-[color:var(--text-muted)]">
                      <Sparkles size={14} />
                      Meine Mini-Apps
                    </div>
                    <div className="grid grid-cols-3 gap-1 sm:grid-cols-4 lg:grid-cols-6">
                      {market.miniApps.map((mini) => (
                        <button
                          key={mini.id}
                          type="button"
                          onClick={() => { openMiniApp(mini.id); onOpenApp("mini_apps"); onClose(); }}
                          className="group flex flex-col items-center gap-2 rounded-2xl p-3 transition duration-200 hover:bg-[color:var(--bg-surface-soft)]"
                        >
                          <div className="grid h-14 w-14 place-items-center rounded-2xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface)] text-2xl transition group-hover:-translate-y-0.5">{mini.icon}</div>
                          <span className="max-w-[88px] truncate text-[11px] font-medium text-[color:var(--text-secondary)]">{mini.name}</span>
                        </button>
                      ))}
                    </div>
                  </section>
                ) : null}

                {showNoResults ? (
                  <section className="rounded-2xl border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface)]/72 px-4 py-5 text-center">
                    <p className="text-sm font-semibold text-[color:var(--text-primary)]">No results for "{search}"</p>
                    <p className="mt-1 text-xs text-[color:var(--text-muted)]">
                      Try one of these suggestions from your installed manifest pack.
                    </p>
                    <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                      {suggestionChips.map((chip) => (
                        <button
                          key={chip}
                          type="button"
                          onClick={() => setSearch(chip)}
                          className="rounded-full border border-[color:var(--os-border-soft)] bg-[color:var(--bg-surface)] px-3 py-1 text-[11px] text-[color:var(--text-secondary)] transition hover:border-[color:var(--os-border-strong)] hover:text-[color:var(--text-primary)]"
                        >
                          {chip}
                        </button>
                      ))}
                    </div>
                  </section>
                ) : null}
              </div>

              <footer className="mt-4 text-center text-[11px] text-[color:var(--text-muted)]">
                ⌘K to toggle · Esc to close
              </footer>
            </motion.section>
          </div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}
