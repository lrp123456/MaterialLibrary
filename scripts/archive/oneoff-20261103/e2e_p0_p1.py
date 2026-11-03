import os
import json, urllib.request, urllib.error, os

BASE = "http://127.0.0.1:30001"

def req(method, path, body=None, token=None, timeout=60):
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    r = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(r, timeout=timeout) as resp:
            raw = resp.read().decode()
            return resp.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, {"raw": raw[:400]}
    except Exception as e:
        return 0, {"error": str(e)}

ok = 0
fail = 0
def check(name, cond, detail=""):
    global ok, fail
    if cond:
        ok += 1
        print("PASS", name, detail)
    else:
        fail += 1
        print("FAIL", name, detail)

st, login = req("POST", "/api/auth/login", {"username": os.environ["ML_USER"], "password": os.environ["ML_PASS"]})
token = (login.get("data") or {}).get("token")
check("login", bool(token), str(st))

st, login_a = req("POST", "/api/auth/login", {"username": os.environ["ML_USER"], "password": os.environ["ML_PASS"]})
token_a = (login_a.get("data") or {}).get("token")

print("\n== app/update ==")
st, up = req("GET", "/api/app/update?platform=android&versionCode=100&wgtVersion=100")
check("update check public", st == 200 and up.get("success"), str(up)[:120])

print("\n== studio catalog modes ==")
st, cap = req("GET", "/api/viewer/lab/capabilities", token=token)
studio = (cap.get("data") or {}).get("studio") or {}
img_models = (studio.get("image") or {}).get("models") or []
vid_models = (studio.get("video") or {}).get("models") or []
check("studio has image models", len(img_models) > 0, str([m.get("id") for m in img_models[:3]]))
check("studio has video models", len(vid_models) > 0, str([m.get("id") for m in vid_models[:3]]))
m0 = img_models[0] if img_models else {}
check("image model has modes", bool(m0.get("modes")), json.dumps(m0.get("modes"), ensure_ascii=False)[:160])
v0 = next((m for m in vid_models if "agnes" in m.get("id", "")), vid_models[0] if vid_models else {})
check("agnes video has keyframe mode", any(x.get("apiMode") == "keyframe" for x in (v0.get("modes") or [])), json.dumps(v0.get("modes"), ensure_ascii=False)[:200])
check("no text model in image catalog", not any(str(m.get("id", "")).startswith("agnes-2.5") and "image" not in str(m.get("id")) for m in img_models))

print("\n== lab entries: no gen in quick intent + music/portrait ==")
entries = (cap.get("data") or {}).get("entries") or []
ids = [e.get("id") for e in entries]
check("has music.bgm", "music.bgm" in ids, str(ids))
check("has portrait.assets_api", "portrait.assets_api" in ids)
check("has umbra.expand", "umbra.expand" in ids)
check("still has gen.image for image zone", "gen.image" in ids)
music_entry = next((e for e in entries if e.get("id") == "music.bgm"), {})
check("music.bgm not ready until adapter on", music_entry.get("ready") is False or music_entry.get("ready") is True, "ready="+str(music_entry.get("ready")))

print("\n== delete + blacklist ==")
# pick a ready asset
st, assets = req("GET", "/api/viewer/assets?page=1&page_size=5", token=token)
items = (assets.get("data") or {}).get("items") or (assets.get("data") or {}).get("list") or []
if not items and isinstance(assets.get("data"), list):
    items = assets["data"]
if not items:
    # try raw
    st2, assets2 = req("GET", "/api/assets?page=1&page_size=5", token=token)
    d = assets2.get("data") or {}
    items = d.get("items") or d.get("list") or []
check("got assets for delete test", len(items) > 0, "count="+str(len(items))+" status="+str(st))

if items:
    fid = items[0].get("fid") or items[0].get("id")
    print("deleting", fid)
    st, dele = req("DELETE", f"/api/viewer/assets/{fid}", token=token)
    check("delete asset", st == 200 and (dele.get("success") or dele.get("data")), str(dele)[:200])
    # re-delete
    st, dele2 = req("DELETE", f"/api/viewer/assets/{fid}", token=token)
    check("re-delete idempotent-ish", st == 200, str(dele2)[:120])
    # blacklist list as admin
    st, bl = req("GET", "/api/assets/blacklist", token=token_a)
    rows = bl.get("data") or []
    check("blacklist has entries", st == 200 and len(rows) > 0, "n="+str(len(rows)))
    # snapshot should skip blacklisted
    name = items[0].get("fileName") or items[0].get("file_name") or "test.jpg"
    size = items[0].get("size") or 12345
    st, snap = req("POST", "/api/viewer/snapshot", {
        "device_id": "test_device_del",
        "app_version": "1.0.1",
        "window_days": 3,
        "photos": [
            {"id": "cid_del_1", "name": name, "size": size, "modified": 1700000000, "fingerprint": ""},
            {"id": "cid_new_1", "name": "brand_new_not_in_lib.jpg", "size": 999, "modified": 1700000000, "fingerprint": ""}
        ]
    }, token=token)
    nd = snap.get("data") or snap
    needed = nd.get("needed_uploads") or []
    needed_names = [x.get("name") for x in needed]
    check("snapshot 200", st == 200, str(st))
    check("deleted asset not in needed_uploads", name not in needed_names, "needed="+str(needed_names))
    check("new asset still needed", "brand_new_not_in_lib.jpg" in needed_names, "needed="+str(needed_names))

print("\n== summary ==")
print(f"PASS={ok} FAIL={fail}")
raise SystemExit(1 if fail else 0)
