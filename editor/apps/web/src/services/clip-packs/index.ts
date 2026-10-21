/**
 * 声明式资源包加载器。
 *
 * 事实约束（2026-10-20 核实）：
 * OpenCut 的 GPU 合成器把 shader 编译进了 opencut-wasm，
 * 当前 Rust 侧只注册了一个 shader id：`gaussian-blur`
 * （见 editor/rust/crates/effects/src/pipeline.rs:10,135）。
 * 因此：
 *   - 资源包可以自由定义"参数预设"，但 render.passes[].shader 必须命中内置 id；
 *   - 想引入新 shader（发光/锐化/胶片颗粒…）必须改 Rust 并重编 wasm，不能靠丢文件实现。
 * 加载器对无法渲染的包不注册，并在状态里标出原因，避免"面板里有、拖上去没效果"。
 *
 * 例外是 type=operation 的能力插件：它没有渲染通道，只登记到 getPluginOperations()，
 * runner 仅是标识，执行体固定在服务端 data/clip-ai-runners/，前端不执行任何包内代码。
 */
import { effectsRegistry } from "@/effects/registry";
import type { EffectDefinition } from "@/effects/types";
import type { ParamDefinition, ParamValues } from "@/params";

/** 与 rust/crates/effects/src/pipeline.rs 的 shader_defs 保持同步。 */
export const BUILTIN_SHADERS = new Set<string>([
	"gaussian-blur",
	"glow",
	"sharpen",
	"skin-smooth",
	"grade",
	"warp",
	"channel",
]);

/**
 * 转场通道的 shader id。
 *
 * 它不在 effects 的 shader_defs 里：转场是双输入，由 compositor 的
 * transition pipeline 执行（见 rust/crates/compositor/src/shaders/transition.wgsl），
 * 所以单独判定，不混进 BUILTIN_SHADERS 以免误导"这是单输入特效"。
 */
export const TRANSITION_SHADER_ID = "transition";

export type ClipPackType =
	| "effect"
	| "transition"
	| "textTemplate"
	| "lut"
	| "sticker"
	| "assetPack"
	| "operation";

export interface ClipPackParam {
	key: string;
	type: "number" | "boolean" | "color" | "enum" | "string" | "vec2";
	label: { zh: string; en?: string };
	default?: unknown;
	min?: number;
	max?: number;
	step?: number;
	keyframable?: boolean;
	options?: Array<{ value: string | number | boolean; label: { zh: string } }>;
}

export interface ClipPack {
	id: string;
	type: ClipPackType;
	version: string;
	nameZh: string;
	contentHash: string;
	enabled: boolean;
	manifest: {
		id: string;
		type: ClipPackType;
		name: { zh: string; en?: string };
		description?: { zh: string; en?: string };
		version: string;
		params?: ClipPackParam[];
		render?: { passes: Array<{ shader: string; uniforms?: Record<string, string> }> };
		transition?: { defaultDuration?: number; mode?: number };
		textTemplate?: Record<string, unknown>;
		lut?: { size: number; file?: string };
		assets?: Array<{ path: string; kind: string; thumb?: string }>;
		operation?: {
			input: string[];
			output: string;
			runner: string;
			params?: ClipPackParam[];
		};
		license?: { type: string; source: string };
		tags?: string[];
		preview?: string;
	};
}

/** 单个资源包在面板里的可用性快照（比 registered/blocked 两个 id 列表更好展示）。 */
export interface ClipPackEntry {
	id: string;
	nameZh: string;
	type: ClipPackType;
	/** 是否已被某个通道接住（渲染注册表 / 转场预设 / operation 列表 / 素材面板） */
	usable: boolean;
	/** 不可用或未注册的原因；可用且正常注册时为空串 */
	reason: string;
}

export interface ClipPackStatus {
	loaded: boolean;
	error: string;
	registered: string[];
	blocked: Array<{ id: string; reason: string }>;
	byType: Record<string, number>;
	/** 每个已加载包一条，供插件面板逐条展示 */
	packs: ClipPackEntry[];
}

const status: ClipPackStatus = {
	loaded: false,
	error: "",
	registered: [],
	blocked: [],
	byType: {},
	packs: [],
};

/** 转场预设：从 type=transition 的资源包解析出的渲染参数 */
export interface TransitionPreset {
	id: string;
	nameZh: string;
	descriptionZh: string;
	tags: string[];
	/** transition.wgsl 的 mode 常量 */
	mode: number;
	/** 默认时长（秒） */
	defaultDuration: number;
	params: ParamDefinition[];
	defaultParams: ParamValues;
}

/** 帧构建需要的转场 uniform */
export interface TransitionRender {
	mode: number;
	scalars: [number, number, number, number];
	direction: [number, number];
}

/**
 * 能力插件（type=operation）。
 *
 * 与 effect / transition 的本质区别：它没有渲染通道，也不进 effectsRegistry。
 * 清单只声明 runner 标识、输入输出与参数；执行体固定在服务端
 * <dataDir>/clip-ai-runners/<runner>.js —— 前端既不加载也不执行包内任何代码。
 */
export interface PluginOperation {
	id: string;
	nameZh: string;
	descriptionZh: string;
	/** 执行体标识（对应服务端 runner 文件名，不含 .js） */
	runner: string;
	/** 接受的输入种类：video / audio / image / text */
	input: string[];
	/** 产出种类标识，如 cuts / audio / segments */
	output: string;
	params: ParamDefinition[];
	defaultParams: ParamValues;
}

/** runner 只允许小写标识符：与 src/clip-packs.js 的 RUNNER_RE 保持一致。 */
const RUNNER_ID_RE = /^[a-z0-9][a-z0-9-]*$/;
const pluginOperations = new Map<string, PluginOperation>();

const transitionPresets = new Map<string, TransitionPreset>();
/** id → 资源包里的 uniform 表达式（u_scalar0..3 / u_direction / mode） */
const transitionUniformExprs = new Map<
	string,
	Record<string, string>
>();

let inflight: Promise<void> | null = null;

export function getClipPackStatus(): ClipPackStatus {
	return status;
}

function authHeaders(): Record<string, string> {
	try {
		const token = localStorage.getItem("ml_token") || "";
		return token ? { Authorization: `Bearer ${token}` } : {};
	} catch {
		return {};
	}
}

function resolveUniform(
	expr: string | undefined,
	effectParams: Record<string, unknown>,
): number | number[] {
	if (expr == null) return 0;
	const s = String(expr).trim();
	if (s.startsWith("$")) {
		const raw = effectParams[s.slice(1)];
		const n = typeof raw === "number" ? raw : Number.parseFloat(String(raw));
		return Number.isFinite(n) ? n : 0;
	}
	if (/^\[.*\]$/.test(s)) {
		const parts = s
			.slice(1, -1)
			.split(",")
			.map((x) => Number.parseFloat(x.trim()))
			.filter((n) => Number.isFinite(n));
		return parts.length ? parts : [0, 0];
	}
	const n = Number.parseFloat(s);
	return Number.isFinite(n) ? n : 0;
}

function toParamDefinitions(params: ClipPackParam[] | undefined): {
	params: ParamDefinition[];
	skipped: string[];
} {
	const out: ParamDefinition[] = [];
	const skipped: string[] = [];
	for (const p of params || []) {
		const label = p.label?.zh || p.key;
		if (p.type === "number") {
			out.push({
				key: p.key,
				label,
				type: "number",
				default: typeof p.default === "number" ? p.default : 0,
				min: typeof p.min === "number" ? p.min : 0,
				max: typeof p.max === "number" ? p.max : 1,
				step: typeof p.step === "number" && p.step > 0 ? p.step : 0.01,
				keyframable: !!p.keyframable,
			});
			continue;
		}
		if (p.type === "boolean") {
			out.push({
				key: p.key,
				label,
				type: "boolean",
				default: !!p.default,
			});
			continue;
		}
		if (p.type === "color") {
			out.push({
				key: p.key,
				label,
				type: "color",
				default: typeof p.default === "string" ? p.default : "#ffffff",
			});
			continue;
		}
		if (p.type === "enum" && p.options?.length) {
			const first = p.options[0].value;
			out.push({
				key: p.key,
				label,
				type: "select",
				default:
					typeof p.default === "string" ? p.default : String(first ?? ""),
				options: p.options.map((o) => ({
					value: String(o.value),
					label: o.label?.zh || String(o.value),
				})),
			});
			continue;
		}
		// string / vec2 目前没有对应的参数控件，跳过但不报错。
		skipped.push(p.key);
	}
	return { params: out, skipped };
}

function toEffectDefinition(pack: ClipPack): {
	definition: EffectDefinition | null;
	reason?: string;
} {
	const passes = pack.manifest.render?.passes || [];
	if (!passes.length) return { definition: null, reason: "缺少 render.passes" };

	const unknown = passes
		.map((p) => p.shader)
		.filter((s) => !BUILTIN_SHADERS.has(s));
	if (unknown.length) {
		return {
			definition: null,
			reason: `shader 未内置：${[...new Set(unknown)].join(", ")}（需重编 opencut-wasm）`,
		};
	}

	const { params, skipped } = toParamDefinitions(pack.manifest.params);
	if (skipped.length) {
		// 只记录，不阻断：跳过的参数不影响已有参数的渲染。
		status.blocked.push({
			id: pack.id,
			reason: `参数控件未支持：${skipped.join(", ")}`,
		});
	}

	const definition: EffectDefinition = {
		type: pack.id,
		name: pack.manifest.name.zh,
		keywords: [pack.manifest.name.zh, ...(pack.manifest.tags || [])],
		params,
		renderer: {
			passes: passes.map((pass) => ({
				shader: pass.shader,
				uniforms: ({ effectParams }: { effectParams: Record<string, unknown> }) => {
					const uniforms: Record<string, number | number[]> = {};
					for (const [k, expr] of Object.entries(pass.uniforms || {})) {
						uniforms[k] = resolveUniform(expr, effectParams);
					}
					return uniforms;
				},
			})),
		},
	};
	return { definition };
}

/**
 * 转场包 → UI 预设 + uniform 表达式。
 *
 * 与 effect 包的区别：转场没有 effects registry，只有 mode + uniform 两组数据，
 * 帧构建时由 resolveTransitionRender 用元素自身的 params 现算。
 */
function toTransitionPreset(pack: ClipPack): {
	preset: TransitionPreset | null;
	reason?: string;
} {
	const passes = pack.manifest.render?.passes || [];
	if (!passes.length) return { preset: null, reason: "缺少 render.passes" };
	const pass = passes[0];
	if (pass.shader !== TRANSITION_SHADER_ID) {
		return {
			preset: null,
			reason: `转场 shader 必须是 "${TRANSITION_SHADER_ID}"，实际为 ${pass.shader}`,
		};
	}

	const { params } = toParamDefinitions(pack.manifest.params);
	const defaultParams: ParamValues = {};
	for (const param of params) {
		defaultParams[param.key] = param.default as ParamValues[string];
	}

	const uniforms = pass.uniforms || {};
	const modeSource = uniforms.mode;
	const rawMode =
		modeSource !== undefined
			? resolveUniform(modeSource, defaultParams)
			: (pack.manifest.transition?.mode ?? 0);
	const modeValue = Array.isArray(rawMode) ? rawMode[0] : rawMode;
	const mode = Number.isFinite(modeValue) ? Math.trunc(modeValue) : 0;

	const preset: TransitionPreset = {
		id: pack.id,
		nameZh: pack.manifest.name.zh,
		descriptionZh: pack.manifest.description?.zh ?? "",
		tags: pack.manifest.tags ?? [],
		mode,
		defaultDuration:
			typeof pack.manifest.transition?.defaultDuration === "number"
				? pack.manifest.transition.defaultDuration
				: 0.6,
		params,
		defaultParams,
	};
	transitionUniformExprs.set(pack.id, uniforms);
	return { preset };
}

/** 已加载的转场预设（按 mode 排序，保证面板顺序稳定） */
export function getTransitionPresets(): TransitionPreset[] {
	return [...transitionPresets.values()].sort((a, b) => a.mode - b.mode);
}

export function getTransitionPreset({
	type,
}: {
	type: string;
}): TransitionPreset | null {
	return transitionPresets.get(type) ?? null;
}

/** 已加载的能力插件（按名称排序，保证面板顺序稳定） */
export function getPluginOperations(): PluginOperation[] {
	return [...pluginOperations.values()].sort((a, b) =>
		a.nameZh.localeCompare(b.nameZh, "zh"),
	);
}

/**
 * 帧构建用：把元素上的 params 代入资源包的 uniform 表达式，得到
 * transition.wgsl 需要的 mode / scalars / direction。
 * 包未加载时退化成 mode 0（叠化），不阻断渲染。
 */
export function resolveTransitionRender({
	type,
	params,
}: {
	type: string;
	params?: ParamValues;
}): TransitionRender {
	const preset = transitionPresets.get(type);
	const exprs = transitionUniformExprs.get(type);
	if (!preset || !exprs) {
		return { mode: 0, scalars: [0, 0, 0, 0], direction: [1, 0] };
	}

	const merged: ParamValues = { ...preset.defaultParams, ...(params ?? {}) };
	const scalarAt = (index: number): number => {
		const expr = exprs[`u_scalar${index}`];
		if (expr === undefined) return 0;
		const value = resolveUniform(expr, merged);
		return Array.isArray(value) ? (value[0] ?? 0) : value;
	};
	const directionRaw =
		exprs.u_direction !== undefined
			? resolveUniform(exprs.u_direction, merged)
			: [1, 0];
	const direction: [number, number] = Array.isArray(directionRaw)
		? [directionRaw[0] ?? 1, directionRaw[1] ?? 0]
		: [directionRaw, 0];

	return {
		mode: preset.mode,
		scalars: [scalarAt(0), scalarAt(1), scalarAt(2), scalarAt(3)],
		direction,
	};
}

/**
 * operation 包 → 能力插件描述。
 *
 * 这里刻意不做任何"加载执行体"的动作：runner 只是一个字符串标识，
 * 实际执行体在服务端，前端只拿它做展示与参数说明。
 */
function toPluginOperation(pack: ClipPack): {
	operation: PluginOperation | null;
	reason?: string;
} {
	const op = pack.manifest.operation;
	if (!op) return { operation: null, reason: "缺少 operation 配置" };
	if (typeof op.runner !== "string" || !RUNNER_ID_RE.test(op.runner)) {
		return {
			operation: null,
			reason: `runner 标识非法：${String(op.runner)}（只允许小写字母、数字与连字符）`,
		};
	}
	if (!Array.isArray(op.input) || !op.input.length) {
		return { operation: null, reason: "operation.input 为空" };
	}

	const { params } = toParamDefinitions(op.params);
	const defaultParams: ParamValues = {};
	for (const param of params) {
		defaultParams[param.key] = param.default as ParamValues[string];
	}

	return {
		operation: {
			id: pack.id,
			nameZh: pack.manifest.name.zh,
			descriptionZh: pack.manifest.description?.zh ?? "",
			runner: op.runner,
			input: op.input.map(String),
			output: typeof op.output === "string" ? op.output : "",
			params,
			defaultParams,
		},
	};
}

async function load(): Promise<void> {
	status.error = "";
	status.registered = [];
	status.blocked = [];
	status.byType = {};
	status.packs = [];
	transitionPresets.clear();
	transitionUniformExprs.clear();
	pluginOperations.clear();

	let items: ClipPack[] = [];
	try {
		const res = await fetch("/editor-api/packs", { headers: authHeaders() });
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const data = await res.json();
		items = (data.items || []) as ClipPack[];
	} catch (e) {
		status.loaded = false;
		status.error = e instanceof Error ? e.message : String(e);
		return;
	}

	for (const pack of items) {
		status.byType[pack.type] = (status.byType[pack.type] || 0) + 1;

		const entry: ClipPackEntry = {
			id: pack.id,
			nameZh: pack.nameZh || pack.manifest?.name?.zh || pack.id,
			type: pack.type,
			usable: false,
			reason: "",
		};
		// 不可用统一走这里：entry.reason 与 blocked 用同一句文案，面板不会自相矛盾。
		const block = (reason: string) => {
			entry.reason = reason;
			status.blocked.push({ id: pack.id, reason });
			status.packs.push(entry);
		};

		if (pack.type === "effect") {
			const { definition, reason } = toEffectDefinition(pack);
			if (!definition) {
				block(reason || "无法注册");
				continue;
			}
			if (!effectsRegistry.has(definition.type)) {
				effectsRegistry.register({ key: definition.type, definition });
			}
			status.registered.push(pack.id);
			entry.usable = true;
			status.packs.push(entry);
			continue;
		}

		// transition / textTemplate / lut 各自有独立通道，不进 effects registry
		if (pack.type === "transition") {
			const { preset, reason } = toTransitionPreset(pack);
			if (!preset) {
				block(reason || "无法注册");
				continue;
			}
			transitionPresets.set(pack.id, preset);
			status.registered.push(pack.id);
			entry.usable = true;
			status.packs.push(entry);
			continue;
		}

		// operation 只进 operations 列表：它不是渲染效果，不能注册进 effectsRegistry。
		if (pack.type === "operation") {
			const { operation, reason } = toPluginOperation(pack);
			if (!operation) {
				block(reason || "无法注册");
				continue;
			}
			pluginOperations.set(pack.id, operation);
			entry.usable = true;
			status.packs.push(entry);
			continue;
		}

		if (pack.type === "lut") {
			block("LUT 需要 shader 支持（需重编 opencut-wasm）");
			continue;
		}
		if (pack.type === "textTemplate") {
			block("文字模板渲染尚未接入（数据已就绪）");
			continue;
		}
		// sticker / assetPack 由素材面板直接消费，无需注册。
		entry.usable = true;
		entry.reason = "由素材面板直接消费，不进渲染注册表";
		status.packs.push(entry);
	}

	status.loaded = true;
}

/** 幂等：编辑器启动时调用一次即可，失败不抛错（不阻断编辑）。 */
export function ensureClipPacksLoaded(): Promise<void> {
	if (inflight) return inflight;
	inflight = load().catch((e) => {
		status.error = e instanceof Error ? e.message : String(e);
	});
	return inflight;
}

/** 手动重载（资源包 reload 之后调用）。 */
export function reloadClipPacks(): Promise<void> {
	inflight = null;
	return ensureClipPacksLoaded();
}
