#!/usr/bin/env bash
set -euo pipefail

REMOTE_HOST="192.168.1.107"
REMOTE_USER="naite"
REMOTE_SERVER_DIR="/data/lrp/MaterialLibraryServer"
REMOTE_DATA_DIR="/data/lrp/dsh-material-library"
REMOTE_CLASH_DIR="$REMOTE_DATA_DIR/clash"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "=== 1. 在 107 上准备目标目录 ==="
ssh -o StrictHostKeyChecking=no "$REMOTE_USER@$REMOTE_HOST" "mkdir -p '$REMOTE_SERVER_DIR' '$REMOTE_DATA_DIR' '$REMOTE_CLASH_DIR'"

echo "=== 2. 同步独立 Mihomo (Clash) 内核与智能分流配置到 107 ==="
scp "$PROJECT_DIR/scratch/mihomo" "$REMOTE_USER@$REMOTE_HOST:$REMOTE_CLASH_DIR/mihomo"
scp "$PROJECT_DIR/scratch/geoip.metadb" "$REMOTE_USER@$REMOTE_HOST:$REMOTE_CLASH_DIR/geoip.metadb"
scp "$PROJECT_DIR/scratch/clash_config.yaml" "$REMOTE_USER@$REMOTE_HOST:$REMOTE_CLASH_DIR/config.yaml"
ssh "$REMOTE_USER@$REMOTE_HOST" "chmod +x '$REMOTE_CLASH_DIR/mihomo'"

echo "=== 3. 部署代码库与前端编译产物到 107 ==="
scp "$PROJECT_DIR/scratch/repo.tar.gz" "$REMOTE_USER@$REMOTE_HOST:/tmp/repo.tar.gz"
scp "$PROJECT_DIR/scratch/web_pro_dist.tar.gz" "$REMOTE_USER@$REMOTE_HOST:/tmp/web_pro_dist.tar.gz"
ssh "$REMOTE_USER@$REMOTE_HOST" "
    cd '$REMOTE_SERVER_DIR'
    tar -xzf /tmp/repo.tar.gz
    mkdir -p web-pro
    tar -xzf /tmp/web_pro_dist.tar.gz -C web-pro
    rm -f /tmp/repo.tar.gz /tmp/web_pro_dist.tar.gz
"

echo "=== 4. 同步核心数据库与敏感密钥凭据到 107 ==="
LOCAL_DATA="/home/lrp/.dsh-material-library"
rsync -avz \
    "$LOCAL_DATA/material.db" \
    "$LOCAL_DATA/media_secret.key" \
    "$LOCAL_DATA/bootstrap-credentials.txt" \
    "$REMOTE_USER@$REMOTE_HOST:$REMOTE_DATA_DIR/"

echo "=== 5. 同步 TLS、AI 模型与媒体静态缓存库到 107 ==="
rsync -avz --exclude='*.bak*' "$LOCAL_DATA/tls" "$LOCAL_DATA/models" "$LOCAL_DATA/clip-ai-runners" "$REMOTE_USER@$REMOTE_HOST:$REMOTE_DATA_DIR/" || true

echo "=== 6. 同步已入库素材图与衍生缓存 ==="
# 排除废弃分片 upload_chunks，其余全部同步
rsync -avz --exclude='upload_chunks' "$LOCAL_DATA/cache" "$REMOTE_USER@$REMOTE_HOST:$REMOTE_DATA_DIR/"

echo "=== 7. 在 107 原生环境编译安装生产依赖 (better-sqlite3 等) ==="
ssh "$REMOTE_USER@$REMOTE_HOST" "
    export PATH=/home/naite/.local/bin:\$PATH
    cd '$REMOTE_SERVER_DIR'
    npm config set registry https://registry.npmmirror.com
    npm install --omit=dev --no-audit
"

echo "=== 8. 在 107 启动服务与 Clash 守护进程 ==="
ssh "$REMOTE_USER@$REMOTE_HOST" "
    export PATH=/home/naite/.local/bin:\$PATH
    export ML_DATA_DIR='$REMOTE_DATA_DIR'
    cd '$REMOTE_SERVER_DIR'
    ./start.sh restart
"

echo "=== 9. 服务健康状态检查 ==="
ssh "$REMOTE_USER@$REMOTE_HOST" "
    export PATH=/home/naite/.local/bin:\$PATH
    export ML_DATA_DIR='$REMOTE_DATA_DIR'
    cd '$REMOTE_SERVER_DIR'
    ./start.sh status
"
