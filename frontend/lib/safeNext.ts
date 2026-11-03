export function safeNext(raw: string | null | undefined, fallback = "/os"): string {
  if (!raw) return fallback;

  let v = raw;
  try {
    // decode at most once
    v = decodeURIComponent(raw);
  } catch {
    // ignore decode errors and keep raw
    v = raw;
  }

  // Trim whitespace
  v = v.trim();

  // Block absolute URLs
  const lower = v.toLowerCase();
  if (lower.startsWith('http://') || lower.startsWith('https://')) return fallback;

  // Must start with /
  if (!v.startsWith('/')) return fallback;

  // Prevent loops back to oauth start (only block the start handler)
  if (v.startsWith('/assistant/oauth/google/start')) return fallback;

  // Length limit
  if (v.length > 200) return fallback;

  // Optional allowlist prefixes (lenient): allow only these top-level prefixes
  const allowedPrefixes = ['/os', '/w', '/assistant', '/merlin', '/admin'];
  if (!allowedPrefixes.some((p) => v === p || v.startsWith(p + '/') || v.startsWith(p + '?') || v.startsWith(p + '#'))) {
    return fallback;
  }

  return v;
}

export default safeNext;
