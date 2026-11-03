import sys
sys.exit('供应商钥匙只在项目 .env，这个检查脚本已停用')
import sqlite3, json, os

home = os.path.expanduser("~")
sec_path = os.path.join(home, ".dsh-material-library", "providers-secrets.json")
print("secrets path", sec_path)
if os.path.exists(sec_path):
    sec = json.load(open(sec_path))
    for k, v in sec.items():
        if isinstance(v, str):
            print("secret", k, "len", len(v), "prefix", v[:12])
        else:
            ak = v.get("api_key") or v.get("apiKey") or ""
            print("secret", k, "len", len(ak), "prefix", ak[:12] if ak else "", "keys", list(v.keys()))

db = os.path.join(home, ".dsh-material-library", "material.db")
print("db", db, "size", os.path.getsize(db) if os.path.exists(db) else "missing")
con = sqlite3.connect(db)
con.row_factory = sqlite3.Row
cur = con.cursor()
tables = [r[0] for r in cur.execute("SELECT name FROM sqlite_master WHERE type='table'")]
print("interesting", [t for t in tables if any(x in t.lower() for x in ["adapter", "provider", "llm", "user", "session"])])

if "llm_providers" in tables:
    for r in cur.execute("SELECT id, api_key, base_url, enabled FROM llm_providers"):
        k = r["api_key"] or ""
        print("provider", r["id"], "enabled", r["enabled"], "keyLen", len(k), "prefix", k[:12], "base", r["base_url"])

if "gen_adapters" in tables:
    for r in cur.execute("SELECT id, kind, protocol, base_url, enabled, secrets_json, config_json FROM gen_adapters"):
        print("adapter", r["id"], r["kind"], r["protocol"], r["enabled"], r["base_url"])
        print("  secrets", (r["secrets_json"] or "")[:100])
        print("  cfg", (r["config_json"] or "")[:240])

if "users" in tables:
    for r in cur.execute("SELECT username, role FROM users LIMIT 10"):
        print("user", r["username"], r["role"])

con.close()
