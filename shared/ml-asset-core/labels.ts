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
	return Object.hasOwn(DERIVATIVE_LABELS, key) ? DERIVATIVE_LABELS[key] : key || "衍生版本";
}

export function isGeometryKind(kind?: string): boolean {
	return GEOMETRY_KINDS.has(String(kind || ""));
}
