import sqlite3, os
db = os.path.expanduser("~/.dsh-material-library/material.db")
con = sqlite3.execute = None
con = sqlite3.connect(db)
con.execute(
    "INSERT INTO kv(key,value) VALUES('bff_public_base',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    ("http://39.107.120.55:30001",),
)
con.commit()
print(con.execute("SELECT key,value FROM kv WHERE key='bff_public_base'").fetchone())
con.close()
