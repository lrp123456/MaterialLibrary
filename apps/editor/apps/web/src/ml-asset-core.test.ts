import { describe, expect, test } from "bun:test";
import {
	DERIVATIVE_LABELS,
	defaultSlotPrefs,
	derivativeLabel,
	isGeometryKind,
	isSelected,
	isSlotBusy,
	missingSlotPresets,
	normalizeSlotCategory,
	slotPresetsFor,
	slotStatusFromDetail,
	stripVersionKey,
	toggleSelection,
	versionKey,
	versionsOf,
} from "../../../../shared/ml-asset-core/index";

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

	test("原型链上的键不会被当成标签", () => {
		expect(derivativeLabel("constructor")).toBe("constructor");
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

describe("normalizeSlotCategory", () => {
	test("前端筛选键与后端原始类目归一到同一组", () => {
		expect(normalizeSlotCategory("interior_exterior")).toBe("interior_exterior");
		expect(normalizeSlotCategory("interior")).toBe("interior_exterior");
		expect(normalizeSlotCategory("exterior")).toBe("interior_exterior");
	});

	test("已知类目原样返回，未知与空值走 default", () => {
		expect(normalizeSlotCategory("clothing")).toBe("clothing");
		expect(normalizeSlotCategory("portrait")).toBe("portrait");
		expect(normalizeSlotCategory("")).toBe("default");
		expect(normalizeSlotCategory("nonsense")).toBe("default");
	});
});

describe("slotPresetsFor", () => {
	test("出厂预设是 9:16 + 3:4", () => {
		const slots = slotPresetsFor("interior_exterior", defaultSlotPrefs());
		expect(slots.map((s) => s.ratio)).toEqual(["9:16", "3:4"]);
		expect(slots.map((s) => s.kind)).toEqual(["restage_9_16", "restage_3_4"]);
	});

	test("总开关关闭时不再给任何插槽", () => {
		const prefs = { ...defaultSlotPrefs(), enabled: false };
		expect(slotPresetsFor("interior_exterior", prefs)).toEqual([]);
	});

	test("按类目覆盖只留一个规格", () => {
		const prefs = defaultSlotPrefs();
		prefs.ratios.furniture = ["3:4"];
		expect(slotPresetsFor("furniture", prefs).map((s) => s.kind)).toEqual(["restage_3_4"]);
	});

	test("人像与服装不预置画幅插槽（即便偏好里有档位）", () => {
		const prefs = defaultSlotPrefs();
		prefs.ratios.clothing = ["3:4"];
		expect(slotPresetsFor("clothing", prefs)).toEqual([]);
		expect(slotPresetsFor("portrait", prefs)).toEqual([]);
	});

	test("类目被显式清空时该类目不补位", () => {
		const prefs = defaultSlotPrefs();
		prefs.ratios.furniture = [];
		expect(slotPresetsFor("furniture", prefs)).toEqual([]);
	});
});

describe("missingSlotPresets", () => {
	const prefs = defaultSlotPrefs();

	test("只有原图时两档全缺", () => {
		const miss = missingSlotPresets("interior_exterior", [{ kind: "origin" }], prefs);
		expect(miss.map((s) => s.kind)).toEqual(["restage_9_16", "restage_3_4"]);
	});

	test("已有的那一档不再出现在缺失里", () => {
		const miss = missingSlotPresets("interior_exterior", [{ kind: "origin" }, { kind: "restage_9_16" }], prefs);
		expect(miss.map((s) => s.kind)).toEqual(["restage_3_4"]);
	});

	test("两档都有就没有插槽", () => {
		const miss = missingSlotPresets(
			"interior_exterior",
			[{ kind: "restage_9_16" }, { kind: "restage_3_4" }],
			prefs,
		);
		expect(miss).toEqual([]);
	});

	test("衍生数据缺失时全部算缺", () => {
		expect(missingSlotPresets("interior_exterior", undefined, prefs)).toHaveLength(2);
	});

	test("人像/服装永远没有缺失插槽", () => {
		expect(missingSlotPresets("portrait", undefined, prefs)).toEqual([]);
		expect(missingSlotPresets("clothing", [{ kind: "origin" }], prefs)).toEqual([]);
	});
});

describe("slotStatusFromDetail", () => {
	test("后端状态透传", () => {
		expect(slotStatusFromDetail("restage_9_16", { restage_9_16: "running" })).toBe("running");
		expect(slotStatusFromDetail("restage_3_4", { restage_3_4: "failed" })).toBe("failed");
	});

	test("未知或缺失都按 missing 处理", () => {
		expect(slotStatusFromDetail("restage_9_16", null)).toBe("missing");
		expect(slotStatusFromDetail("restage_9_16", { restage_9_16: "weird" })).toBe("missing");
	});
});

describe("isSlotBusy", () => {
	test("排队与生成中视为忙", () => {
		expect(isSlotBusy("queued")).toBe(true);
		expect(isSlotBusy("running")).toBe(true);
	});

	test("缺失/失败/就绪都可以再次操作", () => {
		expect(isSlotBusy("missing")).toBe(false);
		expect(isSlotBusy("failed")).toBe(false);
		expect(isSlotBusy("ready")).toBe(false);
	});
});
