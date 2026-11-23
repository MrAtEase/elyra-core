export type ProfileSectionState = "ready" | "empty" | "error";

export type ProfileSection<TData> = {
  state: ProfileSectionState;
  data: TData | null;
  error_code?: string;
  error_message_safe?: string;
};

export type ProfileIdentityData = {
  email: string | null;
  workspace_role: string;
  avatar_initials: string;
};

export type ProfilePreferencesData = {
  language: string | null;
  timezone: string | null;
  keyboard_shortcuts: Array<{
    id: string;
    label: string;
    combo: string;
    source: "surface" | "system";
  }>;
};

export type ProfileSecurityData = {
  sessions: Array<{
    id: string;
    device: string;
    location: string;
    last_seen_at: string;
    is_current: boolean;
  }>;
};

export type ProfilePrivacyData = {
  retention_summary: string;
  export_available: boolean;
  delete_account_available: boolean;
};

export type ProfileSections = {
  identity: ProfileSection<ProfileIdentityData>;
  preferences: ProfileSection<ProfilePreferencesData>;
  security: ProfileSection<ProfileSecurityData>;
  privacy: ProfileSection<ProfilePrivacyData>;
};

export type ProfilePayload = {
  workspace_id: string;
  generated_at: string;
  sections: ProfileSections;
};
