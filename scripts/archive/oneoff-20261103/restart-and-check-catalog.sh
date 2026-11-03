#!/usr/bin/env bash
set -e
NODE=/home/lrp/.local/node/bin/node
DIR=/mnt/c/Users/lrp/DevEcoStudioProjects/MaterialLibraryServer
LOG=/home/lrp/.dsh-material-library/logs/server-30001.log
mkdir -p /home/lrp/.dsh-material-library/logs
pkill -f "node server.js" 2>/dev/null || true
sleep 1
cd "$DIR"
export ML_PORT=30001
export NO_PROXY=127.0.0.1,localhost,::1
export PATH="/home/lrp/.local/node/bin:$PATH"
nohup "$NODE" server.js >> "$LOG" 2>&1 &
echo "started pid=$!"
sleep 5
ss -ltnp | grep 30001 || echo "NOT LISTENING"
curl -sS -m 8 http://127.0.0.1:30001/api/viewer/lab/capabilities > /tmp/lab-cap.json || curl -sS -m 8 http://127.0.0.1:30001/api/lab/capabilities > /tmp/lab-cap.json
python3 - <<'PY'
import json
p='/tmp/lab-cap.json'
d=json.load(open(p,encoding='utf-8'))
s=d.get('studio') or d
img=(s.get('image') or {}).get('models') or []
print('image', len(img))
for m in img:
    print(' -', m.get('name'), '|', m.get('id'), '|', m.get('model_code'))
print('video', len((s.get('video') or {}).get('models') or []))
for m in (s.get('video') or {}).get('models') or []:
    print(' -', m.get('name'), '|', m.get('id'))
PY
tail -20 "$LOG"
