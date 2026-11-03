import sqlite3
import json

con = sqlite3.connect('/home/lrp/.dsh-material-library/material.db')
cur = con.cursor()
rows = cur.execute("SELECT id, prompt FROM creation_templates WHERE id LIKE 'ba_%'").fetchall()

with open('scripts/ba_records_map.json', 'r', encoding='utf-8') as f:
    ba_map = json.load(f)

missing = [r for r in rows if r[0][3:] not in ba_map]
print('Missing:', len(missing))
with open('scripts/missing_templates.json', 'w', encoding='utf-8') as f:
    json.dump([{'id': r[0], 'prompt': r[1]} for r in missing], f, ensure_ascii=False, indent=2)
