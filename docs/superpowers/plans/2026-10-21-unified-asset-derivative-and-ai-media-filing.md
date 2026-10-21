# 云素材库统一仓库：衍生图选择与 AI 视频/音乐入库 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让剪辑器（editor/React）的云端素材库弹窗能像创作工坊（web-pro/Vue）一样选择衍生版本并把它导入时间轴，同时让 AI 生成的视频与音乐自动入素材库、修好「送入剪辑」链路；两端共享一份框架无关的版本选择核心逻辑。

**Architecture:** 在仓库根新建纯 TypeScript、零依赖的 `shared/ml-asset-core/`（类型 / 标签 / 版本展开 / 选择状态 / FID 版本引用），web-pro 用 Vite 直接相对路径引用，editor 用 Next/Turbopack 相对路径引用。版本身份统一为 `fid::derivativeId`（原图为裸 `fid`），以 `mediaFidMap` 的值形式随工程 JSON 进云端快照；`clip_snapshot_assets` 表按 fid 去重且不存版本，因此版本还原只走 `data_json.mediaFidMap`。后端 `/api/viewer/assets/<fid>/file?derivative=<id>` 已原生支持指定衍生版下载，本计划不改后端。

**Tech Stack:** Vue 3 + Vite（web-pro，:30002）、Next.js 16 + React 19 + Turbopack（editor，:3010，若rame 嵌入）、bun:test（editor 现有单测框架）、Node.js 后端（:30001，本计划不改）、better-sqlite3。

---

## 前置事实（执行前必读）

1. **后端下载端点已支持衍生版**：`src/api.js` 的 `/assets/:fid/(image|file|video)` 处理器里 `if (derivativeId)` 是独立优先分支（`getDerivativeById` + 校验 `deriv.asset_fid === fid`），先于 `isRaw/isDl` 逻辑。因此 `GET /api/viewer/assets/<fid>/file?derivative=<id>` 能直接返回该衍生版字节。**不要改后端**。
2. **快照清单不存版本**：`src/clip-snapshots.js` 的 `normalizeAssets()` 按 fid 去重，只保留 `{fid, role}`，`derivativeId` 会被剥掉。版本信息只能放在 `data_json` 内嵌的 `mediaFidMap` 里。
3. **`registerGenerated` 已支持 video/audio**：`src/shelf-lineage.js` L157-268 按扩展名推断 kind（`.mp4/.webm/.mov → video`，`.mp3/.wav/.m4a → audio`），并要求 `previewUrl` 含 `/api/cache/temp/`（或传 data URL）。不需要扩后端。
4. **AI 视频「送入剪辑」当前是断的**：`ChatStudio.vue` 的 video 消息只有 `videoUrl`，没有 `fid`；`mls-bridge.tsx` L118 `if (!asset.fid) return;` 静默丢弃。Phase B 必须同时修入库与载荷。
5. **两端测试/检查命令**（复制即用）：
   - editor 单测：`bun test apps/web/src/ml-asset-core.test.ts`（在 `editor/` 目录执行）
   - editor 类型检查：`node apps/web/node_modules/typescript/bin/tsc --noEmit -p apps/web/tsconfig.json`（在 `editor/` 目录执行；**不要用 npx tsc**，会 `Maximum call stack size exceeded`）
   - web-pro 构建：`npm run build`（在 `web-pro/` 目录执行）

## 文件结构

**新建**
- `shared/ml-asset-core/types.ts` —— 版本选择器共用类型
- `shared/ml-asset-core/labels.ts` —— 衍生版中文标签与画幅类型集合
- `shared/ml-asset-core/versions.ts` —— `versionKey` / `versionsOf` / `stripVersionKey`
- `shared/ml-asset-core/selection.ts` —— 多选状态机
- `shared/ml-asset-core/index.ts` —— 统一出口
- `editor/apps/web/src/ml-asset-core.test.ts` —— 共享 core 单测（bun:test）
- `editor/apps/web/src/services/cloud-snapshots/fid-ref.ts` —— `fid::derivativeId` 引用编解码 + 下载路径
- `editor/apps/web/src/services/cloud-snapshots/fid-ref.test.ts` —— 上述纯函数单测

**修改**
- `web-pro/src/components/AssetPickerModal.vue` —— 改为消费共享 core（行为不变）
- `editor/apps/web/tsconfig.json` —— include 追加 `../../../shared/**/*.ts`
- `editor/apps/web/src/components/editor/asset-library-picker-modal.tsx` —— 版本展开/选择/衍生下载
- `editor/apps/web/src/services/cloud-snapshots/index.ts` —— 映射值升级为版本引用
- `editor/apps/web/src/components/mls-bridge.tsx` —— 载荷透传 derivativeId + mime 归一
- `web-pro/src/views/studio/ChatStudio.vue` —— 视频/音乐入库 + 送入剪辑载荷规范化

---

# Phase A：共享资产 core + 衍生版本全链路

### Task 1: 共享 core 骨架（类型 + 标签）+ 单测

**Files:**
- Create: `shared/ml-asset-core/types.ts`
- Create: `shared/ml-asset-core/labels.ts`
- Create: `shared/ml-asset-core/index.ts`
- Test: `editor/apps/web/src/ml-asset-core.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `editor/apps/web/src/ml-asset-core.test.ts`：

```ts
import { describe, expect, test } from "bun:test";
import { DERIVATIVE_LABELS, derivativeLabel, isGeometryKind } from "../../../../shared/ml-asset-core/index";

describe("derivativeLabel", () => {
	test("已知类型返回中文标签", () => {
		expect(derivativeLabel("restage_9_16")).toBe("9:16 画幅重构");
		expect(derivativeLabel("origin")).toBe("原图");
	});

	test("未知类型原样返回，空值兜底", () => {
		expect(derivativeLabel("brand_new_kind")).toBe("brand_new_kind");
		expect(derivativeLabel("")).toBe("衍生版本");
		expect(derivativeLabel(undefined)).toBe("衍生版本");
	});
});

describe("isGeometryKind", () => {
	test("改画幅的衍生类型返回 true", () => {
		expect(isGeometryKind("restage_9_16")).toBe(true);
		expect(isGeometryKind("expand")).toBe(true);
	});

	test("不改画幅的返回 false", () => {
		expect(isGeometryKind("clean")).toBe(false);
		expect(isGeometryKind("")).toBe(false);
	});
});

describe("DERIVATIVE_LABELS", () => {
	test("标签表覆盖选择器实际会展示的类型", () => {
		for (const kind of ["origin", "restage_3_4", "retouched", "manual_edit"]) {
			expect(typeof DERIVATIVE_LABELS[kind]).toBe("string");
		}
	});
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `bun test apps/web/src/ml-asset-core.test.ts`（在 `editor/` 目录）
Expected: FAIL，报错找不到模块 `../../../../shared/ml-asset-core/index`

- [ ] **Step 3: 写最小实现**

创建 `shared/ml-asset-core/types.ts`：

```ts
/** 版本选择器的共享类型：web-pro(Vue) 与 editor(React) 共用，不依赖任何框架。 */

/** 素材种类（与素材库接口的 kind 对齐）。 */
export type AssetKind = "image" | "video" | "audio";

/** 素材列表项的最小视图模型；两端字段名不同，由调用方负责归一化。 */
export interface AssetLike {
	fid: string;
	name?: string;
	kind?: string;
	mediaToken?: string;
	url?: string;
}

/** 详情接口 `/api/viewer/assets/<fid>` 返回的衍生版本条目（只取用到的字段）。 */
export interface DerivativeLike {
	id: string;
	kind?: string;
	mime?: string;
}

/**
 * 一个可选中的素材版本。
 * key 是唯一身份：原图为裸 fid，衍生版为 `fid::derivativeId`。
 */
export interface AssetVersion {
	key: string;
	fid: string;
	mediaToken: string;
	derivativeId: string;
	derivativeKind: string;
	geometry?: boolean;
	label: string;
	url: string;
	kind: string;
	name: string;
}

/** 两端各自实现的 URL 构造器（鉴权方式不同，因此由调用方注入）。 */
export interface VersionUrlBuilders {
	originUrl: (item: AssetLike) => string;
	derivativeUrl: (item: AssetLike, derivativeId: string) => string;
}
```

创建 `shared/ml-asset-core/labels.ts`：

```ts
/** 衍生类型 → 中文标签。与 web-pro 原 AssetPickerModal 内的映射保持一致。 */
export const DERIVATIVE_LABELS: Record<string, string> = {
	origin: "原图",
	restage_9_16: "9:16 画幅重构",
	restage_3_4: "3:4 画幅重构",
	restage_1_1: "1:1 画幅重构",
	restage_dual: "双画幅重构",
	clean: "净画精修",
	style_transferred: "风格重绘",
	portrait_redraw: "人像重绘",
	clarity_enhanced: "超分高清",
	expand: "扩图延展",
	retouched: "精修版本",
	manual_edit: "手动编辑",
	quick_replace: "快速替换",
	quick_remove: "快速移除",
	quick_insert: "快速插入",
};

/** 会改变画面宽高比的衍生类型：选中它替换底图后画布比例必然变化。 */
export const GEOMETRY_KINDS = new Set<string>([
	"restage_9_16",
	"restage_3_4",
	"restage_1_1",
	"restage_dual",
	"expand",
]);

export function derivativeLabel(kind?: string): string {
	const key = String(kind || "");
	return DERIVATIVE_LABELS[key] || key || "衍生版本";
}

export function isGeometryKind(kind?: string): boolean {
	return GEOMETRY_KINDS.has(String(kind || ""));
}
```

创建 `shared/ml-asset-core/index.ts`：

```ts
export * from "./types";
export * from "./labels";
```

- [ ] **Step 4: 跑测试确认通过**

Run: `bun test apps/web/src/ml-asset-core.test.ts`
Expected: PASS，6 个测试通过

- [ ] **Step 5: 提交**

```bash
git add shared/ml-asset-core/types.ts shared/ml-asset-core/labels.ts shared/ml-asset-core/index.ts editor/apps/web/src/ml-asset-core.test.ts
git commit -m "feat(shared): 抽出框架无关的素材衍生版标签与类型 core"
```

---

### Task 2: 版本展开 `versionsOf`（TDD）

**Files:**
- Create: `shared/ml-asset-core/versions.ts`
- Modify: `shared/ml-asset-core/index.ts`
- Test: `editor/apps/web/src/ml-asset-core.test.ts`（追加 describe）

- [ ] **Step 1: 写失败测试**

在 `editor/apps/web/src/ml-asset-core.test.ts` 顶部 import 追加 `versionKey, versionsOf, stripVersionKey`（同一行）：

```ts
import { DERIVATIVE_LABELS, derivativeLabel, isGeometryKind, stripVersionKey, versionKey, versionsOf } from "../../../../shared/ml-asset-core/index";
```

文件末尾追加：

```ts
describe("versionKey", () => {
	test("原图用裸 fid，衍生版用双冒号拼接", () => {
		expect(versionKey("abc")).toBe("abc");
		expect(versionKey("abc", "")).toBe("abc");
		expect(versionKey("abc", "d1")).toBe("abc::d1");
	});
});

describe("versionsOf", () => {
	const urls = {
		originUrl: (it: { fid: string }) => `/origin/${it.fid}`,
		derivativeUrl: (it: { fid: string }, id: string) => `/deriv/${it.fid}/${id}`,
	};
	const item = { fid: "abc", name: "客厅", kind: "image", mediaToken: "mt" };

	test("无衍生数据时只有原图一项", () => {
		const list = versionsOf(item, undefined, urls);
		expect(list).toHaveLength(1);
		expect(list[0]).toMatchObject({ key: "abc", derivativeId: "", label: "原图", url: "/origin/abc" });
	});

	test("跳过 kind=origin 的衍生项，避免出现两个原图", () => {
		const list = versionsOf(item, [{ id: "o1", kind: "origin" }], urls);
		expect(list).toHaveLength(1);
	});

	test("其余衍生项按详情顺序展开，改画幅的带 geometry 标记", () => {
		const list = versionsOf(
			item,
			[
				{ id: "o1", kind: "origin" },
				{ id: "d1", kind: "restage_9_16" },
				{ id: "d2", kind: "clean" },
			],
			urls,
		);
		expect(list.map((v) => v.key)).toEqual(["abc", "abc::d1", "abc::d2"]);
		expect(list[1]).toMatchObject({
			derivativeId: "d1",
			derivativeKind: "restage_9_16",
			geometry: true,
			label: "9:16 画幅重构",
			url: "/deriv/abc/d1",
			kind: "image",
			mediaToken: "mt",
		});
		expect(list[2].geometry).toBe(false);
	});

	test("缺少 fid 时返回空数组", () => {
		expect(versionsOf({ fid: "" }, [{ id: "d1", kind: "clean" }], urls)).toEqual([]);
	});

	test("stripVersionKey 去掉 key 保留其余字段", () => {
		const [origin] = versionsOf(item, undefined, urls);
		const payload = stripVersionKey(origin);
		expect("key" in payload).toBe(false);
		expect(payload.fid).toBe("abc");
	});
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `bun test apps/web/src/ml-asset-core.test.ts`
Expected: FAIL，`versionKey is not a function` 或导出缺失

- [ ] **Step 3: 写最小实现**

创建 `shared/ml-asset-core/versions.ts`：

```ts
import { derivativeLabel, isGeometryKind } from "./labels";
import type { AssetLike, AssetVersion, DerivativeLike, VersionUrlBuilders } from "./types";

/** 版本身份：原图为裸 fid，衍生版为 `fid::derivativeId`。 */
export function versionKey(fid: string, derivativeId?: string): string {
	return derivativeId ? `${fid}::${derivativeId}` : String(fid);
}

/**
 * 把一条素材展开成「原图 + 全部衍生版」列表。
 * 详情接口会把 kind=origin 的衍生项也列出来，这里已用原图占位，故跳过。
 */
export function versionsOf(
	item: AssetLike,
	derivatives: DerivativeLike[] | undefined,
	urls: VersionUrlBuilders,
): AssetVersion[] {
	const fid = String(item.fid || "");
	if (!fid) return [];
	const list: AssetVersion[] = [
		{
			key: versionKey(fid, ""),
			fid,
			mediaToken: item.mediaToken || "",
			derivativeId: "",
			derivativeKind: "origin",
			label: "原图",
			url: urls.originUrl(item),
			kind: item.kind || "image",
			name: item.name || "",
		},
	];
	if (!Array.isArray(derivatives)) return list;
	for (const d of derivatives) {
		if (!d || !d.id) continue;
		if (d.kind === "origin") continue;
		list.push({
			key: versionKey(fid, d.id),
			fid,
			mediaToken: item.mediaToken || "",
			derivativeId: d.id,
			derivativeKind: d.kind || "",
			geometry: isGeometryKind(d.kind),
			label: derivativeLabel(d.kind),
			url: urls.derivativeUrl(item, d.id),
			kind: "image",
			name: item.name || "",
		});
	}
	return list;
}

/** 去掉仅供 UI 选中用的 key，得到可跨模块传递的载荷。 */
export function stripVersionKey(version: AssetVersion): Omit<AssetVersion, "key"> {
	const { key: _key, ...rest } = version;
	return rest;
}
```

修改 `shared/ml-asset-core/index.ts` 追加一行：

```ts
export * from "./versions";
```

- [ ] **Step 4: 跑测试确认通过**

Run: `bun test apps/web/src/ml-asset-core.test.ts`
Expected: PASS，新增 6 个测试全绿

- [ ] **Step 5: 提交**

```bash
git add shared/ml-asset-core/versions.ts shared/ml-asset-core/index.ts editor/apps/web/src/ml-asset-core.test.ts
git commit -m "feat(shared): 版本展开与版本 key 统一为 fid::derivativeId"
```

---

### Task 3: 选择状态机 `toggleSelection`（TDD）

**Files:**
- Create: `shared/ml-asset-core/selection.ts`
- Modify: `shared/ml-asset-core/index.ts`
- Test: `editor/apps/web/src/ml-asset-core.test.ts`（追加 describe）

- [ ] **Step 1: 写失败测试**

import 行追加 `isSelected, toggleSelection`：

```ts
import { DERIVATIVE_LABELS, derivativeLabel, isGeometryKind, isSelected, stripVersionKey, toggleSelection, versionKey, versionsOf } from "../../../../shared/ml-asset-core/index";
```

文件末尾追加：

```ts
describe("toggleSelection", () => {
	const base = { mediaToken: "", derivativeKind: "origin", label: "原图", url: "/u", kind: "image", name: "n" };
	const a = { ...base, key: "a", fid: "a", derivativeId: "" };
	const b = { ...base, key: "b::d1", fid: "b", derivativeId: "d1" };
	const c = { ...base, key: "c", fid: "c", derivativeId: "" };

	test("单选模式下选中即替换", () => {
		expect(toggleSelection([a], b, 1).selected.map((v) => v.key)).toEqual(["b::d1"]);
	});

	test("同一版本再点一次取消选中", () => {
		expect(toggleSelection([a, b], b, 10).selected.map((v) => v.key)).toEqual(["a"]);
	});

	test("多选模式下累加", () => {
		expect(toggleSelection([a], b, 10).selected.map((v) => v.key)).toEqual(["a", "b::d1"]);
	});

	test("超出上限时保持原状并给出提示", () => {
		const res = toggleSelection([a, b], c, 2);
		expect(res.selected.map((v) => v.key)).toEqual(["a", "b::d1"]);
		expect(res.notice).toBe("最多同时选择 2 件参考素材");
	});

	test("同一 fid 的两个版本可同时选中（key 不同）", () => {
		const aOrigin = { ...base, key: "a", fid: "a", derivativeId: "" };
		const aDeriv = { ...base, key: "a::d1", fid: "a", derivativeId: "d1" };
		expect(toggleSelection([aOrigin], aDeriv, 10).selected.map((v) => v.key)).toEqual(["a", "a::d1"]);
	});
});

describe("isSelected", () => {
	test("按版本 key 判断，不按 fid", () => {
		const v = { mediaToken: "", derivativeKind: "origin", label: "原图", url: "/u", kind: "image", name: "n", key: "a", fid: "a", derivativeId: "" };
		expect(isSelected([v], "a")).toBe(true);
		expect(isSelected([v], "a::d1")).toBe(false);
	});
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `bun test apps/web/src/ml-asset-core.test.ts`
Expected: FAIL，导出缺失

- [ ] **Step 3: 写最小实现**

创建 `shared/ml-asset-core/selection.ts`：

```ts
import type { AssetVersion } from "./types";

export interface SelectionResult {
	selected: AssetVersion[];
	notice: string;
}

/**
 * 点选/取消一个版本。
 * maxSelect <= 1 视为单选：直接替换；超出上限则保持原状并返回提示文案。
 */
export function toggleSelection(
	selected: AssetVersion[],
	version: AssetVersion,
	maxSelect: number,
): SelectionResult {
	const idx = selected.findIndex((s) => s.key === version.key);
	if (idx >= 0) {
		const next = selected.slice();
		next.splice(idx, 1);
		return { selected: next, notice: "" };
	}
	if (maxSelect <= 1) return { selected: [version], notice: "" };
	if (selected.length >= maxSelect) {
		return { selected, notice: `最多同时选择 ${maxSelect} 件参考素材` };
	}
	return { selected: [...selected, version], notice: "" };
}

/** 按版本 key 判断是否已选中（同一 fid 的不同版本互不影响）。 */
export function isSelected(selected: AssetVersion[], key: string): boolean {
	return selected.some((s) => s.key === key);
}
```

修改 `shared/ml-asset-core/index.ts` 追加一行：

```ts
export * from "./selection";
```

- [ ] **Step 4: 跑测试确认通过**

Run: `bun test apps/web/src/ml-asset-core.test.ts`
Expected: PASS，全部测试通过

- [ ] **Step 5: 提交**

```bash
git add shared/ml-asset-core/selection.ts shared/ml-asset-core/index.ts editor/apps/web/src/ml-asset-core.test.ts
git commit -m "feat(shared): 抽出多选状态机，支持同素材多版本并存"
```

---

### Task 4: web-pro 资产选择器改为消费共享 core

**Files:**
- Modify: `web-pro/src/components/AssetPickerModal.vue:495-519`（常量与标签函数）
- Modify: `web-pro/src/components/AssetPickerModal.vue:679-798`（版本与选择逻辑）
- Test: `npm run build` + 浏览器手测（该组件无单测框架）

- [ ] **Step 1: 替换标签常量块**

删除 `AssetPickerModal.vue` 第 495-519 行的 `DERIVATIVE_LABELS` / `GEOMETRY_KINDS` / `derivativeLabel` / `isGeometryKind` 定义，改为在 `<script setup>` 的 import 区（现有 `import { ... } from '../api.js'` 附近）加入：

```js
import {
  derivativeLabel,
  versionKey,
  versionsOf as buildVersions,
  stripVersionKey,
  toggleSelection,
  isSelected as isVersionSelected,
} from '../../../shared/ml-asset-core/index.ts';
```

> 说明：Vite 已配置 `server.fs.allow` 为仓库根（[vite.config.js](file:///c:/Users/lrp/DevEcoStudioProjects/MaterialLibraryServer/web-pro/vite.config.js#L7-L11)），可直接引用根目录 TS 源码；显式写 `.ts` 后缀避免解析歧义。

- [ ] **Step 2: 用 core 重写版本与选择逻辑**

把 `versionKey` 本地定义（L679-681）删除；`isSelected` 改名为直接调用 core（模板里只用了 `isSelected(key)` 一处，保留同名包装）：

```js
function isSelected(key) {
  return isVersionSelected(selected.value, key);
}
```

把 `versionsOf`（L694-727）替换为：

```js
function versionsOf(item) {
  return buildVersions(item, derivativeCache.value[item.fid], {
    originUrl: (it) =>
      it.fid && !['video', 'audio'].includes(it.kind)
        ? getAssetOriginalUrl(it.fid, it.mediaToken)
        : (it.url || ''),
    derivativeUrl: (it, derivativeId) => getDerivativeImageUrl(it.fid, derivativeId, it.mediaToken),
  });
}
```

删除本地 `stripKey`（L761-764），`pick`（L766-783）替换为：

```js
function pick(item, version) {
  const res = toggleSelection(
    selected.value,
    { ...version, name: version.name || item.name },
    props.maxSelect,
  );
  selected.value = res.selected;
  notice.value = res.notice;
  if (props.maxSelect <= 1 && res.selected.length) expandedFid.value = '';
}
```

`selectAllCurrentPage`（L785-792）里的 `stripKey(...)` 改为 `stripVersionKey(...)`，`confirm`（L794-798）改成：

```js
function confirm() {
  if (!selected.value.length) return;
  emit('confirm', selected.value.map(stripVersionKey));
  close();
}
```

新增 import 的 `getAssetOriginalUrl` / `getDerivativeImageUrl` 若当前文件未引入，补到现有 `../api.js` 的 import 列表中。

- [ ] **Step 3: 构建验证**

Run: `npm run build`（在 `web-pro/` 目录）
Expected: 构建成功，无 `Failed to resolve import '../../../shared/ml-asset-core/index.ts'`

- [ ] **Step 4: 浏览器回归（创作工坊 + 快捷编辑）**

1. 打开 `http://localhost:30002`，登录后在「AI 创作 → 对话」点输入区参考素材按钮，打开资产选择器。
2. 点一张图片卡片 → 出现版本面板，含「原图」与各衍生版；连点两个版本 → 计数变 2；再点一次其中一个 → 取消。
3. 确认挂载后，参考图槽位数量与所选版本数一致。
4. 切到「快捷编辑」，打开其素材选择器（单选），选「原图」→ 面板自动收起，底图替换成功。

Expected: 四项全部正常，控制台无报错。

- [ ] **Step 5: 提交**

```bash
git add web-pro/src/components/AssetPickerModal.vue
git commit -m "refactor(web-pro): 资产选择器改用共享 core，消除两端版本逻辑漂移"
```

---

### Task 5: editor 接入共享 core（tsconfig + 类型检查基线）

**Files:**
- Modify: `editor/apps/web/tsconfig.json:35-55`

- [ ] **Step 1: 把共享 core 纳入编辑器工程**

在 `editor/apps/web/tsconfig.json` 的 `include` 数组中（`"../../use-frame-cache.ts"` 之后）追加：

```json
    "../../../shared/**/*.ts",
```

（`editor/apps/web` → 仓库根是三级，故为 `../../../shared`。）

- [ ] **Step 2: 跑类型检查确认基线无新增错误**

Run: `node apps/web/node_modules/typescript/bin/tsc --noEmit -p apps/web/tsconfig.json`（在 `editor/` 目录）
Expected: 输出中不出现 `shared/ml-asset-core` 相关错误；若原本存在历史错误，记录条数作为基线（后续任务对比）

- [ ] **Step 3: 提交**

```bash
git add editor/apps/web/tsconfig.json
git commit -m "chore(editor): tsconfig 纳入仓库根共享 core 源码"
```

---

### Task 6: 剪辑器云端素材库弹窗支持衍生版本

**Files:**
- Modify: `editor/apps/web/src/components/editor/asset-library-picker-modal.tsx`

- [ ] **Step 1: 补 import 与版本状态**

在文件顶部 import 区追加：

```tsx
import {
	isSelected as isVersionSelected,
	toggleSelection,
	versionsOf,
	type AssetLike,
	type AssetVersion,
	type DerivativeLike,
} from "../../../../../../shared/ml-asset-core/index";
```

（`src/components/editor/` → 仓库根为六级。）

把第 120 行的 `const [selectedFids, setSelectedFids] = useState<Set<string>>(new Set());` 替换为：

```tsx
	// 版本级选中：key = fid 或 fid::derivativeId，同一素材的不同版本互不覆盖
	const [selectedVersions, setSelectedVersions] = useState<AssetVersion[]>([]);
	const [expandedFid, setExpandedFid] = useState<string>("");
	const [derivativeCache, setDerivativeCache] = useState<Record<string, DerivativeLike[]>>({});
	const [derivativeLoading, setDerivativeLoading] = useState<Record<string, boolean>>({});
	const [selectionNotice, setSelectionNotice] = useState<string>("");
	// 弹窗是一次性批量导入，实际不限制数量；传大值即等价于不限制
	const MAX_SELECT = 100;
```

- [ ] **Step 2: 加版本展开所需的纯函数与 URL 构造**

在 `formatBytes` 之后插入：

```tsx
function toAssetLike(item: MaterialAssetItem): AssetLike {
	return {
		fid: item.fid,
		name: item.file_name,
		kind: item.kind,
		mediaToken: "",
		url: item.thumb_url || "",
	};
}

/** 剪辑器带 Bearer token，不走 media_token；原图必须 raw=1 才是真 origin。 */
function buildVersionUrls() {
	const token = getAuthToken();
	return {
		originUrl: (item: AssetLike) => {
			const q = new URLSearchParams();
			q.set("raw", "1");
			if (token) q.set("token", token);
			return `/api/viewer/assets/${encodeURIComponent(item.fid)}/image?${q.toString()}`;
		},
		derivativeUrl: (item: AssetLike, derivativeId: string) => {
			const q = new URLSearchParams();
			q.set("derivative", derivativeId);
			if (token) q.set("token", token);
			return `/api/viewer/assets/${encodeURIComponent(item.fid)}/image?${q.toString()}`;
		},
	};
}

/** 指定版本的字节下载地址；衍生版走后端已支持的 derivative 参数。 */
function buildDownloadPath(fid: string, derivativeId?: string): string {
	const base = `/api/viewer/assets/${encodeURIComponent(fid)}/file`;
	return derivativeId ? `${base}?derivative=${encodeURIComponent(derivativeId)}` : base;
}
```

- [ ] **Step 3: 替换选择、详情拉取与确认逻辑**

删除 `toggleSelect`（L228-236），替换为：

```tsx
	const itemHasSelection = (fid: string) => selectedVersions.some((v) => v.fid === fid);

	const toggleVersion = (item: MaterialAssetItem, version: AssetVersion) => {
		const res = toggleSelection(
			selectedVersions,
			{ ...version, name: version.name || item.file_name },
			MAX_SELECT,
		);
		setSelectedVersions(res.selected);
		setSelectionNotice(res.notice);
	};

	const ensureDerivatives = useCallback(async (item: MaterialAssetItem) => {
		if (!item.fid || item.kind !== "image") return;
		if (Object.prototype.hasOwnProperty.call(derivativeCache, item.fid)) return;
		setDerivativeLoading((prev) => ({ ...prev, [item.fid]: true }));
		try {
			const res = await fetch(`/api/viewer/assets/${encodeURIComponent(item.fid)}`, {
				headers: authHeaders(),
			});
			const json = res.ok ? await res.json() : null;
			const detail = json?.data || json;
			const list = Array.isArray(detail?.derivatives) ? detail.derivatives : [];
			setDerivativeCache((prev) => ({ ...prev, [item.fid]: list }));
		} catch {
			setDerivativeCache((prev) => ({ ...prev, [item.fid]: [] }));
		} finally {
			setDerivativeLoading((prev) => ({ ...prev, [item.fid]: false }));
		}
	}, [derivativeCache]);

	const openVersions = (item: MaterialAssetItem) => {
		if (item.kind !== "image") {
			// 视频/音频没有衍生概念，直接按原图选中
			toggleVersion(
				item,
				versionsOf(toAssetLike(item), undefined, buildVersionUrls())[0],
			);
			return;
		}
		if (expandedFid === item.fid) {
			setExpandedFid("");
			return;
		}
		setExpandedFid(item.fid);
		setSelectionNotice("");
		void ensureDerivatives(item);
	};

	const expandedItem = items.find((it) => it.fid === expandedFid) || null;
	const expandedVersions = expandedItem
		? versionsOf(toAssetLike(expandedItem), derivativeCache[expandedItem.fid], buildVersionUrls())
		: [];
```

弹窗每次打开时重置状态：把 `useEffect`（L212-217）里的 `setSelectedFids(new Set());` 替换为：

```tsx
			setSelectedVersions([]);
			setExpandedFid("");
			setSelectionNotice("");
```

`handleConfirm`（L253-336）整体替换为：

```tsx
	const handleConfirm = async (autoInsertTimeline = false) => {
		if (!activeProject) {
			toast.error("请先进入一个工程");
			return;
		}

		const chosen = selectedVersions.filter((v) => v.fid);
		if (chosen.length === 0) return;

		setIsSubmitting(true);
		const toastId = toast.loading(`正在从素材库提取 ${chosen.length} 个版本...`);

		try {
			const filesToProcess: { file: File; version: AssetVersion }[] = [];

			for (const version of chosen) {
				const item = items.find((it) => it.fid === version.fid);
				if (!item) continue;
				const resp = await fetch(buildDownloadPath(item.fid, version.derivativeId), {
					headers: authHeaders(),
				});
				if (!resp.ok) continue;
				const blob = await resp.blob();
				const mime = version.derivativeId ? "image/jpeg" : item.mime || "video/mp4";
				const file = new File([blob], item.file_name, { type: mime });
				filesToProcess.push({ file, version });
			}

			if (filesToProcess.length === 0) {
				throw new Error("所选素材下载异常，请检查网络连接与鉴权");
			}

			// 原生解码落入 OPFS
			const processedAssets = await processMediaAssets({
				files: filesToProcess.map((f) => f.file),
			});

			for (let i = 0; i < processedAssets.length; i++) {
				const asset = processedAssets[i];
				const picked = filesToProcess[i]?.version;

				// processMediaAssets 返回的资产没有 id，后续必须使用入库返回值，
				// 否则上轨元素的 mediaId 为 undefined，会直接把整页打成白屏。
				const created = await editor.media.addMediaAsset({
					projectId: activeProject.metadata.id,
					asset,
				});
				if (!created) continue;

				if (picked?.fid) {
					// 先绑定裸 fid，保证备份不丢素材；版本号在 Task 7 接上
					registerMediaFid(created.id, picked.fid);
				}

				if (autoInsertTimeline || directInsertTimeline) {
					const duration =
						created.duration != null
							? mediaTimeFromSeconds({ seconds: created.duration })
							: DEFAULT_NEW_ELEMENT_DURATION;

					const element = buildElementFromMedia({
						mediaId: created.id,
						mediaType: created.type,
						name: created.name,
						duration,
						startTime: editor.playback.getCurrentTime(),
					});

					editor.timeline.insertElement({
						element,
						placement: { mode: "auto" },
					});
				}
			}

			const msg = autoInsertTimeline || directInsertTimeline
				? `已成功载入 ${processedAssets.length} 个版本并自动上轨`
				: `已导入 ${processedAssets.length} 个版本到工程媒体池`;
			toast.success(msg, { id: toastId });
			onOpenChange(false);
		} catch (err) {
			toast.error(`导入素材失败: ${err instanceof Error ? err.message : "未知错误"}`, { id: toastId });
		} finally {
			setIsSubmitting(false);
		}
	};
```

> 注意：本任务只用两参数 `registerMediaFid`，因此可以独立跑通类型检查；Task 7 会把版本号接到这条调用上。

- [ ] **Step 4: 模板改造（选中态、版本面板、按钮计数）**

在顶栏「已选」徽标（L348）把 `selectedFids.size` 改为 `selectedVersions.length`。

卡片点击（L477）替换为：

```tsx
									onClick={() => openVersions(item)}
```

卡片选中态（L473）替换为：

```tsx
								const isSelected = itemHasSelection(item.fid);
```

在卡片缩略图容器内、勾选指示器之前插入版本数徽标：

```tsx
											{item.kind === "image" && (
												<span className="absolute top-2 left-2 px-1.5 py-0.5 rounded-md bg-black/70 text-[10px] font-bold text-white">
													{versionCountBadge(item)}
												</span>
											)}
```

并在组件内补该函数：

```tsx
	const versionCountBadge = (item: MaterialAssetItem) => {
		const count = derivativeCache[item.fid]?.filter((d) => d.kind !== "origin").length || 0;
		return count > 0 ? `${count + 1} 版` : "1 版";
	};
```

> 该徽标只显示版本数量，不影响点击行为。

在瀑布流容器 `</div>`（L543，主体区域闭合）之后、本地上传 input 之前插入版本选择面板：

```tsx
				{/* 版本选择面板：原图 + 全部衍生版 */}
				{expandedItem && (
					<div className="shrink-0 border-t border-border/50 py-2 max-h-60 overflow-y-auto">
						<div className="flex items-center justify-between mb-2">
							<span className="text-xs font-bold truncate">
								选择版本 · {expandedItem.file_name}
							</span>
							<Button
								size="sm"
								variant="ghost"
								className="h-7 px-2 text-xs cursor-pointer"
								onClick={() => setExpandedFid("")}
							>
								收起
							</Button>
						</div>
						{derivativeLoading[expandedItem.fid] ? (
							<div className="h-16 flex items-center justify-center text-xs text-muted-foreground">
								读取衍生版本…
							</div>
						) : (
							<div className="flex flex-wrap gap-2">
								{expandedVersions.map((version) => (
									<button
										key={version.key}
										type="button"
										onClick={() => toggleVersion(expandedItem, version)}
										className={cn(
											"w-32 rounded-lg border p-1.5 flex flex-col gap-1 cursor-pointer text-left",
											isVersionSelected(selectedVersions, version.key)
												? "border-primary bg-primary/10 ring-2 ring-primary/40"
												: "border-border/60 bg-muted/20 hover:bg-muted/40",
										)}
									>
										<div className="aspect-video w-full rounded overflow-hidden bg-black/40">
											<img
												src={version.url}
												alt={version.label}
												className="size-full object-cover"
												loading="lazy"
											/>
										</div>
										<span className="text-[11px] font-semibold truncate">{version.label}</span>
										{version.geometry && (
											<span className="text-[10px] font-bold text-amber-500">选中会改画幅</span>
										)}
									</button>
								))}
							</div>
						)}
					</div>
				)}
```

在底部工具栏（L567 之前的 `div` 内）插入提示条：

```tsx
					{selectionNotice && (
						<span className="text-[11px] font-bold text-amber-500">{selectionNotice}</span>
					)}
```

两个确认按钮的 `disabled` 与文案（L581、L585、L600）把 `selectedFids.size` 全部改为 `selectedVersions.length`。

- [ ] **Step 5: 类型检查**

Run: `node apps/web/node_modules/typescript/bin/tsc --noEmit -p apps/web/tsconfig.json`（在 `editor/` 目录）
Expected: 不出现 `asset-library-picker-modal` / `shared/ml-asset-core` / `selectedFids` 相关新错误。

- [ ] **Step 6: 提交**

```bash
git add editor/apps/web/src/components/editor/asset-library-picker-modal.tsx editor/apps/web/tsconfig.json
git commit -m "feat(editor): 云端素材库弹窗支持衍生版本展开与按版本导入"
```

---

### Task 7: 版本引用编解码 + `registerMediaFid` 支持衍生版

**Files:**
- Create: `editor/apps/web/src/services/cloud-snapshots/fid-ref.ts`
- Test: `editor/apps/web/src/services/cloud-snapshots/fid-ref.test.ts`
- Modify: `editor/apps/web/src/services/cloud-snapshots/index.ts:19-87`

- [ ] **Step 1: 写失败测试**

创建 `editor/apps/web/src/services/cloud-snapshots/fid-ref.test.ts`：

```ts
import { describe, expect, test } from "bun:test";
import { formatMediaFidRef, parseMediaFidRef, snapshotDownloadPath } from "./fid-ref";

describe("parseMediaFidRef", () => {
	test("裸 fid 视为原图", () => {
		expect(parseMediaFidRef("abc")).toEqual({ fid: "abc", derivativeId: "" });
	});

	test("双冒号格式解析出衍生 id", () => {
		expect(parseMediaFidRef("abc::d1")).toEqual({ fid: "abc", derivativeId: "d1" });
	});

	test("空值不抛错", () => {
		expect(parseMediaFidRef(null)).toEqual({ fid: "", derivativeId: "" });
		expect(parseMediaFidRef(undefined)).toEqual({ fid: "", derivativeId: "" });
	});
});

describe("formatMediaFidRef", () => {
	test("有衍生 id 时拼接，无则裸 fid", () => {
		expect(formatMediaFidRef("abc", "d1")).toBe("abc::d1");
		expect(formatMediaFidRef("abc", "")).toBe("abc");
		expect(formatMediaFidRef("abc")).toBe("abc");
	});

	test("与 parse 往返一致", () => {
		expect(parseMediaFidRef(formatMediaFidRef("abc", "d1"))).toEqual({ fid: "abc", derivativeId: "d1" });
	});
});

describe("snapshotDownloadPath", () => {
	test("原图不带参数，衍生版带 derivative", () => {
		expect(snapshotDownloadPath("abc")).toBe("/api/viewer/assets/abc/file");
		expect(snapshotDownloadPath("abc", "d1")).toBe("/api/viewer/assets/abc/file?derivative=d1");
	});

	test("fid 中的特殊字符被编码", () => {
		expect(snapshotDownloadPath("a b")).toBe("/api/viewer/assets/a%20b/file");
	});
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `bun test apps/web/src/services/cloud-snapshots/fid-ref.test.ts`（在 `editor/` 目录）
Expected: FAIL，找不到 `./fid-ref`

- [ ] **Step 3: 写最小实现**

创建 `editor/apps/web/src/services/cloud-snapshots/fid-ref.ts`：

```ts
/**
 * 素材版本引用：`fid` 或 `fid::derivativeId`。
 * 云备份把版本引用存进 mediaFidMap，拉取时据此还原到具体衍生版。
 */
export interface MediaFidRef {
	fid: string;
	derivativeId: string;
}

export function parseMediaFidRef(value: string | null | undefined): MediaFidRef {
	const raw = String(value || "");
	const idx = raw.indexOf("::");
	if (idx < 0) return { fid: raw, derivativeId: "" };
	return { fid: raw.slice(0, idx), derivativeId: raw.slice(idx + 2) };
}

export function formatMediaFidRef(fid: string, derivativeId?: string): string {
	return derivativeId ? `${fid}::${derivativeId}` : String(fid || "");
}

/** 快照拉取时的字节下载路径；后端已支持 derivative 参数。 */
export function snapshotDownloadPath(fid: string, derivativeId?: string): string {
	const base = `/api/viewer/assets/${encodeURIComponent(fid)}/file`;
	return derivativeId ? `${base}?derivative=${encodeURIComponent(derivativeId)}` : base;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `bun test apps/web/src/services/cloud-snapshots/fid-ref.test.ts`
Expected: PASS，7 个测试通过

- [ ] **Step 5: 改造 cloud-snapshots 映射层**

在 `editor/apps/web/src/services/cloud-snapshots/index.ts` 顶部 import 区追加：

```ts
import {
	formatMediaFidRef,
	parseMediaFidRef,
	snapshotDownloadPath,
} from "./fid-ref";
```

把 L79-87 的 `registerMediaFid` / `getMediaFid` 替换为：

```ts
/**
 * 记录本地 mediaId → 云端版本引用。
 * 传 derivativeId 表示该本地素材实际是某衍生版，备份时据此还原版本。
 */
export function registerMediaFid(mediaId: string, fid: string, derivativeId?: string) {
	if (!mediaId || !fid) return;
	const map = readMap(FID_MAP_KEY);
	map[mediaId] = formatMediaFidRef(fid, derivativeId);
	writeMap(FID_MAP_KEY, map);
}

/** 只要裸 fid（AI 引用、上传去重等旧调用方依赖这个语义）。 */
export function getMediaFid(mediaId: string): string | null {
	const raw = readMap(FID_MAP_KEY)[mediaId];
	if (!raw) return null;
	return parseMediaFidRef(raw).fid || null;
}

/** 完整版本引用，需要区分衍生版时用这个。 */
export function getMediaFidRef(mediaId: string): { fid: string; derivativeId: string } | null {
	const raw = readMap(FID_MAP_KEY)[mediaId];
	if (!raw) return null;
	const parsed = parseMediaFidRef(raw);
	return parsed.fid ? parsed : null;
}
```

- [ ] **Step 6: 把弹窗导入时的 fid 绑定升级为版本引用**

把 `editor/apps/web/src/components/editor/asset-library-picker-modal.tsx` 的 `handleConfirm` 中这段：

```tsx
				if (picked?.fid) {
					// 先绑定裸 fid，保证备份不丢素材；版本号在 Task 7 接上
					registerMediaFid(created.id, picked.fid);
				}
```

替换为：

```tsx
				if (picked?.fid) {
					// 版本引用交给云备份/拉取共用，保证衍生版本能随工程往返
					registerMediaFid(created.id, picked.fid, picked.derivativeId || "");
				}
```

- [ ] **Step 7: 类型检查**

Run: `node apps/web/node_modules/typescript/bin/tsc --noEmit -p apps/web/tsconfig.json`
Expected: `asset-library-picker-modal.tsx` 中三参数 `registerMediaFid` 调用不再报错

- [ ] **Step 8: 提交**

```bash
git add editor/apps/web/src/services/cloud-snapshots/fid-ref.ts editor/apps/web/src/services/cloud-snapshots/fid-ref.test.ts editor/apps/web/src/services/cloud-snapshots/index.ts editor/apps/web/src/components/editor/asset-library-picker-modal.tsx
git commit -m "feat(editor): 云同步映射支持 fid::derivativeId 版本引用"
```

---

### Task 8: 云备份/拉取携带并还原衍生版本

**Files:**
- Modify: `editor/apps/web/src/services/cloud-snapshots/index.ts:155-370`

- [ ] **Step 1: 备份侧收集版本引用**

`backupProject`（L165-186）替换为：

```ts
	const media = await storageService.loadAllMediaAssets({ projectId });
	const fidMap = readMap(FID_MAP_KEY);
	const fids: string[] = [];
	// 本地 mediaId → 版本引用（fid 或 fid::derivativeId），随工程 JSON 进云端
	const mediaFidMap: Record<string, string> = {};
	let uploaded = 0;

	let done = 0;
	for (const item of media) {
		done += 1;
		const known = fidMap[item.id];
		if (known) {
			const parsed = parseMediaFidRef(known);
			if (parsed.fid) fids.push(parsed.fid);
			mediaFidMap[item.id] = known;
			continue;
		}
		onProgress?.(`上传素材 ${done}/${media.length}`, 5 + Math.round((done / Math.max(1, media.length)) * 60));
		const fid = await uploadFileToLibrary(item.file);
		registerMediaFid(item.id, fid);
		fids.push(fid);
		mediaFidMap[item.id] = fid;
		uploaded += 1;
	}
```

> `payload.assets` 的 `[...new Set(fids)]` 保持不变：快照清单只做存在性校验，同一 fid 的多个版本本来就只占一行。

- [ ] **Step 2: 拉取侧按版本引用逐条下载**

`pullSnapshot`（L303-352）从 `const assets = ...` 到 `idRemap` 组装结束，整体替换为：

```ts
	// 需要下载的版本：以 mediaFidMap 的值为准（它才带 derivativeId），
	// snapshot.assets 只按 fid 去重，仅用于兜底老快照/清单缺失的情况。
	const plannedVersions = new Map<string, { fid: string; derivativeId: string }>();
	for (const ref of Object.values(remoteMediaFidMap)) {
		const parsed = parseMediaFidRef(ref);
		if (!parsed.fid) continue;
		plannedVersions.set(formatMediaFidRef(parsed.fid, parsed.derivativeId), parsed);
	}
	const assets = (snapshot.assets || []) as Array<{ fid: string; role: string }>;
	for (const a of assets) {
		if (a.role !== "media" && a.role !== "audio") continue;
		const key = formatMediaFidRef(a.fid, "");
		if (!plannedVersions.has(key)) plannedVersions.set(key, { fid: a.fid, derivativeId: "" });
	}

	const versionEntries = [...plannedVersions.entries()];
	const missing: string[] = [];
	const fidToLocalId: Record<string, string> = {};
	let imported = 0;

	for (let i = 0; i < versionEntries.length; i += 1) {
		const [ref, { fid, derivativeId }] = versionEntries[i];
		onProgress?.(
			`下载素材 ${i + 1}/${versionEntries.length}`,
			15 + Math.round(((i + 1) / Math.max(1, versionEntries.length)) * 75),
		);
		try {
			const fileRes = await fetch(snapshotDownloadPath(fid, derivativeId), {
				headers: headers(),
			});
			if (!fileRes.ok) throw new Error(`HTTP ${fileRes.status}`);
			const blob = await fileRes.blob();
			const suffix = derivativeId ? `_${String(derivativeId).slice(0, 8)}` : "";
			const name = (blob.type || "").startsWith("video")
				? `${fid}${suffix}.mp4`
				: (blob.type || "").startsWith("audio")
					? `${fid}${suffix}.m4a`
					: `${fid}${suffix}.png`;
			const file = new File([blob], name, { type: blob.type || "application/octet-stream" });
			const processed = await processMediaAssets({ files: [file] });
			for (const p of processed) {
				// processMediaAssets 返回的资产没有 id（正常路径由 editor.media.addMediaAsset 生成），
				// 这里直接落库，需要自己补一个。
				const mediaAsset = { ...p, id: generateUUID() };
				await storageService.saveMediaAsset({
					projectId: localId,
					mediaAsset,
				});
				registerMediaFid(mediaAsset.id, fid, derivativeId);
				// 同一 fid 的两个版本必须是两条本地媒体，因此以版本引用为键
				fidToLocalId[ref] = mediaAsset.id;
				imported += 1;
			}
		} catch {
			missing.push(ref);
		}
	}

	// 云端不带本地 mediaId，拉取后时间轴里引用的仍是旧机器上的 id，
	// 按备份时记录的映射换成新导入的本地 id，否则画面会整片空白。
	const mediaFidMap = remoteMediaFidMap;
	const idRemap: Record<string, string> = {};
	for (const [oldId, ref] of Object.entries(mediaFidMap)) {
		const localMediaId = fidToLocalId[ref] || fidToLocalId[formatMediaFidRef(parseMediaFidRef(ref).fid, "")];
		if (localMediaId) idRemap[oldId] = localMediaId;
	}
```

- [ ] **Step 3: 类型检查**

Run: `node apps/web/node_modules/typescript/bin/tsc --noEmit -p apps/web/tsconfig.json`
Expected: `cloud-snapshots/index.ts` 无新错误

- [ ] **Step 4: 调用端补齐（微缩侧栏与桥接）**

`editor/apps/web/src/components/editor/panels/assets/views/library.tsx:210` 维持原图语义，但显式补空字符串以便阅读：

```tsx
						if (created) registerMediaFid(created.id, item.fid, "");
```

- [ ] **Step 5: 提交**

```bash
git add editor/apps/web/src/services/cloud-snapshots/index.ts editor/apps/web/src/components/editor/panels/assets/views/library.tsx
git commit -m "feat(editor): 云备份/拉取按版本引用还原衍生素材"
```

---

### Task 9: 送入剪辑载荷支持衍生版与正确 mime

**Files:**
- Modify: `editor/apps/web/src/components/mls-bridge.tsx:13-19,33-96`

- [ ] **Step 1: 扩载荷类型并归一化**

把 L13-19 的 `MlsAssetPayload` 替换为：

```ts
export interface MlsAssetPayload {
	fid: string;
	file_name: string;
	mime?: string;
	duration?: number;
	/** 衍生版本 id；为空表示原图 */
	derivativeId?: string;
	/** 素材库详情页的旧字段名，兼容「素材库 → 送入剪辑」路径 */
	activeDerivativeId?: string;
	kind?: string;
	[key: string]: unknown;
}
```

在 `handleImportPayload` 开头（`const toastId` 之前）插入归一出：

```ts
		const derivativeId = String(
			payload.derivativeId || payload.activeDerivativeId || "",
		);
		const mime = payload.mime
			|| (payload.kind === "image" ? "image/jpeg"
				: payload.kind === "audio" ? "audio/mpeg"
					: "video/mp4");
```

`fetch` 的 URL（L44）改为：

```ts
			const downloadBase = `/api/viewer/assets/${encodeURIComponent(payload.fid)}/file`;
			const downloadUrl = derivativeId
				? `${downloadBase}?derivative=${encodeURIComponent(derivativeId)}`
				: downloadBase;
			const res = await fetch(downloadUrl, { headers });
```

`new File` 的 type（L49-51）改为：

```ts
			const file = new File([blob], payload.file_name, { type: mime });
```

`registerMediaFid`（L68）改为：

```ts
			registerMediaFid(created.id, payload.fid, derivativeId);
```

- [ ] **Step 2: 类型检查**

Run: `node apps/web/node_modules/typescript/bin/tsc --noEmit -p apps/web/tsconfig.json`
Expected: 无新错误

- [ ] **Step 3: 提交**

```bash
git add editor/apps/web/src/components/mls-bridge.tsx
git commit -m "fix(editor): 送入剪辑支持衍生版与图片/音频 mime，不再一律按 mp4 处理"
```

---

### Task 10: 后端下载端点实证（一次 curl，不改代码）

**Files:** 无代码改动

- [ ] **Step 1: 准备一个带衍生版的素材 fid**

Run（在仓库根，`$TOKEN` 换成网页登录后 localStorage 里的 `ml_token`）：

```bash
curl.exe -s -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:30001/api/viewer/assets?media_type=image&limit=1" | head -c 600
```

Expected: 返回 JSON，其中 `data.items[0].fid` 即素材 fid。

- [ ] **Step 2: 取该素材的衍生版 id**

```bash
curl.exe -s -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:30001/api/viewer/assets/<FID>" | head -c 1200
```

Expected: `data.derivatives` 数组里每项有 `id` 与 `kind`，记录一个非 `origin` 的 `id`。

- [ ] **Step 3: 对比原图与衍生版的字节大小**

```bash
curl.exe -s -o NUL -w "origin %{http_code} %{size_download}\n" -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:30001/api/viewer/assets/<FID>/file"
curl.exe -s -o NUL -w "deriv  %{http_code} %{size_download}\n" -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:30001/api/viewer/assets/<FID>/file?derivative=<DERIV_ID>"
```

Expected: 两行均为 `200`，且 `size_download` 不同（证明 derivative 分支真实生效，没有被 origin 覆盖）。把实际数值记录到实施记录里。

- [ ] **Step 4: 无提交**（本任务不产生代码变更）

---

### Task 11: Phase A 浏览器全链路验收

**Files:** 无代码改动

- [ ] **Step 1: 确认三个服务在跑**

```bash
curl.exe -s -o NUL -w "30001 %{http_code}\n" http://127.0.0.1:30001/api/viewer/assets?limit=1
curl.exe -s -o NUL -w "30002 %{http_code}\n" http://127.0.0.1:30002
curl.exe -s -o NUL -w "3010  %{http_code}\n" http://127.0.0.1:3010/editor/projects
```

Expected: 三个都是 200（30001 未带 token 可能是 401，也算服务存活）。

- [ ] **Step 2: 走完整导入链路**

在浏览器 `http://localhost:30002` 登录 → 媒体剪辑 → 打开剪辑工作台 → 素材面板「云端素材库」→ 点一张有多版本的图片 → 版本面板出现 → 选一个衍生版（如「9:16 画幅重构」）→「导入并上轨」。

Expected:
- 时间轴出现一段新素材，画面内容是该衍生版（画幅与列表缩略图不同）
- 媒体池里能看到该素材，缩略图正确
- 控制台无 404/500

- [ ] **Step 3: 同一素材导入两个版本**

对同一张图分别选「原图」和另一个衍生版导入。

Expected: 媒体池出现两条独立素材，缩略图不同；备份后不互相覆盖。

- [ ] **Step 4: 云备份 → 新建 → 拉取还原**

工程页「备份到云端」→ 回工程列表 →「云端工程」拉取刚备份的那份。

Expected: 拉取后时间轴排版与备份前一致；两个版本的素材各自还原成正确的画面（不是两个一样的原图），媒体池条目数正确。

- [ ] **Step 5: 送入剪辑（素材库详情页）**

在素材库打开一张图 → 切到某个衍生版 → 点「送入媒体剪辑轨道」。

Expected: 剪辑工作台收到该衍生版并自动上轨，不再报错、不再是原图。

- [ ] **Step 6: 提交验收记录**

```bash
git status
```

Expected: 工作区干净（本任务不改代码）；若有调试脚本产生，删除后再结束。

---

# Phase B：AI 生成视频/音乐入素材库 + 送入剪辑载荷

### Task 12: AI 视频生成后入库

**Files:**
- Modify: `web-pro/src/views/studio/ChatStudio.vue:3544-3564`

- [ ] **Step 1: 在消息入列前补入库调用**

在 `const asstMsg = { ... }`（视频分支，L3544-3554）之后、`messages.value.push(asstMsg);` 之前插入：

```js
      try {
        const filed = await registerGeneratedAsset({
          previewUrl: genVideoUrl,
          parentFid: currentTray.find((item) => item.fid)?.fid || '',
          refFids: currentTray.map((item) => item.fid).filter(Boolean).slice(1),
          prompt: rawContent,
          model: videoModelKey.value,
          mode: 'video',
          ratio: submitRatio,
          resolution: submitSize,
          sessionId: currentSessionId.value
        });
        asstMsg.assetFid = filed.fid;
      } catch (fileErr) {
        // 入库失败不阻断消息展示：视频仍可播放、可下载
        console.warn('写入精修素材失败', fileErr);
      }
```

> `registerGeneratedAsset` 已在文件 L1645 附近引入；后端 `registerGenerated` 按扩展名识别 `.mp4` 为 video，并把 `library_shelf` 设为 `retouched`。

- [ ] **Step 2: 校验语法与构建**

Run: `npm run build`（在 `web-pro/` 目录）
Expected: 构建成功，无语法错误

- [ ] **Step 3: 浏览器验证入库**

生成一条视频（或用历史会话里已生成的视频消息重试），完成后切到素材库 → 货架「精修/AI创作」。

Expected: 出现该视频条目，可播放；视频缩略图稍后出现（后台抽帧 `/poster`）。

- [ ] **Step 4: 提交**

```bash
git add web-pro/src/views/studio/ChatStudio.vue
git commit -m "feat(studio): AI 生成视频自动登记入精修货架"
```

---

### Task 13: AI 音乐生成后入库

**Files:**
- Modify: `web-pro/src/views/studio/ChatStudio.vue:3578-3589`

- [ ] **Step 1: 在消息入列前补入库调用**

在音乐分支的 `const asstMsg = { ... }`（L3578-3588）之后、`messages.value.push(asstMsg);` 之前插入：

```js
      try {
        const filed = await registerGeneratedAsset({
          previewUrl: genAudioUrl,
          parentFid: currentTray.find((item) => item.fid)?.fid || '',
          refFids: currentTray.map((item) => item.fid).filter(Boolean).slice(1),
          prompt: rawContent,
          model: musicType.value,
          mode: 'music',
          sessionId: currentSessionId.value
        });
        // 多产物时只登记第一条：当前播放器也只播第一条，其余暂不入库
        asstMsg.assetFid = filed.fid;
      } catch (fileErr) {
        console.warn('写入精修素材失败', fileErr);
      }
```

- [ ] **Step 2: 构建验证**

Run: `npm run build`（在 `web-pro/` 目录）
Expected: 构建成功

- [ ] **Step 3: 浏览器验证**

生成一条音乐 → 素材库「精修/AI创作」货架 → 音频类型筛选。

Expected: 条目存在，可试听；分类为 `music`（后端按 `kind==='audio'` 兜底）。

- [ ] **Step 4: 提交**

```bash
git add web-pro/src/views/studio/ChatStudio.vue
git commit -m "feat(studio): AI 生成音乐自动登记入精修货架"
```

---

### Task 14: 修复「送入剪辑」载荷（视频消息）

**Files:**
- Modify: `web-pro/src/views/studio/ChatStudio.vue:3842-3844`

- [ ] **Step 1: 构造规范载荷**

把 `sendVideoToClip` 替换为：

```js
function sendVideoToClip(msg) {
  // 剪辑桥接只认 {fid, file_name, mime, duration}；直接把消息对象丢过去会因缺 fid 被静默丢弃
  if (msg.assetFid) {
    emit('sendToClip', {
      fid: msg.assetFid,
      file_name: `AI视频_${Date.now()}.mp4`,
      mime: 'video/mp4',
      duration: parseFloat(String(msg.duration || '')) || 0,
      derivativeId: ''
    });
    return;
  }
  alert('该视频尚未完成入库，请稍后重试或先下载 MP4 手动导入');
}
```

- [ ] **Step 2: 构建验证**

Run: `npm run build`（在 `web-pro/` 目录）
Expected: 构建成功

- [ ] **Step 3: 浏览器验证**

在 AI 对话历史里找一条已入库的视频消息（有 `assetFid`）→ 点「送入剪辑」。

Expected: 自动切到剪辑工作台并新建/进入工程，视频自动上轨，Toast 提示「素材…已自动载入并插入时间轴」；不再出现点了没反应。

- [ ] **Step 4: 提交**

```bash
git add web-pro/src/views/studio/ChatStudio.vue
git commit -m "fix(studio): 送入剪辑改为发送规范素材载荷，修复视频无法上轨"
```

---

### Task 15: Phase B 全链路验收与收尾

**Files:** 无代码改动

- [ ] **Step 1: 端到端跑一遍**

AI 创作 → 对话 → 生成视频 → 生成音乐 → 素材库确认两条都在「精修/AI创作」→ 视频点「送入剪辑」→ 剪辑工作台自动上轨 → 备份到云端 → 拉取还原。

Expected: 每一步都成功；拉取后视频仍在时间轴上且可播放。

- [ ] **Step 2: 汇总检查**

Run（在 `editor/` 目录）: `node apps/web/node_modules/typescript/bin/tsc --noEmit -p apps/web/tsconfig.json`
Run（在 `editor/` 目录）: `bun test apps/web/src/ml-asset-core.test.ts apps/web/src/services/cloud-snapshots/fid-ref.test.ts`
Run（在 `web-pro/` 目录）: `npm run build`

Expected: tsc 无新增错误；测试全绿；构建成功。

- [ ] **Step 3: 收尾**

```bash
git status
```

Expected: 工作区干净。

---

## 自检清单（执行完成后核对）

- [ ] 共享 core 两端都被真实引用（web-pro `AssetPickerModal.vue`、editor `asset-library-picker-modal.tsx`），没有第二份重复的标签/版本逻辑
- [ ] 同一素材的两个版本在剪辑器里能同时导入，且备份/拉取后仍是两个不同画面
- [ ] 老快照（`mediaFidMap` 值为裸 fid）拉取仍正常，不出现 404
- [ ] AI 视频与音乐生成后都能在「精修/AI创作」货架找到
- [ ] AI 视频「送入剪辑」真实上轨
- [ ] 后端 `src/` 目录零改动（本次只用 curl 实证）
