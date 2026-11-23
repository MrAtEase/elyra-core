#!/usr/bin/env bash
set -euo pipefail

API_BASE="https://api.elyra-core.app"

echo "Running contract checks against ${API_BASE}..."

default_json_check() {
  local url="$1"
  local label="$2"

  echo "\nChecking ${label} (${url})"
  if output=$(curl -sS "$url" | jq .); then
    printf '%s\n' "$output"
    echo "PASS: ${label}"
  else
    echo "FAIL: ${label}"
    return 1
  fi
}

headers_check() {
  local url="$1"
  local label="$2"
  local origin_header="$3"

  echo "\nChecking ${label} (${url} with Origin: ${origin_header})"
  local headers
  if ! headers=$(curl -sS -I "$url" -H "Origin: ${origin_header}"); then
    echo "FAIL: ${label} (curl failed)"
    return 1
  fi
  printf '%s\n' "$headers"
  if ! printf '%s\n' "$headers" | grep -Ei "access-control|set-cookie|vary|http/" >/dev/null; then
    echo "FAIL: ${label} (expected headers missing)"
    return 1
  fi
  echo "PASS: ${label} (required headers present)"
}

default_json_check "${API_BASE}/assistant/selfcheck" "assistant selfcheck"
headers_check "${API_BASE}/assistant/selfcheck" "selfcheck headers" "https://app.elyra-core.app"
default_json_check "${API_BASE}/assistant/dashboard/summary?workspaceId=ws-default" "dashboard summary"

echo "\nContract checks complete."
