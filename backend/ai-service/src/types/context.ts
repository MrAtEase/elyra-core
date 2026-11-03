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

export type PersonaMemorySlice = {
  confirmations: number;
  denials: number;
  verbosityPreference: "low" | "normal" | "high";
};

  updatedAt: string;
};

export type IntentAttachment = {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes?: number;
  dataBase64: string;
};

import type { GraphSummary } from "../db/repos/graph.js";

export type ContextBundle = {
  workspace: {
    id: string;
    slug: string | null;
    name: string;
    kind: WorkspaceKind;
  };
  identitySlice: IdentityProfile | null;
  memorySlice: PersonaMemorySlice | Record<string, never>;
  artifacts: ContextArtifact[];
  permissions: {
    role: string | null;
  };
  policySnapshot: Record<string, unknown>;
  graphSummary: GraphSummary;
  weatherHint?: string;
  attachments?: IntentAttachment[];
};

export type AssembleContextInput = {
  workspaceId: string;
  userId: string;
  intentText: string;
  openApps: string[];
  activeView: string | null;
  intentDomain?: string;
  attachments?: IntentAttachment[];
};
