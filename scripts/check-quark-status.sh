#!/usr/bin/env bash
set -e
CLI=/home/lrp/.agents/skills/quarkclouddrive/scripts/quark-drive.cjs
NODE=/home/lrp/.local/node/bin/node
echo "=== config dir ==="
ls -la /home/lrp/.quarkclouddrive 2>/dev/null | head -20 || echo no_config
echo "=== get-user-info via server path ==="
$NODE $CLI get-user-info --session-id dsh-ml-test --session-input dsh-material-library
echo
echo "=== login API on server ==="
TOKEN=$(curl -sS -m 8 -X POST http://127.0.0.1:30001/api/auth/login -H 'Content-Type: application/json' -d "{\"username\":\"${ML_USER:?set ML_USER}\",\"password\":\"${ML_PASS:?set ML_PASS}\"}" | python3 -c 'import sys,json; print(json.load(sys.stdin)["data"]["token"])')
echo "token ok"
echo "=== quark-status ==="
curl -sS -m 60 http://127.0.0.1:30001/api/auth/quark-status -H "Authorization: Bearer $TOKEN"
echo
echo "=== quark-status viewer path ==="
curl -sS -m 60 http://127.0.0.1:30001/api/viewer/auth/quark-status -H "Authorization: Bearer $TOKEN"
echo
echo "=== presets (uses quark?) ==="
curl -sS -m 15 http://127.0.0.1:30001/api/presets -H "Authorization: Bearer $TOKEN" | python3 -c 'import sys,json; d=json.load(sys.stdin); print("success",d.get("success"), "keys", list((d.get("data") or {}).keys())[:8] if isinstance(d.get("data"),dict) else type(d.get("data")))' 2>/dev/null || echo presets_fail
