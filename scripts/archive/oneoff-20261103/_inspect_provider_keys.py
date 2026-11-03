#!/usr/bin/env python3
"""Inspect Agnes key pool (keys live in providers-secrets.json / DB, not in this file)."""
import json
import os
import sqlite3

SECRETS = '/home/lrp/.dsh-material-library/providers-secrets.json'
DB = '/home/lrp/.dsh-material-library/material.db'


def mask(k: str) -> str:
    k = str(k or '')
    return f'{k[:8]}…{k[-4:]}' if len(k) > 12 else f'len={len(k)}'


def main():
    print('=== secrets file ===')
    if os.path.exists(SECRETS):
        d = json.load(open(SECRETS))
        for k, v in d.items():
            if isinstance(v, dict):
                keys = v.get('api_keys') or v.get('apiKeys') or []
                primary = v.get('api_key') or v.get('apiKey') or ''
                print(k, 'primary', mask(primary), 'api_keys', [mask(x) for x in keys])
            else:
                print(k, 'str', mask(v))
    else:
        print('missing')

    print('=== db providers ===')
    c = sqlite3.connect(DB)
    for r in c.execute('select id, enabled, api_key, secrets_json from llm_providers'):
        sj = {}
        try:
            sj = json.loads(r[3] or '{}') if r[3] else {}
        except Exception:
            sj = {}
        keys = (sj.get('api_keys') or []) if isinstance(sj, dict) else []
        print(r[0], 'enabled', r[1], 'api_key', mask(r[2]), 'api_keys', [mask(x) for x in keys])
    c.close()


if __name__ == '__main__':
    main()
