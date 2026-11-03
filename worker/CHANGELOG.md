# Changelog — Worker

## Unreleased

- fix: enforce path-only `safeNext` sanitizer for OAuth `next` redirects
  - decode only once, block absolute `http(s)` URLs, require leading `/`
  - block `/assistant/oauth/google/start` (and encoded variants) to prevent redirect loops
  - enforce max length 200 characters and allowlist path prefixes: `/workspace`, `/assistant`, `/merlin`, `/admin`
  - refactor `sanitizeNextTarget` to delegate to `safeNext`
  - add stable test `src/safeNext.test.ts` and `check-safeNext` npm script (uses `tsx`)
