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
