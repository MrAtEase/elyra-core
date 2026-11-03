export type WorkspaceKind = "individual" | "organization" | "platform";

export type BrainPreferences = {
  language?: string;
  tone?: string;
};

type BrainFoundationFields = {
  purpose?: string;
  goals?: string[];
  operatingRules?: string[];
  preferences?: BrainPreferences;
};

export type IndividualIdentityProfile = BrainFoundationFields & {
  kind: "individual";
  displayName?: string;
};

export type OrganizationIdentityProfile = BrainFoundationFields & {
  kind: "organization";
  organizationName?: string;
  roleFocus?: string;
  operatingRhythm?: string;
};

export type PlatformIdentityProfile = BrainFoundationFields & {
  kind: "platform";
  platformName?: string;
  governanceMode?: string;
  priority?: string;
};

export type IdentityProfile =
  | IndividualIdentityProfile
  | OrganizationIdentityProfile
  | PlatformIdentityProfile;

export type ContextBundle = {
  workspace: {
    id: string;
    slug: string | null;
    name: string;
    kind: WorkspaceKind;
  };
  identitySlice: IdentityProfile | null;
  memorySlice:
    | {
        confirmations: number;
        denials: number;
        verbosityPreference: "low" | "normal" | "high";
      }
    | Record<string, never>;
  artifacts: Array<{
    id: string;
    kind: string;
    title: string;
    latestVersion: number;
    updatedAt: string;
  }>;
  permissions: {
    role: string | null;
  };
  policySnapshot: Record<string, unknown>;
};

export type Workspace = {
  id: string;
  label: string;
  kind: WorkspaceKind;
  accent: string;
};

export type OrbVisualState =
  | "idle"
  | "thinking"
  | "listening"
  | "planning"
  | "executing"
  | "attention"
  | "waiting_for_auth"
  | "waiting_for_approval"
  | "success"
  | "degraded";

export type IntentAttachment = {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  dataBase64: string;
};

export type IntentKind = "read_only" | "mutation";
export type IntentRunStatus = "idle" | "thinking" | "running" | "completed" | "failed";
export type IntentStepStatus = "pending" | "running" | "completed" | "failed" | "approval_required" | "skipped";

export type IntentStep = {
  id: string;
  label: string;
  detail: string;
  status: IntentStepStatus;
  requiresConfirmation?: boolean;
  updatedAt: number;
};

export type ActiveIntentState = {
  runId: string | null;
  foundationRunId: string | null;
  intentId: string | null;
  text: string;
  kind: IntentKind;
  status: IntentRunStatus;
  model: "Gemini" | "Claude";
  startedAt: number | null;
  updatedAt: number | null;
  steps: IntentStep[];
  logs: string[];
  attachments?: IntentAttachment[];
};

export type AppId =
  | "mail"
  | "calendar"
  | "tasks"
  | "files"
  | "graph"
  | "builder"
  | "slides"
  | "studio"
  | "code"
  | "weather"
  | "settings_ai"
  | "settings_os"
  | "settings_admin"
  | "approvals"
  | "audit"
  | "runs"
  | "image_studio";

export type AppCategory = "work" | "build" | "settings";

export type WindowRecord = {
  id: string;
  appId: AppId;
  title: string;
  zIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  minimized: boolean;
  maximized: boolean;
  restoreRect: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
};

export type IntentMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  createdAt: number;
  actionCards?: Array<{ id: string; title: string; detail: string; openApp?: AppId; artifactId?: string }>;
  attachments?: IntentAttachment[];
};

export type NotificationItem = {
  id: string;
  workspaceId: string;
  level: "info" | "warning";
  text: string;
  createdAt: number;
};

export type SearchItem = {
  id: string;
  workspaceId: string;
  appId: AppId;
  type: "mail" | "event" | "task" | "file" | "doc";
  title: string;
  body?: string;
  timestamp: number;
};

export type AppManifest = {
  id: AppId;
  name: string;
  icon: string;
  category: AppCategory;
  availableIn: WorkspaceKind[];
  openAs: "window";
};

export type WorkspaceArtifact = {
  id: string;
  workspaceId: string;
  intentId: string | null;
  runId: string | null;
  toolCallId?: string | null;
  type: string;
  uiCardHint?: string | null;
  linkUrl?: string | null;
  title: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  latestVersion: number;
  payloadRef: string | null;
  payloadJson: Record<string, unknown>;
  versions?: Array<{
    id: string;
    version: number;
    contentJson: Record<string, unknown>;
    createdBy: string | null;
    createdAt: string;
  }>;
};

export type UiQuickAction = {
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
  open_app_id?: AppId | null;
};

export type KernelState = {
  activeWorkspaceId: string;
  overlayOpen: boolean;
  orbState: OrbVisualState;
  thinking: boolean;
  windowsByWorkspace: Record<string, WindowRecord[]>;
  messagesByWorkspace: Record<string, IntentMessage[]>;
  notificationsByWorkspace: Record<string, NotificationItem[]>;
};

export type IntentRouteResult = {
  intentKind: IntentKind;
  assistantText: string;
  openApp?: AppId;
  actionCards?: Array<{ id: string; title: string; detail: string }>;
  timeline: Array<{ id: string; label: string; detail: string; requiresConfirmation?: boolean }>;
};
