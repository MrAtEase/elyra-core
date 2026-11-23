#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="$ROOT_DIR/.run"
LOG_DIR="$ROOT_DIR/.logs"
PLAYGROUND_DIR="$ROOT_DIR/.run/playground/frontend"

mkdir -p "$RUN_DIR" "$LOG_DIR" "$ROOT_DIR/.tmp" "$ROOT_DIR/.wrangler"
export TMPDIR="$ROOT_DIR/.tmp"
export WRANGLER_HOME="$ROOT_DIR/.wrangler"

usage() {
  cat <<'EOF'
Usage: scripts/restart-elyra-local.sh [start|stop|restart|status]

Controls local Elyra stack:
  - frontend   (http://localhost:3000)
  - playground (http://localhost:3100)
  - email-io   (http://localhost:3001)
  - worker     (http://localhost:8787)
  - ai-service (http://localhost:8788)
EOF
}

kill_port() {
  local port="$1"
  local pids
  pids="$(lsof -ti "tcp:${port}" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -n "$pids" ]]; then
    echo "Killing listeners on :$port -> $pids"
    kill $pids 2>/dev/null || true
    sleep 1
    pids="$(lsof -ti "tcp:${port}" -sTCP:LISTEN 2>/dev/null || true)"
    if [[ -n "$pids" ]]; then
      kill -9 $pids 2>/dev/null || true
    fi
  fi
}

wait_for_port() {
  local port="$1"
  local timeout="${2:-30}"
  local start_ts
  start_ts="$(date +%s)"
  while true; do
    if lsof -ti "tcp:${port}" -sTCP:LISTEN >/dev/null 2>&1; then
      return 0
    fi
    if (( "$(date +%s)" - start_ts >= timeout )); then
      return 1
    fi
    sleep 1
  done
}

wait_for_http() {
  local url="$1"
  local timeout="${2:-25}"
  local start_ts
  start_ts="$(date +%s)"
  while true; do
    if curl -fsS -o /dev/null --max-time 3 "$url" 2>/dev/null; then
      return 0
    fi
    # Treat any HTTP response code as "alive" even if endpoint returns non-2xx.
    if curl -sS -o /dev/null --max-time 3 "$url" 2>/dev/null; then
      return 0
    fi
    if (( "$(date +%s)" - start_ts >= timeout )); then
      return 1
    fi
    sleep 1
  done
}

load_frontend_env() {
  local env_file="$ROOT_DIR/frontend/.env.local"
  if [[ -f "$env_file" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$env_file"
    set +a
  fi
}

load_backend_env() {
  local dev_vars="$ROOT_DIR/worker/.dev.vars"
  if [[ -f "$dev_vars" ]]; then
    set -a
    source "$dev_vars"
    set +a
  fi
}

prepare_playground_frontend() {
  mkdir -p "$ROOT_DIR/.run/playground"
  rsync -a --delete \
    --exclude ".git" \
    --exclude ".next" \
    --exclude ".run" \
    --exclude ".logs" \
    --exclude "node_modules" \
    "$ROOT_DIR/frontend/" "$PLAYGROUND_DIR/"
  if [[ -d "$ROOT_DIR/frontend/node_modules" ]]; then
    rm -rf "$PLAYGROUND_DIR/node_modules"
    ln -sfn "$ROOT_DIR/frontend/node_modules" "$PLAYGROUND_DIR/node_modules"
  fi
}

start_one() {
  local name="$1"
  local cmd="$2"
  local port="$3"
  local health_url="${4:-}"
  local logfile="$LOG_DIR/${name}.log"
  local pidfile="$RUN_DIR/${name}.pid"

  echo "Starting $name on :$port"
  nohup bash -lc "$cmd" >>"$logfile" 2>&1 &
  local pid=$!
  echo "$pid" >"$pidfile"

  if wait_for_port "$port" 45; then
    sleep 2
    if ! kill -0 "$pid" >/dev/null 2>&1; then
      echo "FAILED: $name bound :$port but exited immediately"
      echo "Last log lines ($logfile):"
      tail -n 80 "$logfile" || true
      return 1
    fi
    if [[ -n "$health_url" ]]; then
      if wait_for_http "$health_url" 30; then
        echo "OK: $name is healthy at $health_url (pid $pid)"
      else
        echo "FAILED: $name did not respond on $health_url"
        echo "Last log lines ($logfile):"
        tail -n 80 "$logfile" || true
        return 1
      fi
    else
      echo "OK: $name is listening on :$port (pid $pid)"
    fi
  else
    echo "FAILED: $name did not bind :$port"
    echo "Last log lines ($logfile):"
    tail -n 60 "$logfile" || true
    return 1
  fi
}

stop_all() {
  for pidfile in "$RUN_DIR"/*.pid; do
    if [[ -f "$pidfile" ]]; then
      local pid
      pid="$(cat "$pidfile")"
      if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
        echo "Killing parent script $pid"
        pkill -P "$pid" 2>/dev/null || true
        kill -9 "$pid" 2>/dev/null || true
      fi
    fi
  done
  kill_port 3000
  kill_port 3100
  kill_port 3001
  kill_port 8787
  kill_port 8788
  rm -f "$RUN_DIR"/*.pid
}

start_all() {
  load_frontend_env
  load_backend_env
  prepare_playground_frontend

  local internal_key="${INTERNAL_API_KEY:-devkey_local_elyra}"
  local internal_secret="${INTERNAL_API_SECRET:-devsecret_local_elyra_123}"

  start_one "worker" "cd '$ROOT_DIR' && HOME='$ROOT_DIR/.home' npm run dev:worker" 8787 "http://127.0.0.1:8787/"
  start_one "ai-service" "cd '$ROOT_DIR/backend/ai-service' && npm run dev" 8788 "http://127.0.0.1:8788/"
  start_one "email-io" "cd '$ROOT_DIR/email-io' && INTERNAL_API_KEY='$internal_key' INTERNAL_API_SECRET='$internal_secret' PORT=3001 npm run dev" 3001 "http://127.0.0.1:3001/"
  # Playground uses webpack explicitly: Turbopack panics on the symlinked node_modules
  start_one "frontend-playground" "cd '$PLAYGROUND_DIR' && ELYRA_PLAYGROUND=1 npx next dev --webpack --port 3100" 3100
  start_one "frontend" "cd '$ROOT_DIR/frontend' && npm run dev -- --port 3000" 3000
}

status_all() {
  echo "Current listeners:"
  lsof -nP -iTCP:3000 -sTCP:LISTEN || true
  lsof -nP -iTCP:3100 -sTCP:LISTEN || true
  lsof -nP -iTCP:3001 -sTCP:LISTEN || true
  lsof -nP -iTCP:8787 -sTCP:LISTEN || true
  lsof -nP -iTCP:8788 -sTCP:LISTEN || true
  echo
  echo "Log files:"
  ls -1 "$LOG_DIR" 2>/dev/null || true
}

ACTION="${1:-restart}"
case "$ACTION" in
  start)
    start_all
    ;;
  stop)
    stop_all
    ;;
  restart)
    stop_all
    start_all
    ;;
  status)
    status_all
    ;;
  *)
    usage
    exit 1
    ;;
esac
