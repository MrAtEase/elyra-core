export type GoalStatus = "planned" | "active" | "blocked" | "at_risk" | "completed" | "archived";
export type GoalPriority = "p0" | "p1" | "p2" | "p3";
export type GoalLevel = "north_star" | "operational" | "task";

export type NorthStarGoal = {
  id: string;
  workspace_id: string;
  title: string;
  description: string;
  owner_user_id: string;
  status: GoalStatus;
  priority: GoalPriority;
  success_metric: string;
  baseline_value: number | null;
  target_value: number | null;
  progress_pct: number;
  confidence: number;
  risk_level: "low" | "medium" | "high";
  due_at: string | null;
  tags: string[];
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

export type OperationalGoal = {
  id: string;
  workspace_id: string;
  parent_north_star_id: string;
  title: string;
  description: string;
  owner_user_id: string;
  status: GoalStatus;
  priority: GoalPriority;
  progress_pct: number;
  confidence: number;
  risk_level: "low" | "medium" | "high";
  due_at: string | null;
  tags: string[];
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

export type GoalTask = {
  id: string;
  workspace_id: string;
  parent_operational_goal_id: string;
  title: string;
  description: string;
  owner_user_id: string;
  status: GoalStatus;
  priority: GoalPriority;
  progress_pct: number;
  due_at: string | null;
  links_to_artifacts: string[];
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

export type RunGoalLink = {
  id: string;
  workspace_id: string;
  run_id: string;
  goal_level: GoalLevel;
  goal_id: string;
  confidence: number;
  mapping_source: "user" | "assistant" | "fallback";
  created_at: string;
};

export type GoalTree = {
  north_star: NorthStarGoal[];
  operational: OperationalGoal[];
  tasks: GoalTask[];
};

const STATUS_WEIGHT: Record<GoalStatus, number> = {
  at_risk: 0,
  blocked: 1,
  active: 2,
  planned: 3,
  completed: 4,
  archived: 5,
};

const PRIORITY_WEIGHT: Record<GoalPriority, number> = {
  p0: 0,
  p1: 1,
  p2: 2,
  p3: 3,
};

export function sortOperationalGoalsForDashboard(goals: OperationalGoal[]): OperationalGoal[] {
  return [...goals].sort((a, b) => {
    const statusDiff = STATUS_WEIGHT[a.status] - STATUS_WEIGHT[b.status];
    if (statusDiff !== 0) return statusDiff;
    const priorityDiff = PRIORITY_WEIGHT[a.priority] - PRIORITY_WEIGHT[b.priority];
    if (priorityDiff !== 0) return priorityDiff;
    return Date.parse(b.updated_at) - Date.parse(a.updated_at);
  });
}

export function inferRunGoalLink(input: {
  workspace_id: string;
  run_id: string;
  explicitGoalId?: string;
  explicitGoalLevel?: GoalLevel;
  assistantSuggestedGoalId?: string;
  assistantSuggestedGoalLevel?: GoalLevel;
  assistantConfidence?: number;
  fallbackGoalId: string;
}): RunGoalLink {
  const nowIso = new Date().toISOString();

  if (input.explicitGoalId && input.explicitGoalLevel) {
    return {
      id: crypto.randomUUID(),
      workspace_id: input.workspace_id,
      run_id: input.run_id,
      goal_level: input.explicitGoalLevel,
      goal_id: input.explicitGoalId,
      confidence: 1,
      mapping_source: "user",
      created_at: nowIso,
    };
  }

  if (input.assistantSuggestedGoalId && input.assistantSuggestedGoalLevel) {
    return {
      id: crypto.randomUUID(),
      workspace_id: input.workspace_id,
      run_id: input.run_id,
      goal_level: input.assistantSuggestedGoalLevel,
      goal_id: input.assistantSuggestedGoalId,
      confidence: Math.max(0, Math.min(1, input.assistantConfidence ?? 0.65)),
      mapping_source: "assistant",
      created_at: nowIso,
    };
  }

  return {
    id: crypto.randomUUID(),
    workspace_id: input.workspace_id,
    run_id: input.run_id,
    goal_level: "operational",
    goal_id: input.fallbackGoalId,
    confidence: 0.4,
    mapping_source: "fallback",
    created_at: nowIso,
  };
}

export function assistantGoalChips(tree: GoalTree) {
  const primaryNorthStar = tree.north_star.find((goal) => goal.status === "active") ?? tree.north_star[0] ?? null;
  const topOperational = sortOperationalGoalsForDashboard(tree.operational).slice(0, 3);
  const activeTasks = tree.tasks.filter((task) => task.status === "active" || task.status === "at_risk").slice(0, 5);

  return {
    current_north_star: primaryNorthStar,
    top_operational_goals: topOperational,
    active_tasks: activeTasks,
  };
}
