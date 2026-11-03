export function validatePlanStructure(obj: any): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!obj || typeof obj !== "object") return { ok: false, errors: ["plan is not an object"] };
  if (!obj.id || typeof obj.id !== "string") errors.push("id is required");
  if (!obj.label || typeof obj.label !== "string") errors.push("label is required");
  if (!Array.isArray(obj.steps)) errors.push("steps must be an array");
  if (Array.isArray(obj.steps)) {
    obj.steps.forEach((step: any, idx: number) => {
      if (!step?.type || (step.type !== "session" && step.type !== "check")) {
        errors.push(`steps[${idx}].type must be 'session' or 'check'`);
        return;
      }
      if (step.type === "session") {
        if (!step.sessionConfigPath || typeof step.sessionConfigPath !== "string") {
          errors.push(`steps[${idx}].sessionConfigPath required`);
        }
      }
      if (step.type === "check") {
        if (!step.check || typeof step.check !== "object") {
          errors.push(`steps[${idx}].check required`);
        } else if (!step.check.command || typeof step.check.command !== "string") {
          errors.push(`steps[${idx}].check.command required`);
        }
      }
    });
  }
  return { ok: errors.length === 0, errors };
}
