
import sqlite3, json, sys
c = sqlite3.connect(r'C:\Users\lrp\DevEcoStudioProjects\MaterialLibraryServer\pack-studio\dcstorage\DCStorage')
try:
    rows = c.execute("select key, value from Data").fetchall()
except Exception as e:
    try:
        rows = c.execute("select key, value from data").fetchall()
    except Exception as e2:
        print("ERR:" + str(e2)); sys.exit(0)
for k, v in rows:
    print(str(k) + "\t" + (str(v)[:160] if v is not None else ""))
