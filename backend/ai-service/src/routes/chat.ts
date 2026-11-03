import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppError, ValidationError } from "../lib/errors.js";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import { callModel } from "../models/router.js";
import { resolveAuthorizedWorkspaceId } from "../db/repos/workspace-access.js";
import { classifyIntentDomain } from "../engine/intent-parser.js";
import {
  assembleContext,
  assembleCrossWorkspaceContext,
  summarizeContextForPrompt,
} from "../kernel/context-assembler.js";
import { executeTool, listTools } from "../tools/index.js";
import { logger } from "../lib/logger.js";
import { db } from "../db/client.js";
import { extractFactsFromChat, getRelevantFacts } from "../kernel/fact-extractor.js";

const chatBody = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string(),
      }),
    )
    .min(1)
    .max(50),
  workspaceId: z.string().optional(),
  preferredProvider: z.enum(["vertex", "anthropic", "openai"]).optional(),
});

const chatHistoryQuery = z.object({
  workspaceId: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const ELLI_SYSTEM_PROMPT = `You are Elli, the AI assistant inside Elyra OS.
You are an AI co-founder, personal assistant, and operations partner.

WORKSPACE CONTEXT:
You are currently operating in the context of a specific workspace. The workspace identity
tells you the purpose, goals, and operating rules of this context.

CROSS-WORKSPACE AWARENESS:
The user may have multiple workspaces (personal, business, platform). When cross-workspace
summaries are provided below, use them to:
- Plan across contexts (e.g., "block personal time around the Fish-Delish supplier meeting")
- Understand priorities (business deadlines override personal tasks during work hours)
- Never leak sensitive data from one workspace to another unless explicitly asked
- Suggest when tasks might belong in a different workspace

CAPABILITIES:
- Calendar: Read events, create meetings (if Google connected)
- Email: Read inbox, draft and send emails (if Google connected)
- Tasks: Create and manage tasks per workspace
- Drive: List and create files in Google Drive
- Slides: Generate presentation outlines
- Text: Summarize and draft content
- Code: Generate Claude Code prompts for development tasks

BEHAVIOR:
- Respond in the same language the user writes in
- Be concise but thorough when it matters
- Think like a co-founder: challenge assumptions, suggest better approaches
- When asked to plan: consider all workspace contexts and priorities
- When creating tasks or events: suggest the right workspace for them
- Proactively flag conflicts (e.g., "You have a Fish-Delish call during your gym time")

Current workspace context:
{CONTEXT}`;

async function prefetchToolData(
  message: string,
  workspaceId: string,
): Promise<string> {
  const lower = message.toLowerCase();
  const results: string[] = [];
  const availableTools = new Set(listTools());

  const shouldFetchCalendar = /kalender|calendar|termin|meeting|schedule|today|heute|morgen|tomorrow|woche|week|diese woche|this week/.test(
    lower,
  );
  const shouldFetchMail = /email|mail|inbox|nachrichten|messages|unread|ungelesen/.test(
    lower,
  );
  const shouldFetchTasks = /task|aufgabe|todo|to-do|aufgaben|erledigen/.test(lower);
  const shouldFetchDrive = /drive|datei|file|dokument|document|speicher|save|ablage/.test(
    lower,
  );

  if (shouldFetchCalendar && availableTools.has("calendar.list")) {
    try {
      const now = new Date();
      const endOfWeek = new Date(now);
      endOfWeek.setDate(endOfWeek.getDate() + 7);

      const calData = await executeTool(
        "calendar.list",
        {
          timeMin: now.toISOString(),
          timeMax: endOfWeek.toISOString(),
        },
        workspaceId,
      );
      results.push(`CALENDAR DATA:\n${JSON.stringify(calData, null, 2)}`);
    } catch (err) {
      logger.warn({ err }, "Calendar prefetch failed in chat");
    }
  }

  if (shouldFetchMail && availableTools.has("gmail.list")) {
    try {
      const mailData = await executeTool(
        "gmail.list",
        {
          query: "is:inbox",
          maxResults: 10,
        },
        workspaceId,
      );
      results.push(`EMAIL DATA:\n${JSON.stringify(mailData, null, 2)}`);
    } catch (err) {
      logger.warn({ err }, "Gmail prefetch failed in chat");
    }
  }

  if (shouldFetchTasks && availableTools.has("tasks.list")) {
    try {
      const taskData = await executeTool("tasks.list", {}, workspaceId);
      results.push(`TASKS DATA:\n${JSON.stringify(taskData, null, 2)}`);
    } catch (err) {
      logger.warn({ err }, "Tasks prefetch failed in chat");
    }
  }

  if (shouldFetchDrive && availableTools.has("drive.list")) {
    try {
      const driveData = await executeTool(
        "drive.list",
        {
          maxResults: 10,
        },
        workspaceId,
      );
      results.push(`GOOGLE DRIVE DATA:\n${JSON.stringify(driveData, null, 2)}`);
    } catch (err) {
      logger.warn({ err }, "Drive prefetch failed in chat");
    }
  }

  return results.length > 0
    ? `\n\nREAL-TIME DATA FROM WORKSPACE TOOLS:\n${results.join("\n\n")}`
    : "";
}

export async function chatRoutes(app: FastifyInstance) {
  app.get("/v1/chat/history", async (request, reply) => {
    const parsed = chatHistoryQuery.safeParse(request.query as Record<string, unknown>);
    if (!parsed.success) {
      throw new ValidationError("invalid_chat_history_query");
    }

    const authRequest = request as AuthenticatedRequest;
    const authorizedWorkspaceId = await resolveAuthorizedWorkspaceId(
      authRequest.userId,
      parsed.data.workspaceId,
    );
    if (!authorizedWorkspaceId) {
      throw new AppError("workspace_not_accessible", 403, "workspace_not_accessible");
    }

    const { data, error } = await db()
      .from("chat_messages")
      .select("id, role, content, model, created_at")
      .eq("workspace_id", authorizedWorkspaceId)
      .eq("user_id", authRequest.userId)
      .order("created_at", { ascending: false })
      .limit(parsed.data.limit);

    if (error) {
      logger.warn({ err: error }, "chat_messages history failed — table may not exist");
      reply.send({ messages: [] });
      return;
    }

    const messages = (data ?? []).reverse();
    reply.send({ messages });
  });

  app.post("/v1/chat", async (request, reply) => {
    const parsed = chatBody.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError("invalid_chat_payload");
    }

    const authRequest = request as AuthenticatedRequest;
    const requestedWorkspaceId = parsed.data.workspaceId ?? authRequest.workspaceId ?? "";
    if (!requestedWorkspaceId) {
      throw new ValidationError("workspaceId is required");
    }

    const authorizedWorkspaceId = await resolveAuthorizedWorkspaceId(
      authRequest.userId,
      requestedWorkspaceId,
    );
    if (!authorizedWorkspaceId) {
      throw new AppError("workspace_not_accessible", 403, "workspace_not_accessible");
    }

    const userMessages = parsed.data.messages.filter((message) => message.role === "user");
    const fallbackMessage = parsed.data.messages[parsed.data.messages.length - 1];
    const lastUserMessage = userMessages[userMessages.length - 1] ?? fallbackMessage;
    const conversationContext = parsed.data.messages
      .slice(0, -1)
      .map((message) => `${message.role === "user" ? "User" : "Elli"}: ${message.content}`)
      .join("\n\n");

    const domain = classifyIntentDomain(lastUserMessage?.content ?? "");
    const contextBundle = await assembleContext({
      workspaceId: authorizedWorkspaceId,
      userId: authRequest.userId,
      intentText: lastUserMessage?.content ?? "",
      openApps: [],
      activeView: null,
      intentDomain: domain,
    });
    const contextSummary = summarizeContextForPrompt(contextBundle, "", [], null);
    let crossWorkspaceInfo = "";
    // Load cross-workspace context for personal (individual) and platform workspaces
    // so Elly always has the full picture when the user is in their Personal or Elyra workspace
    if (contextBundle.workspace.kind === "platform" || contextBundle.workspace.kind === "individual") {
      try {
        crossWorkspaceInfo = await assembleCrossWorkspaceContext(authRequest.userId);
      } catch (err) {
        logger.warn({ err }, "cross-workspace context failed");
      }
    }

    let knowledgeFacts = "";
    try {
      knowledgeFacts = await getRelevantFacts(authorizedWorkspaceId, authRequest.userId);
    } catch (err) {
      logger.warn({ err }, "knowledge_facts query failed — table may not exist");
    }
    const toolData = await prefetchToolData(
      lastUserMessage?.content ?? "",
      authorizedWorkspaceId,
    );
    const systemPrompt = ELLI_SYSTEM_PROMPT.replace(
      "{CONTEXT}",
      contextSummary + crossWorkspaceInfo + knowledgeFacts + toolData,
    );

    const fullPrompt = conversationContext
      ? `Previous conversation:\n${conversationContext}\n\nUser: ${lastUserMessage?.content ?? ""}`
      : lastUserMessage?.content ?? "";

    const response = await callModel(systemPrompt, fullPrompt, {
      preferredProvider: parsed.data.preferredProvider as "vertex" | "anthropic" | "openai" | undefined
    });

    try {
      const { error: persistError } = await db().from("chat_messages").insert([
        {
          workspace_id: authorizedWorkspaceId,
          user_id: authRequest.userId,
          role: "user",
          content: lastUserMessage?.content ?? "",
        },
        {
          workspace_id: authorizedWorkspaceId,
          user_id: authRequest.userId,
          role: "assistant",
          content: response.text,
          model: response.model,
          prompt_tokens: response.promptTokens,
          completion_tokens: response.completionTokens,
        },
      ]);
      if (persistError) {
        throw persistError;
      }
    } catch (err) {
      logger.warn({ err, workspaceId: authorizedWorkspaceId }, "chat_messages save failed — table may not exist");
    }

    extractFactsFromChat(
      authorizedWorkspaceId,
      authRequest.userId,
      lastUserMessage?.content ?? "",
      response.text,
    ).catch((err) => {
      logger.warn({ err }, "fact extraction failed");
    });

    reply.send({
      role: "assistant",
      content: response.text,
      model: response.model,
      usage: {
        promptTokens: response.promptTokens,
        completionTokens: response.completionTokens,
      },
    });
  });
}
