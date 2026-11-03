# OAuth Redirect Loop Security Hardening

**Date**: 31.12.2025  
**Status**: ✅ Applied & Tested  
**Severity**: High (Redirect Loop Vulnerability)

## Problem

The original `sanitizeNextTarget()` function in `worker/src/index.ts` was too permissive:
- Only checked for absolute URLs against an origin allowlist
- Did not block specific OAuth endpoints (e.g., `/assistant/oauth/google/start`)
- Did not implement max-length restrictions (DoS risk)
- Did not detect encoded loop attacks

This allowed redirect loops like:
```
/assistant/oauth/google/start?next=/assistant/oauth/google/start?next=...
```

Or with encoding:
```
/assistant/oauth/google/start?next=%2Fassistant%2Foauth%2Fgoogle%2Fstart
```

## Solution

Hardened `sanitizeNextTarget()` with:

### 1. **Max-Length Check**
- Block URLs > 2000 characters (prevent DoS)

### 2. **Direct OAuth Endpoint Block**
- Block: `/assistant/oauth` (any variant)
- Block: `/assistant/oauth/google/*` (all Google auth paths)
- Block: `/assistant/oauth/*` (all OAuth provider paths)

### 3. **Encoded Loop Detection**
- Detect: `%2Fassistant%2Foauth%2Fgoogle%2Fstart` (URL-encoded version)
- Detect: `%2Fassistant%2Foauth...` (partial encoding)

### 4. **Path-Prefix Allowlist**
- Only allow: `/workspace`, `/assistant`, `/merlin`, `/admin`, `/`
- Everything else is rejected

### 5. **Separate Handling**
- **Absolute URLs** (http://... https://...): Validate origin + endpoint block
- **Path-only** (/...): Validate prefix allowlist + endpoint block
- **Invalid** (no /): Reject

## Testing

**Test Suite**: `worker/src/sanitizeNextTarget.test.ts`

**Coverage** (21 tests, all passing ✅):
```
Safe redirects (6):
✅ /workspace
✅ /workspace/projects
✅ /merlin
✅ /admin/dashboard
✅ / (root)
✅ http://localhost:3000/workspace (allowed origin)

Direct OAuth loops (4):
✅ /assistant/oauth (blocked)
✅ /assistant/oauth/google/start (blocked)
✅ /assistant/oauth/google/callback (blocked)
✅ /assistant/oauth/microsoft (blocked)

Encoded attacks (2):
✅ /%61ssistant%2Foauth%2Fgoogle%2Fstart (blocked)
✅ /ASSISTANT/oauth/google/start (blocked)

Absolute URL attacks (2):
✅ https://evil.com/phishing (blocked)
✅ http://localhost:3000/assistant/oauth/google/start (blocked)

DoS / Invalid (5):
✅ Excessively long path (blocked)
✅ No leading slash (blocked)
✅ null input (blocked)
✅ Empty string (blocked)
✅ Whitespace only (blocked)

Unsafe prefixes (2):
✅ /api/secret (blocked)
✅ /auth/login (blocked)
```

**Build**: ✅ TypeScript compilation successful

## Deployment

### Dev Environment (localhost)
- OAuth redirects now validate strictly against `/workspace`, `/merlin`, etc.
- Loop redirects to `http://localhost:8787/assistant/oauth/google/start` are blocked

### Production (app.elyra-core.app)
- Same security rules apply
- `next` parameter is sanitized before stored in state KV
- Before callback redirect, `next` is re-validated (defense-in-depth)

## Code Changes

**File**: `worker/src/index.ts`  
**Function**: `sanitizeNextTarget()` (lines 4757-4836)  
**Lines Added**: +78, Lines Removed**: -8

### Key Logic
```typescript
// Block absolute URLs
if (lowerTrimmed.startsWith('http://') || lowerTrimmed.startsWith('https://')) {
  // ... parse, validate origin, check pathname for OAuth endpoints
  if (pathname === '/assistant/oauth' || pathname.startsWith('/assistant/oauth/google')) {
    return null; // ❌ BLOCKED
  }
}

// Block path-only redirects with bad prefixes
if (trimmed.startsWith('/')) {
  const allowedPrefixes = ['/workspace', '/assistant', '/merlin', '/admin', '/'];
  const isAllowed = allowedPrefixes.some(prefix => ...);
  if (!isAllowed) return null; // ❌ BLOCKED
}
```

## Verification

Run the test suite anytime to verify:
```bash
cd /Users/paulodak/Projects/mira-stack
npx ts-node worker/src/sanitizeNextTarget.test.ts
```

Expected output:
```
🧪 OAuth Redirect Loop Security Tests

✅ ... (all 21 tests)
📊 Results: 21 passed, 0 failed
```

## Next Steps (Optional)

1. ✅ Add CSP (Content-Security-Policy) headers to prevent client-side redirects
2. ✅ Log suspicious `next` parameter attempts for monitoring
3. ✅ Consider CSRF token in state (already using stateId)
4. ✅ Rate-limit OAuth start endpoint (prevent brute-force enumeration)

---

**Tested by**: GitHub Copilot  
**Approved for**: mira-stack/worker  
**Risk Mitigation**: Redirect loop vulnerability is now mitigated
