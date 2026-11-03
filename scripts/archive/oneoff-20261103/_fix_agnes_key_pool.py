#!/usr/bin/env python3
"""Drop invalid Agnes key from pool (keep only keys that pass Bearer /v1/models)."""
import sys
sys.exit('供应商钥匙只读写项目 .env，这个脚本已停用')
import json
import os
import sqlite3
import time
import urllib.request
import urllib.error

SECRETS = '/home/lrp/.dsh-material-library/providers-secrets.json'
DB = '/home/lrp/.dsh-material-library/material.db'


def mask(k: str) -> str:
    k = str(k or '')
    return f'{k[:8]}…{k[-4:]}' if len(k) > 12 else f'len={len(k)}'


def ok(key: str) -> bool:
    req = urllib.request.Request('https://apihub.agnes-ai.com/v1/models', method='GET')
    req.add_header('Authorization', f'Bearer {key}')
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status == 200
    except urllib.error.HTTPError:
        return False
    except Exception:
        return False


def load_pool():
    d = json.load(open(SECRETS)) if os.path.exists(SECRETS) else {}
    agnes = d.get('agnes') or {}
    if isinstance(agnes, str):
        agnes = {'api_key': agnes}
    keys = []
    for k in [agnes.get('api_key') or agnes.get('apiKey') or '', *(agnes.get('api_keys') or agnes.get('apiKeys') or [])]:
        k = (str(k).strip() if k else '')
        if k and k not in keys:
            keys.append(k)
    return d, agnes, keys


def main():
    d, agnes, keys = load_pool()
    kept = []
    dropped = []
    for k in keys:
        if ok(k):
            kept.append(k)
            print('KEEP', mask(k))
        else:
            dropped.append(k)
            print('DROP', mask(k), '(invalid)')
    if not kept:
        print('ERROR: no valid keys left')
        return

    # secrets file
    agnes['api_key'] = kept[0]
    agnes['api_keys'] = kept[1:]
    agnes['secrets_json'] = json.dumps({'api_keys': kept})
    d['agnes'] = agnes
    with open(SECRETS, 'w') as f:
        json.dump(d, f, indent=2, ensure_ascii=False)
    try:
        os.chmod(SECRETS, 0o600)
    except Exception:
        pass

    # db
    c = sqlite3.connect(DB)
    row = c.execute("select secrets_json from llm_providers where id='agnes'").fetchone()
    sj = {}
    try:
        sj = json.loads(row[0] or '{}') if row and row[0] else {}
    except Exception:
        sj = {}
    sj['api_keys'] = kept
    c.execute(
        "update llm_providers set api_key=?, secrets_json=?, updated_at=? where id='agnes'",
        (kept[0], json.dumps(sj, ensure_ascii=False), int(time.time() * 1000)),
    )
    c.commit()
    c.close()
    print('pool now', len(kept), 'keys;', 'dropped', len(dropped))


if __name__ == '__main__':
    main()
