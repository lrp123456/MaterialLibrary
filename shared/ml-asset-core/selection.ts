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
