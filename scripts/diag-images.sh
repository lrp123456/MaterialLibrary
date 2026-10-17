#!/usr/bin/env bash
export PATH=/home/lrp/.local/node/bin:$PATH
TOKEN=$(curl -sS -m 8 -X POST http://127.0.0.1:30001/api/viewer/auth/login \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"${ML_USER:?set ML_USER}\",\"password\":\"${ML_PASS:?set ML_PASS}\"}" \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["data"]["token"])')
echo "token_len=${#TOKEN}"
# find asset by filename from screenshot
FID=$(curl -sS -m 20 "http://127.0.0.1:30001/api/viewer/assets?page=1&pageSize=50" -H "Authorization: Bearer $TOKEN" \
  | python3 -c '
import sys,json
d=json.load(sys.stdin).get("data") or {}
items=d.get("items") or []
for it in items:
  fn=(it.get("file_name") or it.get("fileName") or "")
  if "c438bd" in fn or "c438bd" in str(it.get("fid")):
    print(it.get("fid")); break
else:
  if items: print(items[0].get("fid"))
')
echo "FID=$FID"
# detail
curl -sS -m 20 "http://127.0.0.1:30001/api/viewer/assets/${FID}" -H "Authorization: Bearer $TOKEN" \
  | python3 -c '
import sys,json
raw=sys.stdin.read()
try:
  d=json.loads(raw)
except Exception as e:
  print("bad json", raw[:200]); raise
data=d.get("data") or {}
a=data.get("asset") or {}
print("file", a.get("file_name"))
print("thumb", a.get("thumb_url"))
print("main_der", a.get("main_derivative_id"))
for key in ("derivatives","allDerivatives"):
  lst=data.get(key) or []
  print(key, [(x.get("id"), x.get("kind"), x.get("storage_type")) for x in lst][:8])
'
echo "=== image no token query, Bearer only ==="
curl -sS -m 30 -o /tmp/m1.jpg -w "http=%{http_code} size=%{size_download} ctype=%{content_type}\n" \
  "http://127.0.0.1:30001/api/viewer/assets/${FID}/image" -H "Authorization: Bearer $TOKEN"
echo "=== image with token query (mobile style) ==="
curl -sS -m 30 -o /tmp/m2.jpg -w "http=%{http_code} size=%{size_download} ctype=%{content_type}\n" \
  "http://127.0.0.1:30001/api/viewer/assets/${FID}/image?token=${TOKEN}"
echo "=== image origin derivative 2 ==="
curl -sS -m 40 -o /tmp/m3.jpg -w "http=%{http_code} size=%{size_download} ctype=%{content_type}\n" \
  "http://127.0.0.1:30001/api/viewer/assets/${FID}/image?derivative=2&token=${TOKEN}"
# public via 39
echo "=== public 39 image ==="
curl -sS -m 30 -o /tmp/m4.jpg -w "http=%{http_code} size=%{size_download}\n" \
  "http://39.107.120.55:30001/api/viewer/assets/${FID}/image?token=${TOKEN}"
file /tmp/m1.jpg /tmp/m4.jpg 2>/dev/null
# how mobile index.html builds image url
grep -n "image" /mnt/c/Users/lrp/DevEcoStudioProjects/AlbumSyncUniAppX/index.html | grep -i "src\|url\|viewer" | head -20
