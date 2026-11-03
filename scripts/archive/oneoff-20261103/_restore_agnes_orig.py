#!/usr/bin/env python3
import sys
sys.exit('供应商钥匙只读写项目 .env，这个脚本已停用')
import json
import os
import sqlite3
import time

p = '/home/lrp/.dsh-material-library/providers-secrets.json'
d = json.load(open(p))
agnes = d.get('agnes') or {}
if isinstance(agnes, str):
    agnes = {'api_key': agnes}

good = None
for k in [agnes.get('api_key'), *(agnes.get('api_keys') or [])]:
    if k and str(k).strip():
        good = str(k).strip()
        break
if not good:
    good = (agnes.get('api_key') or '')

agnes['api_key'] = good
agnes['api_keys'] = []
agnes['secrets_json'] = json.dumps({'api_keys': [good] if good else []})
d['agnes'] = agnes
with open(p, 'w') as f:
    json.dump(d, f, indent=2, ensure_ascii=False)
os.chmod(p, 0o600)

c = sqlite3.connect('/home/lrp/.dsh-material-library/material.db')
sj = {'api_keys': [good] if good else []}
c.execute(
    "update llm_providers set api_key=?, secrets_json=?, updated_at=? where id='agnes'",
    (good, json.dumps(sj), int(time.time() * 1000)),
)
c.commit()
c.close()
print('restored pool size=1 primary', (good or '')[:10] + '…')
