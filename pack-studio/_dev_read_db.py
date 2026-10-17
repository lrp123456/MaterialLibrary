import sqlite3, shutil, os, sys, glob, tempfile

src = glob.glob(os.path.join(tempfile.gettempdir(), 'devst-*'))
src.sort(key=os.path.getmtime)
d = src[-1]
print("目录:", d)

work = os.path.join(d, "merged.db")
# WAL 里可能有未 checkpoint 的数据，必须一起带上
shutil.copyfile(os.path.join(d, "DCStorage"), work)
for ext in ("-wal", "-shm"):
    p = os.path.join(d, "DCStorage" + ext)
    if os.path.exists(p):
        shutil.copyfile(p, work + ext)
        print("附带:", ext)

con = sqlite3.connect(work)
cur = con.cursor()
tabs = [r[0] for r in cur.execute("select name from sqlite_master where type='table'")]
print("表:", tabs)

KEYS = ["server", "url", "token", "user", "app_update", "wgt", "39.107.120.55", "30001"]
for t in tabs:
    try:
        n = cur.execute(f'select count(*) from "{t}"').fetchone()[0]
        print(f"\n=== {t}: {n} 行 ===")
        if n == 0:
            continue
        cols = [c[1] for c in cur.execute(f'PRAGMA table_info("{t}")')]
        print("列:", cols)
        rows = cur.execute(f'select * from "{t}" limit 400').fetchall()
        hits = []
        for r in rows:
            s = " | ".join(str(x)[:200] for x in r)
            if any(k.lower() in s.lower() for k in KEYS):
                hits.append(s)
        print(f"含关键词的行: {len(hits)}")
        for h in hits[:60]:
            print("  ★", h)
        if not hits:
            print("  (无关键词命中，前 8 行预览)")
            for r in rows[:8]:
                print("   -", " | ".join(str(x)[:120] for x in r))
    except Exception as e:
        print(f"{t} 查询失败: {e}")
con.close()
