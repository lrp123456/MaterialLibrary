#!/usr/bin/env bash
TOKEN=$(curl -sS -m 8 -X POST http://127.0.0.1:30001/api/auth/login \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"${ML_USER:?set ML_USER}\",\"password\":\"${ML_PASS:?set ML_PASS}\"}" \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["data"]["token"])')
echo "=== full quark-install ==="
curl -sS -m 180 -X POST http://127.0.0.1:30001/api/auth/quark-install \
  -H "Authorization: Bearer ${TOKEN}" -H 'Content-Type: application/json' \
  -d '{"url":"https://pdds.quark.cn/download/stfile/yy6628964yz4y282p/quarkclouddrive-1.0.19.zip","code":"CAC-e90217f7e6ce42a8b0bba4cccf2698b8"}'
echo
echo "=== status after ==="
curl -sS -m 60 http://127.0.0.1:30001/api/auth/quark-status -H "Authorization: Bearer ${TOKEN}"
echo
/home/lrp/.local/node/bin/node /home/lrp/.agents/skills/quarkclouddrive/scripts/quark-drive.cjs --version
