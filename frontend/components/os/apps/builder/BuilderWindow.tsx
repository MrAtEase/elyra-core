"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Zap, Filter, Clock, CheckCircle, Users, Mail, Database, Webhook, GitBranch,
  Play, Pause, Plus, Trash2, ChevronRight, ChevronDown, Settings, MoreHorizontal,
  AlertCircle, ArrowRight, Link2, Layers, LayoutGrid, List, Search, Code2,
  Bell, Globe, MessageSquare, FileText, Workflow, ExternalLink,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type BlockKind = "trigger" | "action" | "condition" | "delay" | "approval" | "transform" | "notification";

type BlockDef = {
  kind: BlockKind;
  label: string;
  description: string;
  icon: React.ComponentType<{ size?: number; className?: string; style?: React.CSSProperties }>;
  color: string;
  bg: string;
};

type WorkflowStep = {
  id: string;
  kind: BlockKind;
  label: string;
  config: Record<string, string>;
  status?: "active" | "idle" | "error" | "success";
};

type WorkflowDef = {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  runs: number;
  lastRun: string;
  steps: WorkflowStep[];
};

type ImportedReviewFinding = {
  title: string;
  priority: "P1" | "P2" | "P3";
  file?: string;
  issue: string;
  recommendation: string;
};

type BuilderImportPayload = {
  source: "code-review";
  createdAt: string;
  repoUrl?: string;
  branch?: string;
  folderPath?: string;
  findings?: ImportedReviewFinding[];
};

type BuilderQuickstartPayload = {
  title?: string;
  description?: string;
};

// ── Block Definitions ─────────────────────────────────────────────────────────

const BLOCK_DEFS: BlockDef[] = [
  { kind: "trigger",      label: "Trigger",      description: "Start the workflow on an event", icon: Zap,           color: "#f59e0b", bg: "rgba(245,158,11,0.12)" },
  { kind: "action",       label: "Action",        description: "Execute an operation or API call", icon: Play,          color: "#3b82f6", bg: "rgba(59,130,246,0.12)" },
  { kind: "condition",    label: "Condition",     description: "Branch based on a boolean expression", icon: GitBranch,    color: "#8b5cf6", bg: "rgba(139,92,246,0.12)" },
  { kind: "delay",        label: "Delay",         description: "Wait for a duration before continuing", icon: Clock,         color: "#06b6d4", bg: "rgba(6,182,212,0.12)" },
  { kind: "approval",     label: "Approval",      description: "Pause for human review and approval", icon: CheckCircle,   color: "#10b981", bg: "rgba(16,185,129,0.12)" },
  { kind: "transform",    label: "Transform",     description: "Map, filter or reshape data", icon: Code2,         color: "#f97316", bg: "rgba(249,115,22,0.12)" },
  { kind: "notification", label: "Notification",  description: "Send email, push or webhook alert", icon: Bell,          color: "#ec4899", bg: "rgba(236,72,153,0.12)" },
];

const BLOCK_MAP = Object.fromEntries(BLOCK_DEFS.map((b) => [b.kind, b])) as Record<BlockKind, BlockDef>;

// ── Sample Workflows ──────────────────────────────────────────────────────────

const SAMPLE_WORKFLOWS: WorkflowDef[] = [
  {
    id: "wf-1", name: "New Lead Qualification", description: "Auto-qualify inbound leads and route to sales", enabled: true, runs: 248, lastRun: "2 min ago",
    steps: [
      { id: "s1", kind: "trigger",      label: "Form Submitted",          config: { source: "Website contact form" }, status: "active" },
      { id: "s2", kind: "condition",    label: "Company size > 50?",      config: { field: "company_size", op: "gt", value: "50" }, status: "active" },
      { id: "s3", kind: "action",       label: "Create CRM Contact",      config: { system: "Salesforce", stage: "MQL" }, status: "active" },
      { id: "s4", kind: "notification", label: "Notify Sales Team",       config: { channel: "Slack #sales" }, status: "active" },
      { id: "s5", kind: "delay",        label: "Wait 30 min",             config: { duration: "30", unit: "minutes" }, status: "idle" },
      { id: "s6", kind: "action",       label: "Send Intro Email",        config: { template: "lead_intro" }, status: "idle" },
    ],
  },
  {
    id: "wf-2", name: "Invoice Approval", description: "Route invoices for approval based on amount", enabled: true, runs: 61, lastRun: "14 min ago",
    steps: [
      { id: "s1", kind: "trigger",   label: "Invoice Uploaded",          config: { source: "Drive" }, status: "active" },
      { id: "s2", kind: "condition", label: "Amount > €5,000?",          config: { field: "amount", op: "gt", value: "5000" } },
      { id: "s3", kind: "approval",  label: "CFO Approval Required",     config: { approver: "cfo@company.com", timeout: "48h" } },
      { id: "s4", kind: "action",    label: "Post to Accounting System", config: { system: "DATEV" } },
    ],
  },
  {
    id: "wf-3", name: "Customer Churn Alert", description: "Detect at-risk accounts and trigger retention", enabled: false, runs: 12, lastRun: "2 days ago",
    steps: [
      { id: "s1", kind: "trigger",      label: "Usage Drop Detected",        config: { threshold: "50%", period: "7d" } },
      { id: "s2", kind: "action",       label: "Fetch Account Health Score", config: { source: "Analytics" } },
      { id: "s3", kind: "condition",    label: "Health Score < 40?",         config: { field: "health_score", op: "lt", value: "40" } },
      { id: "s4", kind: "action",       label: "Assign CSM Task",             config: { priority: "P1" } },
      { id: "s5", kind: "notification", label: "Alert CSM via Email",         config: { template: "churn_risk" } },
    ],
  },
];

// ── Block Chip ────────────────────────────────────────────────────────────────

function BlockChip({
  step,
  selected,
  isLast,
  onClick,
  onRunInCoder,
}: {
  step: WorkflowStep;
  selected: boolean;
  isLast: boolean;
  onClick: () => void;
  onRunInCoder?: () => void;
}) {
  const def = BLOCK_MAP[step.kind];
  const Icon = def.icon;
  const statusColor = step.status === "active" ? "#22c55e" : step.status === "error" ? "#ef4444" : step.status === "success" ? "#3b82f6" : "rgba(255,255,255,0.2)";

  return (
    <div className="flex flex-col items-center">
      <div
        className="group relative w-full overflow-hidden rounded-xl border transition-all"
        style={{
          background: selected ? def.bg : "var(--bg-surface)",
          borderColor: selected ? def.color : "var(--os-border-soft)",
          boxShadow: selected ? `0 0 0 1px ${def.color}44` : undefined,
        }}
      >
        <button
          type="button"
          onClick={onClick}
          className="flex w-full items-center gap-3 px-3 py-2.5"
        >
          {/* Status dot */}
          <div className="h-1.5 w-1.5 flex-shrink-0 rounded-full" style={{ background: statusColor }} />

          {/* Icon */}
          <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg" style={{ background: def.bg }}>
            <Icon size={13} style={{ color: def.color }} />
          </div>

          {/* Label */}
          <div className="flex-1 min-w-0 text-left">
            <p className="truncate text-xs font-semibold" style={{ color: "var(--text-primary)" }}>{step.label}</p>
            <p className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>{step.kind}</p>
          </div>

          {/* Config indicator */}
          {Object.keys(step.config).length > 0 && (
            <div className="flex-shrink-0 rounded-md px-1.5 py-0.5 text-[9px]" style={{ background: "var(--bg-surface-hover)", color: "var(--text-secondary)" }}>
              {Object.keys(step.config).length} param{Object.keys(step.config).length > 1 ? "s" : ""}
            </div>
          )}
        </button>

        {/* Run in Coder button — only for action steps that have an issue */}
        {step.kind === "action" && step.config.issue && onRunInCoder && (
          <div className="border-t px-3 py-1.5" style={{ borderColor: "rgba(59,130,246,0.15)" }}>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onRunInCoder(); }}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg py-1 text-[10px] font-semibold transition hover:bg-blue-500/15"
              style={{ color: "#60a5fa" }}
            >
              <ExternalLink size={10} />
              Run in Coder
            </button>
          </div>
        )}
      </div>

      {!isLast && (
        <div className="flex flex-col items-center gap-0.5 py-1">
          <div className="h-3 w-px" style={{ background: "var(--os-border-soft)" }} />
          <ChevronDown size={10} style={{ color: "var(--text-tertiary)" }} />
          <div className="h-3 w-px" style={{ background: "var(--os-border-soft)" }} />
        </div>
      )}
    </div>
  );
}

// ── Inspector Panel ───────────────────────────────────────────────────────────

function InspectorPanel({
  step,
  workflow,
  onUpdateStep,
}: {
  step: WorkflowStep | null;
  workflow: WorkflowDef | null;
  onUpdateStep: (id: string, changes: Partial<WorkflowStep>) => void;
}) {
  if (!step || !workflow) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl" style={{ background: "rgba(255,255,255,0.04)" }}>
          <Settings size={20} style={{ color: "var(--text-tertiary)" }} />
        </div>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>Select a step to inspect</p>
      </div>
    );
  }

  const def = BLOCK_MAP[step.kind];
  const Icon = def.icon;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="border-b px-4 py-3" style={{ borderColor: "var(--os-border-soft)" }}>
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl" style={{ background: def.bg }}>
            <Icon size={14} style={{ color: def.color }} />
          </div>
          <div>
            <p className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>{step.label}</p>
            <p className="text-[10px] capitalize" style={{ color: def.color }}>{step.kind}</p>
          </div>
        </div>
      </div>

      {/* Config */}
      <div className="flex-1 overflow-y-auto space-y-4 px-4 py-4">
        <div>
          <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-tertiary)" }}>Label</label>
          <input
            value={step.label}
            onChange={(e) => onUpdateStep(step.id, { label: e.target.value })}
            className="w-full rounded-xl border px-3 py-2 text-xs outline-none"
            style={{ background: "var(--bg-surface)", borderColor: "var(--os-border-soft)", color: "var(--text-primary)" }}
          />
        </div>

        {Object.entries(step.config).map(([key, value]) => (
          <div key={key}>
            <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-tertiary)" }}>
              {key.replace(/_/g, " ")}
            </label>
            <input
              value={value}
              onChange={(e) => onUpdateStep(step.id, { config: { ...step.config, [key]: e.target.value } })}
              className="w-full rounded-xl border px-3 py-2 text-xs outline-none"
              style={{ background: "var(--bg-surface)", borderColor: "var(--os-border-soft)", color: "var(--text-primary)" }}
            />
          </div>
        ))}

        {/* Add parameter */}
        <button
          type="button"
          className="flex w-full items-center justify-center gap-1.5 rounded-xl border py-2 text-xs transition hover:bg-white/5"
          style={{ borderColor: "var(--os-border-soft)", borderStyle: "dashed", color: "var(--text-secondary)" }}
        >
          <Plus size={11} /> Add parameter
        </button>

        <div className="border-t pt-4" style={{ borderColor: "var(--os-border-soft)" }}>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-tertiary)" }}>Status</p>
          <div className="grid grid-cols-2 gap-1.5">
            {(["active", "idle", "error", "success"] as const).map((s) => {
              const colors: Record<string, string> = { active: "#22c55e", idle: "rgba(255,255,255,0.3)", error: "#ef4444", success: "#3b82f6" };
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => onUpdateStep(step.id, { status: s })}
                  className="rounded-lg px-2 py-1.5 text-[10px] font-medium transition"
                  style={{
                    background: step.status === s ? `${colors[s]}22` : "rgba(255,255,255,0.04)",
                    color: step.status === s ? colors[s] : "rgba(255,255,255,0.4)",
                    border: `1px solid ${step.status === s ? `${colors[s]}44` : "rgba(255,255,255,0.06)"}`,
                  }}
                >
                  {s}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="border-t px-4 py-3" style={{ borderColor: "var(--os-border-soft)" }}>
        <button
          type="button"
          className="flex w-full items-center justify-center gap-1.5 rounded-xl py-2 text-xs text-red-400/70 transition hover:bg-red-500/8 hover:text-red-400"
        >
          <Trash2 size={11} /> Remove step
        </button>
      </div>
    </div>
  );
}

// ── Main BuilderWindow ─────────────────────────────────────────────────────────

export default function BuilderWindow() {
  const [workflows, setWorkflows] = useState<WorkflowDef[]>(SAMPLE_WORKFLOWS);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>(SAMPLE_WORKFLOWS[0]!.id);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"canvas" | "list">("canvas");
  const [importNotice, setImportNotice] = useState<string | null>(null);

  const activeWorkflow = useMemo(
    () => workflows.find((w) => w.id === selectedWorkflowId) ?? null,
    [workflows, selectedWorkflowId]
  );

  const selectedStep = useMemo(
    () => activeWorkflow?.steps.find((s) => s.id === selectedStepId) ?? null,
    [activeWorkflow, selectedStepId]
  );

  function addStep(kind: BlockKind) {
    if (!activeWorkflow) return;
    const def = BLOCK_MAP[kind];
    const newStep: WorkflowStep = {
      id: `s${Date.now()}`,
      kind,
      label: def.label,
      config: {},
      status: "idle",
    };
    setWorkflows((prev) =>
      prev.map((w) =>
        w.id === activeWorkflow.id ? { ...w, steps: [...w.steps, newStep] } : w
      )
    );
    setSelectedStepId(newStep.id);
  }

  function updateStep(stepId: string, changes: Partial<WorkflowStep>) {
    if (!activeWorkflow) return;
    setWorkflows((prev) =>
      prev.map((w) =>
        w.id !== activeWorkflow.id
          ? w
          : { ...w, steps: w.steps.map((s) => (s.id === stepId ? { ...s, ...changes } : s)) }
      )
    );
  }

  function toggleWorkflow(id: string) {
    setWorkflows((prev) =>
      prev.map((w) => (w.id === id ? { ...w, enabled: !w.enabled } : w))
    );
  }

  function addWorkflow() {
    const newWf: WorkflowDef = {
      id: `wf-${Date.now()}`,
      name: "New Workflow",
      description: "Describe what this workflow does",
      enabled: false,
      runs: 0,
      lastRun: "Never",
      steps: [{ id: "s1", kind: "trigger", label: "New Trigger", config: {}, status: "idle" }],
    };
    setWorkflows((prev) => [...prev, newWf]);
    setSelectedWorkflowId(newWf.id);
    setSelectedStepId("s1");
  }

  const filteredWorkflows = useMemo(() => {
    if (!search.trim()) return workflows;
    const q = search.toLowerCase();
    return workflows.filter((w) => w.name.toLowerCase().includes(q) || w.description.toLowerCase().includes(q));
  }, [workflows, search]);

  /** Build a clean task string from an action step's config */
  function buildCoderTask(step: WorkflowStep): string {
    const title = step.label.replace(/^P[123]\s+/, "").trim();
    const file = step.config.file ?? "";
    const issue = step.config.issue ?? "";
    const recommendation = step.config.recommendation ?? "";
    let task = `Fix this issue${file ? ` in ${file}` : ""}: ${title}.`;
    if (issue) task += ` Problem: ${issue}`;
    if (recommendation) task += ` Recommendation: ${recommendation}`;
    return task.trim();
  }

  /** Get workspaceId from URL for the handoff link */
  function getWorkspaceIdFromUrl(): string {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("workspaceId") ?? "";
  }

  /** Send a single action step to the Coding Agent via localStorage handoff */
  const runStepInCoder = useCallback((step: WorkflowStep) => {
    const task = buildCoderTask(step);
    if (!task) return;
    const payload = {
      task,
      skill: "fix-build" as const,
      stage: "playground" as const,
      ...(step.config.file ? { selectedFiles: [step.config.file] } : {}),
      autoRun: false,
    };
    try {
      window.localStorage.setItem("elyra_ai_task_queue", JSON.stringify(payload));
      const wsId = getWorkspaceIdFromUrl();
      window.location.assign(wsId ? `/os/code?workspaceId=${encodeURIComponent(wsId)}` : "/os/code");
    } catch {
      // ignore storage errors
    }
  }, []);

  /** Queue ALL action steps from the current workflow into the Coding Agent */
  const runAllInCoder = useCallback(() => {
    if (!activeWorkflow) return;
    const actionSteps = activeWorkflow.steps.filter((s) => s.kind === "action" && s.config.issue);
    if (actionSteps.length === 0) return;

    // Build individual QueuedAgentTask objects and store as a bulk queue
    const tasks = actionSteps.map((step) => ({
      id: crypto.randomUUID(),
      task: buildCoderTask(step),
      skill: "fix-build" as const,
      stage: "playground" as const,
      selectedFiles: step.config.file ? [step.config.file] : [],
      role: "general" as const,
      repoUrl: "",
      branch: "main",
      folderPath: "",
      terminalAccess: true,
      useReasoning: true,
      branchPerAgent: true,
      executionMode: "adaptive" as const,
      vibeCoding: true,
      teamMode: "auto" as const,
      teamConfig: { general: 1, frontend: 1, backend: 1, ui: 1, infra: 1, qa: 1 },
      budgetUsd: 5,
      deadlineMinutes: 60,
      createdAt: Date.now(),
    }));

    try {
      window.localStorage.setItem("elyra_agent_bulk_queue", JSON.stringify(tasks));
      const wsId = getWorkspaceIdFromUrl();
      window.location.assign(wsId ? `/os/code?workspaceId=${encodeURIComponent(wsId)}&import=bulk` : "/os/code?import=bulk");
    } catch {
      // ignore storage errors
    }
  }, [activeWorkflow]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("elyra_builder_review_queue");
      if (!raw) return;
      window.localStorage.removeItem("elyra_builder_review_queue");
      const payload = JSON.parse(raw) as BuilderImportPayload;
      const findings = Array.isArray(payload.findings) ? payload.findings : [];
      if (payload.source !== "code-review" || findings.length === 0) return;

      const importedWorkflow: WorkflowDef = {
        id: `wf-import-${Date.now()}`,
        name: `Review Work Items (${findings.length})`,
        description: payload.folderPath
          ? `Imported from Code review for ${payload.folderPath}`
          : "Imported from Code review findings",
        enabled: false,
        runs: 0,
        lastRun: "Just imported",
        steps: [
          {
            id: `s-trigger-${Date.now()}`,
            kind: "trigger",
            label: "Review imported from Code",
            config: {
              repo: payload.repoUrl || "Current repo",
              branch: payload.branch || "main",
              scope: payload.folderPath || "whole repository",
            },
            status: "active",
          },
          ...findings.flatMap((finding, index) => {
            const actionStep: WorkflowStep = {
              id: `s-action-${Date.now()}-${index}`,
              kind: "action",
              label: `${finding.priority} ${finding.title}`,
              config: {
                ...(finding.file ? { file: finding.file } : {}),
                issue: finding.issue,
                // Store recommendation here too so "Run in Coder" can build the full task text
                recommendation: finding.recommendation,
              },
              status: index === 0 ? "active" : "idle",
            };
            const approvalStep: WorkflowStep = {
              id: `s-approval-${Date.now()}-${index}`,
              kind: "approval",
              label: "Review proposed fix",
              config: {
                recommendation: finding.recommendation,
              },
              status: "idle",
            };
            return [actionStep, approvalStep];
          }),
        ],
      };

      setWorkflows((prev) => [importedWorkflow, ...prev]);
      setSelectedWorkflowId(importedWorkflow.id);
      setSelectedStepId(importedWorkflow.steps[0]?.id ?? null);
      setImportNotice(`Imported ${findings.length} review findings from Code into Builder.`);
    } catch {
      setImportNotice("Unable to import review findings into Builder.");
    }
  }, []);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("elyra_builder_quickstart");
      if (!raw) return;
      window.localStorage.removeItem("elyra_builder_quickstart");
      const payload = JSON.parse(raw) as BuilderQuickstartPayload;
      const quickstartWorkflow: WorkflowDef = {
        id: `wf-quickstart-${Date.now()}`,
        name: payload.title?.trim() || "New AI Process",
        description: payload.description?.trim() || "Quickstart imported from AI controls",
        enabled: false,
        runs: 0,
        lastRun: "Not started",
        steps: [
          { id: `q1-${Date.now()}`, kind: "trigger", label: "Define trigger", config: { source: "AI control" }, status: "active" },
          { id: `q2-${Date.now()}`, kind: "transform", label: "Shape input", config: { mode: "normalize context" }, status: "idle" },
          { id: `q3-${Date.now()}`, kind: "action", label: "Run AI action", config: { provider: "Gemini" }, status: "idle" },
          { id: `q4-${Date.now()}`, kind: "approval", label: "Review output", config: { owner: "You" }, status: "idle" },
          { id: `q5-${Date.now()}`, kind: "notification", label: "Notify stakeholders", config: { channel: "OS rail" }, status: "idle" },
        ],
      };

      setWorkflows((prev) => [quickstartWorkflow, ...prev]);
      setSelectedWorkflowId(quickstartWorkflow.id);
      setSelectedStepId(quickstartWorkflow.steps[0]?.id ?? null);
      setImportNotice(`Quickstart process created: ${quickstartWorkflow.name}`);
    } catch {
      setImportNotice("Unable to create Builder quickstart.");
    }
  }, []);

  return (
    <div className="flex h-full overflow-hidden" style={{ background: "var(--bg-canvas, #070c16)", color: "var(--text-primary)" }}>
      {/* ── Left: Workflow List ─────────────────────────────────────────── */}
      <aside className="flex w-56 flex-shrink-0 flex-col border-r" style={{ borderColor: "var(--os-border-soft)", background: "color-mix(in srgb, var(--bg-elevated) 92%, transparent)" }}>
        {/* Header */}
        <div className="flex items-center justify-between border-b px-3 py-3" style={{ borderColor: "var(--os-border-soft)" }}>
          <div className="flex items-center gap-2">
            <Workflow size={13} style={{ color: "var(--text-secondary)" }} />
            <span className="text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>Workflows</span>
          </div>
          <button
            type="button"
            onClick={addWorkflow}
            className="rounded-lg p-1 text-white/40 transition hover:bg-white/8 hover:text-white/70"
          >
            <Plus size={13} />
          </button>
        </div>

        {/* Search */}
        <div className="border-b px-3 py-2" style={{ borderColor: "var(--os-border-soft)" }}>
          <div className="relative">
            <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: "var(--text-tertiary)" }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search…"
              className="w-full rounded-lg pl-7 pr-2 py-1.5 text-xs outline-none"
              style={{ background: "var(--bg-surface)", color: "var(--text-primary)" }}
            />
          </div>
        </div>

        {/* Workflow list */}
        <div className="flex-1 overflow-y-auto py-1">
          {filteredWorkflows.map((wf) => (
            <button
              key={wf.id}
              type="button"
              onClick={() => { setSelectedWorkflowId(wf.id); setSelectedStepId(null); }}
              className="w-full px-3 py-2.5 text-left transition"
              style={{ background: wf.id === selectedWorkflowId ? "var(--bg-surface-hover)" : "transparent" }}
            >
              <div className="flex items-center gap-2">
                <div className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${wf.enabled ? "bg-emerald-400" : "bg-white/20"}`} />
                <p className="flex-1 truncate text-xs font-medium" style={{ color: wf.id === selectedWorkflowId ? "var(--text-primary)" : "var(--text-secondary)" }}>
                  {wf.name}
                </p>
              </div>
              <p className="mt-0.5 pl-3.5 text-[10px]" style={{ color: "var(--text-tertiary)" }}>
                {wf.steps.length} steps · {wf.runs} runs
              </p>
            </button>
          ))}
        </div>
      </aside>

      {/* ── Center: Canvas / Step List ──────────────────────────────────── */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Toolbar */}
        <div className="flex items-center gap-3 border-b px-4 py-2" style={{ borderColor: "var(--os-border-soft)", minHeight: 44, background: "color-mix(in srgb, var(--bg-elevated) 92%, transparent)" }}>
          <div className="flex-1 truncate">
              <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                {activeWorkflow?.name ?? "—"}
              </span>
            {activeWorkflow && (
              <span className="ml-2 text-xs" style={{ color: "var(--text-secondary)" }}>
                {activeWorkflow.runs} runs · last {activeWorkflow.lastRun}
              </span>
            )}
          </div>

          {/* Run All in Coder — shown for imported review workflows */}
          {activeWorkflow && activeWorkflow.steps.some((s) => s.kind === "action" && s.config.issue) && (
            <button
              type="button"
              onClick={runAllInCoder}
              className="flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition hover:bg-blue-500/15"
              style={{ borderColor: "rgba(59,130,246,0.3)", background: "rgba(59,130,246,0.08)", color: "#60a5fa" }}
            >
              <ExternalLink size={11} />
              Run All in Coder
            </button>
          )}

          {/* Toggle enabled */}
          {activeWorkflow && (
            <button
              type="button"
              onClick={() => toggleWorkflow(activeWorkflow.id)}
              className="flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium transition"
              style={{
                borderColor: activeWorkflow.enabled ? "rgba(34,197,94,0.3)" : "rgba(255,255,255,0.08)",
                background: activeWorkflow.enabled ? "rgba(34,197,94,0.1)" : "rgba(255,255,255,0.04)",
                color: activeWorkflow.enabled ? "#22c55e" : "rgba(255,255,255,0.4)",
              }}
            >
              {activeWorkflow.enabled ? <><Play size={11} /> Active</> : <><Pause size={11} /> Paused</>}
            </button>
          )}

          {/* View toggle */}
          <div className="flex items-center rounded-xl border overflow-hidden" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
            {(["canvas", "list"] as const).map((v) => {
              const Icon = v === "canvas" ? LayoutGrid : List;
              return (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  className="px-2.5 py-1.5 transition"
                  style={{
                    background: view === v ? "rgba(255,255,255,0.08)" : "transparent",
                    color: view === v ? "rgba(255,255,255,0.8)" : "rgba(255,255,255,0.3)",
                  }}
                >
                  <Icon size={13} />
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Step canvas */}
          <div className="flex-1 overflow-y-auto p-6">
            {activeWorkflow ? (
              <div className="mx-auto max-w-md space-y-0">
                {importNotice ? (
                  <div
                    className="mb-4 rounded-2xl border px-4 py-3 text-xs"
                    style={{ background: "rgba(56,189,248,0.08)", borderColor: "rgba(56,189,248,0.18)", color: "rgba(255,255,255,0.78)" }}
                  >
                    {importNotice}
                  </div>
                ) : null}
                {/* Workflow header card */}
                <div
                  className="mb-4 rounded-2xl border p-4"
                  style={{ background: "rgba(255,255,255,0.02)", borderColor: "rgba(255,255,255,0.06)" }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold" style={{ color: "rgba(255,255,255,0.85)" }}>{activeWorkflow.name}</p>
                      <p className="mt-0.5 text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>{activeWorkflow.description}</p>
                    </div>
                    <button type="button" className="rounded-lg p-1.5 text-white/30 transition hover:bg-white/8 hover:text-white/60">
                      <MoreHorizontal size={14} />
                    </button>
                  </div>
                  <div className="mt-3 flex gap-4 text-[10px]" style={{ color: "rgba(255,255,255,0.35)" }}>
                    <span>{activeWorkflow.steps.length} steps</span>
                    <span>{activeWorkflow.runs} total runs</span>
                    <span>Last: {activeWorkflow.lastRun}</span>
                  </div>
                </div>

                {/* Steps */}
                {activeWorkflow.steps.map((step, i) => (
                  <BlockChip
                    key={step.id}
                    step={step}
                    selected={selectedStepId === step.id}
                    isLast={i === activeWorkflow.steps.length - 1}
                    onClick={() => setSelectedStepId(step.id === selectedStepId ? null : step.id)}
                    {...(step.kind === "action" && step.config.issue ? { onRunInCoder: () => runStepInCoder(step) } : {})}
                  />
                ))}

                {/* Add step */}
                <div className="pt-2">
                  <div className="flex flex-col items-center gap-0.5 py-1">
                    <div className="h-3 w-px" style={{ background: "rgba(255,255,255,0.08)" }} />
                  </div>
                  <div className="rounded-xl border p-3" style={{ borderColor: "rgba(255,255,255,0.06)", borderStyle: "dashed" }}>
                    <p className="mb-2 text-center text-[10px] font-semibold uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.3)" }}>Add step</p>
                    <div className="grid grid-cols-4 gap-1.5">
                      {BLOCK_DEFS.map((def) => {
                        const Icon = def.icon;
                        return (
                          <button
                            key={def.kind}
                            type="button"
                            onClick={() => addStep(def.kind)}
                            title={def.label}
                            className="flex flex-col items-center gap-1 rounded-xl p-2 transition hover:bg-white/6"
                            style={{ background: def.bg + "55" }}
                          >
                            <Icon size={14} style={{ color: def.color }} />
                            <span className="text-[9px]" style={{ color: "rgba(255,255,255,0.4)" }}>{def.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center">
                <p className="text-sm" style={{ color: "rgba(255,255,255,0.3)" }}>Select a workflow to edit</p>
              </div>
            )}
          </div>

          {/* Inspector */}
          <aside className="w-56 flex-shrink-0 border-l overflow-hidden" style={{ borderColor: "var(--os-border-soft)", background: "color-mix(in srgb, var(--bg-elevated) 92%, transparent)" }}>
            <div className="flex items-center gap-2 border-b px-4 py-3" style={{ borderColor: "var(--os-border-soft)" }}>
              <Settings size={11} style={{ color: "var(--text-tertiary)" }} />
              <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-tertiary)" }}>Inspector</span>
            </div>
            <InspectorPanel step={selectedStep} workflow={activeWorkflow} onUpdateStep={updateStep} />
          </aside>
        </div>
      </div>

      {/* ── Right: Block palette ────────────────────────────────────────── */}
      <aside className="hidden w-44 flex-shrink-0 flex-col border-l xl:flex" style={{ borderColor: "var(--os-border-soft)", background: "color-mix(in srgb, var(--bg-elevated) 92%, transparent)" }}>
        <div className="border-b px-3 py-3" style={{ borderColor: "var(--os-border-soft)" }}>
          <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-tertiary)" }}>Blocks</span>
        </div>
        <div className="flex-1 overflow-y-auto py-2 px-2 space-y-1">
          {BLOCK_DEFS.map((def) => {
            const Icon = def.icon;
            return (
              <button
                key={def.kind}
                type="button"
                onClick={() => addStep(def.kind)}
                className="group w-full rounded-xl p-2.5 text-left transition hover:bg-white/5"
                style={{ background: "rgba(255,255,255,0.02)" }}
              >
                <div className="flex items-center gap-2">
                  <div className="flex h-6 w-6 items-center justify-center rounded-lg flex-shrink-0" style={{ background: def.bg }}>
                    <Icon size={11} style={{ color: def.color }} />
                  </div>
                  <span className="text-[11px] font-medium" style={{ color: "rgba(255,255,255,0.65)" }}>{def.label}</span>
                </div>
                <p className="mt-1 pl-8 text-[10px] leading-tight" style={{ color: "rgba(255,255,255,0.25)" }}>{def.description}</p>
              </button>
            );
          })}
        </div>
      </aside>
    </div>
  );
}
