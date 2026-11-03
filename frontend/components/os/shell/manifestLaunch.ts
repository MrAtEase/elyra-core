"use client";

import type { AppId } from "@/components/os/kernel/types";
import type { AppManifest } from "@/lib/orb-os/contracts/types";

const MANIFEST_APP_TO_APP_ID: Record<string, AppId> = {
  mail: "mail",
  calendar: "calendar",
  tasks: "tasks",
  files: "files",
  graph: "graph",
  builder: "builder",
  slides: "slides",
  settings_ai: "settings_ai",
  settings_os: "settings_os",
  settings_admin: "settings_admin",
  google_workspace: "mail",
};

const TOOL_PREFIX_TO_APP_ID: Record<string, AppId> = {
  google_mail: "mail",
  google_calendar: "calendar",
  google_drive: "files",
  google_slides: "slides",
  tasks: "tasks",
  files: "files",
  graph: "graph",
  slides: "slides",
  mail: "mail",
  calendar: "calendar",
};

export function resolveManifestLaunchAppId(manifest: AppManifest): AppId | null {
  const direct = MANIFEST_APP_TO_APP_ID[manifest.app_id];
  if (direct) return direct;

  for (const action of manifest.quick_actions) {
    const prefix = action.tool_ref.split(".")[0] ?? "";
    const mapped = TOOL_PREFIX_TO_APP_ID[prefix];
    if (mapped) return mapped;
  }

  return null;
}
