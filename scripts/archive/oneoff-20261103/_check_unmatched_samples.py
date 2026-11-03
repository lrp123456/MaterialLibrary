import sqlite3
import json

con = sqlite3.connect('/home/lrp/.dsh-material-library/material.db')
cur = con.cursor()
for i in ['ba_382', 'ba_155', 'ba_150']:
    row = cur.execute("SELECT id, prompt FROM creation_templates WHERE id=?", (i,)).fetchone()
    print(row[0], repr(row[1][:60]))
