import sys
sys.exit('供应商钥匙只在项目 .env，这个脚本已停用')
import json, os, urllib.request

home = os.path.expanduser("~")
sec = json.load(open(os.path.join(home, ".dsh-material-library", "providers-secrets.json")))
key = sec["agnes"]["api_key"]

req = urllib.request.Request(
    "https://apihub.agnes-ai.com/v1/images/generations",
    data=json.dumps({
        "model": "agnes-image-2.5-flash",
        "prompt": "现代极简客厅室内设计效果图，自然光，干净构图，高细节",
        "size": "1K",
        "ratio": "9:16",
        "extra_body": {"response_format": "url"},
    }).encode(),
    headers={
        "Authorization": "Bearer " + key,
        "Content-Type": "application/json",
    },
    method="POST",
)
try:
    with urllib.request.urlopen(req, timeout=120) as resp:
        body = resp.read().decode()
        print("STATUS", resp.status)
        data = json.loads(body)
        print("created", data.get("created"))
        item = (data.get("data") or [{}])[0]
        print("url", (item.get("url") or "")[:120])
        print("has_b64", bool(item.get("b64_json")))
except Exception as e:
    if hasattr(e, "read"):
        print("ERR", e, e.read().decode()[:500])
    else:
        print("ERR", type(e).__name__, e)
