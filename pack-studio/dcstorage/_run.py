
import sqlite3, json
c = sqlite3.connect(r'C:\Users\lrp\DevEcoStudioProjects\MaterialLibraryServer\pack-studio\dcstorage\DCStorage')
out = []
for t in ["android_metadata","default_wx_storage","DC_1211921507_storage"]:
    if not t.endswith('_storage'): continue
    for k, v, ts in c.execute('select key, value, timestamp from "' + t + '"'):
        out.append({'table': t, 'key': k, 'value': (str(v)[:200] if v is not None else None), 'ts': ts})
print(json.dumps(out, ensure_ascii=False, indent=1))
