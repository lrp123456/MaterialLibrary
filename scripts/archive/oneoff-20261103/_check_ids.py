import sqlite3
import json

con = sqlite3.connect('/home/lrp/.dsh-material-library/material.db')
cur = con.cursor()
rows = cur.execute("SELECT id, created_at, prompt FROM creation_templates WHERE id LIKE 'ba_%'").fetchall()
ids = [r[0] for r in rows]
print('Total ba_ templates in db:', len(ids))
# Extract numeric ids
num_ids = [int(x[3:]) for x in ids]
print('Min id:', min(num_ids), 'Max id:', max(num_ids))
