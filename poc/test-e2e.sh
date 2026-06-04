#!/usr/bin/env bash
# Wrapper around docker compose for this POC stack.
# Always forces --build on up and the `e2e` profile so the e2e-runner
# container is part of the topology in every invocation.

set -euo pipefail

cd "$(dirname "$0")"

ACTION="${1:-}"

usage() {
  cat >&2 <<EOF
usage: $(basename "$0") <up|down>

  up    docker compose --profile e2e up -d --build
  down  docker compose --profile e2e down
EOF
  exit 64
}

case "$ACTION" in
  up)
    exec docker compose --profile e2e up -d --build
    ;;
  down)
    exec docker compose --profile e2e down
    ;;
  *)
    usage
    ;;
esac
