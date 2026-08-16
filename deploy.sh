#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "$0")"

for command_name in docker openssl curl; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "ERROR: ${command_name} is required." >&2
    exit 1
  fi
done
if docker compose version >/dev/null 2>&1; then
  compose_cmd=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  compose_cmd=(docker-compose)
else
  echo "ERROR: Docker Compose v2 is required." >&2
  exit 1
fi

web_port="${WEB_PORT:-18080}"
worktool_api_base="${WORKTOOL_API_BASE:-http://host.docker.internal:15080}"
public_base_url="${PUBLIC_BASE_URL:-${CALLBACK_PUBLIC_BASE_URL:-}}"

env_value() {
  local key="$1"
  awk -v key="$key" 'index($0, key "=") == 1 { print substr($0, length(key) + 2); exit }' .env
}

append_env_default() {
  local key="$1"
  local value="$2"
  if ! grep -q "^${key}=" .env; then
    printf '%s=%s\n' "$key" "$value" >> .env
  fi
}

set_env_value() {
  local key="$1"
  local value="$2"
  local temp_file=".env.deploy.tmp"
  awk -v key="$key" -v value="$value" '
    BEGIN { written=0 }
    index($0, key "=") == 1 {
      if (!written) print key "=" value
      written=1
      next
    }
    { print }
    END { if (!written) print key "=" value }
  ' .env > "$temp_file"
  chmod 600 "$temp_file"
  mv "$temp_file" .env
}

is_public_ipv4() {
  awk -F. '
    NF != 4 { exit 1 }
    { for (i=1; i<=4; i++) if ($i !~ /^[0-9]+$/ || $i < 0 || $i > 255) exit 1 }
    $1 == 0 || $1 == 10 || $1 == 127 || $1 >= 224 { exit 1 }
    $1 == 100 && $2 >= 64 && $2 <= 127 { exit 1 }
    $1 == 169 && $2 == 254 { exit 1 }
    $1 == 172 && $2 >= 16 && $2 <= 31 { exit 1 }
    $1 == 192 && $2 == 168 { exit 1 }
    { exit 0 }
  ' <<<"$1"
}

if [[ ! "$web_port" =~ ^[0-9]+$ ]] || (( web_port < 1 || web_port > 65535 )); then
  echo "ERROR: WEB_PORT must be in 1..65535." >&2
  exit 1
fi
if [[ ! "$worktool_api_base" =~ ^https?:// ]]; then
  echo "ERROR: WORKTOOL_API_BASE must start with http:// or https://." >&2
  exit 1
fi

if [[ ! -f .env ]]; then
  if [[ -z "$public_base_url" ]]; then
    public_ip="$(curl --noproxy '*' -4fsS --max-time 5 https://api.ipify.org 2>/dev/null || true)"
    if ! is_public_ipv4 "$public_ip"; then
      public_ip="$(curl --noproxy '*' -fsS --max-time 3 http://metadata.tencentyun.com/latest/meta-data/public-ipv4 2>/dev/null || true)"
    fi
    if ! is_public_ipv4 "$public_ip"; then
      public_ip="$(curl --noproxy '*' -fsS --max-time 3 http://100.100.100.200/latest/meta-data/eipv4 2>/dev/null || true)"
    fi
    if ! is_public_ipv4 "$public_ip"; then
      echo "ERROR: Public IP could not be detected; set PUBLIC_BASE_URL." >&2
      exit 1
    fi
    public_base_url="http://${public_ip}:${web_port}"
  fi
  if [[ ! "$public_base_url" =~ ^https?:// ]]; then
    echo "ERROR: PUBLIC_BASE_URL must start with http:// or https://." >&2
    exit 1
  fi

  umask 077
  mysql_root_password="$(openssl rand -hex 24)"
  mysql_password="$(openssl rand -hex 24)"
  jwt_secret="$(openssl rand -hex 32)"
  private_license_secret="$(openssl rand -base64 12)"
  private_admin_password="$(openssl rand -hex 12)"
  cat > .env <<EOF
COMPOSE_PROJECT_NAME=openclaw-worktool-bridge
PYTHONUNBUFFERED=1
WEB_BIND_IP=0.0.0.0
WEB_PORT=${web_port}
APP_DEPLOYMENT_MODE=private
PRIVATE_OUTBOUND_ALLOW_LOOPBACK=false
MYSQL_ROOT_PASSWORD=${mysql_root_password}
MYSQL_DATABASE=worktool_bridge
MYSQL_USER=worktool
MYSQL_PASSWORD=${mysql_password}
APP_MYSQL_HOST=mysql
APP_MYSQL_PORT=3306
APP_MYSQL_USER=worktool
APP_MYSQL_PASSWORD=${mysql_password}
APP_MYSQL_DATABASE=worktool_bridge
APP_MYSQL_TIME_ZONE=+08:00
AUTH_JWT_SECRET=${jwt_secret}
AUTH_JWT_EXPIRE_DAYS=30
AUTH_PBKDF2_ITERATIONS=390000
AUTH_SMS_ENABLED=false
PRIVATE_ADMIN_USERNAME=admin
PRIVATE_ADMIN_PASSWORD=${private_admin_password}
PRIVATE_SELF_REGISTRATION_ENABLED=false
ENABLE_RUNTIME_WORKTOOL_SETTINGS=false
PRIVATE_LICENSE_SECRET_KEY=${private_license_secret}
WORKTOOL_API_BASE=${worktool_api_base%/}
CALLBACK_PUBLIC_BASE_URL=${public_base_url%/}
APP_PUBLIC_BASE_URL=${public_base_url%/}
DEFAULT_TEST_PROVIDER_ENABLED=false
CHAT_CONTEXT_ENABLED=true
CHAT_CONTEXT_MAX_MESSAGES=20
CHAT_CONTEXT_RETENTION_DAYS=7
EOF
  chmod 600 .env
  echo "Created secure .env"
else
  chmod 600 .env
  echo "Using existing .env (not overwritten)"
fi

# Idempotent upgrade migration for deployments created before these keys
# existed. Existing non-empty values are never replaced.
append_env_default APP_DEPLOYMENT_MODE private
append_env_default PRIVATE_OUTBOUND_ALLOW_LOOPBACK false
append_env_default PRIVATE_ADMIN_USERNAME admin
append_env_default PRIVATE_SELF_REGISTRATION_ENABLED false
private_license_secret="$(env_value PRIVATE_LICENSE_SECRET_KEY)"
if [[ -z "$private_license_secret" ]]; then
  set_env_value PRIVATE_LICENSE_SECRET_KEY "$(openssl rand -base64 12)"
elif (( ${#private_license_secret} != 16 )); then
  echo "ERROR: PRIVATE_LICENSE_SECRET_KEY must be exactly 16 characters." >&2
  exit 1
fi
private_admin_password="$(env_value PRIVATE_ADMIN_PASSWORD)"
if [[ -z "$private_admin_password" ]]; then
  set_env_value PRIVATE_ADMIN_PASSWORD "$(openssl rand -hex 12)"
elif (( ${#private_admin_password} < 12 )); then
  echo "ERROR: PRIVATE_ADMIN_PASSWORD must be at least 12 characters." >&2
  exit 1
fi
chmod 600 .env

"${compose_cmd[@]}" up -d --build --remove-orphans

set -a
# shellcheck disable=SC1091
source .env
set +a

health_url="http://127.0.0.1:${WEB_PORT}/api/v1/health"
for _ in $(seq 1 60); do
  if curl -fsS --max-time 3 "$health_url" >/dev/null 2>&1; then break; fi
  sleep 2
done
curl -fsS --max-time 5 "$health_url" >/dev/null

"${compose_cmd[@]}" exec -T backend python - <<'PY'
import json
import os
import urllib.request

url = os.environ["WORKTOOL_API_BASE"].rstrip("/") + "/test/version"
with urllib.request.urlopen(url, timeout=10) as response:
    payload = json.load(response)
if str(payload.get("code")) != "200":
    raise SystemExit(f"WorkTool verification failed: {payload}")
data = payload.get("data") or {}
print("WorkTool connected:", data.get("version") or "unknown", data.get("buildVersion") or "")
PY

echo "Bridge deployed: ${CALLBACK_PUBLIC_BASE_URL}"
echo "Run ./verify-deployment.sh for the full acceptance check."
