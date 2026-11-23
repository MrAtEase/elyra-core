export type WorkspaceMailProvider = "imap" | "google";

type WorkspaceMailPolicy = {
  allowed: WorkspaceMailProvider[];
  preferred: WorkspaceMailProvider;
};

const DEFAULT_POLICY: WorkspaceMailPolicy = {
  allowed: ["imap", "google"],
  preferred: "imap",
};

const WORKSPACE_MAIL_POLICY: Record<string, WorkspaceMailPolicy> = {
  "ws-personal": {
    allowed: ["imap"],
    preferred: "imap",
  },
  "ws-fish-delish": {
    allowed: ["google"],
    preferred: "google",
  },
  "ws-elyra-core": {
    allowed: ["google"],
    preferred: "google",
  },
};

export function getWorkspaceMailPolicy(workspaceId: string | null | undefined): WorkspaceMailPolicy {
  if (!workspaceId) return DEFAULT_POLICY;
  return WORKSPACE_MAIL_POLICY[workspaceId.trim().toLowerCase()] ?? DEFAULT_POLICY;
}
