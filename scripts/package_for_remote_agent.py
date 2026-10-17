#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Package MaterialLibraryServer full system:
- Server (Backend on Port 30001, scripts, tests, skills, pack-studio)
- Web Client 1: web-admin (Port 30001, Vue 3 + Tailwind)
- Web Client 2: web-pro (Port 30002, Vue 3 + Vite)
- App Client 1: app-uniapp (UniApp / UniAppX album-sync / shell mobile client)
- App Client 2: app-harmony (HarmonyOS / ArkTS mobile sync client)
- 不打包 .env、密钥文件、账号文件或运行中的数据库
- Documentation (43KB full operation manual + remote agent executive guide)
"""

import os
import sys
import shutil
import sqlite3
import json
import zipfile
import time

WORKSPACE = '/mnt/c/Users/lrp/DevEcoStudioProjects/MaterialLibraryServer'
APP_UNIAPP_DIR = '/mnt/c/Users/lrp/g9-eval-work/shell'
OUTPUT_ZIP = os.path.join(WORKSPACE, 'material-library-full-codebase.zip')
STAGING_DIR = '/tmp/_unified_package_mls'
DSH_DIR = os.path.expanduser('~/.dsh-material-library')

def clean_staging():
    if os.path.exists(STAGING_DIR):
        shutil.rmtree(STAGING_DIR)
    os.makedirs(STAGING_DIR, exist_ok=True)

def dump_database_and_credentials(staging_root):
    note = os.path.join(staging_root, 'CREDENTIALS_NOT_INCLUDED.txt')
    with open(note, 'w', encoding='utf-8') as fh:
        fh.write('供应商钥匙只放在服务器本机的 .env，不进入压缩包。\n')
        fh.write('不要打包 .env、providers-secrets.json、material.db 或账号文件。\n')

def create_remote_agent_readme(staging_root):
    readme_path = os.path.join(staging_root, 'README_FOR_REMOTE_AGENT.md')
    with open(readme_path, 'w', encoding='utf-8') as f:
        f.write("""# 素材库综合系统代码全量归档包 (Server + Web Clients + App Clients + Governance + Secrets)
**专供远端 AI Agent 深度分析与理解全系统架构**

本压缩包已将整个素材库系统的 **服务端**、**两大 Web 客户端**、**两大 App 移动端（UniApp 主端 + HarmonyOS 鸿蒙端）**、**大模型提示词治理引擎** 以及 **全部敏感凭据与 SQLite 数据库** 进行了全量整合打包。

---

## 一、系统全景拓扑图

```
material-library-full-codebase/
├── README_FOR_REMOTE_AGENT.md          # 本全局架构导读指南
├── 素材库业务执行与系统治理全流程说明文档.md  # 43KB 全流程业务与治理操作手册 (必读!)
├── AGENT_RULES.md, CONTEXT.md, README.md
│
├── server/                              # 【服务端核心】(Node.js / Express, 端口 30001)
│   ├── src/                             # 后端代码核心
│   │   ├── models-contract.js           # 大模型契约治理 (Vendor, Capabilities, Schema, Mutex)
│   │   ├── gen-governance.js            # 供应商/模型/提示词/工作流治理 CRUD
│   │   ├── providers.js                 # 各厂商模型适配器 (Agnes, Gemini, Ark, Groq, LiteLLM)
│   │   ├── handlers/                    # 流水线算子 (门禁、质检、打标、精准编辑、风格重构等)
│   │   ├── runtime-config.js            # 密钥与配置热重载
│   │   └── database/ & db.js            # 数据库访问层
│   ├── server.js, index.js, start.sh    # 服务启动入口
│   ├── package.json, .env.example       # 依赖与空的环境变量示例（不含钥匙）
│   ├── scripts/                         # 134 个运维、同步与诊断脚本
│   ├── skills/                          # 提示词工程专家规则 (media-prompt-skills)
│   ├── test/                            # 自动化测试与契约测试集
│   ├── pack-studio/                     # 移动端差量 WGT 打包与 ADB 调试套件
│   ├── service-hub/                     # 微服务协调中枢
│   └── data/                            # 示例数据、预览及更新清单
│
├── clients/                             # 【双端客户端矩阵: 2 个 Web 端 + 2 个 App 端】
│   ├── web-admin/                       # 【Web 客户端 1: 治理控制台】(Port 30001, Vue 3 + Tailwind)
│   │   ├── src/views/ModelsView.vue     # 四合一治理控制台 (供应商模型 / 模型契约 / 提示词 / 工作流)
│   │   ├── src/views/WorkbenchView.vue  # 工作台视图
│   │   └── package.json, vite.config.js
│   │
│   ├── web-pro/                         # 【Web 客户端 2: 专业工作台】(Port 30002, Vue 3 + Vite)
│   │   ├── src/views/LibraryView.vue    # 素材海量资产检索、多维筛选、标签治理、批处理
│   │   ├── src/views/studio/            # 3D 渲染与场景重构 Studio
│   │   ├── server.cjs                   # 30002 前端服务与反代
│   │   └── package.json, vite.config.js
│   │
│   ├── app-uniapp/                      # 【App 移动端 1: 主力移动客户端】(UniApp / UniAppX, album-sync)
│   │   ├── src/pages/browse/            # 素材浏览页 (一级分类下拉、12色色板过滤、多维筛选)
│   │   ├── src/pages/chat/              # AI 创作对话页 (顶栏模型切换、图文芯片混排、一键优化提示词)
│   │   ├── src/pages/edit/              # 精准单品编辑 (TouchSelector 点选/画框/四点/多选合并、六大操作)
│   │   ├── src/pages/home/              # 移动端首页与相册同步
│   │   ├── src/pages/permission/        # 权限向导
│   │   ├── src/pages/quick/             # 快捷功能 (enhance, expand, insert, remove, replace, watermark)
│   │   ├── src/service/ViewerApi.js     # 移动端统一鉴权与服务端 API 对齐层
│   │   ├── src/service/AiTaskManager.js # 移动端 AI 任务管理器
│   │   ├── src/components/              # TouchSelector, HomeLibrary, GlbAdjuster
│   │   ├── package.json, pages.json, manifest.json
│   │   └── AGENT_RULES.md               # 移动端交互原则与契约对齐规范
│   │
│   └── app-harmony/                     # 【App 移动端 2: 华为鸿蒙原生客户端】(ArkTS, DevEco Studio)
│       ├── entry/src/main/ets/          # EntryAbility, Index, GalleryPicker, Api 鸿蒙原生代码
│       └── build-profile.json5, hvigorfile.ts
│
└── CREDENTIALS_NOT_INCLUDED.txt         # 钥匙只在本机 .env，压缩包里没有
```

---

## 二、端与端之间的交互与对齐机制

1. **App 移动端 (`clients/app-uniapp`) 与服务端 (`server`) 的契约对齐**:
   - 移动端通过 `ViewerApi.js` 连接服务端 `30001` 端口；
   - 菜单分类树对齐：`GET /api/viewer/dict/menu-tree` 动态拉取服务端统一分类；
   - 提示词优化对齐：在 `pages/chat/chat.vue` 点击【✨ 优化提示词】调用服务端专属 Skill 扩写；
   - 精准编辑对齐：`pages/edit/edit.vue` 使用 `TouchSelector` 生成点选/蒙版后，调用服务端 `precision-edit` 算子；
   - 差量热更新对齐：通过 `server/pack-studio` 打包 WGT 并通过 `AppUpdater.js` 接收热更新。

2. **Web 治理端 (`clients/web-admin`) 对大模型与工作流的全局治理**:
   - 在 `web/src/views/ModelsView.vue` 中对四大核心概念进行可视化增删改查：
     1. **供应商与模型**: 维护 Agnes, Gemini, 火山引擎 Ark 等厂商及模型列表与密钥；
     2. **模型契约**: 为模型挂载结构化参数规范、互斥组校验与动态 Schema；
     3. **提示词模板**: 管理室内门禁（`gate_interior`）、AI质检（`defect_inspection`）、空间打标（`tag_space_interior`）、精准修改（`precision_*`）及画幅重构（`style_restage_dual`）等提示词；
     4. **模块化工作流**: 定义挂载点与执行模块的拓扑调用关系。

3. **Web 专业工作台 (`clients/web-pro`) 对海量资产的沉淀与利用**:
   - 在 `web-pro/src/views/LibraryView.vue` 依托服务端打标与色彩数据，支持百级标签的高性能切片与 3D Studio 场景合成。

---

## 三、快速开始与运行

```bash
# 1. 启动服务端
cd server
npm install
./start.sh   # 运行于 30001 端口

# 2. 启动治理 Web 端 (开发模式)
cd clients/web-admin
npm install
npm run dev

# 3. 启动专业工作台 Web 端
cd clients/web-pro
npm install
node server.cjs  # 运行于 30002 端口

# 4. 运行 App 移动端 (UniApp H5 / App)
cd clients/app-uniapp
npm install
npm run dev:h5   # 或在 HBuilderX 中点击“运行到手机或模拟器”
```
""")

def copy_server(staging_root):
    server_dir = os.path.join(staging_root, 'server')
    os.makedirs(server_dir, exist_ok=True)

    root_files = [
        '.env.example',
        'package.json',
        'package-lock.json',
        'server.js',
        'index.js',
        'start.sh',
        'dsh-plugin.json',
        'cordis.patch.yml',
        'android-so-guide.html',
        'local-infer-demo.html',
        '启动素材库.bat',
        '停止素材库.bat',
        '启动服务面板.bat',
        '查看状态.bat',
        '_audit_gen_models.js',
        '_audit_gen_models.py',
        '_strip_dup.js',
        '_build_sqlite_for_node24.js',
        '_test_ark_seedream.js',
        '_test_chat_context.js',
        '_test_extract_json.js',
        '_test_maskBuilder.js',
        '_test_prompt_validate.js',
        '_test_region_route.js',
        'query_compare.py',
        'query_deep.py',
        'query_inspect.py',
        'query_kv.js',
        'query_tasks.js',
        'patch_mls.js',
        'test_crop.py',
        'test_submit.js'
    ]

    for rf in root_files:
        src = os.path.join(WORKSPACE, rf)
        if os.path.exists(src):
            shutil.copy2(src, os.path.join(server_dir, rf))

    server_dirs = [
        'src',
        'scripts',
        'docs',
        'test',
        'skills',
        'service-hub'
    ]

    for d in server_dirs:
        src_d = os.path.join(WORKSPACE, d)
        dst_d = os.path.join(server_dir, d)
        if os.path.exists(src_d):
            print(f"Copying server/{d}...")
            shutil.copytree(src_d, dst_d, ignore=shutil.ignore_patterns(
                '__pycache__', '*.pyc', '.DS_Store', 'node_modules', '*.log', '*.pid'
            ))

    # Copy pack-studio excluding node_modules, _shots, zip4j-build, *.apk
    if os.path.exists(os.path.join(WORKSPACE, 'pack-studio')):
        print("Copying server/pack-studio/...")
        shutil.copytree(
            os.path.join(WORKSPACE, 'pack-studio'),
            os.path.join(server_dir, 'pack-studio'),
            ignore=shutil.ignore_patterns(
                'node_modules', '_shots', 'zip4j-build', '*.apk', '*.idsig'
            )
        )

    # Copy data directory (excluding heavy binary weights)
    print("Copying server/data/...")
    os.makedirs(os.path.join(server_dir, 'data'), exist_ok=True)
    if os.path.exists(os.path.join(WORKSPACE, 'data', 'app-update')):
        shutil.copytree(os.path.join(WORKSPACE, 'data', 'app-update'), os.path.join(server_dir, 'data', 'app-update'))
    if os.path.exists(os.path.join(WORKSPACE, 'data', 'previews')):
        shutil.copytree(os.path.join(WORKSPACE, 'data', 'previews'), os.path.join(server_dir, 'data', 'previews'))
    with open(os.path.join(server_dir, 'data', 'README_MODELS.md'), 'w', encoding='utf-8') as f:
        f.write("# 本地深度学习权重文件说明\n`data/local-models/` 和 `data/models/` 存放了 RealESRGAN 和 EdgeSAM 的 onnx/pth 权重文件，体积约 350MB，为保证代码分析包体积便携已剔除二进制模型权重。\n")

def copy_clients(staging_root):
    clients_dir = os.path.join(staging_root, 'clients')
    os.makedirs(clients_dir, exist_ok=True)

    # 1. Web Client 1: web-admin (Port 30001)
    print("Copying clients/web-admin/ (Port 30001)...")
    shutil.copytree(
        os.path.join(WORKSPACE, 'web'),
        os.path.join(clients_dir, 'web-admin'),
        ignore=shutil.ignore_patterns('node_modules', '.cache', '.vite')
    )

    # 2. Web Client 2: web-pro (Port 30002)
    print("Copying clients/web-pro/ (Port 30002)...")
    shutil.copytree(
        os.path.join(WORKSPACE, 'web-pro'),
        os.path.join(clients_dir, 'web-pro'),
        ignore=shutil.ignore_patterns(
            'node_modules', 'dist', '*.glb', 'sample-video.mp4', '.cache', '.vite'
        )
    )
    with open(os.path.join(clients_dir, 'web-pro', 'public', 'README_ASSETS.md'), 'w', encoding='utf-8') as f:
        f.write("# 3D 资产说明\n原始 assets-3d/ 与 models/ 下存放了 3 份各 74MB 的 sofa glb 3D模型文件，为避免远程 Agent 上传受限已在源码包中忽略二进制模型。\n")

    # 3. App Client 1: app-uniapp (from g9-eval-work/shell)
    print(f"Copying clients/app-uniapp/ (from {APP_UNIAPP_DIR})...")
    shutil.copytree(
        APP_UNIAPP_DIR,
        os.path.join(clients_dir, 'app-uniapp'),
        ignore=shutil.ignore_patterns('node_modules', 'dist', '.git', '.cache')
    )

    # 4. App Client 2: app-harmony (from harmony/material_sync)
    harmony_src = os.path.join(WORKSPACE, 'harmony', 'material_sync')
    if os.path.exists(harmony_src):
        print("Copying clients/app-harmony/...")
        shutil.copytree(
            harmony_src,
            os.path.join(clients_dir, 'app-harmony'),
            ignore=shutil.ignore_patterns('node_modules', '.hvigor', 'build', '.preview')
        )

def copy_root_docs(staging_root):
    docs = [
        '素材库业务执行与系统治理全流程说明文档.md',
        'AGENT_RULES.md',
        'CONTEXT.md',
        'README.md'
    ]
    for doc in docs:
        src = os.path.join(WORKSPACE, doc)
        if os.path.exists(src):
            shutil.copy2(src, os.path.join(staging_root, doc))

def create_zip_archive():
    print(f"\nCompressing staging directory to {OUTPUT_ZIP}...")
    t0 = time.time()
    file_count = 0
    with zipfile.ZipFile(OUTPUT_ZIP, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        for root, dirs, files in os.walk(STAGING_DIR):
            for file in files:
                abs_path = os.path.join(root, file)
                rel_path = os.path.relpath(abs_path, STAGING_DIR)
                zf.write(abs_path, arcname=rel_path)
                file_count += 1
                if file_count % 100 == 0:
                    print(f"  Packed {file_count} files...")

    duration = round(time.time() - t0, 2)
    zip_size_mb = round(os.path.getsize(OUTPUT_ZIP) / (1024 * 1024), 2)
    print(f"\nSuccessfully generated {OUTPUT_ZIP}")
    print(f"Total files: {file_count}")
    print(f"Archive size: {zip_size_mb} MB")
    print(f"Time taken: {duration} s")

if __name__ == '__main__':
    print("=== Material Library Full System Packaging (Server + Web + App + Secrets) ===")
    clean_staging()
    dump_database_and_credentials(STAGING_DIR)
    create_remote_agent_readme(STAGING_DIR)
    copy_root_docs(STAGING_DIR)
    copy_server(STAGING_DIR)
    copy_clients(STAGING_DIR)
    create_zip_archive()
    clean_staging()
    print("=== Finished Successfully ===")
