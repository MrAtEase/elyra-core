export const CONFIRMATION_TTL_MS = 10 * 60 * 1000; // 10 minutes

export type ElliMode = "assistant" | "mentor" | "planner" | "operator" | "instructor";

export type IntegrationKey = "gmail" | "calendar" | "tasks";

export type ToolState = "empty" | "populated" | "error";

export type ElliContext = {
  identity: {
    userId: string;
    locale: string;
    role: "owner" | "admin" | "member";
    timezone: string;
  };
  workspace: {
    workspaceId: string;
    workspaceName: string;
    connectedIntegrations: IntegrationKey[];
  };
  tool: {
    activeTool: "home" | "mail" | "calendar" | "planner" | "integrations";
    state: ToolState;
  };
  conversation: {
    messageCount: number;
    pendingActionIds: string[];
    explicitModeOverride?: ElliMode;
  };
  time: {
    localIso: string;
    dayOfWeek: number;
  };
};

export type ConfidenceBand = "high" | "medium" | "low" | "none";

export type IntentKind =
  | "ask_information"
  | "ask_advice"
  | "request_plan"
  | "request_execution"
  | "ask_how_to"
  | "ambiguous";

export type IntentClassification = {
  mode: ElliMode;
  intent: IntentKind;
  score: number;
  confidence: ConfidenceBand;
  reason: string;
  clarificationQuestion?: string;
};

export type ActionCategory = "read" | "create" | "update" | "send" | "delete" | "connect";

export type ActionTarget = "mail" | "calendar" | "task" | "integration";

export type ActionProposal = {
  id: string;
  mode: "operator";
  category: ActionCategory;
  target: ActionTarget;
  title: string;
  details: Record<string, string | number | boolean | null>;
  requiresConfirmation: boolean;
  reversible: boolean;
  missingIntegrations: IntegrationKey[];
  limitations?: string;
  conflict?: {
    detected: boolean;
    reason?: string;
    suggestedStartIso?: string;
  };
};

export type ConfirmationState = "idle" | "pending" | "confirmed" | "executing" | "succeeded" | "failed" | "cancelled";

export type ConfirmationEvent =
  | { type: "PROPOSE" }
  | { type: "CONFIRM" }
  | { type: "EDIT" }
  | { type: "CANCEL" }
  | { type: "EXECUTE" }
  | { type: "SUCCESS" }
  | { type: "FAIL" };

export type ElliErrorType =
  | "integration_error"
  | "permission_error"
  | "data_not_found"
  | "rate_limit"
  | "action_failed"
  | "llm_error";

const MENTOR_HINTS = [
  "recommend",
  "advice",
  "should i",
  "what do you think",
  "was meinst",
  "was empfiehlst",
  "good idea",
];

const PLANNER_HINTS = [
  "plan",
  "organize",
  "schedule my week",
  "create tasks",
  "wochenplan",
  "aufgaben",
  "was muss ich tun",
];

const OPERATOR_HINTS = [
  "send",
  "draft",
  "email",
  "create event",
  "reschedule",
  "cancel event",
  "schedule meeting",
  "sende",
  "schreib",
  "erstelle einen termin",
  "verschieb",
  "absagen",
];

const INSTRUCTOR_HINTS = [
  "how do i",
  "walk me through",
  "show me how",
  "wie mache ich",
  "wie funktioniert",
  "zeig mir",
];

const AMBIGUOUS_HINTS = [
  "do it",
  "fix it",
  "make it better",
  "mach das",
  "erledige das",
  "termin morgen",
];

function hasAny(text: string, hints: string[]): boolean {
  return hints.some((hint) => text.includes(hint));
}

export function classifyConfidence(score: number, hasData: boolean): ConfidenceBand {
  if (!hasData) {
    return "none";
  }
  if (score > 0.9) {
    return "high";
  }
  if (score >= 0.6) {
    return "medium";
  }
  return "low";
}

export function classifyIntent(input: string, ctx: ElliContext): IntentClassification {
  const normalized = input.trim().toLowerCase();
  if (ctx.conversation.explicitModeOverride) {
    return {
      mode: ctx.conversation.explicitModeOverride,
      intent: mapModeToIntent(ctx.conversation.explicitModeOverride),
      score: 1,
      confidence: "high",
      reason: "Explicit mode override active for current conversation.",
    };
  }

  if (!normalized) {
    return {
      mode: "assistant",
      intent: "ambiguous",
      score: 0,
      confidence: "none",
      reason: "Empty message.",
      clarificationQuestion: "What should I help with right now?",
    };
  }

  if (hasAny(normalized, AMBIGUOUS_HINTS)) {
    return {
      mode: "assistant",
      intent: "ambiguous",
      score: 0.4,
      confidence: "low",
      reason: "The request has no concrete target or details.",
      clarificationQuestion: "What exact action do you want: summarize, draft, send, or schedule?",
    };
  }

  if (hasAny(normalized, INSTRUCTOR_HINTS)) {
    return {
      mode: "instructor",
      intent: "ask_how_to",
      score: 0.95,
      confidence: "high",
      reason: "How-to phrasing detected.",
    };
  }

  if (hasAny(normalized, OPERATOR_HINTS)) {
    return {
      mode: "operator",
      intent: "request_execution",
      score: 0.92,
      confidence: "high",
      reason: "Execution verbs detected.",
    };
  }

  if (hasAny(normalized, MENTOR_HINTS)) {
    return {
      mode: "mentor",
      intent: "ask_advice",
      score: 0.9,
      confidence: "high",
      reason: "Advice request detected.",
    };
  }

  if (hasAny(normalized, PLANNER_HINTS)) {
    return {
      mode: "planner",
      intent: "request_plan",
      score: 0.9,
      confidence: "high",
      reason: "Planning terms detected.",
    };
  }

  return {
    mode: "assistant",
    intent: "ask_information",
    score: 0.75,
    confidence: "medium",
    reason: "No stronger mode signal found; defaulting to assistant.",
  };
}

function mapModeToIntent(mode: ElliMode): IntentKind {
  if (mode === "assistant") {
    return "ask_information";
  }
  if (mode === "mentor") {
    return "ask_advice";
  }
  if (mode === "planner") {
    return "request_plan";
  }
  if (mode === "operator") {
    return "request_execution";
  }
  return "ask_how_to";
}

export function shouldAskClarification(classification: IntentClassification): boolean {
  return classification.confidence === "low" || classification.confidence === "none" || classification.intent === "ambiguous";
}

export function validateContext(ctx: ElliContext): string[] {
  const problems: string[] = [];
  if (!ctx.identity.userId) {
    problems.push("identity.userId is required");
  }
  if (!ctx.workspace.workspaceId) {
    problems.push("workspace.workspaceId is required");
  }
  if (!ctx.tool.activeTool) {
    problems.push("tool.activeTool is required");
  }
  if (!ctx.time.localIso) {
    problems.push("time.localIso is required");
  }
  return problems;
}

export function isIntegrationConnected(ctx: ElliContext, key: IntegrationKey): boolean {
  return ctx.workspace.connectedIntegrations.includes(key);
}

export function buildActionProposal(params: {
  id: string;
  input: string;
  ctx: ElliContext;
}): ActionProposal {
  const normalized = params.input.toLowerCase();
  const missingIntegrations: IntegrationKey[] = [];
  let category: ActionCategory = "create";
  let target: ActionTarget = "task";
  let title = "Create task";
  const details: Record<string, string | number | boolean | null> = {};
  let reversible = true;
  let limitations: string | undefined;
  let conflict: ActionProposal["conflict"];

  if (normalized.includes("email") || normalized.includes("mail") || normalized.includes("e-mail")) {
    target = "mail";
    title = normalized.includes("draft") || normalized.includes("schreib") ? "Draft email" : "Send email";
    category = title === "Send email" ? "send" : "create";
    details.channel = "gmail";
    if (!isIntegrationConnected(params.ctx, "gmail")) {
      missingIntegrations.push("gmail");
      limitations = "Mail integration is not connected. Elly can draft text, but cannot send.";
    }
    reversible = category !== "send";
  } else if (
    normalized.includes("event") ||
    normalized.includes("meeting") ||
    normalized.includes("termin") ||
    normalized.includes("calendar")
  ) {
    target = "calendar";
    title = "Create calendar event";
    category = "create";
    if (normalized.includes("reschedule") || normalized.includes("verschieb")) {
      title = "Reschedule calendar event";
      category = "update";
    }
    if (normalized.includes("cancel") || normalized.includes("absagen")) {
      title = "Cancel calendar event";
      category = "delete";
      reversible = false;
    }
    if (!isIntegrationConnected(params.ctx, "calendar")) {
      missingIntegrations.push("calendar");
      limitations = "Calendar integration is not connected. Elly cannot create, reschedule, or cancel events.";
    }
    conflict = { detected: false };
  } else if (normalized.includes("connect")) {
    target = "integration";
    category = "connect";
    title = "Start integration connection flow";
  }

  return {
    id: params.id,
    mode: "operator",
    category,
    target,
    title,
    details,
    requiresConfirmation: true,
    reversible,
    missingIntegrations,
    limitations,
    conflict,
  };
}

export function validateActionProposal(proposal: ActionProposal): string[] {
  const problems: string[] = [];
  const mutating = proposal.category !== "read";
  if (mutating && !proposal.requiresConfirmation) {
    problems.push("Mutating actions must require confirmation.");
  }
  if (proposal.category === "send" && !proposal.requiresConfirmation) {
    problems.push("Send actions always require confirmation.");
  }
  if (proposal.target === "mail" && proposal.category === "send" && proposal.missingIntegrations.includes("gmail")) {
    problems.push("Cannot send mail when Gmail integration is missing.");
  }
  if (proposal.target === "calendar" && proposal.missingIntegrations.includes("calendar")) {
    problems.push("Cannot modify calendar when Calendar integration is missing.");
  }
  return problems;
}

export function detectCalendarConflict(params: {
  proposedStartIso: string;
  proposedEndIso: string;
  existingEvents: Array<{ startIso: string; endIso: string; title: string }>;
}): ActionProposal["conflict"] {
  const proposedStart = Date.parse(params.proposedStartIso);
  const proposedEnd = Date.parse(params.proposedEndIso);
  if (!Number.isFinite(proposedStart) || !Number.isFinite(proposedEnd)) {
    return { detected: true, reason: "Invalid proposed time." };
  }
  for (const event of params.existingEvents) {
    const currentStart = Date.parse(event.startIso);
    const currentEnd = Date.parse(event.endIso);
    if (!Number.isFinite(currentStart) || !Number.isFinite(currentEnd)) {
      continue;
    }
    const overlaps = proposedStart < currentEnd && proposedEnd > currentStart;
    if (overlaps) {
      return {
        detected: true,
        reason: `Conflicts with "${event.title}".`,
        suggestedStartIso: new Date(currentEnd + 30 * 60 * 1000).toISOString(),
      };
    }
  }
  return { detected: false };
}

export function nextConfirmationState(state: ConfirmationState, event: ConfirmationEvent): ConfirmationState {
  switch (state) {
    case "idle":
      return event.type === "PROPOSE" ? "pending" : "idle";
    case "pending":
      if (event.type === "CONFIRM") {
        return "confirmed";
      }
      if (event.type === "CANCEL") {
        return "cancelled";
      }
      return "pending";
    case "confirmed":
      if (event.type === "EXECUTE") {
        return "executing";
      }
      if (event.type === "EDIT") {
        return "pending";
      }
      if (event.type === "CANCEL") {
        return "cancelled";
      }
      return "confirmed";
    case "executing":
      if (event.type === "SUCCESS") {
        return "succeeded";
      }
      if (event.type === "FAIL") {
        return "failed";
      }
      return "executing";
    case "failed":
      if (event.type === "EDIT") {
        return "pending";
      }
      if (event.type === "CANCEL") {
        return "cancelled";
      }
      return "failed";
    case "succeeded":
    case "cancelled":
      return state;
    default:
      return state;
  }
}

export function errorPattern(type: ElliErrorType): { summary: string; recovery: string } {
  if (type === "integration_error") {
    return {
      summary: "Integration connection is unavailable right now.",
      recovery: "Reconnect the integration in Workspace Settings and retry.",
    };
  }
  if (type === "permission_error") {
    return {
      summary: "This action requires higher workspace permissions.",
      recovery: "Ask a workspace owner or admin to grant access.",
    };
  }
  if (type === "data_not_found") {
    return {
      summary: "No matching data was found.",
      recovery: "Refine the query (sender, date, subject, or title) and try again.",
    };
  }
  if (type === "rate_limit") {
    return {
      summary: "Rate limit reached.",
      recovery: "Wait one minute before sending another request.",
    };
  }
  if (type === "action_failed") {
    return {
      summary: "The action did not complete.",
      recovery: "Retry once; if it fails again, save as draft and complete manually.",
    };
  }
  return {
    summary: "Temporary AI processing issue.",
    recovery: "Retry the request in a moment.",
  };
}
