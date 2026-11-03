#!/usr/bin/env bash
set -euo pipefail

API_ORIGIN=${WORKER_API_ORIGIN:-${API_ORIGIN:-http://localhost:8787}}
WORKSPACE_ID=${WORKSPACE_ID:?WORKSPACE_ID is required}
SESSION_COOKIE=${SESSION_COOKIE:?SESSION_COOKIE is required}
ICLOUD_EMAIL=${ICLOUD_EMAIL:?ICLOUD_EMAIL is required}
ICLOUD_APP_PASSWORD=${ICLOUD_APP_PASSWORD:?ICLOUD_APP_PASSWORD is required}
ICLOUD_BAD_PASSWORD=${ICLOUD_BAD_PASSWORD:-bad-password}
ICLOUD_IMAP_HOST=${ICLOUD_IMAP_HOST:-}
ICLOUD_IMAP_PORT=${ICLOUD_IMAP_PORT:-}
ICLOUD_LABEL=${ICLOUD_LABEL:-}
export ICLOUD_EMAIL ICLOUD_APP_PASSWORD ICLOUD_BAD_PASSWORD ICLOUD_IMAP_HOST ICLOUD_IMAP_PORT ICLOUD_LABEL

json_field() {
  node -e "const fs=require('fs');const data=JSON.parse(fs.readFileSync(0,'utf8'));const key=process.argv[1];console.log((data && data[key] !== undefined && data[key] !== null) ? data[key] : '')" "$1"
}

request_json() {
  local method=$1
  local url=$2
  local body=${3:-}
  if [[ -n "$body" ]]; then
    curl -sS -X "$method" "$url" \
      -H 'Content-Type: application/json' \
      -H "Cookie: ${SESSION_COOKIE}" \
      -d "$body"
  else
    curl -sS -X "$method" "$url" \
      -H "Cookie: ${SESSION_COOKIE}"
  fi
}

connect_body=$(node -e "const payload={email:process.env.ICLOUD_EMAIL};if(process.env.ICLOUD_LABEL)payload.label=process.env.ICLOUD_LABEL;console.log(JSON.stringify(payload));")
connect_resp=$(request_json POST "${API_ORIGIN}/assistant/workspaces/${WORKSPACE_ID}/mail/icloud/connect" "$connect_body")
connect_ok=$(json_field ok <<<"$connect_resp")
connection_id=$(json_field connectionId <<<"$connect_resp")

if [[ "$connect_ok" != "true" || -z "$connection_id" ]]; then
  echo "❌ connect failed"
  echo "$connect_resp"
  exit 1
fi

echo "✅ connect ok (identityId=${connection_id})"

verify_bad_body=$(IDENTITY_ID="$connection_id" node -e "const payload={identityId:process.env.IDENTITY_ID,appPassword:process.env.ICLOUD_BAD_PASSWORD};if(process.env.ICLOUD_IMAP_HOST)payload.imapHost=process.env.ICLOUD_IMAP_HOST;if(process.env.ICLOUD_IMAP_PORT)payload.imapPort=Number(process.env.ICLOUD_IMAP_PORT);console.log(JSON.stringify(payload));")
verify_bad_resp=$(request_json POST "${API_ORIGIN}/assistant/workspaces/${WORKSPACE_ID}/mail/icloud/verify" "$verify_bad_body")
verify_bad_ok=$(json_field ok <<<"$verify_bad_resp")
verify_bad_error=$(json_field error <<<"$verify_bad_resp")

if [[ "$verify_bad_ok" != "false" || "$verify_bad_error" != "ICLOUD_AUTH_FAILED" ]]; then
  echo "❌ verify (bad password) did not fail as expected"
  echo "$verify_bad_resp"
  exit 1
fi

echo "✅ verify (bad password) returned ICLOUD_AUTH_FAILED"

verify_body=$(IDENTITY_ID="$connection_id" node -e "const payload={identityId:process.env.IDENTITY_ID,appPassword:process.env.ICLOUD_APP_PASSWORD};if(process.env.ICLOUD_IMAP_HOST)payload.imapHost=process.env.ICLOUD_IMAP_HOST;if(process.env.ICLOUD_IMAP_PORT)payload.imapPort=Number(process.env.ICLOUD_IMAP_PORT);console.log(JSON.stringify(payload));")
verify_resp=$(request_json POST "${API_ORIGIN}/assistant/workspaces/${WORKSPACE_ID}/mail/icloud/verify" "$verify_body")
verify_ok=$(json_field ok <<<"$verify_resp")
verify_status=$(json_field status <<<"$verify_resp")

if [[ "$verify_ok" != "true" || "$verify_status" != "connected" ]]; then
  echo "❌ verify (correct password) failed"
  echo "$verify_resp"
  exit 1
fi

echo "✅ verify (correct password) connected"

labels_resp=$(request_json GET "${API_ORIGIN}/assistant/workspaces/${WORKSPACE_ID}/mail/labels?identityId=${connection_id}")
labels_ok=$(json_field ok <<<"$labels_resp")

if [[ "$labels_ok" != "true" ]]; then
  echo "❌ labels fetch failed"
  echo "$labels_resp"
  exit 1
fi

echo "✅ labels fetched"
