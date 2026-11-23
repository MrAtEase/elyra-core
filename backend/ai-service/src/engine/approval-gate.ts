type PendingApproval = {
  resolve: () => void;
  reject: (reason: Error) => void;
};

const pending = new Map<string, PendingApproval>();

/** Pause execution until approval is received for a step */
export function waitForApproval(stepId: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    pending.set(stepId, { resolve, reject });
  });
}

/** Approve a pending step, unblocking its execution */
export function approveStep(stepId: string): boolean {
  const entry = pending.get(stepId);
  if (!entry) return false;
  entry.resolve();
  pending.delete(stepId);
  return true;
}

/** Reject a pending step */
export function rejectStep(stepId: string, reason = "User rejected"): boolean {
  const entry = pending.get(stepId);
  if (!entry) return false;
  entry.reject(new Error(reason));
  pending.delete(stepId);
  return true;
}

/** Check if a step is awaiting approval */
export function isPending(stepId: string): boolean {
  return pending.has(stepId);
}
