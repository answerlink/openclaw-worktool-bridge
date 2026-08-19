#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "$0")"
if docker compose version >/dev/null 2>&1; then
  compose_cmd=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  compose_cmd=(docker-compose)
else
  echo "ERROR: Docker Compose v2 is required." >&2
  exit 1
fi
if [[ ! -f .env ]]; then
  echo "ERROR: .env is missing; run ./deploy.sh first." >&2
  exit 1
fi
env_value() {
  local key="$1"
  awk -v key="$key" 'index($0, key "=") == 1 { print substr($0, length(key) + 2); exit }' .env
}

WEB_PORT="$(env_value WEB_PORT)"
CALLBACK_PUBLIC_BASE_URL="$(env_value CALLBACK_PUBLIC_BASE_URL)"
if [[ -z "$WEB_PORT" || -z "$CALLBACK_PUBLIC_BASE_URL" ]]; then
  echo "ERROR: WEB_PORT and CALLBACK_PUBLIC_BASE_URL must be set in .env." >&2
  exit 1
fi

echo "[1/4] Container status"
"${compose_cmd[@]}" ps
echo "[2/4] Local Bridge health"
curl -fsS --max-time 10 "http://127.0.0.1:${WEB_PORT}/api/v1/health"
echo
echo "[3/4] WorkTool cluster connectivity from Bridge"
"${compose_cmd[@]}" exec -T backend python - <<'PY'
import json
import os
import urllib.request

url = os.environ["WORKTOOL_API_BASE"].rstrip("/") + "/test/version"
with urllib.request.urlopen(url, timeout=10) as response:
    payload = json.load(response)
if str(payload.get("code")) != "200":
    raise SystemExit(f"unexpected response: {payload}")
print(json.dumps(payload, ensure_ascii=False))
PY
echo "[4/4] Public Bridge health"
curl -fsS --max-time 15 "${CALLBACK_PUBLIC_BASE_URL%/}/api/v1/health"
echo
echo "PASS: Bridge, WorkTool integration, and public HTTP access are healthy."
