#!/usr/bin/env bash
# ==============================================================================
# 服务端预热入口（**只能在 WSL 侧跑**）
#
# 真实 dataDir = ~/.dsh-material-library（ext4）。仓库里的 data/ 是 Windows 侧
# 陈旧副本，在 Windows 侧预热等于预热了一个没人读的目录。
# node_modules 位于 /mnt/c 共享目录且内含 Linux-ELF 原生模块（sharp），
# 预热要派生衍生图，只能用 WSL 的 node。
#
# 用法：bash scripts/prewarm.sh [--limit=300] [--concurrency=6] [--tiers=grid,preview]
# ==============================================================================
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="${ML_DATA_DIR:-$HOME/.dsh-material-library}"
export ML_DATA_DIR="$DATA_DIR"

# 用 WSL 自带的 node（跟服务端同一个 ABI）
if ! command -v node >/dev/null 2>&1; then
  export PATH="/home/lrp/.local/node/bin:$PATH"
fi

if [ ! -d "$DATA_DIR" ]; then
  echo "[prewarm] 数据目录不存在: $DATA_DIR" >&2
  exit 1
fi

cd "$PROJECT_DIR"
exec node scripts/prewarm.js "$@"
