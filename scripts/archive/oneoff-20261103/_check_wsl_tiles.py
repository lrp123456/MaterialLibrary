import sqlite3
import os

db_path = '/home/lrp/.dsh-material-library/material.db'
if not os.path.exists(db_path):
    print("DB not found at", db_path)
    exit(1)

con = sqlite3.connect(db_path)
cur = con.cursor()
cur.execute("SELECT COUNT(*) FROM ba_items WHERE kind_key='tile'")
print("WSL tiles count:", cur.fetchone()[0])

cur.execute("SELECT id, name_zh, brand, preview_rel FROM ba_items WHERE brand='蒙娜丽莎' OR name_zh LIKE '%方案%'")
print("WSL monalisa:", cur.fetchall())

cur.execute("SELECT * FROM ba_items WHERE id='cat_tile_1793252216325_ez9cs3'")
print("cat_tile_1793252216325_ez9cs3 full row:", cur.fetchone())

