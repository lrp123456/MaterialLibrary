#!/usr/bin/env python3
"""Confirm Agnes key in DB can call chat after restore."""
import json
import sqlite3
import urllib.request
import urllib.error

c = sqlite3.connect('/home/lrp/.dsh-material-library/material.db')
row = c.execute("select api_key, secrets_json from llm_providers where id='agnes'").fetchone()
c.close()
key = row[0] or ''
sj = json.loads(row[1] or '{}') if row[1] else {}
print('primary', key[:10] + '…', 'pool', len(sj.get('api_keys') or []))

body = json.dumps({
    'model': 'agnes-3.0-flash',
    'messages': [{'role': 'user', 'content': 'ping'}],
    'max_tokens': 5,
}).encode()
req = urllib.request.Request(
    'https://apihub.agnes-ai.com/v1/chat/completions',
    data=body, method='POST',
)
req.add_header('Authorization', 'Bearer ' + key)
req.add_header('Content-Type', 'application/json')
try:
    with urllib.request.urlopen(req, timeout=20) as r:
        print('chat', r.status, r.read(80).decode('utf-8', 'replace'))
except urllib.error.HTTPError as e:
    print('chat', e.code, e.read(150).decode('utf-8', 'replace'))
except Exception as e:
    print('chat ERR', e)
