# Pack Studio 出包纪律（本次维修说明）

## 一句话

**打包永远用「当次编译」的产物；编译失败就如实报错并中止，绝不拿旧产物顶替。**

## 为什么修

2026-10-03 出现了一个很典型的故障：用户在 App 里看不到任何新功能（回收站入口、精修库、回顶按钮全部消失），
但打包日志里并没有明显报错。根因链条是：

1. `QuickModelPicker.vue` 的 import 路径写错（`../../common/jobModels` 应为 `../common/jobModels`）
   → `uni build` 失败。
2. 打包脚本没有检查编译退出码，失败被静默吞掉，继续往下走。
3. 压缩阶段从 4 个候选目录里「挑一个最好的」：
   `dist/build/app`、`dist/build/app-plus`、`unpackage/resources/__UNI__F183218/www`、`dist/dev/app-plus`。
   新产物不合格时，就挑到了几天前的历史目录。
4. 于是 09-21 的旧代码被打成 wgt 推给用户，App 里的新功能一个都看不到。

另外还发现 Pack Studio 自身有一个独立 bug：`rebuild-www` 用 `spawn(uni.cmd, ...)`，
而 Windows 上 Node **不能直接 spawn `.cmd`**（EINVAL），且该分支没有 `error` 兜底
→ 任务永久卡在「运行中」，一行日志都没有。

## 现在的做法

### 1. 隔离编译，源码只读

编译输入（`src/`、`uni_modules/`、`index.html`、`package.json`、`vite.config.js`）
**只读复制**到 `%TEMP%\pack-studio-fresh-build\<时间戳>\`，在隔离目录里跑 `uni build -p app`。
`node_modules` 用目录联接（junction）指回真实位置，不复制 400MB 依赖。

- 你的项目目录里**不会**被写入、清理、改名。
- 每次都是全新工作区，不存在「上次残留被当成这次产物」。

### 2. 四道闸门，任一不过即中止

| 闸门 | 检查内容 | 不通过的后果 |
|---|---|---|
| 退出码 | `exit code == 0` | 中止，打印编译器原始错误 |
| 新鲜度 | `app-service.js` 的 mtime 晚于编译开始时间 | 中止（防止编到别处 / 静默跳过） |
| 体积 | `> 50KB` | 中止（排除空壳、半成品） |
| 源码同源 | `home_library_tab` / `trash-src-bar` / `disposeSource` / `back-to-top` / `takeRemovals` 全部命中 | 中止，并列出缺哪些标识符 |
| 生产指纹 | 含 `<公网IP>`、无 `体验演示模式`、无 `versionTabs:versionTabs` | 中止 |
| 出包同源 | 解开 wgt 比对 `app-service.js` 的 **sha256** 与本次编译完全一致 | 中止，不推送 |

> 标识符一律用 **CSS 类名 / storage key / 业务文案**，
> 不用函数名 —— Vite/Rollup 会 mangle 函数名，正确产物里也搜不到，用它校验必然误报。

### 3. 没有「复用旧产物」开关

`skipBuild` / `useExisting` 参数已被彻底移除。即使请求里带上，也只会在日志里提示「已忽略」。
`/api/status` 的 `policy` 字段会明确告诉前端：

```json
{
  "alwaysFreshBuild": true,
  "isolatedBuild": true,
  "sourceReadOnly": true,
  "skipBuildSupported": false,
  "fallbackToOldArtifact": false
}
```

### 4. 失败时说人话

失败时日志会打成这样，而不是笼统一句「打包失败」：

```
  ╔══════════════════════════════════════════════════════╗
  ║  编译失败 · 已中止 · 不会使用旧产物打包             ║
  ╚══════════════════════════════════════════════════════╝
  原因: uni build 失败，exit=1

  ── 编译器原始错误 ──
  │ x Build failed in 2.12s
  │ Could not resolve "./__no_such_module__" from "src/components/HomeLibrary.vue"
  │ file: .../src/components/HomeLibrary.vue
  │ Build failed with errors.

  处理建议：按上面的报错修 src/ 里的代码，然后重新打包。
  绝不会发生的事：拿上一次的历史产物重新打包推给用户。
[流水线] 未产出任何 wgt，未推送任何内容。
```

## 文件说明

| 文件 | 作用 |
|---|---|
| `lib/fresh-build.js` | 隔离编译 + 产物闸门；`FAULT_INJECT` 环境变量可注入故障用于自测 |
| `lib/wgt-pipeline.js` | 四步流水线编排 + 纯 Node zip 压缩 |
| `lib/wgt-verify.js` | 纯 Node zip 读取器 + sha256 同源校验（不依赖外部解压工具） |
| `server.js` | 接入闸门、封死回退通道、修复 `rebuild-www` 的 EINVAL、给 PowerShell 补退出码兜底 |
| `index.html` | 新增「出包纪律」卡片 + 本次编译身份展示 + 失败原因弹窗 |
| `_backup_before_freshgate_20261003/` | 维修前的原始文件备份 |

## 自测脚本

```bash
node _verify_freshbuild.js    # 隔离编译 + 源码零改动
node _verify_failchain.js     # 编译失败：如实报错 + 零出包
node _verify_artifacts.js     # 出包同源：历史产物/残包一律拒绝
node _verify_e2e.js           # 端到端（需服务已启动）
node _verify_serve_fail.js    # 真实服务进程里的失败链路（需 FAULT_INJECT 启动）
```

`FAULT_INJECT` 只在隔离副本里注入错误，**永远不碰你的源码**。

## 保留的旧脚本

`AlbumSyncUniAppX/scripts/*.ps1` 未被删除，仍可从命令行直接用。
WGT 出包走的是新的受控流水线；APK 相关（云打包 / 离线打包）仍走原脚本，
但已强制去掉 `-SkipBuild` 透传。
