#!/usr/bin/env bash
set -e
TOKEN=$(curl -sS -m 8 -X POST http://127.0.0.1:30001/api/auth/login \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"${ML_USER:?set ML_USER}\",\"password\":\"${ML_PASS:?set ML_PASS}\"}" \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["data"]["token"])')

echo "=== non-admin should 403 ==="
VT=$(curl -sS -m 8 -X POST http://127.0.0.1:30001/api/auth/login \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"${ML_USER:?set ML_USER}\",\"password\":\"${ML_PASS:?set ML_PASS}\"}" \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["data"]["token"])')
curl -sS -m 10 -X POST http://127.0.0.1:30001/api/auth/quark-install \
  -H "Authorization: Bearer ${VT}" -H 'Content-Type: application/json' \
  -d '{"url":"http://example.com/x.zip","code":"CAC-abc"}'
echo

echo "=== invalid url ==="
curl -sS -m 15 -X POST http://127.0.0.1:30001/api/auth/quark-install \
  -H "Authorization: Bearer ${TOKEN}" -H 'Content-Type: application/json' \
  -d '{"url":"not-a-url","code":"CAC-e90217f7e6ce42a8b0bba4cccf2698b8"}'
echo

echo "=== invalid code ==="
curl -sS -m 15 -X POST http://127.0.0.1:30001/api/auth/quark-install \
  -H "Authorization: Bearer ${TOKEN}" -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com/x.zip","code":"nope"}'
echo

echo "=== quark-status still ok ==="
curl -sS -m 60 http://127.0.0.1:30001/api/auth/quark-status -H "Authorization: Bearer ${TOKEN}"
echo
echo "=== web css primary ==="
curl -sS -m 8 http://127.0.0.1:30001/assets/index-CTavmDwM.css 2>/dev/null | grep -o '3B82F6\|0B1220\|2563EB' | sort | uniq -c | head
