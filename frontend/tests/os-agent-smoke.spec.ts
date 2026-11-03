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

test.describe("OS Agent mode smoke", () => {
  test("shows project/chat/runs/shortcuts rails and allows creating chats", async ({ page, context }) => {
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

    await page.route("**/api/google/status**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          user: { id: "user-123", email: "test@elyra-core.app", avatarUrl: null, initials: "EC" },
          workspace: { id: workspace.id, name: workspace.name, slug: workspace.slug },
          google: {
            connected: true,
            scopes: ["gmail.readonly", "calendar.readonly"],
            hasGmailRead: true,
            hasCalendarRead: true,
            hasCalendarWrite: false,
            config: { ready: true, issues: [] },
            error: null,
          },
        }),
      });
    });

    await page.route("**/api/os/bootstrap**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          contract: {
            tool_registry: [],
          },
          ui: {
            visible_surfaces: ["dashboard", "assistant", "goals", "apps", "settings"],
            apps_surface_apps: [],
            dashboard_widgets: [],
            orb_quick_actions: [
              {
                app_id: "mail",
                app_name: "Mail",
                action_id: "mail-summarize",
                label: "Summarize thread",
                intent: "Summarize this thread",
                tool_ref: "google_mail.summarize_thread",
                requires_auth: true,
                requires_approval: false,
                state: "ready",
                badges: ["connected"],
              },
            ],
          },
        }),
      });
    });

    await page.route("**/api/os/dashboard**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, error: "dashboard skipped in smoke test" }),
      });
    });

    await page.route("**/api/os/projects**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          projects: [{ id: "project-1", workspace_id: workspace.id, name: "Main Project", archived: false }],
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

    await page.route("**/v1/chat/history**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ messages: [] }),
      });
    });

    await page.route("**/v1/chat", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ content: "ok" }),
      });
    });

    await page.goto(new URL("/os/agent?os_e2e=1", APP_BASE_URL).toString(), { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("os-shell-ready")).toBeVisible({ timeout: 8_000 });
    await expect(page.getByRole("button", { name: /^Agent$/i })).toBeVisible();

    const dock = page.getByLabel("AI control dock");
    await expect(dock).toBeVisible();
    await expect(dock.getByRole("button", { name: "Project" })).toBeVisible();
    await expect(dock.getByRole("button", { name: "Chat" })).toBeVisible();
    await expect(dock.getByRole("button", { name: "Runs" })).toBeVisible();
    await expect(dock.getByRole("button", { name: "Shortcuts" })).toBeVisible();

    await dock.getByRole("button", { name: "Chat" }).click();
    await dock.getByRole("button", { name: /New Chat/i }).click();
    await expect(dock.getByText("New Chat")).toBeVisible();

    await page.goto(new URL("/os/mail?os_e2e=1", APP_BASE_URL).toString(), { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("os-shell-ready")).toBeVisible({ timeout: 8_000 });
    const mailDock = page.getByLabel("AI control dock");
    await mailDock.getByRole("button", { name: "Shortcuts" }).click();
    await expect(mailDock.getByText("Summarize thread")).toBeVisible();
  });
});
