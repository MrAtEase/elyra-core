#!/usr/bin/env bash
set -euo pipefail

API_BASE="${API_BASE:-https://api.elyra-core.app}"
WORKSPACE_ID="${WORKSPACE_ID:-ws-default}"
SESSION_COOKIE_NAME="${SESSION_COOKIE_NAME:-mf-s}"
SESSION_COOKIE="${SESSION_COOKIE:-}"

if [[ -z "${SESSION_COOKIE}" ]]; then
  cat <<'MSG' >&2
Set SESSION_COOKIE to the value of your ${SESSION_COOKIE_NAME} cookie before running this smoke check.
Example: SESSION_COOKIE=abc123 ./scripts/check-mail-routes.sh
MSG
  exit 1
fi

COOKIE_HEADER="${SESSION_COOKIE_NAME}=${SESSION_COOKIE}"
TMP_FILE=$(mktemp)
trap 'rm -f "${TMP_FILE}"' EXIT

run_check() {
  local path="$1"
  local label="$2"
  local url="${API_BASE}${path}"
  echo "Checking ${label}: ${url}"
  local status
  status=$(curl -s -o "${TMP_FILE}" -w "%{http_code}" \
    -H "Cookie: ${COOKIE_HEADER}" \
    -H "Accept: application/json" \
    "${url}")
  if [[ "${status}" == "404" ]]; then
    echo "FAIL: ${label} returned 404 (route missing)" >&2
    cat "${TMP_FILE}" >&2
    exit 1
  fi
  if [[ "${status}" != "200" ]]; then
    echo "FAIL: ${label} returned ${status}" >&2
    cat "${TMP_FILE}" >&2
    exit 1
  fi
  echo "OK: ${label} -> 200"
}

run_check "/assistant/auth/whoami" "whoami"
run_check "/assistant/workspaces/${WORKSPACE_ID}/mail/labels" "mail labels"
run_check "/assistant/workspaces/${WORKSPACE_ID}/mail/threads?limit=1&label=INBOX" "mail threads"
