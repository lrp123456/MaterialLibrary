#!/usr/bin/env python3
"""Build upload-package: full server+client, strip AI capability and web (H5) client.

ONLY writes under upload-package/. Never deletes outside that folder.
"""
from __future__ import annotations

import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SERVER_ROOT = Path(r"C:\Users\lrp\DevEcoStudioProjects\MaterialLibraryServer")
EVAL = ROOT / "eval-package"
OUT = ROOT / "upload-package"
NEWCHAT = Path(r"C:\Users\lrp\Doubao\chats\2026-09-04\new-chat")

SERVER_DROP = {
    "ai-tasks.js", "doubao-music.js", "gen-governance.js", "lab.js",
    "polish-prompts.js", "portrait-contract.js", "portrait-library.js",
    "umbra.js", "vlm.js", "model-schemas.js", "studio-catalog.js",
    "providers.js", "volc-openapi.js", "skill-loader.js", "interpreter.js",
}
CLIENT_DROP = {"PromptStudio.js", "ModelCatalog.js", "ModelSchemas.js"}
WEB_DROP_DIR = "pages-h5"


def copy_tree(src: Path, dst: Path, drop_files: set[str], drop_dir_names: set[str] | None = None) -> int:
    drop_dir_names = drop_dir_names or set()
    n = 0
    if not src.exists():
        print("missing", src)
        return n
    for p in src.rglob("*"):
        rel = p.relative_to(src)
        if rel.parts and rel.parts[0] in drop_dir_names:
            continue
        if any(part in drop_dir_names for part in rel.parts[:-1]):
            continue
        if p.name in drop_files:
            continue
        target = dst / rel
        if p.is_dir():
            target.mkdir(parents=True, exist_ok=True)
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(p, target)
        n += 1
    return n


def neutralize_api(text: str) -> str:
    keys = (
        "ai-tasks", "doubao-music", "gen-governance", "polish-prompts",
        "portrait-library", "portrait-contract", "umbra", "vlm",
        "model-schemas", "studio-catalog", "providers", "volc-openapi",
        "lab.js", "require('./lab", 'require("./lab',
    )
    out = []
    for line in text.splitlines(keepends=True):
        low = line.lower()
        if any(k in low for k in keys):
            out.append("// " + line.rstrip() + "\n")
        else:
            out.append(line)
    return "".join(out)


def main() -> None:
    if OUT.exists():
        # only clear inside OUT
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)

    for name in ("00-LOOP.md", "CONTRACTS.md", "PACKING.md", ".env.example", "AGENTS.md"):
        p = EVAL / name
        if not p.exists():
            p = ROOT / name
        if p.exists():
            shutil.copy2(p, OUT / name)
    for sub in ("chapters", "docs", "reference", "contracts"):
        s = EVAL / sub
        if s.exists():
            shutil.copytree(s, OUT / sub)

    # merged prompt into package as reference
    merged = ROOT / "众测-首轮Prompt.txt"
    if merged.exists():
        shutil.copy2(merged, OUT / "00-TASK.txt")

    # ---- server (complete minus AI) ----
    n1 = copy_tree(SERVER_ROOT / "src", OUT / "app" / "server" / "src", SERVER_DROP, {"gen"})
    for name in (
        "package.json", "package-lock.json", "index.js", "server.js",
        "start.sh", "README.md", "metadata.db",
    ):
        p = SERVER_ROOT / name
        if p.exists():
            shutil.copy2(p, OUT / "app" / "server" / name)
    api = OUT / "app" / "server" / "src" / "api.js"
    if api.exists():
        api.write_text(neutralize_api(api.read_text(encoding="utf-8", errors="replace")), encoding="utf-8")

    # ---- client App only (drop H5 + AI services) ----
    src_client = ROOT / "src"
    n2 = copy_tree(src_client, OUT / "app" / "client", CLIENT_DROP, {WEB_DROP_DIR})
    # also drop any h5-only leftover files by name
    for p in list((OUT / "app" / "client").rglob("*h5*")):
        if p.is_file() and "pages-h5" in str(p):
            p.unlink()

    for name in ("package.json", "vite.config.js", "index.html", "uni.scss", "manifest.json"):
        # project root package for uni-app
        p = ROOT / name
        if p.exists() and name == "package.json":
            shutil.copy2(p, OUT / "app" / "package.json")

    # ---- reference new-chat ----
    nref = OUT / "reference" / "new-chat"
    nref.mkdir(parents=True, exist_ok=True)
    for name in ("backend_server.py", "PROMPT_SUITE.md", "PROJECT_CAPABILITIES.md",
                 "CAPABILITY_SUMMARY.md", "SYSTEM_CAPABILITIES.md"):
        p = NEWCHAT / name
        if p.exists():
            shutil.copy2(p, nref / name)
    for p in NEWCHAT.glob("prompt-*.txt"):
        shutil.copy2(p, nref / p.name)

    (OUT / "RUN.md").write_text(
        """# RUN

## 端说明
- **交付端：Android APK（uni-app App）**
- 客户端在 `app/client/`（或工程 `src/`），**勿改 `pages-h5`（已剥离，不要恢复网页端）**
- 服务端在 `app/server/`

## 服务端
```bash
cd app/server
npm install
node server.js
```
端口/数据目录见 `.env`（`ML_PORT`、`ML_DATA_DIR`）。

## App（uni-app）
```bash
cd app
npm install
npm run dev:app    # 或 HBuilderX / 离线打包 android-offline
```
验收以 APK 安装到模拟器/真机为准。

## 分割
`YOLO_SEG_URL` 指向实例分割服务，不要在本机重造模型。
""",
        encoding="utf-8",
    )

    (OUT / "app" / "README.md").write_text(
        """# 产品基线（App + 服务端）

- 保留：登录鉴权、素材浏览/筛选/详情/下载、媒体取图、字典统计、存储
- 已去掉：AI 生成/对话/编辑/检测路由与 PromptStudio 等、以及 **Web/H5 客户端**
- 请在 **App 端** 按 `../CONTRACTS.md` 与 `../chapters/` 实现新能力
""",
        encoding="utf-8",
    )

    # zip
    zpath = ROOT / "upload-package.zip"
    if zpath.exists():
        zpath.unlink()
    import zipfile
    count = 0
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as z:
        for p in sorted(OUT.rglob("*")):
            if p.is_file():
                z.write(p, p.relative_to(OUT).as_posix())
                count += 1
    print(f"done server_files~{n1} client_files~{n2} zip_files={count} out={OUT}")
    print("zip", zpath, zpath.stat().st_size)


if __name__ == "__main__":
    main()
