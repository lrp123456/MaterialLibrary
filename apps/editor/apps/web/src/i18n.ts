/**
 * 轻量 i18n：只做中文字典 + t() 查表。
 *
 * 为什么不做全量 next-intl 抽取：
 * 这个仓库是 fork 来的冻结基线，全量抽取会让后续对照上游变得困难。
 * 现阶段策略是"高频界面逐条替换"，未翻译的英文仍会原样显示，
 * 不会因为缺键而白屏。新增文案只需往 messages/zh.ts 加一条。
 */
import { zh } from "./messages/zh";

export function t(key: string, fallback?: string): string {
	const value = (zh as Record<string, string>)[key];
	if (typeof value === "string") return value;
	return fallback ?? key;
}

/** 已翻译条目数，便于在控制台/测试里核对进度。 */
export function translatedCount(): number {
	return Object.keys(zh).length;
}

export const locale = "zh-CN";
