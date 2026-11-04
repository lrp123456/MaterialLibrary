# app-uniapp 打包说明（素材库 · 仓内自包含）

> 2026-11-04 起，打包工具链全部收入本仓 `app-uniapp/`，
> 与仓外 `AlbumSyncUniAppX` / `AlbumSyncUniApp` 再无任何代码、脚本、软链依赖。
> **删除仓外工程不影响本项目任何打包能力。**

## 自包含边界

**仓库内（随 git 走）：**

- `scripts/`：全部打包脚本（PS1 / Node / Python）
- `android-offline/`：DCloud 离线 APK Gradle 工程（含 26 个 AAR、uni-local-infer.jar、双 ABI .so、res、assets/data）
- `nativeplugins/uni-local-infer/` 与 `uni_modules/uni-local-infer/`：端侧推理原生插件（实体文件，非 junction）
- `node_modules/`：不入库，`npm ci` 可复现（约 740 包）

**仓库外（机器级工具，非项目代码，换机时装一遍即可）：**

| 工具 | 配置项（`offline-config.json`） |
|------|------|
| HBuilderX 自带 JDK（amazon-corretto） | `javaHome` |
| Android SDK | `androidSdkRoot` |
| Gradle 8.9 | `gradleBin` |
| HBuilderX CLI | `hbx` |
| DCloud Android 离线 SDK 解压目录 | `offlineSdkExtractDir` |

`import-offline-sdk.ps1` 每次打包前从离线 SDK 目录把 AAR / jar / .so / assets 同步进
`android-offline/`（入库副本即来自该同步，目录在不在都不影响已入库工程，只影响"修复性重导"）。

**运行数据（不入库，打包时按配置拷入）：** 端侧模型取自服务仓 `data/local-models`。

## 推荐入口

图形入口：pack-studio 工作台（`http://127.0.0.1:3789`），按钮与动作：

| 动作 | 说明 |
|------|------|
| `pack-wgt` / `pack-and-push-wgt` | WGT 热更包（Node 流水线，版本由 `pack-studio/state/wgt-version.json` 分配） |
| `pack-offline-apk`（UI：offline-apk-install） | 离线 APK 完整打包，可选装机 |
| `pack-and-push-offline-apk` | 离线 APK 打包后推送更新通道 |
| `quick-install` / `cloud-apk-install` | adb 安装已有产物 / 云手机安装 |
| `offline-status` | 打包环境体检 |

命令行等价入口（在 `app-uniapp/` 下执行）：

```powershell
# 只打 APK（base 模式 + 强制重编）
.\scripts\pack-latest.ps1

# 打 APK 并安装到设备
.\scripts\pack-latest.ps1 -Install
.\scripts\pack-latest.ps1 -Install -Serial 127.0.0.1:21503

# pack-studio「灰度测试模式」实际调用：
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\pack-offline-apk.ps1 -NoPrompt
```

## 版本号规则（重要）

- `buildCode = versionCode × 10000 + machineCode`
- **🧪 灰度测试默认机号 +1**（`-BumpVersion` 不传）：版本名仍是 `1.0.5`，
  装机后**可以继续接收同版本 WGT 热更**（如 canary 2050011）。
- **「版本号 +1」会把 versionCode 进位并清零机号**（如 1.0.5 → 1.0.6/2060000），
  该机将无法再收到 1.0.5 的 WGT 灰度包。仅在确实要抬版本名时使用。
- WGT 与 PS1 是两套分配器：WGT 走 `pack-studio/state/wgt-version.json`；
  PS1 走 `scripts/version-bump.ps1` 写 `src/version-state.json`。

## 行为保证

1. **每次完整执行 `uni build -p app`**（除非显式 `-SkipBuild`，仅 `pack-offline-apk.ps1` 支持）
2. 产物 `dist\build\app` **整体覆盖** `android-offline\...\assets\apps\__UNI__F183218\www`
3. **不永久改写源码**：`Constants.js` / `manifest.json` 打包前快照（`.pack-bak`），结束后还原
4. **不从 `src_backup` 回滚覆盖 `src`**（base 模式直接用当前工作区）
5. **源码完整性闸门**：检测到反编译/空壳 SFC（`*-stub`、占位标记等）拒绝打包

## 完整流程（pack-offline-apk.ps1）

1. `version-bump.ps1` 分配 buildCode
2. `import-offline-sdk.ps1` 同步 SDK 26 个 AAR / 数据 / res 与 uni-local-infer
3. 并发锁 `dist/run/pack.lock`（30 分钟）
4. 源码完整性检查；base 模式使用当前 `src`
5. 快照并改写端口/应用名 → **`uni build -p app`** → 同步 www → **还原快照**
6. Gradle `assembleRelease --no-daemon`
7. 输出 `dist\release\apk\album-sync-offline-*.apk`
8. 可选 adb 安装（`-Install -Serial <device>`）

## 配置

`scripts/offline-config.json`：所有项目路径均为**仓内相对解析后的绝对路径**；
机器级工具路径（SDK / JDK / Gradle / HBuilderX）按本机实际位置配置。
签名当前用 DCloud 自带公开 `Test.keystore`（默认口令 123456），**正式发版前必须替换**。

## 常见问题

**为什么点不开详情页？** 若 APK 内 `app-config-service.js` 没有
`pages/detail/detail`，说明装的是旧包，用 `pack-latest.ps1` 重编安装。

**脚本报"意外的标记 / 表达式中缺少右括号"？** PS1 必须以 **UTF-8 with BOM**
保存（含中文/破折号的脚本被无 BOM 编辑器重存后，Windows PowerShell 5.1 会按
GBK 误读）。迁移时已统一修复，后续编辑请勿去 BOM。

**旧入口**：`quick-repack-install.ps1` 转发到 `pack-latest.ps1`；
`pack-apk.ps1` / `pack-and-push-apk.ps1` 为旧名，改用
`pack-latest.ps1` / `pack-and-push-offline-apk.ps1`。
