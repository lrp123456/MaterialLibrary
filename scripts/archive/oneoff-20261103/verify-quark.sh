#!/usr/bin/env bash
TOKEN=$(curl -sS -m 8 -X POST http://127.0.0.1:30001/api/auth/login \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"${ML_USER:?set ML_USER}\",\"password\":\"${ML_PASS:?set ML_PASS}\"}" \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["data"]["token"])')
echo "token_len=${#TOKEN}"
echo "=== quark-status ==="
curl -sS -m 90 http://127.0.0.1:30001/api/auth/quark-status \
  -H "Authorization: Bearer ${TOKEN}"
echo
echo "=== root ==="
curl -sS -m 5 -o /dev/null -w "HTTP %{http_code}\n" http://127.0.0.1:30001/
