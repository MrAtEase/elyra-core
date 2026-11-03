"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import SettingsPane from "@/components/merlin/settings/SettingsPane";
import { getWorkspaceAccess } from "@/components/workspace/admin/access";
import { useWorkspaceData, WhoamiWorkspace } from "@/components/workspace/WorkspaceContext";
import { buildAssistantEndpoint } from "@/utils/auth-guard";

type ConfirmTarget =
  | { type: "workspace"; workspace: WhoamiWorkspace }
  | { type: "account" };

type ToastState = {
  message: string;
  tone: "success" | "error";
};

export default function WorkspaceAdminDangerPage() {
  const router = useRouter();
  const { data, loading, authRequired, refresh, setActiveWorkspace } = useWorkspaceData();
  const access = getWorkspaceAccess((data as Record<string, any> | null) ?? null);
  const hasAccess = access.isOwner;
  const isAuthRequired = Boolean(authRequired);
  const [confirmTarget, setConfirmTarget] = useState<ConfirmTarget | null>(null);
  const [confirmInput, setConfirmInput] = useState("");
  const [pendingDelete, setPendingDelete] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);

  const workspaces = useMemo(() => data?.workspaces ?? [], [data?.workspaces]);
  const activeWorkspaceId = data?.activeWorkspace?.id ?? null;
  const showAccountDelete = process.env.NODE_ENV !== "production";

  const expectedPhrase = useMemo(() => {
    if (!confirmTarget) return "";
    if (confirmTarget.type === "account") return "DELETE MY ACCOUNT";
    return `DELETE ${confirmTarget.workspace.slug}`;
  }, [confirmTarget]);

  const confirmationReady = Boolean(confirmTarget && confirmInput.trim() === expectedPhrase);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!loading && !isAuthRequired && !hasAccess) {
      router.replace("/workspace/admin/overview");
    }
  }, [isAuthRequired, hasAccess, loading, router]);

  if (loading || isAuthRequired) {
    return (
      <SettingsPane
        eyebrow="Workspace Admin"
        title="Danger Zone"
        description="Checking access..."
        scope="WORKSPACE"
      >
        <div className="settings-placeholder">
          <p>Checking access...</p>
        </div>
      </SettingsPane>
    );
  }

  if (!hasAccess) {
    return null;
  }

  const openWorkspaceConfirm = (workspace: WhoamiWorkspace) => {
    setConfirmTarget({ type: "workspace", workspace });
    setConfirmInput("");
  };

  const openAccountConfirm = () => {
    setConfirmTarget({ type: "account" });
    setConfirmInput("");
  };

  const closeConfirm = () => {
    if (pendingDelete) return;
    setConfirmTarget(null);
    setConfirmInput("");
  };

  const performDeleteRequest = async (url: string) => {
    const response = await fetch(buildAssistantEndpoint(url), {
      method: "DELETE",
      credentials: "include",
    });
    const text = await response.text();
    if (!response.ok) {
      console.error("[admin] delete failed", { url, status: response.status, body: text });
      const body = text.trim() || response.statusText || "Unknown error";
      throw new Error(`Delete failed: ${response.status} ${body}`);
    }
    return text;
  };

  const handleConfirmDelete = async () => {
    if (!confirmTarget || !confirmationReady || pendingDelete) return;
    setPendingDelete(true);
    try {
      if (confirmTarget.type === "workspace") {
        const { workspace } = confirmTarget;
        const wasActive = activeWorkspaceId === workspace.id;
        const fallbackWorkspaceId = workspaces.find((entry) => entry.id !== workspace.id)?.id ?? null;
        await performDeleteRequest(`/assistant/admin/workspaces/${workspace.id}/`);
        setToast({ message: "Deleted", tone: "success" });
        setConfirmTarget(null);
        setConfirmInput("");
        if (wasActive && fallbackWorkspaceId) {
          await setActiveWorkspace(fallbackWorkspaceId);
        } else {
          await refresh();
        }
      } else {
        await performDeleteRequest("/assistant/admin/account/");
        setToast({ message: "Deleted", tone: "success" });
        setConfirmTarget(null);
        setConfirmInput("");
        await refresh();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Delete failed";
      setToast({ message, tone: "error" });
    } finally {
      setPendingDelete(false);
    }
  };

  return (
    <SettingsPane
      eyebrow="Workspace Admin"
      title="Danger Zone"
      description="Destructive actions for workspace cleanup."
      scope="WORKSPACE"
    >
      <div className="workspace-danger-zone">
        <div className="workspace-danger-zone__header">
          <p className="workspace-danger-zone__eyebrow">Danger Zone</p>
          <h2>Delete workspace</h2>
          <p>Destructive actions for deleting workspaces and dev-only account cleanup.</p>
        </div>
        <div className="workspace-danger-zone__list">
          {workspaces.length === 0 && (
            <div className="workspace-danger-zone__empty">No workspaces available.</div>
          )}
          {workspaces.map((workspace) => {
            const isActive = activeWorkspaceId === workspace.id;
            return (
              <div key={workspace.id} className="workspace-danger-zone__row">
                <div className="workspace-danger-zone__row-main">
                  <div className="workspace-danger-zone__row-title">
                    <span>{workspace.name}</span>
                    {isActive && <span className="workspace-danger-zone__badge">Active</span>}
                  </div>
                  <div className="workspace-danger-zone__row-meta">
                    <span>ID: {workspace.id}</span>
                    <span>Slug: {workspace.slug}</span>
                    <span>Type: {workspace.type}</span>
                  </div>
                </div>
                <button
                  type="button"
                  className="workspace-danger-zone__button workspace-danger-zone__button--danger"
                  onClick={() => openWorkspaceConfirm(workspace)}
                >
                  Delete
                </button>
              </div>
            );
          })}
        </div>
        {showAccountDelete && (
          <div className="workspace-danger-zone__account">
            <div>
              <h3>Delete my account (dev only)</h3>
              <p>This removes your user, identities, memberships, settings, and onboarding records.</p>
            </div>
            <button
              type="button"
              className="workspace-danger-zone__button workspace-danger-zone__button--danger"
              onClick={openAccountConfirm}
            >
              Delete my account
            </button>
          </div>
        )}
      </div>
      {toast && (
        <div className={`workspace-danger-zone__toast ${toast.tone === "error" ? "is-error" : "is-success"}`}>
          {toast.message}
        </div>
      )}
      {confirmTarget && (
        <div className="workspace-danger-zone__modal">
          <div className="workspace-danger-zone__modal-card">
            <div className="workspace-danger-zone__modal-header">
              <h3>
                {confirmTarget.type === "workspace"
                  ? `Delete workspace "${confirmTarget.workspace.name}"`
                  : "Delete your account"}
              </h3>
              <p>
                Type <strong>{expectedPhrase}</strong> to confirm.
              </p>
            </div>
            <label className="workspace-danger-zone__modal-label" htmlFor="danger-confirm">
              Confirmation
            </label>
            <input
              id="danger-confirm"
              className="workspace-danger-zone__modal-input"
              value={confirmInput}
              onChange={(event) => setConfirmInput(event.target.value)}
              placeholder={expectedPhrase}
              autoFocus
            />
            <div className="workspace-danger-zone__modal-actions">
              <button type="button" className="workspace-danger-zone__button" onClick={closeConfirm}>
                Cancel
              </button>
              <button
                type="button"
                className="workspace-danger-zone__button workspace-danger-zone__button--danger"
                disabled={!confirmationReady || pendingDelete}
                onClick={handleConfirmDelete}
              >
                {pendingDelete ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </SettingsPane>
  );
}
