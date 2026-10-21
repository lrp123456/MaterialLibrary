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

	test("空衍生 id 视为原图", () => {
		expect(parseMediaFidRef("abc::")).toEqual({ fid: "abc", derivativeId: "" });
	});

	test("衍生 id 含分隔符时只切第一个", () => {
		expect(parseMediaFidRef("a::b::c")).toEqual({ fid: "a", derivativeId: "b::c" });
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

	test("derivative 参数中的空格被编码", () => {
		expect(snapshotDownloadPath("abc", "d 1")).toBe(
			"/api/viewer/assets/abc/file?derivative=d%201",
		);
	});
});
