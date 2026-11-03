"use client";

import { useEffect, useState } from "react";
import {
  BookText,
  Calendar,
  CheckSquare,
  FileText,
  Languages,
  Mail,
  MessageSquare,
  PenLine,
  Presentation,
  Sparkles,
  Sun,
  Globe2,
  Brain,
  Zap,
  Activity,
  X,
} from "lucide-react";
import type { AppId, UiQuickAction } from "@/components/os/kernel/types";
import {
  SHELL_LAYER_DATA_ATTR,
  SHELL_LAYERS,
} from "@/components/os/shell/layers";
import { ORB_TOP_PX } from "@/components/os/shell/orbMetrics";
import { ensureSupabaseToken } from "@/lib/supabase/browser";

type OrbAreaProps = {
  orbState: "idle" | "hover" | "active" | "thinking" | "warning" | "success" | "error";
  panelOpen: boolean;
  onTogglePanel: () => void;
  onFocusIntent: () => void;
  onOpenApp: (appId: AppId) => void;
  onExecuteQuickAction: (action: UiQuickAction) => void;
  quickActions: Array<{
    app_id: string;
    app_name: string;
    action_id: string;
    label: string;
    intent: string;
    tool_ref: string;
    requires_auth: boolean;
    requires_approval: boolean;
    state: "ready" | "needs_auth" | "policy_blocked" | "disabled";
    badges: Array<"connected" | "needs_auth" | "degraded" | "policy_blocked" | "disabled">;
    open_app_id: AppId | null;
  }>;
  workspaceId: string;
  accent: string;
  onHoverChange?: (hovering: boolean) => void;
};

type WorkspaceSummary = {
  nextEvent: string | null;
  unreadEmails: number;
  openTasks: number;
  recentChats: Array<{ role: string; content: string; created_at: string }>;
  loading: boolean;
};

const ACTION_ICONS: Record<string, typeof Calendar> = {
  mail: Mail,
  calendar: Calendar,
  tasks: CheckSquare,
  task: CheckSquare,
  files: FileText,
  chat: MessageSquare,
  weather: Sun,
  translate: Languages,
  web: Globe2,
  research: Globe2,
  draft: PenLine,
  write: PenLine,
  summarize: BookText,
  summary: BookText,
  pitchdeck: Presentation,
  pitch: Presentation,
  presentation: Presentation,
  slides: Presentation,
  elli_assistant: Sparkles,
};

const STATE_LABELS: Record<OrbAreaProps["orbState"], { label: string; color: string; dot: string }> = {
  idle:     { label: "Bereit",       color: "text-[color:var(--text-muted)]",    dot: "bg-white/30" },
  hover:    { label: "Bereit",       color: "text-[color:var(--text-muted)]",    dot: "bg-white/30" },
  active:   { label: "Aktiv",        color: "text-sky-300/80",                   dot: "bg-sky-400" },
  thinking: { label: "Denkt nach…",  color: "text-indigo-300/80",                dot: "bg-indigo-400 animate-pulse" },
  warning:  { label: "Wartet",       color: "text-amber-300/80",                 dot: "bg-amber-400 animate-pulse" },
  success:  { label: "Erledigt",     color: "text-emerald-300/80",               dot: "bg-emerald-400" },
  error:    { label: "Fehler",       color: "text-rose-300/80",                  dot: "bg-rose-400" },
};

export default function OrbArea({
  orbState,
  panelOpen,
  onTogglePanel,
  onFocusIntent,
  onOpenApp,
  onExecuteQuickAction,
  quickActions,
  workspaceId,
  accent,
  onHoverChange,
}: OrbAreaProps) {
  const [summary, setSummary] = useState<WorkspaceSummary>({
    nextEvent: null,
    unreadEmails: 0,
    openTasks: 0,
    recentChats: [],
    loading: true,
  });

  useEffect(() => {
    if (!panelOpen) return;
    let cancelled = false;
    setSummary((previous) => ({ ...previous, loading: true }));

    const fetchSummary = async () => {
      try {
        const token = await ensureSupabaseToken();
        const base = process.env.NEXT_PUBLIC_AI_SERVICE_URL || "http://localhost:8788";
        const headers = { Authorization: `Bearer ${token}` };

        const [summaryRes, chatRes] = await Promise.allSettled([
          fetch(`${base}/v1/workspace-summary?workspaceId=${encodeURIComponent(workspaceId)}`, { headers }),
          fetch(`${base}/v1/chat/history?workspaceId=${encodeURIComponent(workspaceId)}&limit=8`, { headers }),
        ]);

        if (cancelled) return;

        let nextEvent: string | null = null;
        let unreadEmails = 0;
        let openTasks = 0;
        if (summaryRes.status === "fulfilled" && summaryRes.value.ok) {
          const payload = (await summaryRes.value.json()) as {
            nextEvent?: string | null;
            unreadEmails?: number;
            openTasks?: number;
          };
          nextEvent = typeof payload.nextEvent === "string" ? payload.nextEvent : null;
          unreadEmails = typeof payload.unreadEmails === "number" ? payload.unreadEmails : 0;
          openTasks = typeof payload.openTasks === "number" ? payload.openTasks : 0;
        }

        let recentChats: WorkspaceSummary["recentChats"] = [];
        if (chatRes.status === "fulfilled" && chatRes.value.ok) {
          const payload = (await chatRes.value.json()) as {
            messages?: Array<{ role?: string; content?: string; created_at?: string }>;
          };
          recentChats = (payload.messages ?? [])
            .filter(
              (m) => typeof m.content === "string" && typeof m.created_at === "string" &&
                (m.role === "user" || m.role === "assistant"),
            )
            .map((m) => ({ role: m.role as "user" | "assistant", content: m.content as string, created_at: m.created_at as string }))
            .slice(-5);
        }

        setSummary({ nextEvent, unreadEmails, openTasks, recentChats, loading: false });
      } catch {
        if (!cancelled) {
          setSummary((previous) => ({ ...previous, loading: false }));
        }
      }
    };

    void fetchSummary();
    return () => { cancelled = true; };
  }, [panelOpen, workspaceId]);

  const stateInfo = STATE_LABELS[orbState] ?? STATE_LABELS.idle;
  const accentAlpha = `${accent}44`;
  const accentBorder = `${accent}33`;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 flex justify-center"
      style={{ top: `${ORB_TOP_PX}px`, zIndex: SHELL_LAYERS.orb }}
    >
      <div className="pointer-events-auto relative flex flex-col items-center">
        {/* Invisible clickable zone over the orb */}
        <button
          type="button"
          onClick={() => { onFocusIntent(); onTogglePanel(); }}
          onMouseEnter={() => onHoverChange?.(true)}
          onMouseLeave={() => onHoverChange?.(false)}
          onFocus={() => onHoverChange?.(true)}
          onBlur={() => onHoverChange?.(false)}
          className="pointer-events-auto relative z-50 h-20 w-20 rounded-full bg-transparent p-0 sm:h-24 sm:w-24"
          aria-label="Elli öffnen"
        />

        {panelOpen && (
          <>
            {/* Backdrop */}
            <div
              className="fixed inset-0 z-40 pointer-events-auto"
              onClick={onTogglePanel}
              aria-hidden
              {...{ [SHELL_LAYER_DATA_ATTR]: "orb" }}
            />

            {/* Panel */}
            <div
              className="relative z-50 mt-2 w-[min(94vw,400px)] pointer-events-auto"
              {...{ [SHELL_LAYER_DATA_ATTR]: "orb" }}
              style={{
                animation: "orbPanelIn 0.22s cubic-bezier(0.22, 1, 0.36, 1) both",
              }}
            >
              {/* Glass card */}
              <div
                className="rounded-2xl border overflow-hidden shadow-2xl"
                style={{
                  background: "color-mix(in srgb, var(--bg-elevated, #0d1627) 92%, transparent)",
                  borderColor: accentBorder,
                  backdropFilter: "blur(32px) saturate(1.5)",
                  WebkitBackdropFilter: "blur(32px) saturate(1.5)",
                  boxShadow: `0 24px 64px rgba(0,0,0,0.55), 0 0 0 1px ${accentBorder}, inset 0 1px 0 rgba(255,255,255,0.06)`,
                }}
              >
                {/* Header strip */}
                <div
                  className="flex items-center justify-between px-4 py-3"
                  style={{
                    background: `linear-gradient(135deg, ${accentAlpha} 0%, transparent 60%)`,
                    borderBottom: `1px solid ${accentBorder}`,
                  }}
                >
                  <div className="flex items-center gap-2.5">
                    <Brain size={14} className="text-[color:var(--text-muted)]" />
                    <span className="text-[11px] font-semibold uppercase tracking-[0.15em] text-[color:var(--text-secondary)]">
                      Elly
                    </span>
                    <div className="flex items-center gap-1.5">
                      <span className={`h-1.5 w-1.5 rounded-full ${stateInfo.dot}`} />
                      <span className={`text-[10px] font-medium ${stateInfo.color}`}>{stateInfo.label}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={onTogglePanel}
                    className="rounded-md p-1 text-[color:var(--text-muted)] transition hover:bg-white/10 hover:text-white"
                    aria-label="Schließen"
                  >
                    <X size={13} />
                  </button>
                </div>

                <div className="p-4 space-y-4">
                  {/* Status overview */}
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { icon: Calendar, label: "Nächster Termin", value: summary.loading ? "…" : (summary.nextEvent ?? "Frei"), accent: "#6366f1" },
                      { icon: Mail,     label: "Ungelesen",       value: summary.loading ? "…" : String(summary.unreadEmails),   accent: "#38bdf8" },
                      { icon: CheckSquare, label: "Aufgaben",     value: summary.loading ? "…" : String(summary.openTasks),      accent: "#34d399" },
                    ].map(({ icon: Icon, label, value, accent: cardAccent }) => (
                      <div
                        key={label}
                        className="rounded-xl p-2.5 text-center border transition hover:brightness-110"
                        style={{
                          background: `${cardAccent}0d`,
                          borderColor: `${cardAccent}22`,
                        }}
                      >
                        <Icon size={13} className="mx-auto mb-1.5" style={{ color: cardAccent }} />
                        <p className="text-[9px] uppercase tracking-wider text-[color:var(--text-muted)] mb-0.5">{label}</p>
                        <p className="text-[11px] font-semibold text-[color:var(--text-secondary)] truncate">{value}</p>
                      </div>
                    ))}
                  </div>

                  {/* Quick actions */}
                  {quickActions.length > 0 && (
                    <div>
                      <div className="flex items-center gap-1.5 mb-2 px-0.5">
                        <Zap size={10} style={{ color: accent }} />
                        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[color:var(--text-muted)]">
                          Schnellaktionen
                        </p>
                      </div>
                      <div className="grid grid-cols-2 gap-1.5">
                        {quickActions.slice(0, 6).map((action) => {
                          const key = action.label.toLowerCase();
                          const Icon = ACTION_ICONS[key] ?? ACTION_ICONS[action.app_id] ?? Sparkles;
                          const disabled = action.state === "policy_blocked" || action.state === "disabled";
                          return (
                            <button
                              key={action.action_id}
                              type="button"
                              onClick={() => {
                                if (disabled) return;
                                onExecuteQuickAction(action);
                                if (action.open_app_id) onOpenApp(action.open_app_id);
                                else onFocusIntent();
                                onTogglePanel();
                              }}
                              disabled={disabled}
                              className="group flex items-center gap-2 rounded-xl border px-2.5 py-2 text-left transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
                              style={{
                                background: "var(--bg-surface, rgba(255,255,255,0.03))",
                                borderColor: "var(--os-border-soft, rgba(255,255,255,0.08))",
                              }}
                            >
                              <div
                                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg"
                                style={{ background: `${accent}22` }}
                              >
                                <Icon size={12} style={{ color: accent }} />
                              </div>
                              <span className="text-[11px] font-medium leading-tight text-[color:var(--text-secondary)] truncate">
                                {action.label}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Recent Elli conversations */}
                  {summary.recentChats.filter((m) => m.role === "user").length > 0 && (
                    <div>
                      <div className="flex items-center gap-1.5 mb-2 px-0.5">
                        <Activity size={10} style={{ color: accent }} />
                        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[color:var(--text-muted)]">
                          Zuletzt mit Elli
                        </p>
                      </div>
                      <ul className="space-y-1">
                        {summary.recentChats
                          .filter((m) => m.role === "user")
                          .slice(-3)
                          .map((m, i) => (
                            <li
                              key={`${m.created_at}-${i}`}
                              className="group flex items-start gap-2 rounded-xl border px-2.5 py-2 cursor-default transition hover:brightness-110"
                              style={{
                                background: "var(--bg-surface, rgba(255,255,255,0.02))",
                                borderColor: "var(--os-border-soft, rgba(255,255,255,0.06))",
                              }}
                            >
                              <div
                                className="mt-0.5 h-4 w-4 flex-shrink-0 rounded-full border flex items-center justify-center"
                                style={{ borderColor: `${accent}44`, background: `${accent}18` }}
                              >
                                <span className="text-[7px] font-bold" style={{ color: accent }}>E</span>
                              </div>
                              <span className="text-[11px] leading-snug text-[color:var(--text-muted)] line-clamp-2">
                                {m.content}
                              </span>
                            </li>
                          ))}
                      </ul>
                    </div>
                  )}

                  {/* Ask Elli CTA */}
                  <button
                    type="button"
                    onClick={() => { onFocusIntent(); onTogglePanel(); }}
                    className="group w-full rounded-xl border px-3 py-2.5 text-left transition hover:brightness-110"
                    style={{
                      background: `linear-gradient(135deg, ${accent}12 0%, transparent 70%)`,
                      borderColor: `${accent}33`,
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <Sparkles size={13} style={{ color: accent }} className="shrink-0" />
                      <span className="text-[12px] text-[color:var(--text-muted)] group-hover:text-[color:var(--text-secondary)] transition">
                        Elly etwas fragen…
                      </span>
                    </div>
                  </button>
                </div>
              </div>

              {/* Subtle connector dot */}
              <div
                className="mx-auto -mt-px h-0.5 w-8 rounded-full opacity-40"
                style={{ background: accent }}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
