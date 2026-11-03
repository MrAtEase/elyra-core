import { chromium } from "playwright";

import { getWorkspaceUrl } from "../tests/utils/app";

async function runAuthFlowCheck() {
  const targetUrl = getWorkspaceUrl({ e2e: true });
  console.log(`Checking auth flow at ${targetUrl}`);

  const browser = await chromium.launch();
  const page = await browser.newPage();
  let panelVisible = false;
  let buttonVisible = false;

  try {
    const whoamiPromise = page
      .waitForResponse(
        (response) => response.url().includes("/assistant/auth/whoami"),
        { timeout: 6000 }
      )
      .catch(() => null);

    await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
    await page.waitForURL("**/signin");
    const whoamiResponse = await whoamiPromise;
    console.log(`whoami status: ${whoamiResponse?.status() ?? "no response"}`);

    await page.waitForTimeout(500);

    const panelLocator = page.locator('[data-e2e-signin-panel="true"]');
    panelVisible = (await panelLocator.count()) > 0 && (await panelLocator.first().isVisible());
    const buttonLocator = page.locator('[data-e2e-signin-button="true"]');
    buttonVisible = (await buttonLocator.count()) > 0 && (await buttonLocator.first().isVisible());
    const authState = await page.getAttribute(".workspace-shell", "data-auth-state");

    console.log(`authState=${authState ?? "unknown"}; panelVisible=${panelVisible}; buttonVisible=${buttonVisible}`);

    if (!panelVisible || !buttonVisible) {
      console.warn("Sign-in panel or button missing");
      process.exitCode = 1;
    }
  } catch (error) {
    console.error("Auth flow check failed", error);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

void runAuthFlowCheck();
