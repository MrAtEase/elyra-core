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

test.describe("OS Ely Rail smoke", () => {
  test("shows ely panel and keeps edge rail visible", async ({ page, context }) => {
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

    await page.route("**/v1/intent", async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ message: "intent service unavailable" }),
      });
    });

    await page.goto(new URL("/os/smoke?rail=1", APP_BASE_URL).toString(), { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("os-shell-ready")).toBeVisible({ timeout: 8_000 });

    await page.mouse.move(1, 220);
    const edgeRail = page.getByLabel("Ely rail");
    await expect(edgeRail).toBeVisible({ timeout: 8_000 });
    const elyPanel = page.getByLabel("AI control dock");
    await expect(elyPanel).toBeVisible();

    await expect(elyPanel.getByText(/^No run steps yet\.$/)).toBeVisible({ timeout: 8_000 });

    await expect(edgeRail).toBeVisible();
    await expect(elyPanel.getByText(/^No run steps yet\.$/)).toBeVisible();
  });
});
