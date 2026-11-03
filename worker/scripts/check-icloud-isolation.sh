#!/usr/bin/env bash
set -euo pipefail

API_ORIGIN=${WORKER_API_ORIGIN:-${API_ORIGIN:-http://localhost:8787}}
SESSION_COOKIE=${SESSION_COOKIE:?SESSION_COOKIE is required}
WORKSPACE_ID_A=${WORKSPACE_ID_A:?WORKSPACE_ID_A is required}
WORKSPACE_ID_B=${WORKSPACE_ID_B:?WORKSPACE_ID_B is required}
ICLOUD_IDENTITY_ID=${ICLOUD_IDENTITY_ID:?ICLOUD_IDENTITY_ID is required}
export ICLOUD_IDENTITY_ID

request_with_status() {
  local method=$1
  local url=$2
  local body=${3:-}
  if [[ -n "$body" ]]; then
    curl -sS -X "$method" "$url" \
      -H 'Content-Type: application/json' \
      -H "Cookie: ${SESSION_COOKIE}" \
      -d "$body" -w "\n%{http_code}"
  else
    curl -sS -X "$method" "$url" \
      -H "Cookie: ${SESSION_COOKIE}" -w "\n%{http_code}"
  fi
}

verify_body=$(node -e "const payload={identityId:process.env.ICLOUD_IDENTITY_ID,appPassword:'bad-password'};console.log(JSON.stringify(payload));")
response=$(request_with_status POST "${API_ORIGIN}/assistant/workspaces/${WORKSPACE_ID_B}/mail/icloud/verify" "$verify_body")
body=${response%$'\n'*}
status=${response##*$'\n'}
error=$(node -e "const fs=require('fs');const data=JSON.parse(fs.readFileSync(0,'utf8'));console.log(data?.error || '');" <<<"$body")

if [[ "$status" == "403" || "$status" == "404" ]]; then
  if [[ "$error" != "NOT_FOUND" ]]; then
    echo "❌ expected NOT_FOUND error, got status=${status} error=${error}"
    echo "$body"
    exit 1
  fi
  echo "✅ isolation check passed (status=${status}, error=${error})"
  exit 0
fi

echo "❌ isolation check failed (status=${status})"
echo "$body"
exit 1
