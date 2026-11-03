import { test, expect, type Page } from "@playwright/test";
import { getWorkspaceUrl } from "./utils/app";
import { stubWhoamiResponse } from "./utils/auth";
import type { WhoamiResponse, WhoamiWorkspace } from "../types/whoami";

test.describe.configure({ mode: "serial" });

const personalWorkspace: WhoamiWorkspace = {
  id: "workspace-personal",
  slug: "/privat",
  type: "personal",
  name: "Personal Workspace",
  brand: {
    productName: "Fish Delish",
    assistantName: "Merlin",
    workspaceLabel: "Fish Delish · Portugal Workspace",
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
  workspaces: [personalWorkspace],
  activeWorkspace: personalWorkspace,
  activeWorkspaceId: personalWorkspace.id,
  membership: null,
  capabilities: [],
  onboarding: { state: "done", workspaceId: personalWorkspace.id, payload: null, updatedAt: Date.now() },
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

// Localhost cannot receive the `.elyra-core.app` `mf-s` cookie, so `/assistant/auth/whoami` replies 401 whenever the cookie is missing; these smoke tests stub that guard to keep the flow deterministic.
const signInPanel = (page: Page) => page.locator('[data-e2e-signin-panel="true"]');
const signInButton = (page: Page) => page.locator('[data-e2e-signin-button="true"]');

test.describe("Auth smoke", () => {
  test("shows Sign in when unauthenticated", async ({ page }) => {
    await stubWhoamiResponse(page, {
      status: 401,
      body: {
        ok: false,
        message: "Unauthorized",
        loginUrl: "https://api.elyra-core.app/login",
      },
    });

    await page.goto(getWorkspaceUrl({ e2e: true }));
    await expect(signInPanel(page)).toBeVisible();
    await expect(signInButton(page)).toBeVisible();
    await expect(page).toHaveURL(/\/workspace/);
  });

  test("shows Ready to sign in panel on 401 whoami", async ({ page }) => {
    await stubWhoamiResponse(page, {
      status: 401,
      body: {
        ok: false,
        message: "Unauthorized",
        loginUrl: "https://api.elyra-core.app/login",
      },
    });

    await page.goto(getWorkspaceUrl({ e2e: false }));
    await page.waitForURL("**/signin");
    await expect(signInPanel(page)).toBeVisible();
    await expect(signInButton(page)).toBeVisible();
  });

  test("shows Sign in when whoami fetch rejects", async ({ page }) => {
    await stubWhoamiResponse(page, { reject: true });

    await page.goto(getWorkspaceUrl({ e2e: true }));
    await expect(signInPanel(page)).toBeVisible();
    await expect(signInButton(page)).toBeVisible();
    await expect(page).toHaveURL(/\/workspace/);
  });

  test("shows logout and workspaces when authenticated", async ({ page, context }) => {
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

    await page.goto(getWorkspaceUrl({ e2e: false }), { waitUntil: "domcontentloaded" });
    await expect(signInButton(page)).toHaveCount(0);
    await expect(page.locator('[data-auth-state="authenticated"]')).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Personal Workspace" })
    ).toBeVisible();

    await page.getByRole("button", { name: "Profile" }).click();
    await expect(page.getByRole("menuitem", { name: "Logout" })).toBeVisible();

    await page.route("**/assistant/auth/logout**", async (route) => {
      await context.clearCookies();
      await route.fulfill({
        status: 204,
        body: "",
      });
    });

    await stubWhoamiResponse(page, {
      status: 401,
      body: {
        ok: false,
        message: "Unauthorized",
        loginUrl: "https://api.elyra-core.app/login",
      },
    });

    const navigationPromise = page.waitForURL("**/signin");
    await page.getByRole("menuitem", { name: "Logout" }).click();
    await navigationPromise;
    await expect(signInPanel(page)).toBeVisible();
    await expect(signInButton(page)).toBeVisible();
    await page.unroute("**/assistant/auth/logout**");
  });

  test("logout shows SSR login panel after cookie is removed", async ({ page, context }) => {
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

    await page.goto(getWorkspaceUrl({ e2e: false }), { waitUntil: "domcontentloaded" });
    await expect(signInButton(page)).toHaveCount(0);

    await page.getByRole("button", { name: "Profile" }).click();
    await expect(page.getByRole("menuitem", { name: "Logout" })).toBeVisible();

    await page.route("**/assistant/auth/logout**", async (route) => {
      await context.clearCookies();
      await route.fulfill({
        status: 204,
        body: "",
      });
    });

    await stubWhoamiResponse(page, {
      status: 401,
      body: {
        ok: false,
        message: "Unauthorized",
        loginUrl: "https://api.elyra-core.app/login",
      },
    });

    const navigationPromise = page.waitForURL("**/signin");
    await page.getByRole("menuitem", { name: "Logout" }).click();
    await navigationPromise;

    await expect(signInPanel(page)).toBeVisible();
    await expect(signInButton(page)).toBeVisible();

    await page.unroute("**/assistant/auth/logout**");
  });

  test("direct workspace navigation without cookies shows SSR gate", async ({ page, context }) => {
    await context.clearCookies();
    await page.addInitScript(() => {
      localStorage.clear();
      sessionStorage.clear();
    });

    await stubWhoamiResponse(page, {
      status: 401,
      body: {
        ok: false,
        message: "Unauthorized",
        loginUrl: "https://api.elyra-core.app/login",
      },
    });

    await page.goto(getWorkspaceUrl({ e2e: true }));
    await page.waitForURL("**/signin");
    await expect(signInPanel(page)).toBeVisible();
    await expect(signInButton(page)).toBeVisible();
  });
});

test.describe("Workspace mail", () => {
  test("shows mail threads, creates tasks, and reacts to realtime updates", async ({ page, context }) => {
    const workspaceId = personalWorkspace.id;
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

    const mailThreadsState = [
      {
        id: "mail-thread-initial",
        workspace_id: workspaceId,
        integration_id: null,
        external_id: "gmail-thread-1",
        subject: "Invoice follow-up",
        snippet: "Can you confirm delivery…",
        from_email: "supplier@x.com",
        to_emails: ["ops@x.com"],
        last_message_at: "2025-04-06T12:00:00Z",
        raw: { preview: true },
        created_at: "2025-04-06T11:55:00Z",
        updated_at: "2025-04-06T12:00:00Z",
      },
    ];

    await page.route("**/rest/v1/mail_threads*", async (route) => {
      const request = route.request();
      if (request.method() !== "GET") {
        return route.fallback();
      }
      const total = mailThreadsState.length;
      const rangeEnd = total ? total - 1 : 0;
      await route.fulfill({
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "content-range": `0-${rangeEnd}/${total}`,
        },
        body: JSON.stringify(mailThreadsState),
      });
    });

    const entityLinkRequests: Record<string, unknown>[] = [];
    await page.route("**/rest/v1/entity_links*", async (route) => {
      const request = route.request();
      if (request.method() !== "POST") {
        return route.fallback();
      }
      const body = JSON.parse(await request.postData() ?? "{}");
      expect(body.kind).toBe("task_to_mail_thread");
      expect(body.mail_thread_id).toBe("mail-thread-initial");
      entityLinkRequests.push(body);
      await route.fulfill({
        status: 201,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: "link-mail-thread-initial" }),
      });
    });

    await page.route("**/rest/v1/tasks*", async (route) => {
      const request = route.request();
      if (request.method() !== "POST") {
        return route.fallback();
      }
      const body = JSON.parse(await request.postData() ?? "{}");
      expect(body.workspace_id).toBe(workspaceId);
      expect(body.source).toBe("gmail");
      expect(body.external_ref).toBe("gmail-thread-1");
      expect(body.created_by).toBe("user-123");
      const timestamp = new Date().toISOString();
      await route.fulfill({
        status: 201,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: "task-from-mail",
          title: "Invoice follow-up",
          status: "open",
          priority: 0,
          due_at: null,
          assigned_to: null,
          workspace_id: workspaceId,
          created_by: "user-123",
          created_at: timestamp,
          updated_at: timestamp,
        }),
      });
    });

    const mailUrl = new URL("comm/gmail", getWorkspaceUrl()).toString();
    await page.goto(mailUrl, { waitUntil: "domcontentloaded" });

    await page.waitForResponse(
      (response) => response.url().includes("/rest/v1/mail_threads") && response.request().method() === "GET"
    );

    await expect(page.getByRole("heading", { name: "Mail" })).toBeVisible();
    await expect(
      page.locator('[data-e2e-mail-thread-subject="thread-mail-thread-initial"]')
    ).toHaveText("Invoice follow-up");

    await page.locator('[data-e2e-mail-thread-row="thread-mail-thread-initial"]').click();
    const detail = page.locator('[data-e2e-mail-detail="true"]');
    await expect(detail).toBeVisible();
    await expect(detail.locator('[data-e2e-mail-detail-from="true"]')).toHaveText("From: supplier@x.com");
    await expect(detail.locator('[data-e2e-mail-detail-snippet="true"]')).toHaveText(
      "Can you confirm delivery…"
    );

    const waitTasksPost = page.waitForResponse(
      (response) => response.url().includes("/rest/v1/tasks") && response.request().method() === "POST"
    );
    const waitLinksPost = page.waitForResponse(
      (response) => response.url().includes("/rest/v1/entity_links") && response.request().method() === "POST"
    );

    await Promise.all([
      waitTasksPost,
      waitLinksPost,
      page.locator('[data-e2e-create-task-from-thread="thread-mail-thread-initial"]').click(),
    ]);

    await expect(page.getByText("Task created")).toBeVisible();
    await expect(page.getByText("Invoice follow-up · task-from-mail")).toBeVisible();
    expect(entityLinkRequests.length).toBeGreaterThan(0);

    await page.waitForFunction(() => !!(window as any).__fdMailRealtimeBridge?.insertThread);
    await page.evaluate((workspaceIdValue) => {
      const bridge = (window as any).__fdMailRealtimeBridge;
      if (!bridge) {
        return;
      }
      const now = new Date().toISOString();
      bridge.insertThread({
        id: "mail-thread-realtime",
        workspace_id: workspaceIdValue,
        integration_id: null,
        external_id: "gmail-thread-realtime",
        subject: "Realtime mail",
        snippet: "Realtime snippet delivered via bridge.",
        from_email: "ops@x.com",
        to_emails: ["ops@x.com"],
        last_message_at: now,
        raw: { injected: true },
        created_at: now,
        updated_at: now,
      });
    }, workspaceId);

    await expect(page.getByText("Realtime mail")).toBeVisible();
  });
});

test.describe("Workspace tasks", () => {
  test("renders workspace tasks and updates status", async ({ page, context }) => {
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

    const workspaceId = personalWorkspace.id;
    const tasksState = [
      {
        id: "task-initial",
        workspace_id: workspaceId,
        title: "Existing task",
        status: "open",
        priority: 2,
        due_at: "2025-01-01T12:00:00Z",
        assigned_to: null,
        created_by: "user-123",
        created_at: "2025-01-01T12:00:00Z",
        updated_at: "2025-01-01T12:00:00Z",
      },
    ];

    let tasksHits = 0;

    await page.route("**/rest/v1/tasks*", async (route) => {
      tasksHits++;

      const request = route.request();
      const method = request.method();
      const url = new URL(request.url());

      if (method === "GET") {
        const total = tasksState.length;
        const rangeEnd = total ? total - 1 : 0;
        await route.fulfill({
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "content-range": `0-${rangeEnd}/${total}`,
          },
          body: JSON.stringify(tasksState),
        });
        return;
      }
      if (method === "POST") {
        const body = await request.postDataJSON();
        const requestedWorkspaceId =
          body.workspace_id ?? body.workspaceId ?? workspaceId;
        const created = {
          id: `task-${Date.now()}`,
          workspace_id: requestedWorkspaceId,
          title: body.title,
          status: body.status,
          priority: body.priority,
          due_at: body.due_at,
          assigned_to: body.assigned_to,
          created_by: body.created_by ?? "user-123",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        tasksState.unshift(created);
        await route.fulfill({
          status: 201,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(created),
        });
        return;
      }
      if (method === "PATCH") {
        const url = new URL(request.url());
        const taskId = url.searchParams.get("id")?.replace("eq.", "");
        const patch = await request.postDataJSON();
        const taskIndex = tasksState.findIndex((item) => item.id === taskId);
        if (taskIndex === -1) {
          await route.fulfill({ status: 404, body: JSON.stringify({ message: "not found" }) });
          return;
        }
        const updated = {
          ...tasksState[taskIndex],
          ...patch,
          updated_at: new Date().toISOString(),
        };
        tasksState[taskIndex] = updated;
        await route.fulfill({
          status: 200,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updated),
        });
        return;
      }
      return route.fallback();
    });

    const tasksUrl = new URL("work/tasks", getWorkspaceUrl()).toString();
    await page.goto(tasksUrl, { waitUntil: "domcontentloaded" });
    const tasksResponse = await page.waitForResponse((response) =>
      response.url().includes("/rest/v1/tasks") && response.request().method() === "GET"
    );
    await expect.poll(() => tasksHits).toBeGreaterThan(0);
    await expect(page.getByRole("heading", { name: "Tasks" })).toBeVisible();
    await expect(page.locator('[data-e2e-task-row="task-initial"]')).toBeVisible();
    await expect(
      page.locator('[data-e2e-task-row="task-initial"] [data-e2e-task-title]')
    ).toHaveValue("Existing task");

    await page.fill('[data-e2e-new-task-title="true"]', "Playwright task");
    await page.getByRole("button", { name: "Add Task" }).click();
    const newTaskRow = page.locator('[data-e2e-task-row]:not([data-task-id="task-initial"])');
    await expect(newTaskRow).toHaveCount(1);
    await expect(newTaskRow.locator('[data-e2e-task-title]')).toHaveValue("Playwright task");

    const statusSelect = page.locator('[data-task-status="status-task-initial"]');
    await statusSelect.selectOption("done");
    await expect(statusSelect).toHaveValue("done");
  });
});

test.describe("Workspace calendar", () => {
  test("renders workspace calendar entries and reacts to realtime inserts", async ({ page, context }) => {
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

    const workspaceId = personalWorkspace.id;
    const calendarEventsState = [
      {
        id: "calendar-event-initial",
        workspace_id: workspaceId,
        external_id: "calendar-event-initial",
        title: "Team Planning Call",
        description: "Weekly sync on priorities",
        start_at: "2025-04-07T09:30:00Z",
        end_at: "2025-04-07T10:00:00Z",
        organizer_email: "team@elyra-core.app",
        created_at: "2025-04-01T08:00:00Z",
        updated_at: "2025-04-01T08:00:00Z",
      },
    ];
    const tasksState = [
      {
        id: "task-calendar-initial",
        workspace_id: workspaceId,
        title: "Budget review follow-up",
        status: "open",
        priority: 1,
        due_at: "2025-04-07T15:00:00Z",
        assigned_to: null,
        created_by: "user-123",
        created_at: "2025-04-01T08:00:00Z",
        updated_at: "2025-04-01T08:00:00Z",
      },
    ];

    await page.route("**/rest/v1/calendar_events*", async (route) => {
      const request = route.request();
      if (request.method() !== "GET") {
        return route.fallback();
      }
      const total = calendarEventsState.length;
      const rangeEnd = total ? total - 1 : 0;
      await route.fulfill({
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "content-range": `0-${rangeEnd}/${total}`,
        },
        body: JSON.stringify(calendarEventsState),
      });
    });

    await page.route("**/rest/v1/tasks*", async (route) => {
      const request = route.request();
      if (request.method() !== "GET") {
        return route.fallback();
      }
      const total = tasksState.length;
      const rangeEnd = total ? total - 1 : 0;
      await route.fulfill({
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "content-range": `0-${rangeEnd}/${total}`,
        },
        body: JSON.stringify(tasksState),
      });
    });

    const calendarUrl = new URL("work/calendar", getWorkspaceUrl()).toString();
    await page.goto(calendarUrl, { waitUntil: "domcontentloaded" });

    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes("/rest/v1/calendar_events") && response.request().method() === "GET"
      ),
      page.waitForResponse(
        (response) => response.url().includes("/rest/v1/tasks") && response.request().method() === "GET"
      ),
    ]);

    await expect(page.getByRole("heading", { name: "Calendar" })).toBeVisible();
    await expect(page.getByText("Team Planning Call")).toBeVisible();
    await expect(page.getByText("Budget review follow-up")).toBeVisible();

    await page.waitForFunction(() => !!(window as any).__fdCalendarRealtimeBridge?.publish);
    await page.evaluate(() => {
      const bridge = (window as any).__fdCalendarRealtimeBridge;
      if (!bridge) {
        return;
      }
      const now = new Date().toISOString();
      bridge.publish({
        table: "calendar_events",
        event: "INSERT",
        newRecord: {
          id: "calendar-event-realtime",
          workspace_id: "workspace-personal",
          external_id: "calendar-event-realtime",
          title: "Realtime stand-up",
          description: "Injected realtime event",
          start_at: "2025-04-08T08:00:00Z",
          end_at: "2025-04-08T08:30:00Z",
          organizer_email: "team@elyra-core.app",
          created_at: now,
          updated_at: now,
        },
      });
    });

    await expect(page.getByText("Realtime stand-up")).toBeVisible();
  });
});
