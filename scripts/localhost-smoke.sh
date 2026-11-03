#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT_DIR/scripts/localhost-env.sh"

if [[ -z "${WS_ID:-}" ]]; then
  echo "Missing WS_ID. Export WS_ID first or ensure cookies.txt contains a valid session."
  exit 1
fi

echo ""
echo "Running smoke checks against $BASE (workspace: $WS_ID)"

echo ""
echo "1) Drive status"
curl -i -sS -b "$COOKIE_FILE" -c "$COOKIE_FILE" "$BASE/assistant/drive/status" | head -n 25

echo ""
echo "2) Workspace Drive files"
curl -i -sS -b "$COOKIE_FILE" -c "$COOKIE_FILE" "$BASE/assistant/workspaces/$WS_ID/drive/files?limit=10" | head -n 25

echo ""
echo "3) Docs list"
curl -i -sS -b "$COOKIE_FILE" -c "$COOKIE_FILE" "$BASE/assistant/docs/list?limit=10" | head -n 25

echo ""
echo "4) Slides list-decks"
curl -i -sS -b "$COOKIE_FILE" -c "$COOKIE_FILE" "$BASE/assistant/slides/list-decks?limit=10" | head -n 25

echo ""
echo "5) Docs create"
curl -i -sS -X POST -b "$COOKIE_FILE" -c "$COOKIE_FILE" \
  -H "Content-Type: application/json" \
  -d '{"title":"Codex Smoke Doc"}' \
  "$BASE/assistant/docs/create" | head -n 25

echo ""
echo "Smoke checks executed."
