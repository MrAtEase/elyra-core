import { expect, test } from "@playwright/test";

const APP_BASE_URL = process.env.FDL_APP_URL?.trim() || "http://localhost:3000";

test.describe("OS run persistence", () => {
  test("run continues after browser page closes and artifacts appear after reopen", async ({ context, page }) => {
    const runId = "run-browser-close-1";
    const startAt = Date.now();
    let started = false;
    await context.addInitScript(() => {
      window.localStorage.removeItem("elyra.smoke.backbone_run_id");
    });

    await context.route("**/api/os/runs*", async (route, request) => {
      if (request.method() === "POST") {
        started = true;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ok: true,
            run: { id: runId, status: "queued" },
          }),
        });
        return;
      }
      await route.fallback();
    });

    await context.route(`**/api/os/runs/${runId}*`, async (route) => {
      const elapsed = Date.now() - startAt;
      const status = !started ? "queued" : elapsed < 1100 ? "running" : "succeeded";
      const artifacts =
        status === "succeeded"
          ? [{ id: "artifact-1", title: "Weather Snapshot", kind: "weather_forecast" }]
          : [];

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          run: { id: runId, status },
          artifacts,
        }),
      });
    });

    const postRequest = page.waitForRequest(
      (request) => request.url().includes("/api/os/runs") && request.method() === "POST",
      { timeout: 12_000 },
    );
    await page.goto(new URL("/os/smoke/backbone?autostart=1", APP_BASE_URL).toString(), { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("backbone-hydrated")).toContainText("hydrated:yes", { timeout: 8_000 });
    await postRequest;

    await expect(page.getByTestId("backbone-run-id")).toContainText(runId);
    await expect(page.getByTestId("backbone-status")).not.toContainText("idle");

    await page.close();

    const reopened = await context.newPage();
    await reopened.goto(new URL("/os/smoke/backbone?autostart=1", APP_BASE_URL).toString(), { waitUntil: "domcontentloaded" });

    await expect(reopened.getByTestId("backbone-run-id")).toContainText(runId, { timeout: 8_000 });
    await expect(reopened.getByTestId("backbone-status")).toContainText("succeeded", { timeout: 12_000 });
    await expect(reopened.getByTestId("artifact-list")).toContainText("Weather Snapshot");
  });
});
