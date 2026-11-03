"use client";

import { useEffect, useState } from "react";
import {
  Brain, Zap, Lock, Eye, BarChart2, Cpu, MessageSquare,
  Check, ChevronRight, Info, Sparkles, Shield, FlaskConical,
  Database, GitBranch, RefreshCw,
} from "lucide-react";

type Section = "model" | "autonomy" | "privacy" | "memory" | "advanced" | "capabilities";

const SECTIONS: { id: Section; label: string; icon: React.ComponentType<{ size?: number }> }[] = [
  { id: "model",    label: "Model & Routing",  icon: Cpu },
  { id: "autonomy", label: "Autonomy & Control", icon: Zap },
  { id: "privacy",  label: "Privacy Mode",     icon: Shield },
  { id: "memory",   label: "Memory & Context", icon: Brain },
  { id: "advanced", label: "Advanced",         icon: FlaskConical },
  { id: "capabilities", label: "Capabilities", icon: Sparkles },
];

const MODELS = [
  { id: "gemini-2-flash",    label: "Gemini 2.0 Flash",    desc: "Fastest — great for quick tasks and real-time responses", badge: "Fast" },
  { id: "gemini-15-pro",     label: "Gemini 1.5 Pro",      desc: "Best quality — deep reasoning, code, long context", badge: "Pro" },
  { id: "claude-sonnet",     label: "Claude Sonnet 4.5",   desc: "Balanced — excellent writing, analysis and code", badge: "" },
  { id: "claude-haiku",      label: "Claude Haiku 4.5",    desc: "Fast and efficient for high-volume tasks", badge: "Fast" },
];

const ROUTING_STRATEGIES = [
  { id: "balanced",  label: "Balanced",       desc: "Route by task type — fastest for simple, best for complex" },
  { id: "quality",   label: "Highest Quality", desc: "Always use the best available model" },
  { id: "speed",     label: "Fastest",         desc: "Prioritize speed and minimal latency" },
  { id: "manual",    label: "Manual",          desc: "You choose the model per request" },
];

const PRIVACY_MODES = [
  { id: "strict",    label: "Strict",        desc: "No data leaves your device — local inference only", icon: Lock },
  { id: "unified",   label: "Standard",      desc: "Data sent to Elyra AI backend — no third-party sharing", icon: Shield },
  { id: "per-query", label: "Per-Query",     desc: "Choose data sharing settings per request", icon: Eye },
];

const CAPABILITY_ACTIONS = [
  {
    id: "analyze-visual",
    title: "Analyze Screenshot",
    desc: "Upload screenshots or UI references and generate a clean implementation plan.",
    target: "code" as const,
    payload: {
      skill: "custom",
      task: "Analyze the uploaded screenshots or assets, identify the visible UI problems, and prepare an implementation plan with concrete fixes.",
    },
  },
  {
    id: "script-writer",
    title: "Script Writer",
    desc: "Draft scripts, flows, outlines, and production-ready prompts with reasoning.",
    target: "code" as const,
    payload: {
      skill: "custom",
      task: "Draft a polished script, outline, or AI prompt pack for the current project. Use uploaded files as source material when available.",
    },
  },
  {
    id: "image-video-brief",
    title: "Image + Video Briefs",
    desc: "Prepare generation-ready creative briefs for image and video workflows in Gemini.",
    target: "code" as const,
    payload: {
      skill: "custom",
      task: "Create high-quality image and video generation briefs, shot lists, prompts, and asset requirements for the current project.",
    },
  },
  {
    id: "build-process",
    title: "Build Process",
    desc: "Open Builder with a ready-made workflow seed for automation or ops processes.",
    target: "builder" as const,
    payload: {
      title: "New AI Process",
      description: "Imported from AI Capabilities",
    },
  },
  {
    id: "create-project",
    title: "Create Project",
    desc: "Jump into Tasks to create and track a new project plan.",
    target: "route" as const,
    route: "/os/tasks",
  },
  {
    id: "summarize-email",
    title: "Summarize Email",
    desc: "Open Mail and use Elli to summarize inbox threads with shared context.",
    target: "route" as const,
    route: "/os/mail",
  },
  {
    id: "plan-week",
    title: "Plan My Week",
    desc: "Open Calendar and organize the week from schedules, tasks, and priorities.",
    target: "route" as const,
    route: "/os/calendar",
  },
];

const AI_PREFERENCES_KEY = "elyra_ai_preferences";

export default function AiSettingsWindow() {
  const [section, setSection] = useState<Section>("model");
  const [selectedModel, setSelectedModel] = useState("gemini-2-flash");
  const [routingStrategy, setRoutingStrategy] = useState("balanced");
  const [autonomy, setAutonomy] = useState(45);
  const [privacyMode, setPrivacyMode] = useState("unified");
  const [graphMemory, setGraphMemory] = useState(true);
  const [contextWindow, setContextWindow] = useState(32000);
  const [streamingEnabled, setStreamingEnabled] = useState(true);
  const [showReasoning, setShowReasoning] = useState(false);
  const [autoRetry, setAutoRetry] = useState(true);
  const [temperature, setTemperature] = useState(0.7);
  const [personalityTone, setPersonalityTone] = useState<"professional" | "pragmatic" | "friendly">("pragmatic");
  const [fullAccessMode, setFullAccessMode] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(AI_PREFERENCES_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (typeof parsed.autonomy === "number") setAutonomy(Math.max(0, Math.min(100, parsed.autonomy)));
      if (typeof parsed.selectedModel === "string") setSelectedModel(parsed.selectedModel);
      if (typeof parsed.routingStrategy === "string") setRoutingStrategy(parsed.routingStrategy);
      if (typeof parsed.personalityTone === "string") {
        const tone = parsed.personalityTone;
        if (tone === "professional" || tone === "pragmatic" || tone === "friendly") {
          setPersonalityTone(tone);
        }
      }
      if (parsed.fullAccessMode === true) setFullAccessMode(true);
    } catch {
      // ignore malformed local preferences
    }
  }, []);

  useEffect(() => {
    const payload = {
      selectedModel,
      routingStrategy,
      autonomy,
      privacyMode,
      graphMemory,
      streamingEnabled,
      showReasoning,
      autoRetry,
      temperature,
      personalityTone,
      fullAccessMode,
    };
    try {
      window.localStorage.setItem(AI_PREFERENCES_KEY, JSON.stringify(payload));
    } catch {
      // ignore storage errors
    }
  }, [
    selectedModel,
    routingStrategy,
    autonomy,
    privacyMode,
    graphMemory,
    streamingEnabled,
    showReasoning,
    autoRetry,
    temperature,
    personalityTone,
    fullAccessMode,
  ]);

  const launchCapability = (actionId: string) => {
    const action = CAPABILITY_ACTIONS.find((item) => item.id === actionId);
    if (!action) return;

    if (action.target === "code") {
      window.localStorage.setItem("elyra_ai_task_queue", JSON.stringify(action.payload));
      window.location.assign("/os/code");
      return;
    }

    if (action.target === "builder") {
      window.localStorage.setItem("elyra_builder_quickstart", JSON.stringify(action.payload));
      window.location.assign("/os/builder");
      return;
    }

    window.location.assign(action.route);
  };

  const autonomyLabel = autonomy < 25 ? "Conservative — always asks before acting"
    : autonomy < 50 ? "Guided — confirms on significant actions"
    : autonomy < 75 ? "Proactive — acts independently on routine tasks"
    : "Autonomous — full execution without confirmation";

  return (
    <div className="flex h-full overflow-hidden">
      {/* Sidebar */}
      <aside className="flex w-48 flex-shrink-0 flex-col border-r py-2" style={{ borderColor: "var(--os-border-faint)", background: "var(--bg-surface)" }}>
        {SECTIONS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setSection(id)}
            className="flex w-full items-center gap-2.5 rounded-lg mx-2 px-3 py-2.5 text-left transition"
            style={{
              width: "calc(100% - 16px)",
              background: section === id ? "var(--os-accent-faint, rgba(108,156,252,0.12))" : "transparent",
              color: section === id ? "var(--os-accent)" : "var(--text-secondary)",
            }}
          >
            <Icon size={14} />
            <span className="text-sm">{label}</span>
            {section === id && <ChevronRight size={12} className="ml-auto opacity-50" />}
          </button>
        ))}
      </aside>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">

        {/* MODEL */}
        {section === "model" && (
          <div className="space-y-6">
            <div>
              <h3 className="mb-1 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>AI Model</h3>
              <p className="mb-4 text-xs" style={{ color: "var(--text-tertiary)" }}>Select the primary model for Elli to use</p>
              <div className="space-y-2">
                {MODELS.map(({ id, label, desc, badge }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setSelectedModel(id)}
                    className="flex w-full items-start gap-3 rounded-xl border px-4 py-3 text-left transition"
                    style={{
                      borderColor: selectedModel === id ? "var(--os-accent)" : "var(--os-border-faint)",
                      background: selectedModel === id ? "var(--os-accent-faint, rgba(108,156,252,0.08))" : "var(--bg-elevated)",
                    }}
                  >
                    <div className="mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border" style={{
                      borderColor: selectedModel === id ? "var(--os-accent)" : "var(--os-border-soft)",
                      background: selectedModel === id ? "var(--os-accent)" : "transparent",
                    }}>
                      {selectedModel === id && <Check size={9} className="text-white" />}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{label}</span>
                        {badge && (
                          <span className="rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide" style={{ background: "var(--os-accent-faint, rgba(108,156,252,0.12))", color: "var(--os-accent)" }}>
                            {badge}
                          </span>
                        )}
                      </div>
                      <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>{desc}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <h3 className="mb-1 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Routing Strategy</h3>
              <p className="mb-3 text-xs" style={{ color: "var(--text-tertiary)" }}>How Elli selects models for different tasks</p>
              <div className="grid grid-cols-2 gap-2">
                {ROUTING_STRATEGIES.map(({ id, label, desc }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setRoutingStrategy(id)}
                    className="rounded-xl border p-3 text-left transition"
                    style={{
                      borderColor: routingStrategy === id ? "var(--os-accent)" : "var(--os-border-faint)",
                      background: routingStrategy === id ? "var(--os-accent-faint, rgba(108,156,252,0.08))" : "var(--bg-elevated)",
                    }}
                  >
                    <p className="text-xs font-medium" style={{ color: routingStrategy === id ? "var(--os-accent)" : "var(--text-primary)" }}>{label}</p>
                    <p className="mt-0.5 text-[10px]" style={{ color: "var(--text-tertiary)" }}>{desc}</p>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* AUTONOMY */}
        {section === "autonomy" && (
          <div className="space-y-6">
            <div>
              <h3 className="mb-1 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Autonomy Level</h3>
              <p className="mb-4 text-xs" style={{ color: "var(--text-tertiary)" }}>Control how independently Elli acts on your behalf</p>

              <div className="rounded-2xl border p-5" style={{ borderColor: "var(--os-border-faint)", background: "var(--bg-elevated)" }}>
                <div className="mb-4 flex items-center justify-between">
                  <span className="text-2xl font-bold" style={{ color: "var(--os-accent)" }}>{autonomy}%</span>
                  <span className="rounded-full px-2.5 py-1 text-xs font-medium" style={{ background: "var(--os-accent-faint, rgba(108,156,252,0.1))", color: "var(--os-accent)" }}>
                    {autonomy < 25 ? "Conservative" : autonomy < 50 ? "Guided" : autonomy < 75 ? "Proactive" : "Autonomous"}
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={autonomy}
                  onChange={(e) => setAutonomy(Number(e.target.value))}
                  className="w-full"
                  style={{ accentColor: "var(--os-accent)" }}
                />
                <div className="mt-3 flex justify-between text-[10px]" style={{ color: "var(--text-tertiary)" }}>
                  <span>Always asks</span>
                  <span>Fully autonomous</span>
                </div>
                <p className="mt-3 text-xs" style={{ color: "var(--text-secondary)" }}>{autonomyLabel}</p>
              </div>
            </div>

            <div className="space-y-2">
              {[
                { label: "Auto-retry on failure", desc: "Retry failed AI requests automatically up to 3 times", value: autoRetry, onChange: setAutoRetry },
                { label: "Streaming responses", desc: "Show AI responses as they're generated in real-time", value: streamingEnabled, onChange: setStreamingEnabled },
              ].map(({ label, desc, value, onChange }) => (
                <div key={label} className="flex items-center justify-between rounded-xl border px-4 py-3" style={{ borderColor: "var(--os-border-faint)", background: "var(--bg-elevated)" }}>
                  <div>
                    <p className="text-sm" style={{ color: "var(--text-primary)" }}>{label}</p>
                    <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>{desc}</p>
                  </div>
                  <button type="button" onClick={() => onChange(!value)} className="relative h-6 w-10 rounded-full transition-colors" style={{ background: value ? "var(--os-accent)" : "var(--bg-surface-hover, rgba(255,255,255,0.1))" }}>
                    <div className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform" style={{ transform: value ? "translateX(18px)" : "translateX(2px)" }} />
                  </button>
                </div>
              ))}
            </div>

            <div className="rounded-2xl border p-4" style={{ borderColor: "var(--os-border-faint)", background: "var(--bg-elevated)" }}>
              <h4 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-tertiary)" }}>Personality</h4>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {([
                  { id: "pragmatic", label: "Pragmatic" },
                  { id: "professional", label: "Professional" },
                  { id: "friendly", label: "Friendly" },
                ] as const).map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setPersonalityTone(option.id)}
                    className="rounded-lg border px-2 py-1.5 text-[11px] font-semibold transition"
                    style={{
                      borderColor: personalityTone === option.id ? "var(--os-accent)" : "var(--os-border-faint)",
                      color: personalityTone === option.id ? "var(--os-accent)" : "var(--text-secondary)",
                      background: personalityTone === option.id ? "var(--os-accent-faint, rgba(108,156,252,0.1))" : "var(--bg-surface)",
                    }}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border p-4" style={{ borderColor: "rgba(249,115,22,0.28)", background: "color-mix(in srgb, #f97316 8%, var(--bg-elevated))" }}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Full Access Mode</p>
                  <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                    Elli can use available tools aggressively (terminal/actions). High-risk external changes still require explicit confirmation.
                  </p>
                </div>
                <button type="button" onClick={() => setFullAccessMode(!fullAccessMode)} className="relative h-6 w-10 rounded-full transition-colors" style={{ background: fullAccessMode ? "var(--os-accent)" : "var(--bg-surface-hover, rgba(255,255,255,0.1))" }}>
                  <div className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform" style={{ transform: fullAccessMode ? "translateX(18px)" : "translateX(2px)" }} />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* PRIVACY */}
        {section === "privacy" && (
          <div className="space-y-6">
            <div>
              <h3 className="mb-1 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Privacy Mode</h3>
              <p className="mb-4 text-xs" style={{ color: "var(--text-tertiary)" }}>Control how your data is processed and where it goes</p>
              <div className="space-y-2">
                {PRIVACY_MODES.map(({ id, label, desc, icon: Icon }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setPrivacyMode(id)}
                    className="flex w-full items-start gap-3 rounded-xl border px-4 py-3 text-left transition"
                    style={{
                      borderColor: privacyMode === id ? "var(--os-accent)" : "var(--os-border-faint)",
                      background: privacyMode === id ? "var(--os-accent-faint, rgba(108,156,252,0.08))" : "var(--bg-elevated)",
                    }}
                  >
                    <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl" style={{ background: privacyMode === id ? "var(--os-accent-faint, rgba(108,156,252,0.15))" : "var(--bg-surface)" }}>
                      <Icon size={14} style={{ color: privacyMode === id ? "var(--os-accent)" : "var(--text-tertiary)" }} />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{label}</p>
                        {privacyMode === id && <Check size={12} style={{ color: "var(--os-accent)" }} />}
                      </div>
                      <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>{desc}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* MEMORY */}
        {section === "memory" && (
          <div className="space-y-6">
            <div>
              <h3 className="mb-1 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Memory & Context</h3>
              <p className="mb-4 text-xs" style={{ color: "var(--text-tertiary)" }}>Configure how Elli remembers and uses context</p>
              <div className="space-y-2">
                {[
                  { label: "Knowledge graph memory", desc: "Build a knowledge graph from your workspace activity", value: graphMemory, onChange: setGraphMemory },
                ].map(({ label, desc, value, onChange }) => (
                  <div key={label} className="flex items-center justify-between rounded-xl border px-4 py-3" style={{ borderColor: "var(--os-border-faint)", background: "var(--bg-elevated)" }}>
                    <div>
                      <p className="text-sm" style={{ color: "var(--text-primary)" }}>{label}</p>
                      <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>{desc}</p>
                    </div>
                    <button type="button" onClick={() => onChange(!value)} className="relative h-6 w-10 rounded-full transition-colors" style={{ background: value ? "var(--os-accent)" : "var(--bg-surface-hover, rgba(255,255,255,0.1))" }}>
                      <div className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform" style={{ transform: value ? "translateX(18px)" : "translateX(2px)" }} />
                    </button>
                  </div>
                ))}
              </div>

              <div className="mt-4">
                <label className="mb-2 block text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-tertiary)" }}>Context window size</label>
                <div className="flex items-center gap-3">
                  <input type="range" min={4096} max={128000} step={4096} value={contextWindow} onChange={(e) => setContextWindow(Number(e.target.value))} className="flex-1" style={{ accentColor: "var(--os-accent)" }} />
                  <span className="w-20 text-right text-sm font-medium" style={{ color: "var(--text-primary)" }}>{(contextWindow / 1000).toFixed(0)}K tokens</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {section === "capabilities" && (
          <div className="space-y-6">
            <div>
              <h3 className="mb-1 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Unified AI Capabilities</h3>
              <p className="mb-4 text-xs" style={{ color: "var(--text-tertiary)" }}>
                Launch connected AI flows across Code, Builder, Mail, Calendar, and projects. Screenshot uploads and data files work through the Code app.
              </p>
              <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
                {CAPABILITY_ACTIONS.map((action) => (
                  <button
                    key={action.id}
                    type="button"
                    onClick={() => launchCapability(action.id)}
                    className="rounded-xl border p-4 text-left transition"
                    style={{ borderColor: "var(--os-border-faint)", background: "var(--bg-elevated)" }}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{action.title}</p>
                      <Sparkles size={13} style={{ color: "var(--os-accent)" }} />
                    </div>
                    <p className="mt-1 text-xs" style={{ color: "var(--text-tertiary)" }}>{action.desc}</p>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ADVANCED */}
        {section === "advanced" && (
          <div className="space-y-6">
            <div>
              <h3 className="mb-1 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Advanced Settings</h3>
              <p className="mb-4 text-xs" style={{ color: "var(--text-tertiary)" }}>Fine-tune model behavior and experimental features</p>
            </div>
            <div>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-tertiary)" }}>Temperature</label>
              <div className="flex items-center gap-3">
                <input type="range" min={0} max={2} step={0.05} value={temperature} onChange={(e) => setTemperature(Number(e.target.value))} className="flex-1" style={{ accentColor: "var(--os-accent)" }} />
                <span className="w-10 text-right text-sm font-medium tabular-nums" style={{ color: "var(--text-primary)" }}>{temperature.toFixed(2)}</span>
              </div>
              <p className="mt-1 text-xs" style={{ color: "var(--text-tertiary)" }}>Lower = more deterministic · Higher = more creative</p>
            </div>
            <div className="space-y-2">
              {[
                { label: "Show reasoning traces", desc: "Display intermediate reasoning steps in the chat", value: showReasoning, onChange: setShowReasoning },
              ].map(({ label, desc, value, onChange }) => (
                <div key={label} className="flex items-center justify-between rounded-xl border px-4 py-3" style={{ borderColor: "var(--os-border-faint)", background: "var(--bg-elevated)" }}>
                  <div>
                    <p className="text-sm" style={{ color: "var(--text-primary)" }}>{label}</p>
                    <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>{desc}</p>
                  </div>
                  <button type="button" onClick={() => onChange(!value)} className="relative h-6 w-10 rounded-full transition-colors" style={{ background: value ? "var(--os-accent)" : "var(--bg-surface-hover, rgba(255,255,255,0.1))" }}>
                    <div className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform" style={{ transform: value ? "translateX(18px)" : "translateX(2px)" }} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
