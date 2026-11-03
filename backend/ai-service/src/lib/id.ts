import { nanoid } from "nanoid";

export const runId = () => `run_${nanoid(16)}`;
export const stepId = () => `step_${nanoid(16)}`;
export const toolCallId = () => `tc_${nanoid(16)}`;
export const intentId = () => `intent_${nanoid(16)}`;
export const intentMessageId = () => `imsg_${nanoid(16)}`;
export const foundationRunId = () => `frun_${nanoid(16)}`;
export const foundationStepId = () => `fstep_${nanoid(16)}`;
export const artifactId = () => `artifact_${nanoid(16)}`;
export const artifactVersionId = () => `aver_${nanoid(16)}`;
export const behaviorEventId = () => `bevt_${nanoid(16)}`;
