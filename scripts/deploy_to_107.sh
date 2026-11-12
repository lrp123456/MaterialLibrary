#!/usr/bin/env bash
# 一键将 59 开发测试代码安全部署到 107 生产服务器
# 仅同步源代码与前端编译产物，保护 107 生产数据库与素材数据不受影响
set -euo pipefail

REMOTE_HOST="192.168.1.107"
REMOTE_USER="naite"
REMOTE_SERVER_DIR="/data/lrp/MaterialLibraryServer"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "======================================================"
echo "    Material Library · 生产环境一键发布 (59 -> 107)    "
echo "======================================================"

# 1. 检查前端是否需要重新构建
if [ "${BUILD_FRONTEND:-1}" = "1" ]; then
    echo ">> [1/4] 构建 Web Pro 前端生产产物..."
    cd "$PROJECT_DIR/web-pro"
    npm run build
    cd "$PROJECT_DIR"
fi

# 2. 同步后端代码与脚本（排除本地临时文件、缓存、数据库与 node_modules）
echo ">> [2/4] 同步代码至 107 生产目录 ($REMOTE_SERVER_DIR)..."
rsync -avz --delete \
    --exclude='.git' \
    --exclude='node_modules' \
    --exclude='scratch' \
    --exclude='logs' \
    --exclude='*.log' \
    --exclude='coverage' \
    --exclude='.dsh-material-library' \
    --exclude='cache' \
    --exclude='*.db' \
    --exclude='*.db-wal' \
    --exclude='*.db-shm' \
    --exclude='web-pro/node_modules' \
    --exclude='web-pro/src' \
    "$PROJECT_DIR/" \
    "$REMOTE_USER@$REMOTE_HOST:$REMOTE_SERVER_DIR/"

# 单独同步 web-pro/dist
rsync -avz --delete "$PROJECT_DIR/web-pro/dist/" "$REMOTE_USER@$REMOTE_HOST:$REMOTE_SERVER_DIR/web-pro/dist/"
# 若 web/dist 存在也同步
if [ -d "$PROJECT_DIR/web/dist" ]; then
    rsync -avz --delete "$PROJECT_DIR/web/dist/" "$REMOTE_USER@$REMOTE_HOST:$REMOTE_SERVER_DIR/web/dist/"
fi

# 3. 远程执行依赖更新（如有必要）并平滑重启 107
echo ">> [3/4] 远程平滑重启 107 服务（含守护与 Clash）..."
ssh -o StrictHostKeyChecking=no "$REMOTE_USER@$REMOTE_HOST" "
    export PATH=/home/naite/.local/bin:/usr/local/bin:/usr/bin:/bin:\$PATH
    export NODEJS_ORG_MIRROR=https://npmmirror.com/mirrors/node
    cd '$REMOTE_SERVER_DIR'
    chmod +x start.sh scripts/*.sh
    ./start.sh restart
"

# 4. 健康检查
echo ">> [4/4] 验证 107 生产服务可用性..."
sleep 2
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://$REMOTE_HOST:30002/" || true)
if [ "$HTTP_CODE" = "200" ]; then
    echo "======================================================"
    echo "   [成功] 107 生产环境发布完成！"
    echo "   • 生产访问: http://$REMOTE_HOST:30002"
    echo "   • 开发测试: http://192.168.1.59:30002"
    echo "======================================================"
else
    echo "[警告] 107 Web 服务 HTTP 状态码为 $HTTP_CODE，请检查远程日志"
fi
