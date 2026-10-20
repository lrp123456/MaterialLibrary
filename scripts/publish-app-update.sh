#!/usr/bin/env bash
# 一键发布 App 更新包到素材库私有服
# 用法:
#   bash scripts/publish-app-update.sh <wgt或apk路径> [versionName] [note] [channel]
# 例:
#   bash scripts/publish-app-update.sh /path/to/app.wgt 1.0.2 "三区工坊+删除" internal
#
# 环境变量:
#   ML_BASE   未设置时回退到 PUBLIC_BASE_URL
#   ML_USER   默认 admin
#   ML_PASS   默认 
set -euo pipefail

FILE="${1:?用法: publish-app-update.sh <file.wgt|apk> [versionName] [note] [channel]}"
VNAME="${2:-}"
NOTE="${3:-App 更新}"
CHANNEL="${4:-internal}"
BASE="${ML_BASE:-${PUBLIC_BASE_URL:?未设置 ML_BASE 或 PUBLIC_BASE_URL}}"
USER="${ML_USER:-admin}"
PASS="${ML_PASS:-}"

if [[ ! -f "$FILE" ]]; then
  echo "文件不存在: $FILE" >&2
  exit 1
fi

# 从文件名解析版本 code：app-101.wgt / xxx-1.0.2.wgt
BASENAME=$(basename "$FILE")
if [[ -z "$VNAME" ]]; then
  if [[ "$BASENAME" =~ ([0-9]+\.[0-9]+\.[0-9]+) ]]; then
    VNAME="${BASH_REMATCH[1]}"
  else
    VNAME="1.0.$(date +%H%M)"
  fi
fi

# versionCode：去掉点取数字，或用时间戳后 3 位 + 100
CODE=$(echo "$VNAME" | tr -cd '0-9')
if [[ -z "$CODE" ]]; then
  CODE=$((100 + $(date +%s) % 900))
fi
# 保证是递增整数
if [[ ${#CODE} -lt 3 ]]; then
  CODE="10${CODE}"
fi

echo "[1/3] 登录 $BASE ..."
LOGIN=$(curl -fsS -X POST "$BASE/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"$USER\",\"password\":\"$PASS\"}")
TOKEN=$(python3 - <<PY
import json,sys
print(json.loads('''$LOGIN''').get('data',{}).get('token',''))
PY
)
if [[ -z "$TOKEN" ]]; then
  echo "登录失败: $LOGIN" >&2
  exit 1
fi

echo "[2/3] 上传 $BASENAME (code=$CODE name=$VNAME channel=$CHANNEL) ..."
UP=$(curl -fsS -X POST "$BASE/api/app/update/upload?fileName=$(python3 -c "import urllib.parse;print(urllib.parse.quote('''$BASENAME'''))")" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/octet-stream' \
  --data-binary @"$FILE")
echo "$UP"

# 若 upload 未带版本字段，再写一次清单（含 channel 说明）
python3 - <<PY
import json, urllib.request, os
base = "$BASE"
token = "$TOKEN"
body = {
  "versionCode": int("$CODE"),
  "versionName": "$VNAME",
  "wgtVersion": "$CODE",
  "type": "apk" if "$BASENAME".endswith(".apk") else "wgt",
  "force": False,
  "note": "$NOTE (channel=$CHANNEL)",
}
# 填 url/md5/size 若 upload 已返回
try:
  up = json.loads('''$UP''')
  f = (up.get("data") or {}).get("file") or {}
  if f.get("url"):
    body["url"] = f["url"]
  if f.get("md5"):
    body["md5"] = f["md5"]
  if f.get("size"):
    body["size"] = f["size"]
except Exception:
  pass
req = urllib.request.Request(
  base + "/api/app/update",
  data=json.dumps(body).encode(),
  headers={"Content-Type": "application/json", "Authorization": "Bearer " + token},
  method="POST",
)
with urllib.request.urlopen(req, timeout=30) as r:
  print("[3/3] 清单已更新:", r.read().decode()[:400])
PY

echo ""
echo "发布完成。客户端将检查: GET $BASE/api/app/update"
echo "测试: curl \"$BASE/api/app/update?platform=android&versionCode=100&wgtVersion=100\""
