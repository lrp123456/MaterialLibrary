#!/usr/bin/env bash
TOKEN=$(curl -sS -m 8 -X POST http://127.0.0.1:30001/api/auth/login \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"${ML_USER:?set ML_USER}\",\"password\":\"${ML_PASS:?set ML_PASS}\"}" \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["data"]["token"])')
echo "=== server quark-status ==="
curl -sS -m 90 http://127.0.0.1:30001/api/auth/quark-status \
  -H "Authorization: Bearer ${TOKEN}"
echo
echo "=== cli version via agents path ==="
/home/lrp/.local/node/bin/node /home/lrp/.agents/skills/quarkclouddrive/scripts/quark-drive.cjs --version
echo
echo "=== which configs exist ==="
ls -la /home/lrp/.agents/skills/quarkclouddrive/openclaw/config.json /home/lrp/.claude/skills/quarkclouddrive/claudecode/config.json 2>&1
