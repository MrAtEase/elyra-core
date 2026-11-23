import type { ThemeKey } from "@/lib/theme";
import type { MailIdentity } from "@/components/workspace/mail/mail.types";
import type { WorkspaceType } from "@/lib/workspace/workspaceType";

export type WhoamiWorkspaceBrand = {
  productName: string;
  assistantName: string;
  workspaceLabel: string;
  logoUrl?: string | null;
  accentColor?: string | null;
  themeMode?: string | null;
};

export type WhoamiWorkspace = {
  id: string;
  slug: string;
  type: WorkspaceType | string;
  name: string;
  brand: WhoamiWorkspaceBrand;
  defaultThemeKey?: ThemeKey | null;
  brandNameOverride?: string | null;
};

export type WhoamiCapabilityReason = {
  grantedBy: "role" | "connection";
  connection?: {
    domain?: string | null;
    provider?: string | null;
    access?: string | null;
    connectionId?: string | null;
  };
  missing?: boolean;
};

export type WhoamiWorkspaceConnection = {
  id: string;
  workspaceId: string;
  domain: string;
  provider: string;
  access: string;
  scopes: string[];
  status: string;
  updatedAt?: number | null;
  isActive?: boolean;
  meta?: {
    providerUserId?: string | null;
    email?: string | null;
  } | null;
};

type WhoamiTheme = {
  key: ThemeKey;
  name: string;
  description: string;
  group?: "light" | "dark";
};

type WhoamiMembership = {
  role: string;
  title: string | null;
  workspaceId: string;
  workspaceAvatarUrl?: string | null;
};

type WhoamiOnboarding = {
  state: string;
  workspaceId: string | null;
  payload?: Record<string, any> | null;
  updatedAt: number;
};

type WhoamiUserSettings = {
  locale: string | null;
  language?: string | null;
  orbVariant: string | null;
  theme: ThemeKey | null;
  defaultWorkspaceId: string | null;
  alwaysPersonalOnLogin: boolean;
};

export type WhoamiResponse = {
  ok: boolean;
  user: {
    id: string;
    email: string | null;
  };
  userId: string;
  userKey: string;
  workspaces: WhoamiWorkspace[];
  activeWorkspace: WhoamiWorkspace | null;
  membership: WhoamiMembership | null;
  capabilities: string[];
  capabilityReasons?: Record<string, WhoamiCapabilityReason>;
  onboarding: WhoamiOnboarding;
  userSettings: WhoamiUserSettings;
  resolvedTheme?: ThemeKey;
  availableThemes?: WhoamiTheme[];
  workspaceConnections?: WhoamiWorkspaceConnection[];
  mailIdentities?: MailIdentity[];
  defaultMailIdentity?: string | null;
  [key: string]: any;
};
