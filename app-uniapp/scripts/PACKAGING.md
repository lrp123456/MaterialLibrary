# 打包说明（AlbumSyncUniAppX）

## 推荐入口：强制重编最新源码

```powershell
# 只打 APK
.\scripts\pack-latest.ps1

# 打 APK 并安装到设备
.\scripts\pack-latest.ps1 -Install

# 指定设备
.\scripts\pack-latest.ps1 -Install -Serial 127.0.0.1:21503
```

行为保证：

1. **每次完整执行 `uni build -p app`**（除非显式 `-SkipBuild`，仅 `pack-offline-apk.ps1` 支持）
2. 产物 `dist\build\app` **整体覆盖** `android-offline\...\www`
3. **不永久改写源码**：`Constants.js` / `manifest.json` 打包前快照，结束后还原
4. **不从 `src_backup` 回滚覆盖 `src`**（base 模式直接用当前工作区）

## 底层脚本

| 脚本 | 作用 |
|------|------|
| `pack-latest.ps1` | 推荐入口：base 模式 + 强制重编 |
| `pack-offline-apk.ps1` | 完整打包（模型切换 / Gradle / 可选安装） |
| `pack-and-push-offline-apk.ps1` | 打包后推送到更新通道 |
| `quick-repack-install.ps1` | 旧入口名，转发到 `pack-latest.ps1` |
| `import-offline-sdk.ps1` | 修复/导入离线 SDK 与原生插件 |

## 完整流程（pack-offline-apk.ps1）

1. （可选）导入离线 SDK / native plugin
2. 源码完整性检查（拒绝反编译/空壳 SFC）
3. base：使用当前 `src`；其它 model：overlay 到 `src`
4. 快照并改写端口/应用名 → **`uni build -p app`** → 拷贝 www → **还原快照**
5. Gradle `assembleRelease`
6. 输出到 `dist\release\apk\album-sync-offline-*.apk`

## 配置

`scripts/offline-config.json`：SDK 路径、appId、签名、Gradle、输出目录等。

## 已知损坏（请勿使用旧内容）

以下文件曾在磁盘上被写成全 0，现已重写或改由其它脚本承担：

- `PACKAGING.md`（本文）
- `quick-repack-install.ps1`（转发 pack-latest）
- `pack-apk.ps1` / `pack-and-push-apk.ps1`（请改用 `pack-latest.ps1` / `pack-and-push-offline-apk.ps1`）

## 为什么点不开详情页？

若 APK 内 `app-config-service.js` 没有 `pages/detail/detail`，说明装的是**旧包**。
用 `pack-latest.ps1` 重编安装后，路由与页面会一并进包。
