import type { OrchestratorPlan } from "../types/plan.js";

/** Pre-built plans for demo mode — no AI call needed */
export const mockPlans: Record<string, OrchestratorPlan> = {
  "slide deck": {
    summary: "Creating a slide deck for the Spring 2026 Menu Launch",
    steps: [
      { index: 0, toolName: "calendar.list", label: "Check upcoming events for context", input: {}, requiresApproval: false },
      { index: 1, toolName: "slides.create", label: "Generate slide deck", input: { title: "Fish Delish — Spring 2026 Menu Launch" }, requiresApproval: false },
    ],
  },
  "week plan": {
    summary: "Planning your week based on calendar, tasks, and emails",
    steps: [
      { index: 0, toolName: "calendar.list", label: "Fetch this week's events", input: {}, requiresApproval: false },
      { index: 1, toolName: "tasks.list", label: "Get pending tasks", input: { status: "todo" }, requiresApproval: false },
      { index: 2, toolName: "gmail.list", label: "Check recent emails", input: { query: "is:inbox is:unread", maxResults: 5 }, requiresApproval: false },
      { index: 3, toolName: "text.draft", label: "Draft weekly summary", input: { prompt: "Summarize the week ahead", style: "concise" }, requiresApproval: false },
    ],
  },
  "email reply": {
    summary: "Drafting a reply to the catering inquiry from Elena Torres",
    steps: [
      { index: 0, toolName: "gmail.list", label: "Find the catering email", input: { query: "from:elena catering" }, requiresApproval: false },
      { index: 1, toolName: "text.draft", label: "Draft reply", input: { prompt: "Draft a professional reply to Elena Torres about the March 15 catering for 80 guests. Confirm interest, mention we'll send a detailed quote and menu options within 48 hours.", style: "professional" }, requiresApproval: false },
      { index: 2, toolName: "gmail.reply", label: "Send reply", input: { threadId: "t11" }, requiresApproval: true },
    ],
  },
};

/** Detect if a prompt matches a mock flow — DISABLED in production */
export function matchMockPlan(prompt: string): OrchestratorPlan | null {
  // Mock plans are only used when ELYRA_MOCK_MODE=true
  if (process.env.ELYRA_MOCK_MODE !== "true") {
    return null;
  }

  const lower = prompt.toLowerCase();
  if (lower.includes("slide") || lower.includes("deck") || lower.includes("presentation")) {
    return mockPlans["slide deck"]!;
  }
  if (lower.includes("week") || lower.includes("plan my") || lower.includes("schedule")) {
    return mockPlans["week plan"]!;
  }
  if (lower.includes("reply") || lower.includes("respond") || lower.includes("email")) {
    return mockPlans["email reply"]!;
  }
  return null;
}
