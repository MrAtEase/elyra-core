import { registerTool } from "../tools/registry.js";
import { mockEmails } from "./emails.js";
import { mockCalendarEvents } from "./calendar-events.js";
import { mockTasks } from "./tasks.js";
import { mockSlideDecks } from "./slides.js";
import { mockFiles } from "./files.js";

/**
 * Register mock tool implementations.
 * These override the real tools when Google APIs aren't connected.
 * Call this AFTER the real tools are registered to override them.
 */
export function registerMockTools(): void {
  registerTool("calendar.list", async () => ({
    events: mockCalendarEvents,
    text: `Found ${mockCalendarEvents.length} events this week`,
    mock: true,
  }));

  registerTool("calendar.create", async (input) => ({
    eventId: `mock_evt_${Date.now()}`,
    text: `[Mock] Created event: ${input["summary"]}`,
    mock: true,
  }));

  registerTool("gmail.list", async (input) => {
    const query = ((input["query"] as string) ?? "").toLowerCase();
    let filtered = mockEmails;
    if (query.includes("elena") || query.includes("catering")) {
      filtered = mockEmails.filter((e) => e.from.includes("Elena") || e.subject.toLowerCase().includes("catering"));
    } else if (query.includes("unread")) {
      filtered = mockEmails.slice(0, 5);
    }
    return { emails: filtered, text: `Found ${filtered.length} emails`, mock: true };
  });

  registerTool("gmail.send", async (input) => ({
    messageId: `mock_msg_${Date.now()}`,
    text: `[Mock] Email sent to ${input["to"]}`,
    mock: true,
  }));

  registerTool("gmail.reply", async (input) => ({
    messageId: `mock_msg_${Date.now()}`,
    text: `[Mock] Reply sent in thread ${input["threadId"]}`,
    mock: true,
  }));

  registerTool("tasks.list", async (input) => {
    const status = input["status"] as string | undefined;
    const filtered = status ? mockTasks.filter((t) => t.status === status) : mockTasks;
    return { tasks: filtered, text: `Found ${filtered.length} tasks`, mock: true };
  });

  registerTool("tasks.create", async (input) => ({
    taskId: `mock_tk_${Date.now()}`,
    text: `[Mock] Created task: ${input["title"]}`,
    mock: true,
  }));

  registerTool("slides.create", async (input) => {
    const title = (input["title"] as string) ?? "Untitled";
    const deck = mockSlideDecks.find((d) => d.title.toLowerCase().includes(title.toLowerCase().split(" ")[0] ?? "")) ?? mockSlideDecks[0]!;
    return { deck, text: `Created slide deck "${deck.title}" with ${deck.slides.length} slides`, mock: true };
  });

  // Files tool (bonus)
  registerTool("files.list", async () => ({
    files: mockFiles,
    text: `Found ${mockFiles.length} files`,
    mock: true,
  }));
}
