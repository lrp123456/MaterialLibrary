import sqlite3

con = sqlite3.connect('/home/lrp/.dsh-material-library/material.db')
cur = con.cursor()
rows = cur.execute("SELECT DISTINCT mode FROM chat_messages").fetchall()
print('Distinct modes in chat_messages:', rows)
sess_rows = cur.execute("SELECT id, title FROM chat_sessions LIMIT 5").fetchall()
print('Sample chat_sessions:', sess_rows)
