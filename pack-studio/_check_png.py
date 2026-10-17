from PIL import Image
import os
p = r"C:\Users\lrp\AppData\Local\Temp\ps-raw-pull.png"
print("size", os.path.getsize(p))
with open(p, "rb") as f:
    b = f.read(16)
print("head", b.hex())
try:
    im = Image.open(p)
    im.load()
    print("PIL OK", im.size, im.mode)
    im.save(r"C:\Users\lrp\AppData\Local\Temp\ps-view.png")
except Exception as e:
    print("PIL FAIL", type(e), e)
    data = open(p, "rb").read()
    print("len", len(data), "crlf", data.count(b"\r\n"), "sig", data[:8].hex())
    # try fix all CRLF -> LF
    fixed = data.replace(b"\r\n", b"\n")
    p2 = r"C:\Users\lrp\AppData\Local\Temp\ps-raw-pull-fix.png"
    open(p2, "wb").write(fixed)
    print("fixed len", len(fixed))
    try:
        im = Image.open(p2)
        im.load()
        print("FIXED OK", im.size)
        im.save(r"C:\Users\lrp\AppData\Local\Temp\ps-view.png")
    except Exception as e2:
        print("FIXED FAIL", e2)
