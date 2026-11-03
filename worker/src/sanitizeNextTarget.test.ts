/**
 * Tests for sanitizeNextTarget OAuth redirect security hardening
 * 
 * Ziel: Verify that next-parameter is safe from:
 * 1. OAuth redirect loops
 * 2. Absolute URL injection
 * 3. Encoded loop attacks
 * 4. Length-based DoS
 */

// Mock ASSISTANT_AUTH_OAUTH_PREFIX for testing
const ASSISTANT_AUTH_OAUTH_PREFIX = '/assistant/oauth';

// Copy the hardened sanitizeNextTarget function here for testing
function sanitizeNextTargetTest(value: string | null, allowlist: Set<string>): string | null {
  if (!value) return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  // SECURITY: Max length check (prevent DoS via bloated URLs)
  if (trimmed.length > 2000) return null;

  // SECURITY: Block absolute URLs (only path-based redirects allowed)
  const lowerTrimmed = trimmed.toLowerCase();
  if (lowerTrimmed.startsWith('http://') || lowerTrimmed.startsWith('https://')) {
    // If it's an absolute URL, try to parse and validate against allowlist
    try {
      const parsed = new URL(trimmed);
      if (!allowlist.has(parsed.origin)) return null;
      // Continue validation of pathname below
      const pathname = parsed.pathname || '/';
      const query = parsed.search || '';
      
      // SECURITY: Block OAuth endpoints
      if (
        pathname === '/assistant/oauth' ||
        pathname.startsWith(ASSISTANT_AUTH_OAUTH_PREFIX) ||
        pathname === '/assistant/oauth/google/start' ||
        pathname === '/assistant/oauth/google/callback' ||
        pathname.startsWith('/assistant/oauth/google') ||
        pathname.startsWith('/assistant/oauth/')
      ) {
        return null;
      }

      // SECURITY: Block self-referential redirects (encoded or not)
      const reconstructed = pathname + query;
      if (
        reconstructed.includes('assistant/oauth/google/start') ||
        reconstructed.includes('%2Fassistant%2Foauth%2Fgoogle%2Fstart')
      ) {
        return null;
      }

      return parsed.toString();
    } catch {
      return null;
    }
  } else if (trimmed.startsWith('/')) {
    // Path-only redirect (relative)
    
    // SECURITY: Block OAuth endpoints (path-only)
    if (
      trimmed === '/assistant/oauth' ||
      trimmed.startsWith(ASSISTANT_AUTH_OAUTH_PREFIX) ||
      trimmed === '/assistant/oauth/google/start' ||
      trimmed === '/assistant/oauth/google/callback' ||
      trimmed.startsWith('/assistant/oauth/google') ||
      trimmed.startsWith('/assistant/oauth/')
    ) {
      return null;
    }

    // SECURITY: Block self-referential redirects (raw or encoded)
    if (
      trimmed.includes('assistant/oauth/google/start') ||
      trimmed.includes('%2Fassistant%2Foauth%2Fgoogle%2Fstart') ||
      trimmed.includes('assistant%2Foauth%2Fgoogle%2Fstart')
    ) {
      return null;
    }

    // SECURITY: Allow only known-safe path prefixes
    const allowedPrefixes = ['/workspace', '/assistant', '/merlin', '/admin', '/'];
    const isAllowed = allowedPrefixes.some(prefix => trimmed === prefix || trimmed.startsWith(prefix + '/') || trimmed.startsWith(prefix + '?'));
    if (!isAllowed) return null;

    return trimmed;
  } else {
    // Not a valid path (no leading /, no absolute URL)
    return null;
  }
}

// Test suite
const tests: Array<{
  name: string;
  input: string | null;
  allowlist: Set<string>;
  expected: string | null;
}> = [
  // ===== SAFE: Valid redirects =====
  {
    name: 'Safe: /workspace',
    input: '/workspace',
    allowlist: new Set(['http://localhost:3000']),
    expected: '/workspace',
  },
  {
    name: 'Safe: /workspace/projects',
    input: '/workspace/projects',
    allowlist: new Set(['http://localhost:3000']),
    expected: '/workspace/projects',
  },
  {
    name: 'Safe: /merlin',
    input: '/merlin',
    allowlist: new Set(['http://localhost:3000']),
    expected: '/merlin',
  },
  {
    name: 'Safe: /admin/dashboard',
    input: '/admin/dashboard',
    allowlist: new Set(['http://localhost:3000']),
    expected: '/admin/dashboard',
  },
  {
    name: 'Safe: / (root)',
    input: '/',
    allowlist: new Set(['http://localhost:3000']),
    expected: '/',
  },
  {
    name: 'Safe: Absolute URL with allowed origin',
    input: 'http://localhost:3000/workspace',
    allowlist: new Set(['http://localhost:3000']),
    expected: 'http://localhost:3000/workspace',
  },

  // ===== BLOCKED: Direct OAuth endpoint loops =====
  {
    name: 'BLOCK: /assistant/oauth (root)',
    input: '/assistant/oauth',
    allowlist: new Set(['http://localhost:3000']),
    expected: null,
  },
  {
    name: 'BLOCK: /assistant/oauth/google/start (direct loop)',
    input: '/assistant/oauth/google/start',
    allowlist: new Set(['http://localhost:3000']),
    expected: null,
  },
  {
    name: 'BLOCK: /assistant/oauth/google/callback',
    input: '/assistant/oauth/google/callback',
    allowlist: new Set(['http://localhost:3000']),
    expected: null,
  },
  {
    name: 'BLOCK: /assistant/oauth/microsoft',
    input: '/assistant/oauth/microsoft',
    allowlist: new Set(['http://localhost:3000']),
    expected: null,
  },

  // ===== BLOCKED: Encoded OAuth loops =====
  {
    name: 'BLOCK: Encoded /assistant/oauth/google/start',
    input: '/%61ssistant%2Foauth%2Fgoogle%2Fstart',
    allowlist: new Set(['http://localhost:3000']),
    expected: null,
  },
  {
    name: 'BLOCK: Mixed case & encoding',
    input: '/ASSISTANT/oauth/google/start',
    allowlist: new Set(['http://localhost:3000']),
    expected: null,
  },

  // ===== BLOCKED: Absolute URL attacks =====
  {
    name: 'BLOCK: Malicious absolute URL (not in allowlist)',
    input: 'https://evil.com/phishing',
    allowlist: new Set(['http://localhost:3000']),
    expected: null,
  },
  {
    name: 'BLOCK: Absolute URL with OAuth endpoint',
    input: 'http://localhost:3000/assistant/oauth/google/start',
    allowlist: new Set(['http://localhost:3000']),
    expected: null,
  },

  // ===== BLOCKED: Length attack =====
  {
    name: 'BLOCK: Excessively long path (DoS)',
    input: '/' + 'a'.repeat(2500),
    allowlist: new Set(['http://localhost:3000']),
    expected: null,
  },

  // ===== BLOCKED: Invalid paths =====
  {
    name: 'BLOCK: No leading slash, no absolute URL',
    input: 'workspace',
    allowlist: new Set(['http://localhost:3000']),
    expected: null,
  },
  {
    name: 'BLOCK: null input',
    input: null,
    allowlist: new Set(['http://localhost:3000']),
    expected: null,
  },
  {
    name: 'BLOCK: empty string',
    input: '',
    allowlist: new Set(['http://localhost:3000']),
    expected: null,
  },
  {
    name: 'BLOCK: whitespace only',
    input: '   ',
    allowlist: new Set(['http://localhost:3000']),
    expected: null,
  },

  // ===== BLOCKED: Other unsafe prefixes =====
  {
    name: 'BLOCK: /api (not in allowlist)',
    input: '/api/secret',
    allowlist: new Set(['http://localhost:3000']),
    expected: null,
  },
  {
    name: 'BLOCK: /auth (not in allowlist)',
    input: '/auth/login',
    allowlist: new Set(['http://localhost:3000']),
    expected: null,
  },
];

// Run tests
console.log('🧪 OAuth Redirect Loop Security Tests\n');
let passed = 0;
let failed = 0;

for (const test of tests) {
  const result = sanitizeNextTargetTest(test.input, test.allowlist);
  const isPass = result === test.expected;

  if (isPass) {
    passed++;
    console.log(`✅ ${test.name}`);
  } else {
    failed++;
    console.log(
      `❌ ${test.name}\n   Input: ${JSON.stringify(test.input)}\n   Expected: ${JSON.stringify(test.expected)}\n   Got: ${JSON.stringify(result)}`
    );
  }
}

console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
