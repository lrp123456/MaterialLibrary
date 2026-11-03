#!/usr/bin/env bash
export PATH=/home/lrp/.local/node/bin:$PATH
cd /mnt/c/Users/lrp/DevEcoStudioProjects/MaterialLibraryServer
TOKEN=$(curl -sS -m 8 -X POST http://127.0.0.1:30001/api/auth/login \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"${ML_USER:?set ML_USER}\",\"password\":\"${ML_PASS:?set ML_PASS}\"}" \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["data"]["token"])')
# list one asset
FID=$(curl -sS -m 15 "http://127.0.0.1:30001/api/assets?page=1&pageSize=1" -H "Authorization: Bearer $TOKEN" \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["data"]["items"][0]["fid"])')
echo "FID=$FID"
echo "=== detail ==="
curl -sS -m 20 "http://127.0.0.1:30001/api/assets/${FID}" -H "Authorization: Bearer $TOKEN" \
  | python3 -c '
import sys,json
d=json.load(sys.stdin).get("data") or {}
print("keys",list(d.keys())[:20])
print("thumb",d.get("thumb_url"))
print("mainDeriv", (d.get("mainDerivative") or {}).get("kind"), (d.get("mainDerivative") or {}).get("id"))
print("tags", [(t.get("dimension"),t.get("dir")) for t in (d.get("tags") or [])][:12])
print("colors", d.get("colors"))
print("derivs", [(x.get("id"),x.get("kind"),x.get("storage_type")) for x in (d.get("derivatives") or [])][:8])
'
echo "=== image no deriv ==="
curl -sS -m 25 -o /tmp/img0.jpg -w "http=%{http_code} size=%{size_download}\n" \
  "http://127.0.0.1:30001/api/assets/${FID}/image" -H "Authorization: Bearer $TOKEN"
file /tmp/img0.jpg 2>/dev/null || ls -la /tmp/img0.jpg
echo "=== image with derivative ==="
DID=$(curl -sS -m 15 "http://127.0.0.1:30001/api/assets/${FID}" -H "Authorization: Bearer $TOKEN" \
  | python3 -c 'import sys,json; d=json.load(sys.stdin)["data"]; print((d.get("derivatives") or [{}])[0].get("id") or "")')
echo "DID=$DID"
if [ -n "$DID" ]; then
  curl -sS -m 40 -o /tmp/img1.jpg -w "http=%{http_code} size=%{size_download}\n" \
    "http://127.0.0.1:30001/api/assets/${FID}/image?derivative=$DID" -H "Authorization: Bearer $TOKEN"
fi
# server log tail
tail -30 /home/lrp/.dsh-material-library/logs/server-30001.log 2>/dev/null | tail -20
