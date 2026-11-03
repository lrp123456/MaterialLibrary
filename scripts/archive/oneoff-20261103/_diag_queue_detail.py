import sqlite3
import os

db_path = os.path.expanduser('~/.dsh-material-library/material.db')
conn = sqlite3.connect(db_path)
cur = conn.cursor()

auth_sql = "(a.auth_state IS NULL OR a.auth_state IN ('live','frozen'))"
sql_all = f"SELECT count(*) FROM assets a WHERE a.kind IN ('image','video') AND {auth_sql}"
sql_fixed = f"SELECT count(*) FROM assets a WHERE a.kind IN ('image','video') AND {auth_sql} AND (a.status IS NULL OR a.status NOT IN ('deleted', 'rejected'))"

print("All count (includes deleted):", cur.execute(sql_all).fetchone()[0])
print("Fixed count (excludes deleted/rejected):", cur.execute(sql_fixed).fetchone()[0])

# Breakdown of all assets by status
print("Breakdown by status:")
for r in cur.execute("SELECT status, count(*) FROM assets GROUP BY status").fetchall():
    print(" ", r)

# Queued node_runs
print("Queued node_runs by node_type:")
for r in cur.execute("SELECT node_type, count(*) FROM node_runs WHERE status='queued' GROUP BY node_type").fetchall():
    print(" ", r)

# Queued node_runs breakdown by asset status
print("Queued node_runs breakdown by parent asset status:")
q = """
SELECT nr.node_type, a.status, count(*)
FROM node_runs nr
JOIN assets a ON nr.asset_fid = a.fid
WHERE nr.status = 'queued'
GROUP BY nr.node_type, a.status
"""
for r in cur.execute(q).fetchall():
    print(" ", r)
