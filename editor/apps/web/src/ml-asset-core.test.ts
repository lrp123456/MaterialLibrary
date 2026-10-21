import { describe, expect, test } from "bun:test";
import { DERIVATIVE_LABELS, derivativeLabel, isGeometryKind, isSelected, stripVersionKey, toggleSelection, versionKey, versionsOf } from "../../../../shared/ml-asset-core/index";

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
