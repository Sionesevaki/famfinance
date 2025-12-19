#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required" >&2
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

echo "Running prisma migrate deploy..."
docker run --rm \
  -e DATABASE_URL="$DATABASE_URL" \
  -v "$ROOT_DIR:/repo" \
  -w /repo \
  node:20-bullseye \
  bash -lc 'corepack enable >/dev/null 2>&1 && corepack prepare pnpm@9.12.0 --activate >/dev/null 2>&1 && pnpm --filter @famfinance/db migrate:deploy'

