"use client";

import { useState } from "react";
import { AlertCircle, Check, ChevronRight, Lock, Shield, X } from "lucide-react";
import { ensureSupabaseToken } from "@/lib/supabase/browser";
import type { WorkspaceKind } from "@/components/os/kernel/types";
import { SHELL_LAYER_DATA_ATTR } from "@/components/os/shell/layers";

type WorkingHours = "flexible" | "9-5" | "custom";

type Props = {
  workspaceId: string;
  workspaceKind: WorkspaceKind;
  workspaceName: string;
  accent: string;
  /** Called only after successful save OR explicit user skip */
  onComplete: () => void;
};

// Elyra platform workspace has god-mode: full system rights, no external override
const PLATFORM_GOD_MODE_IDS = ["ws-elyra-core", "elyra-core"];
function isPlatformGodMode(workspaceId: string): boolean {
  return PLATFORM_GOD_MODE_IDS.some(
    (id) => workspaceId === id || workspaceId.toLowerCase().includes("elyra-core"),
  );
}

export default function WorkspaceOnboardingWizard({
  workspaceId,
  workspaceKind,
  workspaceName,
  accent,
  onComplete,
}: Props) {
  const [step, setStep] = useState(1);
  const [purpose, setPurpose] = useState("");
  const [goals, setGoals] = useState(["", "", ""]);
  const [personalGoals, setPersonalGoals] = useState(["", "", ""]);
  const [roleFocus, setRoleFocus] = useState("");
  const [workingHours, setWorkingHours] = useState<WorkingHours>("flexible");
  const [customWorkingHours, setCustomWorkingHours] = useState("");
  const [loading, setLoading] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const workspaceKindValue = String(workspaceKind).toLowerCase();
  const isPersonal = workspaceKindValue === "individual" || workspaceKindValue === "personal";
  const isPlatform = workspaceKind === "platform";
  const godMode = isPlatformGodMode(workspaceId);

  // Steps: personal=3 (purpose, goals, personal), org=4 (purpose, goals, personal, role), platform=3 (purpose, goals, role)
  const totalSteps = isPersonal ? 3 : isPlatform ? 3 : 4;

  async function handleSubmit() {
    setLoading(true);
    setSaveError(null);
    try {
      const token = await ensureSupabaseToken();
      const profile: Record<string, unknown> = {
        kind: workspaceKind,
        purpose: purpose.trim(),
        goals: goals.map((g) => g.trim()).filter(Boolean),
        personalGoals: personalGoals.map((g) => g.trim()).filter(Boolean),
        operatingRules: [],
        preferences: {
          language: isPlatform ? "en" : "de",
          tone: isPersonal
            ? "casual-supportive"
            : isPlatform
              ? "technical-strategic"
              : "professional-efficient",
        },
      };

      // God-mode: platform workspace can't be overridden by other workspaces
      if (godMode) {
        profile.godMode = true;
        profile.systemRights = "full";
        profile.canOverrideOtherWorkspaces = true;
      }

      if (isPersonal) {
        profile.displayName = workspaceName;
      } else if (workspaceKind === "organization") {
        profile.organizationName = workspaceName;
        // Fish-delish: organization scope only, no elyra system rights
        if (workspaceId === "ws-fish-delish" || workspaceId.toLowerCase().includes("fish-delish")) {
          profile.systemRights = "none";
          profile.scopedToWorkspace = true;
        }
      } else {
        profile.platformName = workspaceName;
      }

      if (!isPersonal) {
        if (roleFocus.trim()) profile.roleFocus = roleFocus.trim();
        const rhythm = workingHours === "custom" ? customWorkingHours.trim() : workingHours;
        if (rhythm) profile.operatingRhythm = rhythm;
      }

      const response = await fetch(
        `/api/v1/workspace-brain/?workspaceId=${encodeURIComponent(workspaceId)}`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ profile }),
        },
      );

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(text || `Save failed (${response.status})`);
      }

      onComplete();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Setup konnte nicht gespeichert werden.";
      setSaveError(msg);
      // Do NOT call onComplete() here — user must fix the error or skip explicitly
    } finally {
      setLoading(false);
    }
  }

  const inputClass =
    "w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white/90 placeholder:text-white/30 focus:border-white/20 focus:outline-none transition";

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      {...{ [SHELL_LAYER_DATA_ATTR]: "modal" }}
    >
      <div className="relative w-[min(560px,94vw)] rounded-2xl border border-white/15 bg-[#0a1424]/96 p-6 shadow-2xl">
        {/* Close / Skip button */}
        <button
          type="button"
          onClick={onComplete}
          className="absolute right-4 top-4 text-white/40 hover:text-white/70 transition"
          aria-label="Wizard überspringen"
          title="Setup überspringen"
        >
          <X size={18} />
        </button>

        {/* Header */}
        <div className="mb-3 flex items-center gap-2.5">
          <div className="h-3 w-3 rounded-full flex-shrink-0" style={{ background: accent }} />
          <h2 className="text-lg font-semibold text-white/90">{workspaceName} einrichten</h2>
          {godMode && (
            <span className="ml-1 inline-flex items-center gap-1 rounded-full border border-violet-400/30 bg-violet-500/15 px-2 py-0.5 text-[10px] font-medium text-violet-300">
              <Shield size={10} />
              God-Mode
            </span>
          )}
          {workspaceId.toLowerCase().includes("fish-delish") && (
            <span className="ml-1 inline-flex items-center gap-1 rounded-full border border-orange-400/30 bg-orange-500/15 px-2 py-0.5 text-[10px] font-medium text-orange-300">
              <Lock size={10} />
              Scoped
            </span>
          )}
        </div>

        {/* Progress bar */}
        <div className="mb-6 flex gap-1">
          {Array.from({ length: totalSteps }).map((_, index) => (
            <div
              key={index}
              className="h-1 flex-1 rounded-full transition-all duration-300"
              style={{
                background: index < step ? accent : "rgba(255,255,255,0.1)",
              }}
            />
          ))}
        </div>

        {/* Error banner */}
        {saveError ? (
          <div className="mb-4 flex items-start gap-2 rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2.5 text-sm text-rose-300">
            <AlertCircle size={15} className="mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-medium">Setup konnte nicht gespeichert werden</p>
              <p className="text-xs text-rose-300/70 mt-0.5">{saveError}</p>
              <button
                type="button"
                onClick={() => setSaveError(null)}
                className="mt-1 text-xs text-rose-400/80 hover:text-rose-300 underline"
              >
                Erneut versuchen
              </button>
              <span className="mx-2 text-rose-400/40">·</span>
              <button
                type="button"
                onClick={onComplete}
                className="mt-1 text-xs text-rose-400/60 hover:text-rose-300"
              >
                Überspringen
              </button>
            </div>
          </div>
        ) : null}

        {/* ── Step 1: Purpose ── */}
        {step === 1 ? (
          <div className="space-y-4">
            <label className="block">
              <span className="text-sm text-white/70">
                {isPersonal
                  ? "Wobei soll dir Elli helfen?"
                  : isPlatform
                    ? "Was ist die Mission von Elyra Core?"
                    : `Was macht ${workspaceName}?`}
              </span>
              {godMode && (
                <p className="mt-0.5 text-xs text-violet-400/70">
                  Als Plattform-Workspace hat Elyra Core System-Rechte und kann andere Workspaces nicht überschreiben lassen.
                </p>
              )}
              <textarea
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                placeholder={
                  isPersonal
                    ? "Hilf mir mit meinem Alltag, Finanzen und persönlichem Wachstum."
                    : isPlatform
                      ? "KI-Plattform für intelligente Produktivität und Automatisierung."
                      : "Aufbau und Skalierung des Unternehmens mit klaren Prioritäten."
                }
                className={inputClass}
                rows={3}
              />
            </label>
            <button
              type="button"
              onClick={() => setStep(2)}
              disabled={!purpose.trim()}
              className="w-full rounded-xl py-2.5 text-sm font-medium text-white transition disabled:cursor-not-allowed"
              style={{ background: purpose.trim() ? accent : "rgba(255,255,255,0.06)" }}
            >
              Weiter <ChevronRight size={14} className="ml-1 inline" />
            </button>
          </div>
        ) : null}

        {/* ── Step 2: Workspace Goals ── */}
        {step === 2 ? (
          <div className="space-y-3">
            <div>
              <p className="text-sm font-medium text-white/80">
                {isPersonal ? "Deine Top-Ziele" : `Top-Ziele für ${workspaceName}`}
              </p>
              <p className="text-xs text-white/40 mt-0.5">Bis zu 3 Ziele — werden im Workspace gespeichert</p>
            </div>
            {goals.map((goal, index) => (
              <input
                key={index}
                value={goal}
                onChange={(e) => {
                  const next = [...goals];
                  next[index] = e.target.value;
                  setGoals(next);
                }}
                placeholder={
                  index === 0
                    ? "z. B. Umsatz verdoppeln bis Q4"
                    : index === 1
                      ? "z. B. Team auf 10 Personen skalieren"
                      : "z. B. Produktlaunch in 3 Ländern"
                }
                className={inputClass}
              />
            ))}
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="flex-1 rounded-xl border border-white/10 bg-white/[0.04] py-2.5 text-sm text-white/60 hover:bg-white/[0.07] transition"
              >
                Zurück
              </button>
              <button
                type="button"
                onClick={() => setStep(3)}
                className="flex-1 rounded-xl py-2.5 text-sm font-medium text-white transition"
                style={{ background: accent }}
              >
                Weiter <ChevronRight size={14} className="ml-1 inline" />
              </button>
            </div>
          </div>
        ) : null}

        {/* ── Step 3: Personal Goals (all workspace types) ── */}
        {step === 3 && (isPersonal || workspaceKind === "organization") ? (
          <div className="space-y-3">
            <div>
              <p className="text-sm font-medium text-white/80">Persönliche Ziele</p>
              <p className="text-xs text-white/40 mt-0.5">Separat gespeichert — nur für dich sichtbar</p>
            </div>
            {personalGoals.map((goal, index) => (
              <input
                key={index}
                value={goal}
                onChange={(e) => {
                  const next = [...personalGoals];
                  next[index] = e.target.value;
                  setPersonalGoals(next);
                }}
                placeholder={
                  index === 0
                    ? "z. B. Jeden Morgen 30 min Sport"
                    : index === 1
                      ? "z. B. 2 Bücher pro Monat lesen"
                      : "z. B. Wöchentliches Familien-Dinner"
                }
                className={inputClass}
              />
            ))}
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => setStep(2)}
                className="flex-1 rounded-xl border border-white/10 bg-white/[0.04] py-2.5 text-sm text-white/60 hover:bg-white/[0.07] transition"
              >
                Zurück
              </button>
              <button
                type="button"
                onClick={() => (isPersonal ? void handleSubmit() : setStep(4))}
                disabled={loading}
                className="flex-1 rounded-xl py-2.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-70 transition"
                style={{ background: accent }}
              >
                {isPersonal
                  ? loading
                    ? "Wird gespeichert…"
                    : "Setup abschließen"
                  : "Weiter"}
                {!isPersonal && <ChevronRight size={14} className="ml-1 inline" />}
              </button>
            </div>
          </div>
        ) : null}

        {/* ── Step 3 for Platform: Role ── */}
        {step === 3 && isPlatform ? (
          <div className="space-y-4">
            {godMode && (
              <div className="rounded-xl border border-violet-400/20 bg-violet-500/10 px-3 py-2.5 text-xs text-violet-300">
                <p className="font-medium flex items-center gap-1.5">
                  <Shield size={12} />
                  Elyra God-Mode aktiv
                </p>
                <p className="mt-1 text-violet-300/70">
                  Dieser Workspace hat volle Systemrechte. Andere Workspaces können die Elyra-Konfiguration nicht überschreiben. Nutzer- und Mitarbeiterverwaltung ist hier zentralisiert.
                </p>
              </div>
            )}
            <label className="block">
              <span className="text-sm text-white/70">Deine Rolle im System</span>
              <input
                value={roleFocus}
                onChange={(e) => setRoleFocus(e.target.value)}
                placeholder="Platform Owner, CTO, Head of AI..."
                className={`mt-1 ${inputClass}`}
              />
            </label>
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => setStep(2)}
                className="flex-1 rounded-xl border border-white/10 bg-white/[0.04] py-2.5 text-sm text-white/60 hover:bg-white/[0.07] transition"
              >
                Zurück
              </button>
              <button
                type="button"
                onClick={() => void handleSubmit()}
                disabled={loading}
                className="flex-1 rounded-xl py-2.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-70 transition"
                style={{ background: accent }}
              >
                {loading ? "Wird gespeichert…" : "Setup abschließen"}
                {!loading && <Check size={14} className="ml-1 inline" />}
              </button>
            </div>
          </div>
        ) : null}

        {/* ── Step 4 for Organization: Role & Hours ── */}
        {step === 4 && workspaceKind === "organization" ? (
          <div className="space-y-4">
            <label className="block">
              <span className="text-sm text-white/70">Deine Rolle in diesem Workspace</span>
              <input
                value={roleFocus}
                onChange={(e) => setRoleFocus(e.target.value)}
                placeholder="Founder, CEO, Operations Manager..."
                className={`mt-1 ${inputClass}`}
              />
            </label>

            <label className="block">
              <span className="text-sm text-white/70">Arbeitszeiten</span>
              <select
                value={workingHours}
                onChange={(e) => setWorkingHours(e.target.value as WorkingHours)}
                className={`mt-1 ${inputClass}`}
              >
                <option value="flexible">Flexibel</option>
                <option value="9-5">9–17 Uhr</option>
                <option value="custom">Individuell</option>
              </select>
            </label>

            {workingHours === "custom" ? (
              <label className="block">
                <span className="text-sm text-white/70">Eigene Zeitplanung</span>
                <input
                  value={customWorkingHours}
                  onChange={(e) => setCustomWorkingHours(e.target.value)}
                  placeholder="z. B. Mo–Fr 08:00–17:00"
                  className={`mt-1 ${inputClass}`}
                />
              </label>
            ) : null}

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => setStep(3)}
                className="flex-1 rounded-xl border border-white/10 bg-white/[0.04] py-2.5 text-sm text-white/60 hover:bg-white/[0.07] transition"
              >
                Zurück
              </button>
              <button
                type="button"
                onClick={() => void handleSubmit()}
                disabled={loading}
                className="flex-1 rounded-xl py-2.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-70 transition"
                style={{ background: accent }}
              >
                {loading ? "Wird gespeichert…" : "Setup abschließen"}
                {!loading && <Check size={14} className="ml-1 inline" />}
              </button>
            </div>
          </div>
        ) : null}

        <p className="mt-4 text-center text-xs text-white/30">
          Jederzeit änderbar unter Einstellungen → Workspace Brain
        </p>
      </div>
    </div>
  );
}
