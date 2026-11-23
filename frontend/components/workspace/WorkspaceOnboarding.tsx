"use client";

import { useEffect, useState } from "react";
import { getOnboardingCompleteEndpoint } from "@/utils/auth-guard";
import { useWorkspaceData } from "@/components/workspace/WorkspaceContext";

const ROLE_OPTIONS = [
  { label: "Owner", value: "owner" },
  { label: "Admin", value: "admin" },
  { label: "Member", value: "member" },
] as const;

const STEPS = [
  { label: "Type", description: "Choose workspace type" },
  { label: "Name", description: "Name your workspace" },
  { label: "Role", description: "Define your role" },
];

export default function WorkspaceOnboarding() {
  const { refresh } = useWorkspaceData();
  const [step, setStep] = useState(1);
  const [workspaceType, setWorkspaceType] = useState<"personal" | "company">("personal");
  const [workspaceName, setWorkspaceName] = useState("");
  const [role, setRole] = useState("owner");
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleNext = () => {
    if (step === 2 && !workspaceName.trim()) {
      setError("Workspace name is required");
      return;
    }
    if (step === 3 && !title.trim()) {
      setError("Role title is required");
      return;
    }
    setError(null);
    setStep((prev) => Math.min(prev + 1, 3));
  };

  const handleSubmit = async () => {
    if (!workspaceName.trim() || !title.trim()) {
      setError("Please provide the workspace name and role title");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const response = await fetch(getOnboardingCompleteEndpoint(), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceType,
          workspaceName: workspaceName.trim(),
          role,
          title: title.trim(),
          goal: goal.trim() || null,
        }),
      });
      if (!response.ok) {
        const body = await response.text();
        throw new Error(body || "Onboarding submission failed");
      }
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (typeof document === "undefined") return;
    const body = document.body;
    const previousOverflow = body.style.overflow;
    body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" || event.key === "Esc") {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, []);

  return (
    <div
      className="onboarding-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Workspace onboarding"
    >
      <div className="onboarding-overlay__backdrop" aria-hidden="true" />
      <div className="onboarding-dialog">
        {/* Stepper */}
        <div className="onboarding-stepper" role="list">
          {STEPS.map((s, i) => {
            const stepNum = i + 1;
            const isActive = step === stepNum;
            const isCompleted = step > stepNum;
            return (
              <div
                key={s.label}
                className={`onboarding-step ${isActive ? "is-active" : ""} ${isCompleted ? "is-completed" : ""}`}
                role="listitem"
                aria-current={isActive ? "step" : undefined}
              >
                <span className="onboarding-step__number">
                  {isCompleted ? "\u2713" : stepNum}
                </span>
                <div>
                  <p className="onboarding-step__label">{s.label}</p>
                  <p className="onboarding-step__desc">{s.description}</p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Content */}
        <div className="onboarding-content">
          <h2 className="onboarding-content__title">
            {STEPS[step - 1]?.description}
          </h2>

          {step === 1 && (
            <div className="onboarding-type-grid">
              <button
                type="button"
                className={`onboarding-type-card ${workspaceType === "personal" ? "is-selected" : ""}`}
                onClick={() => setWorkspaceType("personal")}
              >
                <p className="onboarding-type-card__title">Personal</p>
                <p className="onboarding-type-card__desc">
                  Private workspace for your personal tasks, email, and calendar.
                </p>
              </button>
              <button
                type="button"
                className={`onboarding-type-card ${workspaceType === "company" ? "is-selected" : ""}`}
                onClick={() => setWorkspaceType("company")}
              >
                <p className="onboarding-type-card__title">Company</p>
                <p className="onboarding-type-card__desc">
                  Shared workspace for your team with roles, permissions, and branding.
                </p>
              </button>
            </div>
          )}

          {step === 2 && (
            <div className="onboarding-field">
              <label htmlFor="workspaceName" className="onboarding-field__label">
                Workspace name
              </label>
              <input
                id="workspaceName"
                type="text"
                className="onboarding-field__input"
                value={workspaceName}
                onChange={(e) => setWorkspaceName(e.target.value)}
                placeholder={workspaceType === "personal" ? "My Workspace" : "Acme Corp"}
                autoFocus
              />
            </div>
          )}

          {step === 3 && (
            <div className="onboarding-fields">
              <div className="onboarding-field">
                <label htmlFor="workspaceRole" className="onboarding-field__label">
                  Role
                </label>
                <select
                  id="workspaceRole"
                  className="onboarding-field__input"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                >
                  {ROLE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="onboarding-field">
                <label htmlFor="workspaceTitle" className="onboarding-field__label">
                  Title
                </label>
                <input
                  id="workspaceTitle"
                  type="text"
                  className="onboarding-field__input"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="CEO, Designer, Developer..."
                  autoFocus
                />
              </div>
              <div className="onboarding-field">
                <label htmlFor="workspaceGoal" className="onboarding-field__label">
                  Goal <span style={{ opacity: 0.5 }}>(optional)</span>
                </label>
                <textarea
                  id="workspaceGoal"
                  className="onboarding-field__input"
                  value={goal}
                  onChange={(e) => setGoal(e.target.value)}
                  placeholder="What do you want to accomplish?"
                  rows={2}
                />
              </div>
            </div>
          )}

          {error && (
            <p className="onboarding-error" role="alert">{error}</p>
          )}
        </div>

        {/* Actions */}
        <div className="onboarding-actions">
          {step > 1 && (
            <button
              type="button"
              className="onboarding-btn"
              onClick={() => { setError(null); setStep(step - 1); }}
            >
              Back
            </button>
          )}
          <div style={{ flex: 1 }} />
          {step < 3 && (
            <button
              type="button"
              className="onboarding-btn onboarding-btn--primary"
              onClick={handleNext}
            >
              Continue
            </button>
          )}
          {step === 3 && (
            <button
              type="button"
              className="onboarding-btn onboarding-btn--primary"
              onClick={handleSubmit}
              disabled={loading}
            >
              {loading ? "Saving..." : "Complete Setup"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
