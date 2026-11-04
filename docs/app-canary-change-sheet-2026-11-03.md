# App 灰度能力——仓外工程改动单（AlbumSyncUniAppX）

> **2026-11-04 状态更新：** App 工程与打包工具链已全部迁回本仓 `app-uniapp/`（自包含，见
> `app-uniapp/scripts/PACKAGING.md`）。本单中的客户端建议如继续实施，应落到仓内工程，
> 路径 `C:\...\AlbumSyncUniAppX` 不再是正源。以下内容按 2026-11-03 当时状况留档。

> 日期：2026-11-03
> 适用工程：`C:\Users\lrp\DevEcoStudioProjects\AlbumSyncUniAppX`（appid `__UNI__F183218`，App 正源）
> 本仓（MaterialLibraryServer）**不代为修改**该工程；本单只描述服务端已交付的能力与建议的客户端改动。
> 服务端对应实现：`src/app-update.js`、`src/api.js`、`test/app-update-canary.test.js`（B8 批次）。

## 0. 结论速览

| 项 | 现状（2026-11-03 核实） | 客户端是否必须改 |
|---|---|---|
| 尝鲜通道开关 | 设置页已有开关，`getActiveChannel()` 正确发 `canary` / `internal` | 否 |
| check/update 带 channel + deviceId | `AppUpdater.js:219-226` 已带 | 否 |
| 按设备百分比分桶 | 服务端新增 `rolloutPct`，**纯服务端能力，客户端零改动** | 否 |
| 设备号双轨（更新用 A、设置页显示 B） | 白名单复制设备号可能对不上，**建议统一** | 建议（见 §1） |
| 设备名册管理接口 | 新增 `GET /api/app/update/devices`（admin） | 否（管理端用） |
| 渠道默认值 `private` vs 客户端 `internal` | 客户端始终显式传参，不受影响 | 可选（见 §4） |

## 1. 建议改动：统一设备标识（唯一建议的客户端代码变更）

### 问题：两套设备号

| 用途 | 函数 | 形态 | 位置 |
|---|---|---|---|
| 快照同步 `device_id`、**设置页「设备标识」展示与复制** | `store.getDeviceId()` | 优先 `and_<ANDROID_ID>`，其次 `plus.device.uuid`，再次本地随机 UUID | `src/service/SyncStateStore.js:49`；展示于 `src/pages/settings/settings.vue:385`，复制按钮 `:599` |
| **更新检查**上报的 `deviceId` | `getClientDeviceId()` | `plus.device.uuid + '|' + plus.device.model`，失败才用本地随机 `dev-xxxxxxxx` | `src/service/AppUpdater.js:34-50`；请求拼装 `:219-226` |

两个字符串不相等。运维从设置页复制「设备 ID」填进灰度白名单（pack-studio 目标设备框 / `targetDevices`）时，
更新接口实际上报的是另一个值。服务端白名单是**子串双向包含**匹配（`dev.includes(target) || target.includes(dev)`，
`src/app-update.js:76-78`），当两者共享 `plus.device.uuid` 片段时可能碰巧命中，但 `and_<ANDROID_ID>` 形态与
`uuid|model` 形态无公共片段时必然不命中——表现为「明明加了白名单，设备就是收不到灰度」。

### 建议改法（任选其一，推荐 A）

**A. 更新通道复用同步设备号（推荐）**

`src/service/AppUpdater.js`：

```js
import { store } from './SyncStateStore.js'   // 路径按实际调整

export function getClientDeviceId() {
  // 与快照同步、设置页「设备标识」保持同一个身份，白名单才可复制即用
  const sid = store.getDeviceId()
  if (sid) return sid
  // 兜底保留原逻辑（鸿蒙/plus 不可用时）
  // ……现有 plus.device.uuid|model 与 dev- 随机兜底……
}
```

注意：
- `store.getDeviceId()` 首次调用可能在 Android 上读 `Settings.Secure.ANDROID_ID`（同步 plus 桥），AppUpdater 在冷启动
  路径调用，耗时与现有 `plus.device.uuid` 同级，可接受。
- 上线后设备的更新 deviceId 会从 `uuid|model` 切到 `and_<androidId>`：**已发布灰度白名单中的旧值需同步更换**。
  新白名单建议在服务端设备名册（§3）上线后按名册值重新登记。
- 鸿蒙端没有 ANDROID_ID，会落到 uuid/随机分支，行为不变。

**B. 不改 AppUpdater，在设置页额外展示「更新设备号」**

`settings.vue` 的「设备标识」卡片增加一行展示 `getClientDeviceId()`，让运维复制正确的值。
成本低，但身份双轨长期存在，快照与更新两侧数据无法按设备号关联，不推荐作为终态。

## 2. 百分比分桶灰度（服务端新能力，客户端无需改动）

服务端灰度清单 `manifest.grayscale` 新增可选字段 `rolloutPct`（0–100 整数）：

- 仅在**白名单留空**时有意义；设置了 `targetDevices` 时该字段被服务端忽略（白名单严格优先）。
- 缺省（字段不存在）= 旧行为：所有声明 canary/beta/gray 通道的设备全量收灰度。
- `100` = 全部尝鲜设备；`0` = 暂停下发（灰度配置保留不撤回，设备回落到正式版）；
  `1–99` = 按 `sha256('canary-rollout:' + 归一化deviceId)` 前 32 位 % 100 稳定分桶，桶号 < pct 的设备收灰度。
- 分桶以更新请求上报的 deviceId 为键（**trim + 小写归一**），同设备永远同桶，调大比例只进不退。
- **没有 deviceId 的旧客户端不参与 1–99 分桶**（排除而非随机命中，避免按请求漂移）；pct=100 时不受影响。
  这也是建议 §1 统一设备号的附带理由：随机 `dev-` ID 虽稳定但无法人工对应到物理设备。

运维入口：pack-studio 出包流水线「目标设备」留空时，可填「灰度比例（%）」
（`pack-studio/index.html` rolloutPctInput → `/api/run` → `push-update.js` query `rolloutPct` →
`/api/app/update/upload`，服务端在 `publishUpdate` 内夹取 0–100 落盘）。

## 3. 新增管理接口：灰度设备名册

```
GET /api/app/update/devices        # 需 admin（与 promote/revoke-canary 同级鉴权）
→ { success: true, data: { devices: [ ... ] } }
```

设备每次调 `GET /api/app/update`（检查更新）都会在服务端 sidecar 名册
（`<dataDir>/app-update/devices.json`）留一条：

```json
{
  "deviceId": "and_a1b2c3…",
  "platform": "android",
  "versionCode": 2040001,
  "wgtVersion": "2040001",
  "channel": "canary",
  "userAgent": "...",
  "ip": "192.168.1.0",
  "firstSeen": 1762100000000,
  "lastSeen": 1762100000000,
  "hits": 3
}
```

要点：
- IP 已脱敏（IPv4 末段归 0）；列表按 `lastSeen` 倒序；名册上限 500 条 LRU；
  同一设备 10 分钟内重复报到只增 `hits` 不重写（写盘去抖，失败仅告警不影响检查更新）。
- deviceId 为空的请求**不进名册**。
- 用途：admin/pack-studio 从名册复制真实上报的设备号进白名单，根治「猜设备号」问题；
  也是 §1 改动上线后重新登记白名单的数据来源。

## 4. 备注：渠道名 `internal` vs 服务端默认 `private`

- 客户端 `UPDATE_CHANNEL = 'internal'`（`AppUpdater.js:32`），尝鲜时发 `canary`（`:62-65`），
  请求始终显式带 `channel` 参数（`:225`）。
- 服务端 `GET /api/app/update` 在**缺参**时回落 `'private'`（`src/api.js` 检查更新路由）。
  现行 App 永远显式传参，不受默认值影响，**无需改动**；如未来出现不发 channel 的新客户端，
  需注意它与 App 不属同一渠道桶。该项仅备案，不建议为本批改动。

## 5. 验证建议（改动单落地后）

1. §1-A 改完，设置页复制的设备号与名册 `GET /api/app/update/devices` 中的 deviceId 完全一致。
2. 开关尝鲜通道 + 服务端 `rolloutPct=0`：检查更新返回正式版；改 `50`：同设备结论稳定（多次请求不漂移），
   两台设备可出现一台命中一台不命中；`100`：全部尝鲜设备命中。
3. 白名单非空时 `rolloutPct` 不生效：未登记设备即使在 canary 通道也只收正式版。
4. 关闭尝鲜通道的设备在任何灰度配置下都只收正式全量版。

服务端回归：`node test/app-update-canary.test.js`（分桶稳定性/分布、白名单优先、pct 夹取、
端到端检查更新、名册脱敏与 LRU 上限）。
