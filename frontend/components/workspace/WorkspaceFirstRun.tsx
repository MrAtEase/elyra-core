"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import MerlinGlassCard from "@/components/merlin/MerlinGlassCard";
import { getWorkspacesCreateEndpoint } from "@/utils/auth-guard";

const PERSONAL_WORKSPACE = {
  name: "Privat",
  slug: "privat",
  type: "personal" as const,
};

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

type WorkspaceFirstRunProps = {
  refreshWorkspaceData: () => Promise<unknown>;
};

export default function WorkspaceFirstRun({ refreshWorkspaceData }: WorkspaceFirstRunProps) {
  const router = useRouter();
  const [showCompanyForm, setShowCompanyForm] = useState(false);
  const [companyName, setCompanyName] = useState("");
  const [companySlug, setCompanySlug] = useState("");
  const [loadingAction, setLoadingAction] = useState<"personal" | "company" | null>(null);
  const [personalError, setPersonalError] = useState<string | null>(null);
  const [companyError, setCompanyError] = useState<string | null>(null);

  const createWorkspace = async (
    payload: { name: string; slug?: string; type: "personal" | "company" },
    action: "personal" | "company"
  ) => {
    setLoadingAction(action);
    if (action === "personal") {
      setPersonalError(null);
    } else {
      setCompanyError(null);
    }
    try {
      const response = await fetch(getWorkspacesCreateEndpoint(), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await response.json().catch(() => null)) as Record<string, any> | null;
      if (!response.ok || !body?.ok) {
        const message = body?.error || body?.message || "Unable to create workspace.";
        throw new Error(message);
      }
      await refreshWorkspaceData();
      router.push("/os");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to create workspace.";
      if (action === "personal") {
        setPersonalError(message);
      } else {
        setCompanyError(message);
      }
    } finally {
      setLoadingAction(null);
    }
  };

  const handleCreatePersonal = () => {
    void createWorkspace(PERSONAL_WORKSPACE, "personal");
  };

  const handleCreateCompany = () => {
    const trimmedName = companyName.trim();
    if (!trimmedName) {
      setCompanyError("Company name is required.");
      return;
    }
    const trimmedSlug = companySlug.trim().toLowerCase();
    if (trimmedSlug) {
      if (trimmedSlug.length < 3 || trimmedSlug.length > 40 || !SLUG_PATTERN.test(trimmedSlug)) {
        setCompanyError("Slug must be lowercase a-z0-9-, 3-40 characters.");
        return;
      }
    }
    void createWorkspace(
      {
        name: trimmedName,
        ...(trimmedSlug && { slug: trimmedSlug }),
        type: "company",
      },
      "company"
    );
  };

  return (
    <section className="workspace-main-panel">
      <div className="workspace-main-panel__header">
        <p className="workspace-main-panel__eyebrow">Workspace</p>
        <p className="workspace-main-panel__desc">
          Start with a personal space or set up a shared company workspace for your team.
        </p>
      </div>
      <div className="workspace-first-run">
        <MerlinGlassCard title="Personal Workspace" kicker="Quick Start" className="workspace-first-run__card">
          <p className="workspace-first-run__copy">
            Private workspace with your personal identity. We will create your first space now.
          </p>
          <div className="workspace-first-run__actions">
            <button
              type="button"
              className="workspace-onboarding__button workspace-onboarding__button--primary"
              onClick={handleCreatePersonal}
              disabled={loadingAction !== null}
            >
              {loadingAction === "personal" ? "Creating..." : "Create Personal (iCloud)"}
            </button>
          </div>
          <p className="workspace-first-run__note">Workspace name: Privat | slug: /privat</p>
          {personalError && <p className="workspace-first-run__error">{personalError}</p>}
        </MerlinGlassCard>

        <MerlinGlassCard title="Company Workspace" kicker="Teams" className="workspace-first-run__card">
          <p className="workspace-first-run__copy">
            Set up a shared workspace for your restaurant or business and invite collaborators later.
          </p>
          {!showCompanyForm ? (
            <div className="workspace-first-run__actions">
              <button
                type="button"
                className="workspace-onboarding__button workspace-onboarding__button--primary"
                onClick={() => setShowCompanyForm(true)}
                disabled={loadingAction !== null}
              >
                Create Company Workspace
              </button>
            </div>
          ) : (
            <div className="workspace-first-run__form">
              <div className="workspace-onboarding__input">
                <label htmlFor="company-name">Company name</label>
                <input
                  id="company-name"
                  type="text"
                  value={companyName}
                  onChange={(event) => setCompanyName(event.target.value)}
                  placeholder="Fish Delish Portugal"
                />
              </div>
              <div className="workspace-onboarding__input">
                <label htmlFor="company-slug">Workspace slug (optional)</label>
                <input
                  id="company-slug"
                  type="text"
                  value={companySlug}
                  onChange={(event) => setCompanySlug(event.target.value.toLowerCase())}
                  placeholder="fish-delish-pt"
                />
              </div>
              <div className="workspace-first-run__actions">
                <button
                  type="button"
                  className="workspace-onboarding__button"
                  onClick={() => setShowCompanyForm(false)}
                  disabled={loadingAction !== null}
                >
                  Back
                </button>
                <button
                  type="button"
                  className="workspace-onboarding__button workspace-onboarding__button--primary"
                  onClick={handleCreateCompany}
                  disabled={loadingAction !== null}
                >
                  {loadingAction === "company" ? "Creating..." : "Create Company Workspace"}
                </button>
              </div>
              {companyError && <p className="workspace-first-run__error">{companyError}</p>}
            </div>
          )}
        </MerlinGlassCard>
      </div>
    </section>
  );
}
