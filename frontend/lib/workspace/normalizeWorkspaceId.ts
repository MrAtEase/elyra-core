const WORKSPACE_ALIAS_TO_ID: Record<string, string> = {
  person: "ws-personal",
  "ws-person": "ws-personal",
  personal: "ws-personal",
  "ws-personal": "ws-personal",
  "fish-delish": "ws-fish-delish",
  "ws-fish-delish": "ws-fish-delish",
  "elyra-core": "ws-elyra-core",
  "ws-elyra-core": "ws-elyra-core",
};

const WORKSPACE_WITH_INDEX_SUFFIX = /^(ws-[a-z0-9-]+):\d+$/i;

export function normalizeWorkspaceId(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  const withSuffix = trimmed.match(WORKSPACE_WITH_INDEX_SUFFIX);
  if (withSuffix?.[1]) {
    return withSuffix[1];
  }

  const lowered = trimmed.toLowerCase();
  return WORKSPACE_ALIAS_TO_ID[lowered] ?? trimmed;
}
