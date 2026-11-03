#!/usr/bin/env python3
"""Diagnose Agnes keys against official (.cn) and legacy (.com) endpoints."""
import json
import urllib.error
import urllib.request

KEYS = {
    'orig': None,  # filled from secrets
    'k1': '',
    'k2': '',
}

# load original
import os
p = '/home/lrp/.dsh-material-library/providers-secrets.json'
if os.path.exists(p):
    d = json.load(open(p))
    agnes = d.get('agnes') or {}
    if isinstance(agnes, str):
        agnes = {'api_key': agnes}
    KEYS['orig'] = agnes.get('api_key') or (agnes.get('api_keys') or [None])[0]


def mask(k):
    if not k:
        return 'None'
    k = str(k)
    return k[:10] + '…' + k[-4:] + f' (len={len(k)})'


def call(url, key, mode, extra_headers=None, body=None, method='GET'):
    """mode: bearer | bearer_nospace | bearer_space | query | raw"""
    headers = {'Content-Type': 'application/json'} if body is not None else {}
    if extra_headers:
        headers.update(extra_headers)
    if mode == 'bearer':
        headers['Authorization'] = f'Bearer {key}'
    elif mode == 'bearer_nospace':
        headers['Authorization'] = f'Bearer{key}'  # missing space
    elif mode == 'bearer_space2':
        headers['Authorization'] = f'Bearer  {key}'  # double space
    elif mode == 'bare':
        headers['Authorization'] = key  # no Bearer prefix
    elif mode == 'query':
        sep = '&' if '?' in url else '?'
        url = url + sep + 'key=' + key
    # raw: no auth header at all
    data = body.encode() if isinstance(body, str) else body
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            return r.status, r.read(180).decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        return e.code, e.read(180).decode('utf-8', 'replace')
    except Exception as e:
        return 'ERR', f'{type(e).__name__}: {e}'


def main():
    endpoints = [
        ('models.cn', 'GET', 'https://api.agnes-ai.cn/v1/models', None),
        ('models.com', 'GET', 'https://apihub.agnes-ai.com/v1/models', None),
        ('img.cn', 'POST', 'https://api.agnes-ai.cn/v1/images/generations',
         json.dumps({
             'model': 'agnes-image-2.5-flash',
             'prompt': 'a red cube on white background',
             'size': '1K',
             'ratio': '1:1',
             'extra_body': {'response_format': 'url'},
         })),
        ('chat.cn', 'POST', 'https://api.agnes-ai.cn/v1/chat/completions',
         json.dumps({
             'model': 'agnes-3.0-flash',
             'messages': [{'role': 'user', 'content': 'ping'}],
             'max_tokens': 5,
         })),
    ]

    for name, key in KEYS.items():
        if not key:
            print(f'=== {name}: missing ===')
            continue
        print(f'=== {name} {mask(key)} ===')
        # first: auth shape check on models.cn
        for mode in ('bearer', 'bearer_nospace', 'bearer_space2', 'bare', 'query', 'raw'):
            code, body = call('https://api.agnes-ai.cn/v1/models', key, mode)
            print(f'  auth/{mode:14} models.cn -> {code} {body[:90]}')
        # then official image endpoint with proper Bearer
        for ep_name, method, url, body in endpoints:
            code, resp = call(url, key, 'bearer', body=body, method=method)
            print(f'  {ep_name:14} bearer    -> {code} {resp[:100]}')
        print()


if __name__ == '__main__':
    main()
