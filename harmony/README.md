# 素材库鸿蒙伴侣

手机把**相册原图**直接交给素材库服务端，跳过夸克中转。入库成功后再由**服务端**可选备份到夸克或 NAS。

## 为什么百度网盘、夸克网盘能静默扫相册？

华为把 `ohos.permission.READ_IMAGEVIDEO` / `WRITE_IMAGEVIDEO` 列为**受控权限（ACL）**。官方允许的场景包括：

- 文件管理、备份恢复
- **图库备份 / 云同步**（百度网盘、夸克网盘走的就是这条）

本产品同类：**把相册备份/同步到素材库**。上架前要向华为申请 ACL；侧载或调试签名在 DevEco 里可以先自动授权做通。

文档：

- [Media Library 开发准备](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/photoaccesshelper-preparation)
- [PhotoViewPicker](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/photoviewpicker-V5)
- [媒体变更通知](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/photoaccesshelper-notify-guidelines)

NAS **没有**官方 SMB/WebDAV Kit，不要在手机上直连群晖。备份目录由服务机挂载后由服务端 `backup` 节点写入。

## 两期

| 期 | 能力 | 权限 | 上架 |
|----|------|------|------|
| 1 | 用户点「从相册选择」→ `PhotoViewPicker` 多选原图 → `POST /api/assets/ingest` | 不需要读写图库 ACL | 可以 |
| 2 | `PhotoAccessHelper.getAssets` + `registerChange` 自动发现新照片并上传 | `READ_IMAGEVIDEO` ACL（按备份/同步场景申请，与夸克同类） | 需过审 |

一期工程在 `material_sync/`。用 DevEco Studio 打开该目录，把 `services/Api.ets` 里的 `BASE_URL` 改成你的素材库地址（电脑局域网 IP + `:8787`）。

## 服务端约定

```
POST /api/auth/login          { username, password }
POST /api/assets/ingest       multipart file + source=harmony + client_asset_id
```

`client_asset_id` 用相册 URI 或文件 hash，避免重复传。

设置页「直连入库」可用浏览器先验证同一接口；「入库后备份槽」配 NAS 目录或夸克 fid。
