import {
  buildActionProposal,
  classifyIntent,
  CONFIRMATION_TTL_MS,
  detectCalendarConflict,
  errorPattern,
  nextConfirmationState,
  shouldAskClarification,
  validateActionProposal,
  validateContext,
  type ConfirmationState,
  type ElliContext,
} from "./system";

const ctxBase: ElliContext = {
  identity: {
    userId: "u_123",
    locale: "en-US",
    role: "owner",
    timezone: "America/New_York",
  },
  workspace: {
    workspaceId: "ws_123",
    workspaceName: "Core Ops",
    connectedIntegrations: ["gmail", "calendar", "tasks"],
  },
  tool: {
    activeTool: "home",
    state: "populated",
  },
  conversation: {
    messageCount: 1,
    pendingActionIds: [],
  },
  time: {
    localIso: "2026-02-08T10:00:00-05:00",
    dayOfWeek: 0,
  },
};

function assert(name: string, condition: boolean): number {
  if (!condition) {
    console.log(`FAIL ${name}`);
    return 1;
  }
  console.log(`PASS ${name}`);
  return 0;
}

let failures = 0;

failures += assert("context validates", validateContext(ctxBase).length === 0);

const operatorIntent = classifyIntent("Send an email to Alex with the roadmap", ctxBase);
failures += assert("operator mode inferred", operatorIntent.mode === "operator");
failures += assert("operator high confidence", operatorIntent.confidence === "high");

const mentorIntent = classifyIntent("What do you think about this launch plan?", ctxBase);
failures += assert("mentor mode inferred", mentorIntent.mode === "mentor");

const ambiguous = classifyIntent("Do it", ctxBase);
failures += assert("ambiguous asks clarification", shouldAskClarification(ambiguous));

const sendMailProposal = buildActionProposal({
  id: "a1",
  input: "send email to team@example.com",
  ctx: ctxBase,
});
failures += assert("send mail requires confirmation", sendMailProposal.requiresConfirmation);
failures += assert("send mail proposal valid", validateActionProposal(sendMailProposal).length === 0);

const noMailCtx: ElliContext = {
  ...ctxBase,
  workspace: {
    ...ctxBase.workspace,
    connectedIntegrations: ["calendar", "tasks"],
  },
};
const blockedMailProposal = buildActionProposal({
  id: "a2",
  input: "send email to team@example.com",
  ctx: noMailCtx,
});
failures += assert(
  "missing gmail blocks send",
  validateActionProposal(blockedMailProposal).includes("Cannot send mail when Gmail integration is missing.")
);

const conflict = detectCalendarConflict({
  proposedStartIso: "2026-02-10T14:00:00.000Z",
  proposedEndIso: "2026-02-10T15:00:00.000Z",
  existingEvents: [{ startIso: "2026-02-10T13:45:00.000Z", endIso: "2026-02-10T14:30:00.000Z", title: "Team Sync" }],
});
failures += assert("calendar conflict detected", Boolean(conflict?.detected));
failures += assert("calendar conflict suggests alternative", Boolean(conflict?.suggestedStartIso));

const flowEvents = ["PROPOSE", "CONFIRM", "EXECUTE", "SUCCESS"] as const;
let state: ConfirmationState = "idle";
for (const eventType of flowEvents) {
  state = nextConfirmationState(state, { type: eventType });
}
failures += assert("confirmation flow reaches success", state === "succeeded");

const pattern = errorPattern("integration_error");
failures += assert("error pattern has summary", pattern.summary.length > 0);
failures += assert("error pattern has recovery", pattern.recovery.length > 0);

// ---------------------------------------------------------------------------
// B3-001: Confirmation TTL + state machine edge cases
// ---------------------------------------------------------------------------

failures += assert("CONFIRMATION_TTL_MS is 10 minutes", CONFIRMATION_TTL_MS === 10 * 60 * 1000);

// Terminal states are idempotent (no transition out)
failures += assert(
  "succeeded is terminal",
  nextConfirmationState("succeeded", { type: "CONFIRM" }) === "succeeded"
);
failures += assert(
  "cancelled is terminal",
  nextConfirmationState("cancelled", { type: "EDIT" }) === "cancelled"
);

// Cancel from pending
failures += assert(
  "pending -> cancel -> cancelled",
  nextConfirmationState("pending", { type: "CANCEL" }) === "cancelled"
);

// Cancel from failed
failures += assert(
  "failed -> cancel -> cancelled",
  nextConfirmationState("failed", { type: "CANCEL" }) === "cancelled"
);

// Edit from failed re-enters pending
failures += assert(
  "failed -> edit -> pending",
  nextConfirmationState("failed", { type: "EDIT" }) === "pending"
);

// Edit from confirmed re-enters pending
failures += assert(
  "confirmed -> edit -> pending",
  nextConfirmationState("confirmed", { type: "EDIT" }) === "pending"
);

// Invalid transitions stay in current state
failures += assert(
  "idle ignores CONFIRM",
  nextConfirmationState("idle", { type: "CONFIRM" }) === "idle"
);
failures += assert(
  "pending ignores EXECUTE",
  nextConfirmationState("pending", { type: "EXECUTE" }) === "pending"
);
failures += assert(
  "executing ignores CONFIRM",
  nextConfirmationState("executing", { type: "CONFIRM" }) === "executing"
);

// Full happy path with individual steps verified
let s: ConfirmationState = "idle";
s = nextConfirmationState(s, { type: "PROPOSE" });
failures += assert("after PROPOSE -> pending", s === "pending");
s = nextConfirmationState(s, { type: "CONFIRM" });
failures += assert("after CONFIRM -> confirmed", s === "confirmed");
s = nextConfirmationState(s, { type: "EXECUTE" });
failures += assert("after EXECUTE -> executing", s === "executing");
s = nextConfirmationState(s, { type: "SUCCESS" });
failures += assert("after SUCCESS -> succeeded", s === "succeeded");

// Fail path
let f: ConfirmationState = "executing";
f = nextConfirmationState(f, { type: "FAIL" });
failures += assert("after FAIL -> failed", f === "failed");
f = nextConfirmationState(f, { type: "EDIT" });
failures += assert("after EDIT from failed -> pending", f === "pending");

console.log(`\nResult: ${failures === 0 ? "PASS" : "FAIL"} (${failures} failure(s))`);
process.exit(failures === 0 ? 0 : 1);

