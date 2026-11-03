import sqlite3, json, os, time

home = os.path.expanduser("~")
db_path = os.path.join(home, ".dsh-material-library", "material.db")
con = sqlite3.connect(db_path)
cur = con.cursor()
row = cur.execute("SELECT config_json FROM gen_adapters WHERE id='agnes_video'").fetchone()
if row and row[0]:
    cfg = json.loads(row[0])
    t = cfg.get("submitBodyTemplate") or {}
    # 默认 text 模式，避免无图请求带 images
    t["mode"] = "text"
    if "images" in t and not t.get("images"):
        t.pop("images", None)
    # 保持结构，normalizeAgnesVideoPayload 会在运行时按是否有图切换 reference
    cfg["submitBodyTemplate"] = t
    cur.execute(
        "UPDATE gen_adapters SET config_json=?, updated_at=? WHERE id='agnes_video'",
        (json.dumps(cfg, ensure_ascii=False), int(time.time() * 1000)),
    )
    con.commit()
    print("updated agnes_video config:", json.dumps(cfg.get("submitBodyTemplate"), ensure_ascii=False)[:300])
else:
    print("agnes_video adapter not found")
con.close()

# seed app-update manifest on Windows project data dir (shared via WSL mount)
upd = r"C:\Users\lrp\DevEcoStudioProjects\MaterialLibraryServer\data\app-update"
os.makedirs(os.path.join(upd, "files"), exist_ok=True)
mp = os.path.join(upd, "manifest.json")
if not os.path.exists(mp):
    manifest = {
        "platform": "android",
        "latest": {
            "versionCode": 100,
            "versionName": "1.0.0",
            "wgtVersion": "100",
            "type": "none",
            "force": False,
            "note": "初始基线版本",
            "url": "",
            "md5": "",
            "size": 0,
            "publishedAt": None,
        },
        "minBaseVersionCode": 100,
        "apk": {
            "versionCode": 100,
            "versionName": "1.0.0",
            "url": "",
            "md5": "",
            "note": "",
        },
    }
    json.dump(manifest, open(mp, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print("seeded", mp)
else:
    print("manifest exists", mp)
