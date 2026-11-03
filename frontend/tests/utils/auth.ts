import type { Page } from "@playwright/test";
import type { WhoamiResponse } from "../../types/whoami";

type AuthRequiredResponse = {
  ok: false;
  message: string;
  loginUrl: string;
  code?: string;
  authUrl?: string;
};

type WhoamiStubResponse =
  | { reject: true; message?: string }
  | {
      reject?: false;
      status: number;
      body: WhoamiResponse | AuthRequiredResponse;
    };

// Local Playwright runs on http://localhost:3000, but the worker sets the `mf-s` cookie for
// `.elyra-core.app`. The browser can therefore never receive the cookie, and `/assistant/auth/whoami`
// responds 401 when `mf-s` is missing. These stubs keep the UI deterministic while still matching
// that production guard behavior.
const WHOAMI_PATTERN = "**/assistant/auth/whoami**";

export async function stubWhoamiResponse(page: Page, response: WhoamiStubResponse) {
  await page.unroute(WHOAMI_PATTERN);
  await page.route(WHOAMI_PATTERN, async (route) => {
    if (response.reject) {
      await route.abort(response.message ?? "failed");
      return;
    }
    await route.fulfill({
      status: response.status,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(response.body),
    });
  });
}
