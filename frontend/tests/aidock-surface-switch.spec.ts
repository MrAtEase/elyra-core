import { expect, test } from "@playwright/test";
import { stubWhoamiResponse } from "./utils/auth";
import type { WhoamiResponse, WhoamiWorkspace } from "../types/whoami";

const APP_BASE_URL = process.env.FDL_APP_URL?.trim() || "http://localhost:3000";

const workspace: WhoamiWorkspace = {
  id: "workspace-platform",
  slug: "elyra-core",
  type: "platform",
  name: "Elyra Core",
  brand: {
    productName: "Elyra Core",
    assistantName: "Elli",
    workspaceLabel: "Elyra Core",
  },
  defaultThemeKey: null,
  brandNameOverride: null,
};

const authenticatedWhoamiPayload: WhoamiResponse = {
  ok: true,
  user: {
    id: "user-123",
    email: "test@elyra-core.app",
  },
  userId: "user-123",
  userKey: "user-123",
  workspaces: [workspace],
  activeWorkspace: workspace,
  activeWorkspaceId: workspace.id,
  membership: null,
  capabilities: [],
  onboarding: { state: "done", workspaceId: workspace.id, payload: null, updatedAt: Date.now() },
  userSettings: {
    locale: null,
    orbVariant: null,
    theme: null,
    defaultWorkspaceId: null,
    alwaysPersonalOnLogin: false,
  },
  resolvedTheme: "light-classic",
  availableThemes: [],
  workspaceConnections: [],
};

test.describe("AI Dock rail behavior", () => {
  test("renders dock and supports keyboard reorder with reset", async ({ page, context }) => {
    await context.clearCookies();
    await context.addCookies([
      {
        name: "mf-s",
        value: "stubbed-auth-cookie",
        domain: "localhost",
        path: "/",
      },
    ]);
    await page.addInitScript(() => {
      localStorage.clear();
      sessionStorage.clear();
    });

    await stubWhoamiResponse(page, {
      status: 200,
      body: authenticatedWhoamiPayload,
    });

    await page.route("**/api/google/status**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          user: { id: "user-123", email: "test@elyra-core.app", avatarUrl: null, initials: "EC" },
          workspace: { id: workspace.id, name: workspace.name, slug: workspace.slug },
          google: {
            connected: false,
            scopes: [],
            hasGmailRead: false,
            hasCalendarRead: false,
            hasCalendarWrite: false,
            config: { ready: true, issues: [] },
            error: null,
          },
        }),
      });
    });

    await page.route("**/api/supabase/token", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          access_token: "stub-token",
          expires_at: Date.now() + 60_000,
          expires_in: 60,
        }),
      });
    });

    await page.route("**/v1/intents/latest**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ workspaceId: workspace.id, bundle: null }),
      });
    });

    await page.route("**/api/os/projects**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, projects: [] }),
      });
    });

    await page.route("**/api/os/bootstrap**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          contract: {
            workspace_id: "ws-personal",
            workspace_capabilities: {
              workspace_id: "ws-personal",
              contract_version: "v1.0",
              policy_version: 1,
              updated_at: new Date().toISOString(),
              surfaces: {
                dashboard: "enabled",
                assistant: "enabled",
                goals: "enabled",
                apps: "enabled",
                settings: "enabled",
                builder: "enabled",
                marketplace: "enabled",
              },
              capabilities: {},
            },
            app_manifest: [],
            installed_apps: [],
            integration_status: [],
            tool_registry: [],
            generated_at: new Date().toISOString(),
          },
          ui: {
            visible_surfaces: ["dashboard", "assistant", "goals", "apps", "settings"],
            orb_quick_actions: [],
            edge_rail_apps: [],
            apps_surface_apps: [],
            dashboard_widgets: [],
          },
        }),
      });
    });

    await page.goto(new URL("/os/smoke?rail=1", APP_BASE_URL).toString(), { waitUntil: "domcontentloaded" });
    const dock = page.getByLabel("AI control dock");
    await expect(dock).toBeVisible({ timeout: 10_000 });

    await dock.getByRole("button", { name: "Move Project up" }).click();
    await expect(dock.getByRole("button", { name: "Project", exact: true })).toBeVisible();
    await expect(dock.getByRole("button", { name: "Artifacts", exact: true })).toBeVisible();

    await dock.getByRole("button", { name: "Reset panel order" }).click();
    await expect(dock.getByRole("button", { name: "Processes / Runs", exact: true })).toBeVisible();
  });
});
