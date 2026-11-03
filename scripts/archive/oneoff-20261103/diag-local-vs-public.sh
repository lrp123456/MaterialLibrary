#!/usr/bin/env bash
TOKEN=$(curl -sS -m 8 -X POST http://127.0.0.1:30001/api/viewer/auth/login \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"${ML_USER:?set ML_USER}\",\"password\":\"${ML_PASS:?set ML_PASS}\"}" \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["data"]["token"])')
FID='~1T2NL7dp5vbkD77c2PyA0k9pTbl5Bm5WXrriI3mhM-TBFnvRu7Jap6NphifdXGkgbAo7fTw19fk6rD1D_8fucDU'
echo -n "local "
curl -sS -m 15 -o /tmp/a.jpg -w 'http=%{http_code} size=%{size_download} time=%{time_total}\n' \
  "http://127.0.0.1:30001/api/viewer/assets/${FID}/image?token=${TOKEN}"
echo -n "public "
curl -sS -m 15 -o /dev/null -w 'http=%{http_code} time=%{time_total}\n' \
  "${PUBLIC_BASE_URL:?未设置}/api/viewer/assets/${FID}/image?token=${TOKEN}"
file /tmp/a.jpg
