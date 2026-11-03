import sqlite3
import json

con = sqlite3.connect('/home/lrp/.dsh-material-library/material.db')
cur = con.cursor()

print("=== ba_resources count ===")
print(cur.execute("SELECT count(*) FROM ba_resources").fetchone()[0])

print("=== creation_templates count ===")
print(cur.execute("SELECT count(*) FROM creation_templates").fetchone()[0])

print("=== creation_templates with ba_ prefix ===")
print(cur.execute("SELECT count(*) FROM creation_templates WHERE id LIKE 'ba_%'").fetchone()[0])

print("=== creation_templates created_at distribution ===")
rows = cur.execute("SELECT strftime('%Y-%m-%d', datetime(created_at/1000, 'unixepoch', 'localtime')) as dt, count(*) FROM creation_templates GROUP BY dt ORDER BY dt").fetchall()
for r in rows:
    print(r)

print("=== ba_resources sample ===")
rows = cur.execute("SELECT remote_id, create_time, type, url FROM ba_resources LIMIT 5").fetchall()
for r in rows:
    print(r)

print("=== creation_templates ba_ sample ===")
rows = cur.execute("SELECT id, created_at, datetime(created_at/1000, 'unixepoch', 'localtime'), prompt, params_json FROM creation_templates WHERE id LIKE 'ba_%' LIMIT 5").fetchall()
for r in rows:
    print(r[0], r[1], r[2], r[3][:30], r[4])
