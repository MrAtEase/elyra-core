#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/worker"

echo "==> npm ci"
npm ci

echo "==> npm run build"
npm run build

echo "==> wrangler deploy"
npx wrangler deploy
