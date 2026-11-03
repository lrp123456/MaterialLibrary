#!/usr/bin/env bash
TOKEN=$(curl -sS -m 8 -X POST http://127.0.0.1:30001/api/auth/login \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"${ML_USER:?set ML_USER}\",\"password\":\"${ML_PASS:?set ML_PASS}\"}" \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["data"]["token"])')
echo "login_ok"
curl -sS -m 30 http://127.0.0.1:30001/api/auth/quark-status -H "Authorization: Bearer ${TOKEN}"
echo
curl -sS -m 15 "http://127.0.0.1:30001/api/assets?page=1&pageSize=2" -H "Authorization: Bearer ${TOKEN}" \
  | python3 -c 'import sys,json;d=json.load(sys.stdin);print("assets_ok",d.get("success"),"total",d.get("data",{}).get("total"))'
