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

test.describe("OS UI consistency smoke", () => {
  test("keeps shell readable and consistent across main surfaces", async ({ page, context }) => {
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

    await page.route("**/api/os/bootstrap**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, error: "bootstrap skipped in smoke test" }),
      });
    });

    await page.route("**/api/os/dashboard**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, error: "dashboard skipped in smoke test" }),
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

    await page.goto(new URL("/os?os_e2e=1", APP_BASE_URL).toString(), {
      waitUntil: "domcontentloaded",
    });

    await expect(page.getByTestId("os-shell-ready")).toBeVisible({ timeout: 8_000 });
    await expect(page.locator('[aria-label="AI control dock"]')).toBeVisible();
    await expect(page.locator('[data-elyra-page-shell="true"]').first()).toBeVisible();

    const systemButtons = page.getByRole("button", { name: /^system$/i });
    await expect(systemButtons.first()).toBeVisible();
    await expect(systemButtons).toHaveCount(1);

    for (const tab of ["Agent", "Goals", "Apps", "System"]) {
      await page.getByRole("button", { name: new RegExp(`^${tab}$`, "i") }).click();
      await expect(page.getByRole("button", { name: new RegExp(`^${tab}$`, "i") })).toBeVisible();
    }

    const orbButton = page.getByRole("button", { name: "Open orb panel" });
    await expect(orbButton).toBeVisible();
    const orbBox = await orbButton.boundingBox();
    expect(orbBox).not.toBeNull();
    expect(orbBox!.width).toBeGreaterThanOrEqual(46);
    expect(orbBox!.width).toBeLessThanOrEqual(60);
  });
});
