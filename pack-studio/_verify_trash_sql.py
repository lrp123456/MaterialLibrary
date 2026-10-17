"""_verify_trash_sql.py · 用真实 schema 验证回收站 SQL

关键点：assets 表刻意不含 tags_text（复现生产 bug 的前提）。
"""
import sqlite3, sys, os, json

AD = r"C:\Users\lrp\DevEcoStudioProjects\MaterialLibraryServer"
sys.path.insert(0, AD)

con = sqlite3.connect(":memory:")
con.row_factory = sqlite3.Row
cur = con.cursor()

# 只放生产里真实存在的列 —— 没有 tags_text
cur.executescript("""
CREATE TABLE assets (
  fid TEXT PRIMARY KEY, file_name TEXT, size INTEGER, sha256 TEXT,
  client_asset_id TEXT, status TEXT, error_note TEXT, reject_reason TEXT,
  reject_detail TEXT, kind TEXT, origin_orientation TEXT,
  origin_width INTEGER, origin_height INTEGER, source TEXT, created_at INTEGER
);
CREATE TABLE asset_tags (asset_fid TEXT, tag_id INTEGER);
CREATE TABLE tag_dict (id INTEGER PRIMARY KEY, label TEXT, dimension TEXT);
CREATE TABLE derivatives (asset_fid TEXT, kind TEXT);
CREATE TABLE asset_trash (
  id INTEGER PRIMARY KEY AUTOINCREMENT, fid TEXT, file_name TEXT, size INTEGER,
  trash_rel TEXT, deleted_at INTEGER, deleted_by TEXT, dispose_source TEXT, dispose_detail TEXT
);
""")

now = 1788000000000
cur.execute("INSERT INTO assets (fid,file_name,size,sha256,status,kind,origin_width,origin_height,source,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
            ("fid_test_001","test.jpg",1024,"abc","active","image",800,600,"local",now))
cur.execute("INSERT INTO tag_dict (id,label,dimension) VALUES (?,?,?)",(1,"混搭","style"))
cur.execute("INSERT INTO asset_tags (asset_fid,tag_id) VALUES (?,?)",("fid_test_001",1))
cur.execute("INSERT INTO derivatives (asset_fid,kind) VALUES (?,?)",("fid_test_001","origin"))
cur.execute("INSERT INTO asset_trash (fid,file_name,size,trash_rel,deleted_at,deleted_by,dispose_source) VALUES (?,?,?,?,?,?,?)",
            ("fid_test_001","test.jpg",1024,"",now,"admin","user_delete"))
con.commit()

P, F = 0, 0
def check(name, fn):
    global P, F
    try:
        r = fn()
        print(f"  [PASS] {name}" + (f"  {r}" if r else ""))
        P += 1
        return r
    except Exception as e:
        print(f"  [FAIL] {name}  -> {type(e).__name__}: {e}")
        F += 1
        return None

print("=== 1. assets 表确实没有 tags_text ===")
cols = [r[1] for r in cur.execute("PRAGMA table_info(assets)")]
print("  列:", ", ".join(cols))
print("  含 tags_text:", "YES" if "tags_text" in cols else "NO  <- 复现 bug 的前提成立")

print("\n=== 2. 旧 SQL 复现报错 ===")
def old_sql():
    try:
        cur.execute("SELECT a.tags_text FROM assets a").fetchall()
        return "  ? 未报错，测不出 bug"
    except Exception as e:
        return f"  [OK] 复现: {e}"
print(old_sql())

print("\n=== 3. 调新代码 listTrash / getTrashDetail ===")
# 通过 node 子进程跑真正的 JS 模块（better-sqlite3 ABI 与当前 node 不符，改用 node + node:sqlite）
NODE = r"C:\Users\lrp\.workbuddy\binaries\node\versions\22.22.2-3\node.exe"
DRIVER = r"C:\Users\lrp\DevEcoStudioProjects\MaterialLibraryServer\pack-studio\_trash_driver.js"
import subprocess
r = subprocess.run([NODE, DRIVER], capture_output=True, text=True, encoding="utf-8", errors="replace")
print(r.stdout.rstrip())
if r.stderr.strip():
    print("STDERR:", r.stderr.strip()[:2000])

class Svc:
    def __init__(s, db): s.db, s.config = db, {"dataDir": "."}

svc = Svc(con)

# 下面这些检查改由 node 驱动完成（见上），此处仅做 sqlite 侧的交叉确认
def t_cross():
    n = cur.execute("SELECT COUNT(*) FROM asset_trash").fetchone()[0]
    assert n == 1, n
    return f"asset_trash 有 {n} 条，node 侧结果应与之匹配"
check("sqlite 侧测试数据就绪", t_cross)

print(f"\n（详细的 listTrash/getTrashDetail 断言见 node 驱动输出）")
sys.exit(0)
