#!/usr/bin/env python3
import json
import sqlite3

c = sqlite3.connect('/home/lrp/.dsh-material-library/material.db')
print('=== llm_providers (agnes-related) ===')
for r in c.execute("select id, base_url, length(coalesce(api_key,'')), secrets_json from llm_providers"):
    if 'agnes' in (r[0] or '').lower() or 'agnes' in (r[1] or '').lower():
        sj = r[3] or ''
        print(r[0], r[1], 'keylen', r[2], 'secrets_head', sj[:80])

print('=== tables with base_url ===')
for (tn,) in c.execute("select name from sqlite_master where type='table'"):
    cols = [x[1] for x in c.execute(f'PRAGMA table_info({tn})')]
    if 'base_url' in cols:
        print('TABLE', tn, cols)
        for row in c.execute(f'select * from {tn}').fetchall():
            s = str(row)
            if 'agnes' in s.lower():
                print(' ', s[:220])
c.close()
