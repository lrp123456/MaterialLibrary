# pack-studio 旧工具归档（2026-11-03，留档 7 天）

- `auto-confirm-install.js`：自动确认安装的辅助脚本，现行 e2e 不再使用。
- `fix-whitescreen-apk*.js`：历史白屏 APK 修复工具（zip4j 兼容期，结论已沉淀进现行管线）。
- `pack-current-www.js`：旧 www 直打流程，已被 WGT 管线（lib/）取代。

同批直接删除的 41 个 `_dev/_e2e/_verify/_diag/_probe` 一次性脚本与
`_zip4jfix/dexout/classes.dex`、`dcstorage/DCStorage`（手机 DB 拉取物）无留档价值，
已 git rm；现行代码只依赖 server.js / launch.js / start.ps1 / index.html / lib/ / state/。
