#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INDEX="$ROOT/worker/src/index.ts"

if [[ ! -f "$INDEX" ]]; then
  echo "ERROR: worker/src/index.ts not found at: $INDEX"
  exit 1
fi

echo "==> Patching: $INDEX"

# 1) Ensure imports exist
if ! rg -n 'from "\.\/lib\/workspaceAuth"' "$INDEX" >/dev/null 2>&1; then
  echo "==> Adding imports (workspaceAuth/cors/emailIoClient)"
  perl -0777 -i -pe 's/(\n)(\s*export\s+default\s*\{)/\nimport { isWorkspaceMember, unauthorizedWorkspaceResponse } from "\.\/lib\/workspaceAuth";\nimport { isAssistantPath, preflightIfNeeded, withCors } from "\.\/lib\/cors";\nimport { fetchEmailIo } from "\.\/lib\/emailIoClient";\n\n$2/s' "$INDEX"
fi

# 2) Add global preflight handling in fetch (best-effort)
# Looks for "const url = new URL(request.url)" and injects below it.
if ! rg -n 'preflightIfNeeded\(' "$INDEX" >/dev/null 2>&1; then
  echo "==> Adding global /assistant preflight handling"
  perl -0777 -i -pe 's/(const\s+url\s*=\s*new\s+URL\(request\.url\)\s*;\s*\n)/$1  const pathname = url.pathname;\n\n  if (isAssistantPath(pathname)) {\n    const pf = preflightIfNeeded(request);\n    if (pf) return pf;\n  }\n\n/s' "$INDEX"
fi

# 3) Disable Google OAuth routes (minimal)
if ! rg -n 'Google OAuth disabled' "$INDEX" >/dev/null 2>&1; then
  echo "==> Adding Google OAuth disable guard"
  perl -0777 -i -pe 's/(if\s*\(\s*isAssistantPath\(pathname\)\s*\)\s*\{\s*\n\s*const\s+pf\s*=\s*preflightIfNeeded\(request\)\s*;\s*\n\s*if\s*\(pf\)\s*return\s*pf\s*;\s*\n\s*\}\s*\n)/$1  if (pathname.startsWith(\"\/assistant\/oauth\/google\")) {\n    return withCors(request, new Response(JSON.stringify({ ok: false, code: \"UNSUPPORTED\", message: \"Google OAuth disabled in dev\" }), { status: 400, headers: { \"content-type\": \"application\/json\" } }));\n  }\n\n/s' "$INDEX"
fi

# 4) Remove requestedWorkspaceId !== activeWorkspaceId mismatch block
# This is intentionally conservative: removes the IF block that contains requestedWorkspaceId/activeWorkspaceId mismatch check.
if rg -n 'requestedWorkspaceId\s*&&\s*activeWorkspaceId\s*&&\s*requestedWorkspaceId\s*!==\s*activeWorkspaceId' "$INDEX" >/dev/null 2>&1; then
  echo "==> Removing activeWorkspaceId mismatch unauthorized block"
  perl -0777 -i -pe 's/\n\s*if\s*\(\s*requestedWorkspaceId\s*&&\s*activeWorkspaceId\s*&&\s*requestedWorkspaceId\s*!==\s*activeWorkspaceId\s*\)\s*\{.*?\n\s*\}\n/\n/s' "$INDEX"
fi

echo "==> Done. Review diff:"
echo "    git diff -- worker/src/index.ts"
