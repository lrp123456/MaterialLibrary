/**
 * 素材「默认衍生图」预置插槽。
 *
 * 一张图在挂载前理论上就该具备若干标准画幅衍生图（室内外设计默认 9:16 + 3:4）。
 * 版本面板据此把「缺失的那一档」渲染成待生成插槽，点一下就现场补出来，
 * 而不是让用户对着只有原图的版本列表自己去别处生成。
 *
 * 规格与后端 derivatives.kind 一一对应（restage_9_16 / restage_3_4），
 * 生成走 `POST /api/viewer/assets/<fid>/restage`，body.ratios 传本模块的 ratio。
 *
 * 本文件不依赖任何框架：web-pro(Vue) 与 editor(React) 共用。
 */

/** 一个标准画幅插槽。 */
export interface DerivativeSlotPreset {
	/** 与后端 derivatives.kind 对齐，例如 restage_9_16 */
	kind: string;
	/** 后端生成接口吃的画幅键，例如 9:16 */
	ratio: string;
	/** 面板卡片标题 */
	label: string;
	/** 卡片角标用的短标签 */
	shortLabel: string;
}

export const SLOT_9_16: DerivativeSlotPreset = {
	kind: 'restage_9_16',
	ratio: '9:16',
	label: '9:16 竖图',
	shortLabel: '9:16',
};

export const SLOT_3_4: DerivativeSlotPreset = {
	kind: 'restage_3_4',
	ratio: '3:4',
	label: '3:4 竖图',
	shortLabel: '3:4',
};

/** 后端当前能产出的全部标准画幅（新增规格要先让 restage 节点支持）。 */
export const ALL_SLOT_PRESETS: DerivativeSlotPreset[] = [SLOT_9_16, SLOT_3_4];

/** 类目别名归一：前端筛选用的 interior_exterior 与后端原始 interior/exterior 归一到同一组。 */
export function normalizeSlotCategory(raw?: string): string {
	const key = String(raw || '').trim().toLowerCase();
	if (!key) return 'default';
	if (key === 'interior_exterior' || key === 'interior' || key === 'exterior') return 'interior_exterior';
	if (key === 'portrait' || key === 'clothing' || key === 'furniture' || key === 'finished') return key;
	return 'default';
}

/** 设置页按这个顺序与文案渲染分组。 */
export const SLOT_CATEGORY_LABELS: Record<string, string> = {
	interior_exterior: '室内外设计',
	portrait: '空间人像',
	clothing: '服装服饰',
	furniture: '单品家具',
	finished: '成品素材',
	default: '其它图片',
};

/** 设置页可编辑的类目顺序（default 兜底项放最后）。 */
export const SLOT_CATEGORY_ORDER: string[] = [
	'interior_exterior',
	'portrait',
	'clothing',
	'furniture',
	'finished',
	'default',
];

/** 出厂预设：室内外与单品等默认要求 9:16 与 3:4；人像与服装严格仅保留原图，不预置画幅插槽。 */
export const DEFAULT_SLOT_RATIOS: Record<string, string[]> = {
	interior_exterior: ['9:16', '3:4'],
	portrait: [],
	clothing: [],
	furniture: ['9:16', '3:4'],
	finished: ['9:16', '3:4'],
	default: ['9:16', '3:4'],
};

export interface DerivativeSlotPrefs {
	/** 总开关：关闭后任何选择器都不再出现待生成插槽。 */
	enabled: boolean;
	/** 类目 → 画幅键列表；显式空数组表示该类目不做预置。 */
	ratios: Record<string, string[]>;
}

const PREFS_KEY = 'ml.derivative-slot-prefs.v1';
const PREFS_EVENT = 'ml:derivative-slot-prefs-changed';

export function defaultSlotPrefs(): DerivativeSlotPrefs {
	return { enabled: true, ratios: { ...DEFAULT_SLOT_RATIOS } };
}

/** 读取设置；任何异常或脏数据都退回出厂预设，避免选择器整体不可用。 */
export function readDerivativeSlotPrefs(): DerivativeSlotPrefs {
	if (typeof window === 'undefined') return defaultSlotPrefs();
	try {
		const raw = window.localStorage.getItem(PREFS_KEY);
		if (!raw) return defaultSlotPrefs();
		const parsed = JSON.parse(raw);
		const ratios: Record<string, string[]> = { ...DEFAULT_SLOT_RATIOS };
		const src = parsed && typeof parsed === 'object' ? parsed.ratios : null;
		if (src && typeof src === 'object') {
			for (const [key, value] of Object.entries(src)) {
				if (!Array.isArray(value)) continue;
				ratios[String(key)] = value.filter((x): x is string => typeof x === 'string');
			}
		}
		return { enabled: parsed?.enabled !== false, ratios };
	} catch {
		return defaultSlotPrefs();
	}
}

/** 写入设置并广播；同域下 web-pro 与 editor 共用同一份。 */
export function writeDerivativeSlotPrefs(prefs: DerivativeSlotPrefs): void {
	if (typeof window === 'undefined') return;
	try {
		window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
		window.dispatchEvent(new CustomEvent(PREFS_EVENT, { detail: prefs }));
	} catch {
		/* 隐私模式下写入失败时保持静默：本次会话内的设置弹窗仍会即时生效 */
	}
}

/** 订阅设置变更（同页自定义事件 + 跨标签页 storage 事件），返回取消函数。 */
export function onDerivativeSlotPrefsChange(
	callback: (prefs: DerivativeSlotPrefs) => void,
): () => void {
	if (typeof window === 'undefined') return () => {};
	const onLocal = () => callback(readDerivativeSlotPrefs());
	const onStorage = (event: StorageEvent) => {
		if (event.key !== PREFS_KEY) return;
		callback(readDerivativeSlotPrefs());
	};
	window.addEventListener(PREFS_EVENT, onLocal);
	window.addEventListener('storage', onStorage);
	return () => {
		window.removeEventListener(PREFS_EVENT, onLocal);
		window.removeEventListener('storage', onStorage);
	};
}

/** 某个类目当前应当具备的插槽列表；总开关关闭或人像/服装类目时返回空数组。 */
export function slotPresetsFor(
	category?: string,
	prefs?: DerivativeSlotPrefs,
): DerivativeSlotPreset[] {
	const key = normalizeSlotCategory(category);
	if (key === 'portrait' || key === 'clothing') return [];
	const resolved = prefs || readDerivativeSlotPrefs();
	if (!resolved.enabled) return [];
	const ratios = resolved.ratios[key] ?? DEFAULT_SLOT_RATIOS[key] ?? DEFAULT_SLOT_RATIOS.default ?? [];
	return ratios
		.map((ratio) => ALL_SLOT_PRESETS.find((slot) => slot.ratio === ratio))
		.filter((slot): slot is DerivativeSlotPreset => Boolean(slot));
}

/**
 * 还缺哪几档：拿已有衍生版本的 kind 跟类目预设求差集。
 * 只喂详情接口返回的 derivatives（后端已过滤成合格衍生），因此不会把
 * 「有记录但没真正生成成功」的旧数据误判为已具备。
 */
export function missingSlotPresets(
	category: string | undefined,
	derivatives: Array<{ kind?: string }> | undefined,
	prefs?: DerivativeSlotPrefs,
): DerivativeSlotPreset[] {
	const presets = slotPresetsFor(category, prefs);
	if (!presets.length) return [];
	const have = new Set(
		(derivatives || [])
			.map((item) => String(item?.kind || ''))
			.filter(Boolean),
	);
	return presets.filter((slot) => !have.has(slot.kind));
}

/** 插槽的运行状态，与后端 detail.restageStatus[kind] 的取值保持一致。 */
export type DerivativeSlotStatus = 'missing' | 'queued' | 'running' | 'failed' | 'ready';

export function slotStatusFromDetail(
	kind: string,
	restageStatus?: Record<string, unknown> | null,
): DerivativeSlotStatus {
	const raw = String((restageStatus || {})[kind] || '');
	if (raw === 'ready' || raw === 'queued' || raw === 'running' || raw === 'failed') {
		return raw;
	}
	return 'missing';
}

/** 只有这两种状态代表「生成还没结束」，插槽需要展示为进行中并禁止重复点击。 */
export function isSlotBusy(status: DerivativeSlotStatus): boolean {
	return status === 'queued' || status === 'running';
}
