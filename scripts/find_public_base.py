import sqlite3, os
db = os.path.expanduser("~/.dsh-material-library/material.db")
con = sqlite3.connect(db)
rows = con.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
names = [r[0] for r in rows]
print("tables with kv/config", [n for n in names if any(x in n.lower() for x in ["kv","config","setting","umbra","bff"])])
for t in names:
    if any(x in t.lower() for x in ["kv","config","setting"]):
        try:
            cols = [c[1] for c in con.execute(f"PRAGMA table_info({t})")]
            print(t, cols)
            for r in con.execute(f"SELECT * FROM {t} LIMIT 20"):
                s = str(r)
                if any(k in s.lower() for k in ["public", "base", "bff", "39.107", "127.0"]):
                    print(" ", r)
        except Exception as e:
            print(t, e)
con.close()
