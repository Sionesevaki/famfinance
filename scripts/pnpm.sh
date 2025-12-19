#!/usr/bin/env bash
set -euo pipefail

IMAGE="${PNPM_DOCKER_IMAGE:-node:20-bullseye}"

TTY_ARGS=()
if [ -t 0 ] && [ -t 1 ]; then
  TTY_ARGS=(-it)
fi

exec docker run --rm "${TTY_ARGS[@]}" \
  -v "$PWD:/repo" \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -w /repo \
  "$IMAGE" \
  bash -lc 'corepack enable >/dev/null 2>&1 && pnpm "$@"' bash "$@"
