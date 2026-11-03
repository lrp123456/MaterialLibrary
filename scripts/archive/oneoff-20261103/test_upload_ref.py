import os
import json, urllib.request, os

BASE = "http://127.0.0.1:30001"
# login
r = urllib.request.Request(BASE+"/api/auth/login", data=json.dumps({"username":os.environ["ML_USER"],"password":os.environ["ML_PASS"]}).encode(), headers={"Content-Type":"application/json"}, method="POST")
with urllib.request.urlopen(r, timeout=15) as resp:
    token = json.loads(resp.read().decode())["data"]["token"]

# tiny png
png = bytes.fromhex("89504e470da10a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082")
boundary = "----WebKitFormBoundary7MA4YWxkTrZu0gW"
body = (
    f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"t.png\"\r\nContent-Type: image/png\r\n\r\n".encode()
    + png
    + f"\r\n--{boundary}--\r\n".encode()
)
req = urllib.request.Request(
    BASE+"/api/viewer/ai/upload",
    data=body,
    headers={"Content-Type": f"multipart/form-data; boundary={boundary}", "Authorization": "Bearer "+token},
    method="POST",
)
with urllib.request.urlopen(req, timeout=20) as resp:
    print(resp.status, resp.read().decode()[:300])
