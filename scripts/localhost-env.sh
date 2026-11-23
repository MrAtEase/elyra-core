#!/usr/bin/env bash
set -euo pipefail

BASE_DEFAULT="http://localhost:8787"
COOKIE_FILE_DEFAULT="cookies.txt"

export BASE="${BASE:-$BASE_DEFAULT}"
COOKIE_FILE="${COOKIE_FILE:-$COOKIE_FILE_DEFAULT}"

if [[ -z "${WS_ID:-}" && -f "$COOKIE_FILE" ]]; then
  WHOAMI_JSON="$(curl -sS -b "$COOKIE_FILE" -c "$COOKIE_FILE" "$BASE/assistant/auth/whoami" || true)"
  DERIVED_WS_ID="$(printf "%s" "$WHOAMI_JSON" | sed -n 's/.*"activeWorkspace":{"id":"\([^"]*\)".*/\1/p' | head -n 1)"
  if [[ -n "$DERIVED_WS_ID" ]]; then
    export WS_ID="$DERIVED_WS_ID"
  fi
fi

echo "BASE=$BASE"
if [[ -n "${WS_ID:-}" ]]; then
  echo "WS_ID=$WS_ID"
else
  echo "WS_ID is not set. Set it manually, e.g.: export WS_ID=<workspace-id>"
fi
echo "COOKIE_FILE=$COOKIE_FILE"
