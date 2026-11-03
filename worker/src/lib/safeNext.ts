export function safeNext(raw: string | null | undefined, fallback = '/os'): string {
  if (!raw) return fallback;

  let v = raw;
  try {
    v = decodeURIComponent(raw);
  } catch {
    v = raw;
  }

  v = v.trim();
  if (!v) return fallback;

  const lower = v.toLowerCase();

  // hard-block absolute URLs
  if (lower.startsWith('http://') || lower.startsWith('https://')) return fallback;

  // must be path-only
  if (!v.startsWith('/')) return fallback;

  // block oauth start loop and related endpoints
  if (v.startsWith('/assistant/oauth/google/start')) return fallback;
  if (v.startsWith('/assistant/oauth/google/callback')) return fallback;
  if (v.startsWith('/assistant/oauth')) return fallback;
  if (v.startsWith('/signin')) return fallback;

  // block encoded or mixed encodings that might still include the oauth start
  if (lower.includes('assistant/oauth/google/start')) return fallback;
  if (lower.includes('%2fassistant%2foauth%2fgoogle%2fstart')) return fallback;

  // length limit
  if (v.length > 200) return fallback;

  // allowlist prefixes
  const allowed = ['/os', '/w', '/workspace', '/assistant', '/merlin', '/admin'];
  const ok = allowed.some(
    (p) => v === p || v.startsWith(p + '/') || v.startsWith(p + '?') || v.startsWith(p + '#')
  );
  return ok ? v : fallback;
}

export default safeNext;
