#!/usr/bin/env python3
"""Probe Agnes keys multiple times to check stability."""
import json
import os
import time
import urllib.request
import urllib.error

SECRETS = '/home/lrp/.dsh-material-library/providers-secrets.json'
ALL = [
    # will also load from secrets + a known extras list if present
]


def mask(k: str) -> str:
    k = str(k or '')
    return f'{k[:8]}…{k[-4:]}' if len(k) > 12 else f'len={len(k)}'


def probe(key: str):
    req = urllib.request.Request('https://apihub.agnes-ai.com/v1/models', method='GET')
    req.add_header('Authorization', f'Bearer {key}')
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code
    except Exception as e:
        return f'ERR:{type(e).__name__}'


def main():
    keys = []
    # load current secrets
    if os.path.exists(SECRETS):
        d = json.load(open(SECRETS))
        agnes = d.get('agnes') or {}
        if isinstance(agnes, str):
            agnes = {'api_key': agnes}
        for k in [agnes.get('api_key'), *(agnes.get('api_keys') or [])]:
            k = (str(k).strip() if k else '')
            if k and k not in keys:
                keys.append(k)
    # also re-add previously dropped if we can find them in DB history? skip.
    print('probing', len(keys), 'keys x 4 rounds')
    results = {k: [] for k in keys}
    for round_i in range(4):
        for k in keys:
            code = probe(k)
            results[k].append(code)
            print(f'round{round_i} {mask(k)} -> {code}')
            time.sleep(0.4)
    print('=== summary ===')
    for k, codes in results.items():
        ok_n = sum(1 for c in codes if c == 200)
        print(mask(k), 'codes', codes, 'ok', ok_n, '/4')


if __name__ == '__main__':
    main()
