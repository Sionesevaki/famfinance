#!/usr/bin/env bash
set -euo pipefail

# Deploys tagged GHCR images to a VPS running Docker + docker compose plugin.
#
# Required:
# - VPS_HOST (e.g. 1.2.3.4 or example.com)
# - VPS_USER (e.g. ubuntu)
# - TAG (same tag used for api/worker/migrate images)
#
# Optional:
# - VPS_PATH (default /opt/famfinance)
# - COMPOSE_FILE (default infra/docker/docker-compose.deploy.example.yml)
# - ENV_FILE (default infra/docker/env.vps.example; typically you supply your own .env)
#
# Notes:
# - This script copies the compose file to the VPS and runs `docker compose pull`.
# - It expects the VPS to already have a `.env` in VPS_PATH; it will not overwrite it unless you pass `PUSH_ENV=1`.

VPS_HOST="${VPS_HOST:?VPS_HOST is required}"
VPS_USER="${VPS_USER:-root}"
TAG="${TAG:?TAG is required}"

VPS_PATH="${VPS_PATH:-/opt/famfinance}"
COMPOSE_FILE="${COMPOSE_FILE:-infra/docker/docker-compose.deploy.example.yml}"
ENV_FILE="${ENV_FILE:-infra/docker/env.vps.example}"
PUSH_ENV="${PUSH_ENV:-0}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

remote() {
  ssh -o StrictHostKeyChecking=accept-new "$VPS_USER@$VPS_HOST" "$@"
}

echo "Preparing remote directory: $VPS_USER@$VPS_HOST:$VPS_PATH"
remote "mkdir -p '$VPS_PATH'"

echo "Copying compose file..."
scp "$ROOT_DIR/$COMPOSE_FILE" "$VPS_USER@$VPS_HOST:$VPS_PATH/docker-compose.yml" >/dev/null

if [[ "$PUSH_ENV" == "1" ]]; then
  echo "Copying env file (PUSH_ENV=1)..."
  scp "$ROOT_DIR/$ENV_FILE" "$VPS_USER@$VPS_HOST:$VPS_PATH/.env" >/dev/null
else
  echo "Not copying .env (PUSH_ENV=0). Ensure $VPS_PATH/.env exists on the VPS."
fi

echo "Pulling images and running migrations..."
remote "cd '$VPS_PATH' && export TAG='$TAG' && docker compose pull && docker compose run --rm migrate"

echo "Starting services..."
remote "cd '$VPS_PATH' && export TAG='$TAG' && docker compose up -d api worker"

echo "Done. Run smoke check from your machine:"
echo "  BASE_URL=http://$VPS_HOST:4000 ./scripts/smoke/api-smoke.sh"

