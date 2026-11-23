"use client";

/**
 * Client-side marketplace state, shared by launcher, desktop, marketplace window and Elly.
 * One fetch per workspace; every change notifies all subscribers.
 */
import { useCallback, useEffect, useState } from "react";
import { withSupabaseAuthorization } from "@/lib/auth/clientAuthHeaders";
import type { InstalledMap } from "@/lib/marketplace/catalog";

export type MiniAppSummary = { id: string; name: string; description: string; icon: string; created_at: string; updated_at: string };

export type MarketplaceState = {
  loaded: boolean;
  installed: InstalledMap;
  canManage: boolean;
  /** Own personal workspace – sensitive templates (health, money) are only offered here. */
  personal: boolean;
  miniApps: MiniAppSummary[];
  setupError: string | null;
};

const EMPTY: MarketplaceState = { loaded: false, installed: null, canManage: false, personal: false, miniApps: [], setupError: null };
const cache = new Map<string, MarketplaceState>();
const inflight = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();

const notify = () => listeners.forEach((fn) => fn());

export async function marketplaceRequest<T = Record<string, unknown>>(workspaceId: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch("/api/os/marketplace", {
    method: "POST",
    credentials: "include",
    headers: await withSupabaseAuthorization({ "content-type": "application/json" }),
    body: JSON.stringify({ workspaceId, ...body }),
  });
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string } & T;
  if (!res.ok || !data.ok) throw new Error(data.error || `Fehler ${res.status}`);
  return data;
}

export function refreshMarketplace(workspaceId: string): Promise<void> {
  const running = inflight.get(workspaceId);
  if (running) return running;
  const job = (async () => {
    try {
      const res = await fetch(`/api/os/marketplace?workspaceId=${encodeURIComponent(workspaceId)}`, {
        credentials: "include",
        cache: "no-store",
        headers: await withSupabaseAuthorization(),
      });
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; installed?: InstalledMap; canManage?: boolean; personal?: boolean; miniApps?: MiniAppSummary[]; setupError?: string; error?: string }
        | null;
      if (!res.ok || !data?.ok) {
        // Not reachable: keep everything visible (installed = null) rather than hiding apps.
        cache.set(workspaceId, { ...EMPTY, loaded: true, setupError: data?.error ?? null });
      } else {
        cache.set(workspaceId, {
          loaded: true,
          installed: data.installed ?? null,
          canManage: Boolean(data.canManage),
          personal: Boolean(data.personal),
          miniApps: data.miniApps ?? [],
          setupError: data.setupError ?? null,
        });
      }
    } catch {
      cache.set(workspaceId, { ...EMPTY, loaded: true });
    } finally {
      inflight.delete(workspaceId);
      notify();
    }
  })();
  inflight.set(workspaceId, job);
  return job;
}

export function useMarketplace(workspaceId: string) {
  const [state, setState] = useState<MarketplaceState>(() => cache.get(workspaceId) ?? EMPTY);

  useEffect(() => {
    const sync = () => setState(cache.get(workspaceId) ?? EMPTY);
    listeners.add(sync);
    sync();
    if (!cache.has(workspaceId)) void refreshMarketplace(workspaceId);
    return () => { listeners.delete(sync); };
  }, [workspaceId]);

  const setItem = useCallback(async (itemId: string, install: boolean) => {
    await marketplaceRequest(workspaceId, { action: install ? "install" : "uninstall", itemId });
    const current = cache.get(workspaceId) ?? { ...EMPTY, loaded: true };
    cache.set(workspaceId, { ...current, installed: { ...(current.installed ?? {}), [itemId]: install } });
    notify();
  }, [workspaceId]);

  return { ...state, setItem, refresh: () => refreshMarketplace(workspaceId) };
}

// ── Cross-component signals ─────────────────────────────────────────────────

export const MARKETPLACE_OPEN_EVENT = "elyra:marketplace-open";
export const MINI_APP_OPEN_EVENT = "elyra:mini-app-open";
export const INSTALL_REQUEST_EVENT = "elyra:install-request";
export const PREFILL_INTENT_EVENT = "elyra:prefill-intent";

export type MarketplaceOpenDetail = { tab?: "apps" | "templates" | "skills" | "connectors" | "build"; buildDescription?: string; autoBuild?: boolean; templateId?: string };

export function openMarketplace(detail: MarketplaceOpenDetail = {}) {
  try { window.sessionStorage.setItem(MARKETPLACE_OPEN_EVENT, JSON.stringify(detail)); } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent<MarketplaceOpenDetail>(MARKETPLACE_OPEN_EVENT, { detail }));
}

export function openMiniApp(id: string) {
  try { window.sessionStorage.setItem(MINI_APP_OPEN_EVENT, id); } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent<string>(MINI_APP_OPEN_EVENT, { detail: id }));
}

export function prefillIntent(text: string) {
  window.dispatchEvent(new CustomEvent<string>(PREFILL_INTENT_EVENT, { detail: text }));
}

/** Ask the shell to open an app (handles routed apps and floating windows alike). */
export const OPEN_APP_EVENT = "elyra:open-app";
export function requestOpenApp(appId: string) {
  window.dispatchEvent(new CustomEvent<string>(OPEN_APP_EVENT, { detail: appId }));
}
