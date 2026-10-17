import os
import json, urllib.request

BASE = "http://127.0.0.1:30001"

def req(method, path, body=None, token=None, timeout=180):
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
            return e.code, {"raw": raw[:500]}
    except Exception as e:
        return 0, {"error": str(e)}

st, login = req("POST", "/api/auth/login", {"username": os.environ["ML_USER"], "password": os.environ["ML_PASS"]})
token = (login.get("data") or {}).get("token")

print("== capabilities ==")
st, cap = req("GET", "/api/viewer/lab/capabilities", token=token)
studio = (cap.get("data") or {}).get("studio") or {}
img = studio.get("image") or {}
vid = studio.get("video") or {}
print("image models:")
for m in img.get("models") or []:
    print(" ", m.get("id"), "->", m.get("adapterId"), "default", m.get("default"))
print("video models:")
for m in vid.get("models") or []:
    print(" ", m.get("id"), "->", m.get("adapterId"), "default", m.get("default"))

print("== gen.video submit ==")
st, run = req(
    "POST",
    "/api/viewer/lab/runs",
    {
        "entryId": "gen.video",
        "params": {
            "prompt": "现代客厅镜头缓慢向前推进，光影自然位移，电影感运镜",
            "ratio": "16:9",
            "duration": 5,
            "model": "agnes-video-2.5-flash",
            "mode": "text_to_video",
        },
    },
    token=token,
    timeout=300,
)
print("status", st)
rd = run.get("data") or run
print("engine", rd.get("engine"), "status", rd.get("status"), "mode", rd.get("mode"))
res = rd.get("result") or {}
print("preview", res.get("previewUrl"), "error", res.get("error"), "taskId", res.get("taskId"))
if rd.get("engine") == "gen" and rd.get("runId") and rd.get("status") not in ("done", "failed"):
    # sync path usually waits; if async poll path exists
    print("full", json.dumps(rd, ensure_ascii=False)[:400])
