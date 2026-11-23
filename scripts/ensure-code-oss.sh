#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TOOLS_DIR="$ROOT_DIR/.tools"
VERSION="4.106.3"
ARCHIVE="code-server-${VERSION}-macos-arm64.tar.gz"
EXTRACTED_DIR="code-server-${VERSION}-macos-arm64"
BINARY_PATH="$TOOLS_DIR/$EXTRACTED_DIR/bin/code-server"
DOWNLOAD_URL="https://github.com/coder/code-server/releases/download/v${VERSION}/${ARCHIVE}"

mkdir -p "$TOOLS_DIR"

if [[ ! -x "$BINARY_PATH" ]]; then
  cd "$TOOLS_DIR"
  rm -f "$ARCHIVE"
  rm -rf "$EXTRACTED_DIR"
  curl -L "$DOWNLOAD_URL" -o "$ARCHIVE"
  tar -xzf "$ARCHIVE"
fi

printf '%s\n' "$BINARY_PATH"
