import { NextRequest, NextResponse } from "next/server";
import { getWhoamiEndpoint } from "@/utils/auth-guard";
import type { WhoamiResponse } from "@/types/whoami";
import { buildBootstrapContractFromDb } from "@/lib/orb-os/contracts/store";
import { resolveUiModel } from "@/lib/orb-os/contracts/rendering";
import type {
  ProfileIdentityData,
  ProfilePayload,
  ProfilePreferencesData,
  ProfilePrivacyData,
  ProfileSection,
  ProfileSecurityData,
} from "@/lib/orb-os/profile/types";
import { resolveWorkerSessionHeaders } from "@/lib/auth/workerSessionHeaders";

async function fetchWhoami(request: NextRequest) {
  const headers = resolveWorkerSessionHeaders(request);
  const response = await fetch(getWhoamiEndpoint(), { method: "GET", headers, cache: "no-store" });
  const payload = await response.json().catch(() => null);
  return { response, payload } as { response: Response; payload: WhoamiResponse | null };
}

function sectionReady<T>(data: T): ProfileSection<T> {
  return { state: "ready", data };
}

function sectionEmpty<T>(): ProfileSection<T> {
  return { state: "empty", data: null };
}

function sectionError<T>(code: string, message: string): ProfileSection<T> {
  return { state: "error", data: null, error_code: code, error_message_safe: message };
}

function initials(email?: string | null): string {
  if (!email) return "EC";
  return email.slice(0, 2).toUpperCase();
}

export async function GET(request: NextRequest) {
  const { response, payload } = await fetchWhoami(request);
  if (!response.ok || !payload) {
    return NextResponse.json({ ok: false, error: "AUTH_REQUIRED" }, { status: response.status });
  }

  const workspaceId = payload.activeWorkspace?.id || payload.session?.activeWorkspaceId || payload.workspaceId;
  const role = (payload.membership?.role || "member").toLowerCase();
  if (!workspaceId) {
    return NextResponse.json({ ok: false, error: "WORKSPACE_REQUIRED" }, { status: 400 });
  }

  const userId = payload.user?.id || payload.userId || payload.userKey || null;
  const contract = await buildBootstrapContractFromDb(workspaceId, { userId, seedIfMissing: true });
  const ui = resolveUiModel(contract, { role });

  const identity: ProfileSection<ProfileIdentityData> = sectionReady({
    email: payload.user?.email ?? null,
    workspace_role: role,
    avatar_initials: initials(payload.user?.email ?? null),
  });

  const shortcutSeed = ui.visible_surfaces.slice(0, 4).map((surface, index) => ({
    id: `surface-${surface}`,
    label: `Open ${surface}`,
    combo: `⌘${index + 1}`,
    source: "surface" as const,
  }));

  const preferences: ProfileSection<ProfilePreferencesData> = sectionReady({
    language: payload.userSettings?.locale ?? null,
    timezone: "UTC",
    keyboard_shortcuts: [
      ...shortcutSeed,
      { id: "assistant", label: "Focus Assistant", combo: "⌘/", source: "system" },
      { id: "launcher", label: "Toggle App Launcher", combo: "⌘K", source: "system" },
    ],
  });

  let security: ProfileSection<ProfileSecurityData> = sectionEmpty<ProfileSecurityData>();
  try {
    const userAgent = request.headers.get("user-agent") || "";
    const device = userAgent.split(" ").slice(0, 4).join(" ") || "Current device";
    security = sectionReady({
      sessions: [
        {
          id: "current",
          device,
          location: "Current workspace",
          last_seen_at: new Date().toISOString(),
          is_current: true,
        },
      ],
    });
  } catch {
    security = sectionError("SECURITY_UNAVAILABLE", "Security sessions temporarily unavailable");
  }

  const privacy: ProfileSection<ProfilePrivacyData> = sectionReady({
    retention_summary:
      "Workspace data is retained according to workspace policy. Export and delete requests are audit-logged.",
    export_available: true,
    delete_account_available: true,
  });

  const profile: ProfilePayload = {
    workspace_id: workspaceId,
    generated_at: new Date().toISOString(),
    sections: { identity, preferences, security, privacy },
  };

  return NextResponse.json({ ok: true, profile });
}
