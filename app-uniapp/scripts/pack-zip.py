from pathlib import Path
import zipfile

root = Path(__file__).resolve().parents[1]
pkg = root / "upload-package"
loop = (pkg / "00-LOOP.md").read_text(encoding="utf-8")
header = (
    "# 入口提示词（zip 外 · 初始任务指令）\n\n"
    "> 用法：解压 `upload-package.zip` 到工作区，将**本文件全文**作为初始任务交给受测模型。\n"
    "> 本文件是总控框架；工作区内的 `chapters/`、`CONTRACTS.md`、`docs/`、`reference/` 是执行材料。\n"
    "> 若模型工作区支持放置文件，请将本文件另存为工作区根目录 `00-LOOP.md`，以便章节内引用。\n\n"
    "---\n\n"
)
out = root / "入口提示词.md"
out.write_text(header + loop, encoding="utf-8")
print("entry", out, "bytes", out.stat().st_size)

for p in pkg.rglob("*TOOLCALL*"):
    p.unlink()
for p in pkg.rglob("*ESTIMATE*"):
    if p.is_file():
        p.unlink()

zpath = root / "upload-package.zip"
if zpath.exists():
    zpath.unlink()
count = 0
with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as z:
    for p in sorted(pkg.rglob("*")):
        if p.is_file():
            z.write(p, p.relative_to(pkg).as_posix())
            count += 1
print("zip", zpath, "bytes", zpath.stat().st_size, "files", count)
