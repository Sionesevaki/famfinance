#!/usr/bin/env bash
set -euo pipefail

IMAGE_PREFIX="${IMAGE_PREFIX:-famfinance}"
TAG="${TAG:-dev}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

echo "Building images with:"
echo "  IMAGE_PREFIX=$IMAGE_PREFIX"
echo "  TAG=$TAG"

docker build -f "$ROOT_DIR/apps/api/Dockerfile" -t "$IMAGE_PREFIX-api:$TAG" "$ROOT_DIR"
docker build -f "$ROOT_DIR/apps/worker/Dockerfile" -t "$IMAGE_PREFIX-worker:$TAG" "$ROOT_DIR"
docker build -f "$ROOT_DIR/packages/db/Dockerfile" -t "$IMAGE_PREFIX-migrate:$TAG" "$ROOT_DIR"

echo "Built:"
echo "  $IMAGE_PREFIX-api:$TAG"
echo "  $IMAGE_PREFIX-worker:$TAG"
echo "  $IMAGE_PREFIX-migrate:$TAG"
