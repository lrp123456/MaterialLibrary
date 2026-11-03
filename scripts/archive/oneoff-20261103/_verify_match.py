import sqlite3
import json

con = sqlite3.connect('/home/lrp/.dsh-material-library/material.db')
cur = con.cursor()
rows = cur.execute("SELECT id FROM creation_templates WHERE id LIKE 'ba_%'").fetchall()

with open('scripts/ba_records_map.json', 'r', encoding='utf-8') as f:
    ba_map = json.load(f)

matched = 0
unmatched = []
for (cid,) in rows:
    rid = cid[3:]
    if rid in ba_map:
        matched += 1
    else:
        unmatched.append(cid)

print(f'Matched: {matched}/{len(rows)}')
if unmatched:
    print('Unmatched IDs:', unmatched)
