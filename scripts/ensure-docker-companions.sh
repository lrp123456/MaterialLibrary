#!/usr/bin/env bash
# 确保素材库 Docker 伴生容器在运行
set -u
export PATH="/usr/bin:/usr/local/bin:${PATH:-}"

containers=(sm-litellm sm-postgres sm-redis sm-python-worker)

if ! command -v docker >/dev/null 2>&1; then
  echo "docker not found"
  exit 0
fi

if ! docker info >/dev/null 2>&1; then
  echo "docker daemon not ready"
  exit 0
fi

for c in "${containers[@]}"; do
  st=$(docker inspect -f '{{.State.Running}}' "$c" 2>/dev/null || echo missing)
  if [ "$st" != "true" ]; then
    echo "starting $c"
    docker start "$c" >/dev/null 2>&1 || echo "failed to start $c"
  else
    echo "already running $c"
  fi
done

docker ps --format '{{.Names}} {{.Status}}' | grep -E 'sm-litellm|sm-postgres|sm-redis|sm-python-worker' || true
