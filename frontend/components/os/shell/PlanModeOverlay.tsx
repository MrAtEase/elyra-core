"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, X, ChevronRight, Zap, Eye, Edit3, SkipForward } from "lucide-react";
import type { ActiveIntentState, IntentStep, IntentStepStatus } from "@/components/os/kernel/types";

// ── Types ─────────────────────────────────────────────────────────────────────

type PlanNode = {
  id: string;
  label: string;
  detail: string;
  status: IntentStepStatus;
  requiresConfirmation?: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  targetX: number;
  targetY: number;
};

type Props = {
  intentState: ActiveIntentState;
  onConfirmAll: () => void;
  onDeny: () => void;
  onClose: () => void;
};

// ── Colors ────────────────────────────────────────────────────────────────────

function stepColor(status: IntentStepStatus): string {
  if (status === "completed") return "#22c55e";
  if (status === "running") return "#60a5fa";
  if (status === "approval_required") return "#f59e0b";
  if (status === "failed") return "#ef4444";
  if (status === "skipped") return "#6b7280";
  return "#475569"; // pending
}

function stepGlow(status: IntentStepStatus): string {
  if (status === "completed") return "rgba(34,197,94,0.4)";
  if (status === "running") return "rgba(96,165,250,0.4)";
  if (status === "approval_required") return "rgba(245,158,11,0.5)";
  if (status === "failed") return "rgba(239,68,68,0.4)";
  return "transparent";
}

function stepStatusLabel(status: IntentStepStatus): string {
  if (status === "completed") return "Done";
  if (status === "running") return "Running";
  if (status === "approval_required") return "Awaiting approval";
  if (status === "failed") return "Failed";
  if (status === "skipped") return "Skipped";
  return "Pending";
}

// ── Canvas Mindmap ────────────────────────────────────────────────────────────

function MindmapCanvas({
  steps,
  intentText,
  selectedId,
  onSelectNode,
}: {
  steps: IntentStep[];
  intentText: string;
  selectedId: string | null;
  onSelectNode: (id: string | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nodesRef = useRef<PlanNode[]>([]);
  const animRef = useRef<number>(0);
  const clickHandlerRef = useRef<((e: MouseEvent) => void) | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [canvasSize, setCanvasSize] = useState({ w: 800, h: 500 });

  // Build nodes from steps
  const nodes = useMemo<PlanNode[]>(() => {
    const n = steps.length;
    const cx = canvasSize.w / 2;
    const cy = canvasSize.h / 2;
    const radius = Math.min(cx, cy) * 0.52;

    return steps.map((step, i) => {
      const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
      const tx = cx + Math.cos(angle) * radius;
      const ty = cy + Math.sin(angle) * radius;
      const existing = nodesRef.current.find((node) => node.id === step.id);
      return {
        id: step.id,
        label: step.label,
        detail: step.detail,
        status: step.status,
        ...(step.requiresConfirmation != null ? { requiresConfirmation: step.requiresConfirmation } : {}),
        x: existing?.x ?? tx,
        y: existing?.y ?? ty,
        vx: existing?.vx ?? 0,
        vy: existing?.vy ?? 0,
        radius: step.status === "approval_required" ? 34 : 28,
        targetX: tx,
        targetY: ty,
      };
    });
  }, [steps, canvasSize]);

  // Resize observer
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(() => {
      setCanvasSize({ w: el.clientWidth, h: el.clientHeight });
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Animation loop
  useEffect(() => {
    nodesRef.current = nodes.map((n) => ({ ...n }));

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvasSize.w;
    const H = canvasSize.h;
    canvas.width = W;
    canvas.height = H;

    const CX = W / 2;
    const CY = H / 2;
    const ROOT_RADIUS = 44;
    const shortLabel = intentText.length > 22 ? intentText.slice(0, 20) + "…" : intentText;

    function draw() {
      if (!ctx) return;
      ctx.clearRect(0, 0, W, H);

      // Subtle grid
      ctx.strokeStyle = "rgba(255,255,255,0.02)";
      ctx.lineWidth = 1;
      const grid = 40;
      for (let gx = 0; gx <= W; gx += grid) {
        ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke();
      }
      for (let gy = 0; gy <= H; gy += grid) {
        ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke();
      }

      const currentNodes = nodesRef.current;

      // Physics: spring each node toward target
      for (const node of currentNodes) {
        const dx = node.targetX - node.x;
        const dy = node.targetY - node.y;
        node.vx = node.vx * 0.7 + dx * 0.04;
        node.vy = node.vy * 0.7 + dy * 0.04;
        node.x += node.vx;
        node.y += node.vy;
      }

      // Draw edges (root → step)
      for (const node of currentNodes) {
        const color = stepColor(node.status);

        // Outer glow line
        ctx.beginPath();
        ctx.moveTo(CX, CY);
        ctx.lineTo(node.x, node.y);
        ctx.strokeStyle = color + "20";
        ctx.lineWidth = 6;
        ctx.stroke();

        // Inner line
        ctx.beginPath();
        ctx.moveTo(CX, CY);
        ctx.lineTo(node.x, node.y);
        ctx.strokeStyle = color + "55";
        ctx.lineWidth = 1.5;
        ctx.setLineDash(node.status === "pending" ? [4, 4] : []);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Draw step nodes
      for (const node of currentNodes) {
        const color = stepColor(node.status);
        const glow = stepGlow(node.status);
        const isSelected = node.id === selectedId;
        const r = node.radius;

        // Glow halo
        if (glow !== "transparent") {
          const glowGrad = ctx.createRadialGradient(node.x, node.y, r * 0.3, node.x, node.y, r * 2.2);
          glowGrad.addColorStop(0, glow);
          glowGrad.addColorStop(1, "transparent");
          ctx.beginPath();
          ctx.arc(node.x, node.y, r * 2.2, 0, Math.PI * 2);
          ctx.fillStyle = glowGrad;
          ctx.fill();
        }

        // Node circle
        const nodeGrad = ctx.createRadialGradient(node.x - r * 0.2, node.y - r * 0.2, 1, node.x, node.y, r);
        nodeGrad.addColorStop(0, color + "40");
        nodeGrad.addColorStop(1, "#0d141880");
        ctx.beginPath();
        ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
        ctx.fillStyle = nodeGrad;
        ctx.fill();

        // Border
        ctx.beginPath();
        ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
        ctx.strokeStyle = isSelected ? "#fff" : color;
        ctx.lineWidth = isSelected ? 2.5 : 1.5;
        ctx.stroke();

        // Label inside
        ctx.fillStyle = "#fff";
        ctx.font = `bold 10px -apple-system, "SF Pro Display", sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const lbl = node.label.length > 10 ? node.label.slice(0, 9) + "…" : node.label;
        ctx.fillText(lbl, node.x, node.y - 2);

        // Status line below label
        ctx.fillStyle = color;
        ctx.font = `9px -apple-system, "SF Pro Display", sans-serif`;
        ctx.fillText(stepStatusLabel(node.status), node.x, node.y + 9);

        // Approval pulse ring
        if (node.status === "approval_required") {
          const pulse = (Math.sin(Date.now() / 400) + 1) / 2;
          ctx.beginPath();
          ctx.arc(node.x, node.y, r + 6 + pulse * 5, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(245,158,11,${0.25 + pulse * 0.25})`;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }

        // Running spinner arc
        if (node.status === "running") {
          const t = Date.now() / 600;
          ctx.beginPath();
          ctx.arc(node.x, node.y, r + 6, t, t + Math.PI * 1.2);
          ctx.strokeStyle = "rgba(96,165,250,0.8)";
          ctx.lineWidth = 2;
          ctx.lineCap = "round";
          ctx.stroke();
          ctx.lineCap = "butt";
        }
      }

      // Root node
      const rootGrad = ctx.createRadialGradient(CX - 8, CY - 8, 4, CX, CY, ROOT_RADIUS);
      rootGrad.addColorStop(0, "rgba(148,163,184,0.25)");
      rootGrad.addColorStop(1, "rgba(13,20,32,0.9)");
      ctx.beginPath();
      ctx.arc(CX, CY, ROOT_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = rootGrad;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(CX, CY, ROOT_RADIUS, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(148,163,184,0.5)";
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.fillStyle = "#fff";
      ctx.font = `bold 10px -apple-system, "SF Pro Display", sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("ELLI", CX, CY - 8);
      ctx.fillStyle = "rgba(148,163,184,0.7)";
      ctx.font = `9px -apple-system, "SF Pro Display", sans-serif`;
      const rootLbl = shortLabel.length > 14 ? shortLabel.slice(0, 13) + "…" : shortLabel;
      ctx.fillText(rootLbl, CX, CY + 6);

      animRef.current = requestAnimationFrame(draw);
    }

    animRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animRef.current);
  }, [nodes, canvasSize, intentText, selectedId]);

  // Click handling
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handler = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      const hit = nodesRef.current.find((node) => {
        const dx = mx - node.x;
        const dy = my - node.y;
        return Math.sqrt(dx * dx + dy * dy) <= node.radius + 4;
      });

      onSelectNode(hit?.id ?? null);
    };

    if (clickHandlerRef.current) canvas.removeEventListener("click", clickHandlerRef.current);
    clickHandlerRef.current = handler;
    canvas.addEventListener("click", handler);
    return () => canvas.removeEventListener("click", handler);
  }, [onSelectNode]);

  return (
    <div ref={containerRef} className="flex-1 relative overflow-hidden">
      <canvas
        ref={canvasRef}
        width={canvasSize.w}
        height={canvasSize.h}
        className="absolute inset-0 cursor-pointer"
        style={{ width: "100%", height: "100%" }}
      />
    </div>
  );
}

// ── Step Detail Panel ─────────────────────────────────────────────────────────

function StepPanel({
  steps,
  selectedId,
  onSelect,
}: {
  steps: IntentStep[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const selectedStep = steps.find((s) => s.id === selectedId);

  return (
    <div
      className="w-72 flex-shrink-0 flex flex-col border-l overflow-hidden"
      style={{ borderColor: "rgba(255,255,255,0.08)" }}
    >
      {/* Step list */}
      <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
        <div className="text-xs font-semibold mb-3 px-1" style={{ color: "rgba(255,255,255,0.4)" }}>
          EXECUTION PLAN
        </div>
        {steps.map((step, i) => {
          const color = stepColor(step.status);
          const isSelected = step.id === selectedId;
          return (
            <button
              key={step.id}
              onClick={() => onSelect(step.id)}
              className="w-full text-left rounded-xl px-3 py-2.5 transition-all"
              style={{
                background: isSelected ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.03)",
                border: isSelected ? `1px solid ${color}60` : "1px solid rgba(255,255,255,0.05)",
              }}
            >
              <div className="flex items-center gap-2 mb-0.5">
                <div
                  className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                  style={{
                    background: color + "20",
                    border: `1.5px solid ${color}`,
                    color,
                  }}
                >
                  {step.status === "completed" ? "✓" : step.status === "failed" ? "✗" : i + 1}
                </div>
                <span
                  className="text-xs font-semibold truncate flex-1"
                  style={{ color: "rgba(255,255,255,0.9)" }}
                >
                  {step.label}
                </span>
                {step.requiresConfirmation && (
                  <span
                    className="text-xs px-1.5 py-0.5 rounded-md"
                    style={{ background: "rgba(245,158,11,0.15)", color: "#f59e0b", fontSize: "9px" }}
                  >
                    CONFIRM
                  </span>
                )}
              </div>
              <div className="pl-7 text-xs" style={{ color: "rgba(255,255,255,0.35)" }}>
                {step.detail}
              </div>
              <div className="pl-7 mt-0.5">
                <span
                  className="text-xs"
                  style={{ color }}
                >
                  {stepStatusLabel(step.status)}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Selected step detail */}
      {selectedStep && (
        <div
          className="border-t p-4 flex-shrink-0"
          style={{ borderColor: "rgba(255,255,255,0.08)" }}
        >
          <div className="text-xs font-semibold mb-2" style={{ color: stepColor(selectedStep.status) }}>
            {selectedStep.label}
          </div>
          <p className="text-xs mb-3" style={{ color: "rgba(255,255,255,0.5)" }}>
            {selectedStep.detail}
          </p>
          <div className="flex gap-1.5">
            <div
              className="text-xs px-2 py-1 rounded-lg flex items-center gap-1"
              style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.5)" }}
            >
              <Eye size={10} />
              Inspect
            </div>
            {selectedStep.requiresConfirmation && (
              <div
                className="text-xs px-2 py-1 rounded-lg flex items-center gap-1"
                style={{ background: "rgba(245,158,11,0.12)", color: "#f59e0b" }}
              >
                <SkipForward size={10} />
                Skip step
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Overlay ──────────────────────────────────────────────────────────────

export default function PlanModeOverlay({ intentState, onConfirmAll, onDeny, onClose }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const hasMutationSteps = intentState.steps.some((s) => s.requiresConfirmation);
  const allApproved = intentState.steps.every(
    (s) => !s.requiresConfirmation || s.status === "completed" || s.status === "skipped",
  );
  const anyRunning = intentState.steps.some((s) => s.status === "running");

  const handleSelectNode = useCallback((id: string | null) => {
    setSelectedId(id);
  }, []);

  return (
    <div
      className="fixed inset-0 flex flex-col overflow-hidden"
      style={{
        zIndex: 155,
        background: "rgba(7, 11, 20, 0.96)",
        backdropFilter: "blur(40px) saturate(160%)",
      }}
    >
      {/* ── Header ── */}
      <div
        className="flex items-center gap-4 px-6 py-4 border-b flex-shrink-0"
        style={{ borderColor: "rgba(255,255,255,0.07)" }}
      >
        {/* Pulsing orb dot */}
        <div className="relative flex-shrink-0">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center"
            style={{ background: "rgba(245,158,11,0.15)", border: "1.5px solid rgba(245,158,11,0.5)" }}
          >
            <Zap size={14} style={{ color: "#f59e0b" }} />
          </div>
          <div
            className="absolute inset-0 rounded-full animate-ping"
            style={{ background: "rgba(245,158,11,0.1)" }}
          />
        </div>

        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold mb-0.5" style={{ color: "rgba(245,158,11,0.9)" }}>
            PLAN MODE — MUTATION DETECTED
          </div>
          <div className="text-sm font-medium truncate" style={{ color: "rgba(255,255,255,0.85)" }}>
            {intentState.text}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <div
            className="text-xs px-3 py-1.5 rounded-full"
            style={{
              background: "rgba(255,255,255,0.05)",
              color: "rgba(255,255,255,0.4)",
              border: "1px solid rgba(255,255,255,0.08)",
            }}
          >
            {intentState.steps.filter((s) => s.status === "completed").length} / {intentState.steps.length} steps
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl transition-colors"
            style={{ color: "rgba(255,255,255,0.3)" }}
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* ── Body: Mindmap + Step Panel ── */}
      <div className="flex flex-1 overflow-hidden min-h-0">
        <MindmapCanvas
          steps={intentState.steps}
          intentText={intentState.text}
          selectedId={selectedId}
          onSelectNode={handleSelectNode}
        />
        <StepPanel
          steps={intentState.steps}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
      </div>

      {/* ── Footer ── */}
      <div
        className="flex items-center gap-3 px-6 py-4 border-t flex-shrink-0"
        style={{ borderColor: "rgba(255,255,255,0.07)" }}
      >
        <button
          onClick={onDeny}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium transition-all"
          style={{
            background: "rgba(239,68,68,0.08)",
            border: "1px solid rgba(239,68,68,0.2)",
            color: "#f87171",
          }}
        >
          <X size={14} />
          Abort
        </button>

        <div className="flex-1" />

        <div className="text-xs" style={{ color: "rgba(255,255,255,0.3)" }}>
          {hasMutationSteps
            ? "Review the plan, then confirm to execute all steps."
            : "All steps are read-only — no confirmation needed."}
        </div>

        <button
          onClick={onConfirmAll}
          disabled={anyRunning}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-50"
          style={{
            background: allApproved ? "rgba(34,197,94,0.2)" : "rgba(245,158,11,0.15)",
            border: allApproved ? "1px solid rgba(34,197,94,0.4)" : "1px solid rgba(245,158,11,0.35)",
            color: allApproved ? "#4ade80" : "#fbbf24",
          }}
        >
          <Check size={14} />
          {anyRunning ? "Executing..." : "Confirm & Execute All"}
        </button>
      </div>
    </div>
  );
}
