export const GOOGLE_GMAIL_READONLY_SCOPE =
  "https://www.googleapis.com/auth/gmail.readonly";
export const GOOGLE_CALENDAR_READONLY_SCOPE =
  "https://www.googleapis.com/auth/calendar.readonly";
export const GOOGLE_CALENDAR_EVENTS_SCOPE =
  "https://www.googleapis.com/auth/calendar.events";
export const GOOGLE_TASKS_SCOPE =
  "https://www.googleapis.com/auth/tasks";
export const GOOGLE_TASKS_READONLY_SCOPE =
  "https://www.googleapis.com/auth/tasks.readonly";
export const GOOGLE_DRIVE_FILE_SCOPE =
  "https://www.googleapis.com/auth/drive.file";
export const GOOGLE_DRIVE_READONLY_SCOPE =
  "https://www.googleapis.com/auth/drive.readonly";
export const GOOGLE_GMAIL_SEND_SCOPE =
  "https://www.googleapis.com/auth/gmail.send";
export const GOOGLE_PRESENTATIONS_SCOPE =
  "https://www.googleapis.com/auth/presentations";
export const GOOGLE_USERINFO_EMAIL_SCOPE =
  "https://www.googleapis.com/auth/userinfo.email";

export const GOOGLE_REQUIRED_DEMO_SCOPES = [
  GOOGLE_GMAIL_READONLY_SCOPE,
  GOOGLE_GMAIL_SEND_SCOPE,
  GOOGLE_CALENDAR_READONLY_SCOPE,
  GOOGLE_CALENDAR_EVENTS_SCOPE,
  GOOGLE_TASKS_SCOPE,
  GOOGLE_TASKS_READONLY_SCOPE,
  GOOGLE_DRIVE_FILE_SCOPE,
  GOOGLE_PRESENTATIONS_SCOPE,
  GOOGLE_USERINFO_EMAIL_SCOPE,
] as const;

export function parseScopeString(scope: string | null | undefined): string[] {
  if (!scope) return [];
  return Array.from(
    new Set(
      scope
        .split(/\s+/)
        .map((value) => value.trim())
        .filter(Boolean)
    )
  );
}

export function serializeScopes(scopes: readonly string[]): string {
  return Array.from(new Set(scopes.map((scope) => scope.trim()).filter(Boolean))).join(" ");
}

const SCOPE_ALIASES: Record<string, string[]> = {
  "gmail.readonly": [GOOGLE_GMAIL_READONLY_SCOPE],
  "gmail.send": [GOOGLE_GMAIL_SEND_SCOPE],
  "calendar.readonly": [GOOGLE_CALENDAR_READONLY_SCOPE],
  "calendar.events": [GOOGLE_CALENDAR_EVENTS_SCOPE],
  "drive.file": [GOOGLE_DRIVE_FILE_SCOPE],
  "drive.readonly": [GOOGLE_DRIVE_READONLY_SCOPE],
  presentations: [GOOGLE_PRESENTATIONS_SCOPE],
  "userinfo.email": [GOOGLE_USERINFO_EMAIL_SCOPE],
  tasks: [GOOGLE_TASKS_SCOPE],
  "tasks.readonly": [GOOGLE_TASKS_READONLY_SCOPE],
};

function aliasForScope(scope: string): string[] {
  const normalized = scope.trim();
  if (!normalized) return [];
  const alias = SCOPE_ALIASES[normalized];
  if (alias) return [normalized, ...alias];

  const fromUrl = Object.entries(SCOPE_ALIASES).find(([, values]) => values.includes(normalized));
  if (fromUrl) return [normalized, fromUrl[0]];
  return [normalized];
}

export function expandScopesForMatching(scopes: readonly string[]): string[] {
  const all = scopes.flatMap((scope) => aliasForScope(scope));
  return Array.from(new Set(all));
}

export function hasRequiredScopes(
  grantedScopes: readonly string[],
  requiredScopes: readonly string[],
): { ok: true } | { ok: false; missing: string[] } {
  if (requiredScopes.length === 0) return { ok: true };
  const granted = new Set(expandScopesForMatching(grantedScopes));
  const missing = requiredScopes.filter((required) => {
    const acceptable = aliasForScope(required);
    return !acceptable.some((candidate) => granted.has(candidate));
  });
  if (missing.length > 0) return { ok: false, missing };
  return { ok: true };
}
