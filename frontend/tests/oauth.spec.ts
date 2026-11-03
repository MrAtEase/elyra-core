import { test, expect } from "@playwright/test";
import { getWorkspaceUrl } from "./utils/app";
import { stubWhoamiResponse } from "./utils/auth";

test.use({
  storageState: { cookies: [], origins: [] },
});

test("Workspace redirects to /signin without auto-starting Google OAuth", async ({ page, context }) => {
  await context.clearCookies();
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  await stubWhoamiResponse(page, {
    status: 401,
    body: {
      ok: false,
      code: "AUTH_REQUIRED",
      message: "Unauthorized",
      loginUrl: "https://api.elyra-core.app/assistant/oauth/google/start/",
      authUrl: "https://api.elyra-core.app/assistant/oauth/google/start/",
    },
  });

  let oauthHit = false;
  await page.route(
    "https://api.elyra-core.app/assistant/oauth/google/start/**",
    async (route) => {
      oauthHit = true;
      await route.fulfill({
        status: 200,
        contentType: "text/plain",
        body: "ok",
      });
    }
  );

  await page.goto(getWorkspaceUrl({ e2e: true }), {
    waitUntil: "domcontentloaded",
  });

  await page.waitForURL("**/signin");
  const signInLocator = page.locator('[data-e2e-signin-button="true"]');
  await expect(signInLocator).toBeVisible();
  expect(oauthHit).toBe(false);
});
