import os
import sqlite3

# 公网地址不入库：从环境变量读取（可写进本地 .env）
PUBLIC_BASE = os.environ.get("PUBLIC_BASE_URL")
if not PUBLIC_BASE:
    raise SystemExit("请先设置环境变量 PUBLIC_BASE_URL，例如 http://your-host:30001")

db = os.path.expanduser("~/.dsh-material-library/material.db")
con = sqlite3.connect(db)
con.execute(
    "INSERT INTO kv(key,value) VALUES('bff_public_base',?) "
    "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    (PUBLIC_BASE,),
)
con.commit()
print(con.execute("SELECT key,value FROM kv WHERE key='bff_public_base'").fetchone())
con.close()
