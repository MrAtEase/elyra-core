import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ValidationError, AppError } from "../lib/errors.js";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import { resolveAuthorizedWorkspaceId } from "../db/repos/workspace-access.js";
import { executeTool, listTools } from "../tools/index.js";
import { db } from "../db/client.js";
import { logger } from "../lib/logger.js";

const querySchema = z.object({
  workspaceId: z.string().min(1),
});

type ToolEvent = {
  summary?: unknown;
};

type CalendarListPayload = {
  events?: ToolEvent[];
};

type GmailListPayload = {
  emails?: unknown[];
};

export async function workspaceSummaryRoutes(app: FastifyInstance) {
  app.get("/v1/workspace-summary", async (request, reply) => {
    const parsed = querySchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      throw new ValidationError("workspaceId required");
    }

    const authRequest = request as AuthenticatedRequest;
    const authorizedWorkspaceId = await resolveAuthorizedWorkspaceId(
      authRequest.userId,
      parsed.data.workspaceId,
    );

    if (!authorizedWorkspaceId) {
      throw new AppError("workspace_not_accessible", 403, "workspace_not_accessible");
    }

    const availableTools = new Set(listTools());
    const now = new Date();
    const in24Hours = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const calendarPromise = availableTools.has("calendar.list")
      ? executeTool(
          "calendar.list",
          {
            timeMin: now.toISOString(),
            timeMax: in24Hours.toISOString(),
          },
          authorizedWorkspaceId,
        )
      : Promise.resolve({ events: [] });

    const mailPromise = availableTools.has("gmail.list")
      ? executeTool(
          "gmail.list",
          {
            query: "in:inbox is:unread",
            maxResults: 50,
          },
          authorizedWorkspaceId,
        )
      : Promise.resolve({ emails: [] });

    const taskPromise = db()
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", authorizedWorkspaceId)
      .in("status", ["open", "in_progress", "todo"]);

    const [calendarResult, mailResult, taskResult] = await Promise.allSettled([
      calendarPromise,
      mailPromise,
      taskPromise,
    ]);

    let nextEvent: string | null = null;
    let eventCount = 0;
    if (calendarResult.status === "fulfilled") {
      const events = (calendarResult.value as CalendarListPayload).events;
      if (Array.isArray(events) && events.length > 0) {
        eventCount = events.length;
        const first = events[0] as { summary?: unknown };
        nextEvent = typeof first?.summary === "string" ? first.summary : null;
      }
    } else {
      logger.warn({ err: calendarResult.reason }, "workspace-summary: calendar fetch failed");
    }

    let unreadEmails = 0;
    if (mailResult.status === "fulfilled") {
      const emails = (mailResult.value as GmailListPayload).emails;
      unreadEmails = Array.isArray(emails) ? emails.length : 0;
    } else {
      logger.warn({ err: mailResult.reason }, "workspace-summary: gmail fetch failed");
    }

    let openTasks = 0;
    if (taskResult.status === "fulfilled") {
      const count = taskResult.value.count;
      openTasks = typeof count === "number" ? count : 0;
    } else {
      logger.warn({ err: taskResult.reason }, "workspace-summary: tasks fetch failed");
    }

    reply.send({
      nextEvent,
      eventCount,
      unreadEmails,
      openTasks,
    });
  });
}
