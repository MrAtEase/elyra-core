"use client";

import { SETTINGS_SCOPE_DETAILS, type SettingsScope } from "./settingsConfig";

type SettingsScopeBadgeProps = {
  scope: SettingsScope;
  variant?: "default" | "nav";
};

export default function SettingsScopeBadge({ scope, variant = "default" }: SettingsScopeBadgeProps) {
  const scopeMeta = SETTINGS_SCOPE_DETAILS[scope];
  if (!scopeMeta) {
    return null;
  }

  const classes = [
    "settings-scope-badge",
    `settings-scope-badge--${scope.toLowerCase()}`,
    variant === "default" ? "" : `settings-scope-badge--${variant}`,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span className={classes}>
      <strong>{scopeMeta.label}</strong>
      <span>{scopeMeta.description}</span>
    </span>
  );
}
