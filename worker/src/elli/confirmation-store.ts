import {
  type ActionProposal,
  type ActionCategory,
  type ActionTarget,
  type ConfirmationState,
  nextConfirmationState,
  CONFIRMATION_TTL_MS,
} from "./system";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConfirmationEventRow {
  id: string;
  workspace_id: string;
  user_id: string;
  action_type: string;
  target: string;
  proposal_json: string;
  state: ConfirmationState;
  created_at: number;
  confirmed_at: number | null;
  executed_at: number | null;
  result_state: string | null;
  error_message: string | null;
  expires_at: number;
}

export interface CreateConfirmationParams {
  proposal: ActionProposal;
  userId: string;
  workspaceId: string;
}

export class ConfirmationError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number = 400
  ) {
    super(message);
    this.name = "ConfirmationError";
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId(): string {
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function writeAuditLog(
  db: D1Database,
  params: {
    workspaceId: string;
    userId: string;
    action: string;
    domain: string;
    resourceId?: string;
    confirmationEventId?: string;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  const id = generateId();
  await db
    .prepare(
      `INSERT INTO audit_log (id, workspace_id, user_id, action, domain, resource_id, confirmation_event_id, metadata_json, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`
    )
    .bind(
      id,
      params.workspaceId,
      params.userId,
      params.action,
      params.domain,
      params.resourceId ?? null,
      params.confirmationEventId ?? null,
      params.metadata ? JSON.stringify(params.metadata) : null,
      Date.now()
    )
    .run();
}

// ---------------------------------------------------------------------------
// Store Functions
// ---------------------------------------------------------------------------

export async function createConfirmationEvent(
  db: D1Database,
  params: CreateConfirmationParams
): Promise<{ id: string; expiresAt: number }> {
  const id = generateId();
  const now = Date.now();
  const expiresAt = now + CONFIRMATION_TTL_MS;
  const { proposal, userId, workspaceId } = params;

  await db
    .prepare(
      `INSERT INTO confirmation_events (id, workspace_id, user_id, action_type, target, proposal_json, state, created_at, expires_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pending', ?7, ?8)`
    )
    .bind(
      id,
      workspaceId,
      userId,
      proposal.category,
      proposal.target,
      JSON.stringify(proposal),
      now,
      expiresAt
    )
    .run();

  await writeAuditLog(db, {
    workspaceId,
    userId,
    action: "propose",
    domain: proposal.target,
    confirmationEventId: id,
    metadata: { title: proposal.title, category: proposal.category },
  });

  return { id, expiresAt };
}

export async function getConfirmationEvent(
  db: D1Database,
  id: string
): Promise<ConfirmationEventRow | null> {
  return db
    .prepare(`SELECT * FROM confirmation_events WHERE id = ?1`)
    .bind(id)
    .first<ConfirmationEventRow>();
}

export async function confirmEvent(
  db: D1Database,
  id: string,
  userId: string,
  workspaceId: string
): Promise<ConfirmationEventRow> {
  const event = await getConfirmationEvent(db, id);
  if (!event) {
    throw new ConfirmationError("Confirmation event not found.", "not_found", 404);
  }
  if (event.user_id !== userId || event.workspace_id !== workspaceId) {
    throw new ConfirmationError("Event does not belong to this user/workspace.", "forbidden", 403);
  }
  if (event.expires_at < Date.now()) {
    throw new ConfirmationError("Confirmation has expired. Please propose a new action.", "expired", 410);
  }

  const nextState = nextConfirmationState(event.state as ConfirmationState, { type: "CONFIRM" });
  if (nextState === event.state) {
    throw new ConfirmationError(
      `Cannot confirm from state "${event.state}".`,
      "invalid_transition",
      409
    );
  }

  const now = Date.now();
  await db
    .prepare(
      `UPDATE confirmation_events SET state = ?1, confirmed_at = ?2 WHERE id = ?3`
    )
    .bind(nextState, now, id)
    .run();

  await writeAuditLog(db, {
    workspaceId,
    userId,
    action: "confirm",
    domain: event.target,
    confirmationEventId: id,
  });

  return { ...event, state: nextState as ConfirmationState, confirmed_at: now };
}

export async function cancelEvent(
  db: D1Database,
  id: string,
  userId: string,
  workspaceId: string
): Promise<ConfirmationEventRow> {
  const event = await getConfirmationEvent(db, id);
  if (!event) {
    throw new ConfirmationError("Confirmation event not found.", "not_found", 404);
  }
  if (event.user_id !== userId || event.workspace_id !== workspaceId) {
    throw new ConfirmationError("Event does not belong to this user/workspace.", "forbidden", 403);
  }

  const nextState = nextConfirmationState(event.state as ConfirmationState, { type: "CANCEL" });
  if (nextState === event.state) {
    throw new ConfirmationError(
      `Cannot cancel from state "${event.state}".`,
      "invalid_transition",
      409
    );
  }

  await db
    .prepare(`UPDATE confirmation_events SET state = ?1 WHERE id = ?2`)
    .bind(nextState, id)
    .run();

  await writeAuditLog(db, {
    workspaceId,
    userId,
    action: "cancel",
    domain: event.target,
    confirmationEventId: id,
  });

  return { ...event, state: nextState as ConfirmationState };
}

export async function markExecuting(
  db: D1Database,
  id: string
): Promise<void> {
  const event = await getConfirmationEvent(db, id);
  if (!event) {
    throw new ConfirmationError("Confirmation event not found.", "not_found", 404);
  }

  const nextState = nextConfirmationState(event.state as ConfirmationState, { type: "EXECUTE" });
  if (nextState === event.state) {
    throw new ConfirmationError(
      `Cannot execute from state "${event.state}".`,
      "invalid_transition",
      409
    );
  }

  await db
    .prepare(`UPDATE confirmation_events SET state = ?1 WHERE id = ?2`)
    .bind(nextState, id)
    .run();

  await writeAuditLog(db, {
    workspaceId: event.workspace_id,
    userId: event.user_id,
    action: "execute",
    domain: event.target,
    confirmationEventId: id,
  });
}

export async function markSucceeded(
  db: D1Database,
  id: string,
  resourceId?: string
): Promise<void> {
  const event = await getConfirmationEvent(db, id);
  if (!event) {
    throw new ConfirmationError("Confirmation event not found.", "not_found", 404);
  }

  const nextState = nextConfirmationState(event.state as ConfirmationState, { type: "SUCCESS" });
  if (nextState === event.state) {
    throw new ConfirmationError(
      `Cannot mark succeeded from state "${event.state}".`,
      "invalid_transition",
      409
    );
  }

  const now = Date.now();
  await db
    .prepare(
      `UPDATE confirmation_events SET state = ?1, executed_at = ?2, result_state = 'succeeded' WHERE id = ?3`
    )
    .bind(nextState, now, id)
    .run();

  await writeAuditLog(db, {
    workspaceId: event.workspace_id,
    userId: event.user_id,
    action: "succeed",
    domain: event.target,
    resourceId,
    confirmationEventId: id,
  });
}

export async function markFailed(
  db: D1Database,
  id: string,
  errorMessage: string
): Promise<void> {
  const event = await getConfirmationEvent(db, id);
  if (!event) {
    throw new ConfirmationError("Confirmation event not found.", "not_found", 404);
  }

  const nextState = nextConfirmationState(event.state as ConfirmationState, { type: "FAIL" });
  if (nextState === event.state) {
    throw new ConfirmationError(
      `Cannot mark failed from state "${event.state}".`,
      "invalid_transition",
      409
    );
  }

  await db
    .prepare(
      `UPDATE confirmation_events SET state = ?1, result_state = 'failed', error_message = ?2 WHERE id = ?3`
    )
    .bind(nextState, errorMessage, id)
    .run();

  await writeAuditLog(db, {
    workspaceId: event.workspace_id,
    userId: event.user_id,
    action: "fail",
    domain: event.target,
    confirmationEventId: id,
    metadata: { error: errorMessage },
  });
}

/**
 * Hard gate: returns the confirmed event or throws.
 * Use this in every mutation endpoint before executing the action.
 */
export async function requireConfirmedEvent(
  db: D1Database,
  eventId: string,
  userId: string,
  workspaceId: string
): Promise<ConfirmationEventRow> {
  const event = await getConfirmationEvent(db, eventId);
  if (!event) {
    throw new ConfirmationError("Confirmation event not found.", "not_found", 404);
  }
  if (event.user_id !== userId) {
    throw new ConfirmationError("Confirmation belongs to a different user.", "forbidden", 403);
  }
  if (event.workspace_id !== workspaceId) {
    throw new ConfirmationError("Confirmation belongs to a different workspace.", "forbidden", 403);
  }
  if (event.state !== "confirmed") {
    throw new ConfirmationError(
      `Event is in state "${event.state}", expected "confirmed".`,
      "not_confirmed",
      409
    );
  }
  if (event.expires_at < Date.now()) {
    throw new ConfirmationError("Confirmation has expired. Please propose a new action.", "expired", 410);
  }
  return event;
}
