export type SettingsNavItem = {
  id: string;
  label: string;
  description: string;
  path: string;
};

export type SettingsSection = {
  id: string;
  label: string;
  description: string;
  scope: SettingsScope;
  items: SettingsNavItem[];
};

export type SettingsScope = "USER" | "WORKSPACE" | "SYSTEM";

export const SETTINGS_SCOPE_DETAILS: Record<SettingsScope, { label: string; description: string }> = {
  USER: { label: "USER", description: "Applies to all workspaces" },
  WORKSPACE: { label: "WORKSPACE", description: "Applies only to this workspace" },
  SYSTEM: { label: "SYSTEM", description: "Admin / developer only" },
};

export const SETTINGS_SECTIONS: SettingsSection[] = [
  {
    id: "personal",
    label: "Personal Settings",
    description: "Account, theme, privacy, and personal integrations.",
    scope: "USER",
    items: [
      {
        id: "account",
        label: "Account",
        description: "Email, membership and profile details.",
        path: "/workspace/settings/user/account",
      },
      {
        id: "appearance",
        label: "Theme",
        description: "Appearance presets and contrast controls.",
        path: "/workspace/settings/user/appearance",
      },
      {
        id: "privacy",
        label: "Privacy",
        description: "Security, privacy and data controls.",
        path: "/workspace/settings/user/privacy",
      },
      {
        id: "integrations",
        label: "Personal integrations",
        description: "Connect your personal calendar, mail, and docs.",
        path: "/workspace/settings/user/integrations",
      },
      {
        id: "workspace",
        label: "Workspace defaults",
        description: "Default workspace and personal workspace routing.",
        path: "/workspace/settings/user/workspace",
      },
    ],
  },
  {
    id: "workspace",
    label: "Workspace Admin",
    description: "Identity, members, roles, integrations, and safety controls.",
    scope: "WORKSPACE",
    items: [
      {
        id: "identity",
        label: "Identity",
        description: "Workspace name, slug, and branding.",
        path: "/workspace/settings/workspace/identity",
      },
      {
        id: "profile",
        label: "Workspace avatar",
        description: "Set a workspace-specific avatar for the header.",
        path: "/workspace/settings/profile",
      },
      {
        id: "members",
        label: "Members",
        description: "People, invites, and team management.",
        path: "/workspace/settings/workspace/members",
      },
      {
        id: "access",
        label: "Roles & Capabilities",
        description: "Explain and request access.",
        path: "/workspace/admin/access",
      },
      {
        id: "integrations",
        label: "Integrations",
        description: "Connected services and modules.",
        path: "/workspace/settings/workspace/modules",
      },
      {
        id: "behavior",
        label: "Behavior",
        description: "Automation and policy controls.",
        path: "/workspace/settings/workspace/behavior",
      },
      {
        id: "danger",
        label: "Danger Zone",
        description: "Permanent, destructive actions.",
        path: "/workspace/admin/danger",
      },
    ],
  },
  {
    id: "system",
    label: "System",
    description: "Developer and experimental controls.",
    scope: "SYSTEM",
    items: [
      {
        id: "developer",
        label: "Developer",
        description: "SDKs, keys, and system settings.",
        path: "/workspace/settings/system/developer",
      },
      {
        id: "experimental",
        label: "Experimental",
        description: "Enable or disable beta features.",
        path: "/workspace/settings/system/experimental",
      },
    ],
  },
];
