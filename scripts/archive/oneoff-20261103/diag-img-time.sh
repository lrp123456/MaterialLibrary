#!/usr/bin/env bash
export PATH=/home/lrp/.local/node/bin:$PATH
TOKEN=$(curl -sS -m 8 -X POST http://127.0.0.1:30001/api/viewer/auth/login \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"${ML_USER:?set ML_USER}\",\"password\":\"${ML_PASS:?set ML_PASS}\"}" \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["data"]["token"])')
FID='~1T2NL7dp5vbkD77c2PyA0k9pTbl5Bm5WXrriI3mhM-TBFnvRu7Jap6NphifdXGkgbAo7fTw19fk6rD1D_8fucDU'
echo local:
curl -sS -m 20 -o /tmp/loc.jpg -w 'http=%{http_code} size=%{size_download} time=%{time_total}\n' \
  "http://127.0.0.1:30001/api/viewer/assets/${FID}/image?token=${TOKEN}"
echo public:
curl -sS -m 90 -o /tmp/pub.jpg -w 'http=%{http_code} size=%{size_download} time=%{time_total}\n' \
  "${PUBLIC_BASE_URL:?未设置}/api/viewer/assets/${FID}/image?token=${TOKEN}"
echo list thumb_url sample:
curl -sS -m 15 "http://127.0.0.1:30001/api/viewer/assets?page=1&pageSize=3" -H "Authorization: Bearer $TOKEN" \
  | python3 -c 'import sys,json;d=json.load(sys.stdin)["data"]["items"];
for it in d: print(it.get("file_name"), "thumb=", (it.get("thumb_url") or "")[:60], "main=", it.get("mainDerivative",{}) if isinstance(it.get("mainDerivative"),dict) else it.get("main_derivative_id"))'
