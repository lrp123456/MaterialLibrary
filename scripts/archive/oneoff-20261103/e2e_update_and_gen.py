import os
import json, urllib.request, urllib.parse, os, ssl

BASE = "http://127.0.0.1:30001"

def req(method, path, body=None, token=None, timeout=30):
    url = BASE + path
    data = None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    if body is not None:
        data = json.dumps(body).encode()
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

print("== health ==")
print(req("GET", "/api/health"))

print("== app/update no auth ==")
print(req("GET", "/api/app/update?platform=android&versionCode=100&wgtVersion=100"))

print("== login ==")
st, login = req("POST", "/api/auth/login", {"username": os.environ["ML_USER"], "password": os.environ["ML_PASS"]})
print(st, {k: login.get(k) for k in ("success",)} )
token = (login.get("data") or {}).get("token")
print("token?", bool(token))

print("== capabilities studio ==")
st, cap = req("GET", "/api/viewer/lab/capabilities", token=token)
data = cap.get("data") or {}
studio = data.get("studio") or {}
print("status", st, "hasStudio", bool(studio))
if studio:
    img = studio.get("image") or {}
    vid = studio.get("video") or {}
    print("image.ready", img.get("ready"), "models", [(m.get("id"), m.get("type"), m.get("adapterId")) for m in img.get("models") or []])
    print("video.ready", vid.get("ready"), "models", [(m.get("id"), m.get("type"), m.get("adapterId")) for m in vid.get("models") or []])

print("== submit gen.image ==")
st, run = req(
    "POST",
    "/api/viewer/lab/runs",
    {
        "entryId": "gen.image",
        "params": {
            "prompt": "日式侘寂茶室，微水泥墙面，柔和侧光，高细节室内效果图",
            "ratio": "9:16",
            "model": "agnes-image-2.5-flash",
            "mode": "text_to_image",
        },
    },
    token=token,
    timeout=180,
)
print("status", st)
rd = run.get("data") or run
print("engine", rd.get("engine"), "status", rd.get("status"), "runId", rd.get("runId"))
res = rd.get("result") or {}
print("preview", res.get("previewUrl"), "error", res.get("error"))

print("== publish wgt metadata then check ==")
st, pub = req(
    "POST",
    "/api/app/update",
    {
        "versionCode": 101,
        "versionName": "1.0.1",
        "wgtVersion": "101",
        "type": "wgt",
        "force": False,
        "note": "测试热更新：三区 AI 工坊 + 模型目录",
        "url": "/api/app-update/files/demo.wgt",
        "md5": "demo",
        "size": 12,
    },
)
# need admin for publish
print("publish as no-auth", st, pub)

st, login_a = req("POST", "/api/auth/login", {"username": os.environ["ML_USER"], "password": os.environ["ML_PASS"]})
token_a = (login_a.get("data") or {}).get("token")
st, pub = req(
    "POST",
    "/api/app/update",
    {
        "versionCode": 101,
        "versionName": "1.0.1",
        "wgtVersion": "101",
        "type": "wgt",
        "force": False,
        "note": "测试热更新：三区 AI 工坊 + 模型目录",
        "url": "/api/app-update/files/demo.wgt",
        "md5": "demo",
        "size": 12,
    },
    token=token_a,
)
print("publish admin", st, (pub.get("data") or {}).get("latest"))

print("== check update after publish ==")
print(req("GET", "/api/app/update?platform=android&versionCode=100&wgtVersion=100"))

# also test via viewer prefix
print("== viewer prefix update ==")
print(req("GET", "/api/viewer/app/update?platform=android&versionCode=100&wgtVersion=100"))
