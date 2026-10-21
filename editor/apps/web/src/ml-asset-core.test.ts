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
