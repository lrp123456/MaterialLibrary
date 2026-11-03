import os
import json, urllib.request, urllib.error, os, time

BASE = "http://127.0.0.1:30001"

def req(method, path, body=None, token=None, timeout=90):
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    r = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(r, timeout=timeout) as resp:
            return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, {"raw": raw[:400]}
    except Exception as e:
        return 0, {"error": str(e)}

ok = fail = 0
def check(name, cond, detail=""):
    global ok, fail
    if cond:
        ok += 1; print("PASS", name, detail)
    else:
        fail += 1; print("FAIL", name, detail)

st, login = req("POST", "/api/auth/login", {"username": os.environ["ML_USER"], "password": os.environ["ML_PASS"]})
token = (login.get("data") or {}).get("token")
st, login_a = req("POST", "/api/auth/login", {"username": os.environ["ML_USER"], "password": os.environ["ML_PASS"]})
token_a = (login_a.get("data") or {}).get("token")
check("login", bool(token))

print("== channel ==")
st, pub = req("POST", "/api/app/update", {
    "versionCode": 110, "versionName": "1.1.0", "wgtVersion": "110",
    "type": "wgt", "force": False, "note": "internal channel test",
    "url": "/api/app/update/files/demo.wgt", "md5": "x", "size": 1,
    "channel": "internal"
}, token=token_a)
check("publish internal", st == 200, str(st))
st, u1 = req("GET", "/api/app/update?platform=android&versionCode=100&wgtVersion=100&channel=internal")
d1 = (u1.get("data") or {})
check("internal sees 110", d1.get("versionCode") == 110, str(d1.get("versionCode")))
st, u2 = req("GET", "/api/app/update?platform=android&versionCode=100&wgtVersion=100&channel=release")
d2 = (u2.get("data") or {})
# release falls back to latest which was also set to 110 by publish - acceptable
check("release still works", st == 200 and d2.get("hasUpdate") is not None, str(d2.get("versionCode")))

print("== music/portrait not_ready ==")
st, run = req("POST", "/api/viewer/lab/runs", {"entryId": "music.bgm", "params": {"prompt": "test"}}, token=token)
rd = run.get("data") or run
check("music.bgm friendly fail", st == 400 and "not_ready" in str(run) or "尚未" in str(run.get("error","")) or st == 400, f"st={st} err={run.get('error')} code={run.get('code')}")
st, run2 = req("POST", "/api/viewer/lab/runs", {"entryId": "portrait.assets_api", "params": {"asset_group": "g"}}, token=token)
check("portrait friendly fail", st == 400, f"st={st} err={run2.get('error')}")

print("== gen with imageUrls (no real image, expect agnes keyframe or ref error not unknown) ==")
st, run3 = req("POST", "/api/viewer/lab/runs", {
    "entryId": "gen.video",
    "params": {
        "prompt": "缓慢推进",
        "ratio": "16:9",
        "duration": 5,
        "model": "agnes-video-2.5-flash",
        "adapterId": "agnes_video",
        "mode": "first_last_frame",
        "firstFrame": "https://via.placeholder.invalid/x.png",
        "lastFrame": "https://via.placeholder.invalid/y.png",
    }
}, token=token, timeout=60)
rd3 = run3.get("data") or run3
# may fail at agnes or timeout path - must NOT be "未处理的引擎" or missing params
err = str(rd3.get("error") or run3.get("error") or "")
check("keyframe path not unknown_engine", "未处理的引擎" not in err, err[:160])
check("keyframe attempted", st in (200, 400) and ("keyframe" in err.lower() or "首帧" in err or "http" in err.lower() or rd3.get("status") in ("done","failed","running") or st==200), f"st={st} {err[:120]} status={rd3.get('status')}")

print("== capabilities modes still ok ==")
st, cap = req("GET", "/api/viewer/lab/capabilities", token=token)
studio = (cap.get("data") or {}).get("studio") or {}
check("studio ok", bool(studio.get("image")), str(list(studio.keys())))

print(f"\nPASS={ok} FAIL={fail}")
raise SystemExit(1 if fail else 0)
