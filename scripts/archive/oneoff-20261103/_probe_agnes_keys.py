#!/usr/bin/env python3
"""Probe Agnes keys (masked output). Usage: pass keys via env AGNES_KEYS=json-array or read secrets."""
import json
import os
import urllib.request
import urllib.error

SECRETS = '/home/lrp/.dsh-material-library/providers-secrets.json'


def mask(k: str) -> str:
    k = str(k or '')
    return f'{k[:8]}…{k[-4:]}' if len(k) > 12 else f'len={len(k)}'


def probe(key: str, mode: str):
    url = 'https://apihub.agnes-ai.com/v1/models'
    req = urllib.request.Request(url, method='GET')
    if mode == 'bearer':
        req.add_header('Authorization', f'Bearer {key}')
    elif mode == 'query':
        req = urllib.request.Request(url + f'?key={key}', method='GET')
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            body = r.read(200).decode('utf-8', 'replace')
            return r.status, body[:120]
    except urllib.error.HTTPError as e:
        body = e.read(200).decode('utf-8', 'replace')
        return e.code, body[:120]
    except Exception as e:
        return 'ERR', str(e)[:120]


def main():
    d = json.load(open(SECRETS))
    agnes = d.get('agnes') or {}
    if isinstance(agnes, str):
        agnes = {'api_key': agnes}
    keys = []
    primary = agnes.get('api_key') or agnes.get('apiKey') or ''
    if primary:
        keys.append(primary)
    for k in (agnes.get('api_keys') or agnes.get('apiKeys') or []):
        if k and k not in keys:
            keys.append(k)
    print(f'pool size={len(keys)}')
    for i, k in enumerate(keys):
        for mode in ('bearer', 'query'):
            code, body = probe(k, mode)
            print(f'[{i}] {mask(k)} mode={mode} -> {code} {body}')


if __name__ == '__main__':
    main()
