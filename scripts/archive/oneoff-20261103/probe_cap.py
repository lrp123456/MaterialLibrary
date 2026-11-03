import os
import json, urllib.request, urllib.error
BASE = "http://127.0.0.1:30001"

def req(method, path, body=None, token=None):
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json"}
    if token: headers["Authorization"] = "Bearer " + token
    r = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode())
    except Exception as e:
        return 0, {"error": str(e)}

st, login = req("POST", "/api/auth/login", {"username": os.environ["ML_USER"], "password": os.environ["ML_PASS"]})
token = (login.get("data") or {}).get("token")
st, cap = req("GET", "/api/viewer/lab/capabilities", token=token)
print("status", st)
print(json.dumps(cap, ensure_ascii=False)[:2000])
