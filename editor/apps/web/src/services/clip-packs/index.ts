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
 */
import { effectsRegistry } from "@/effects/registry";
import type { EffectDefinition } from "@/effects/types";
import type { ParamDefinition } from "@/params";

/** 与 rust/crates/effects/src/pipeline.rs 的 shader_defs 保持同步。 */
export const BUILTIN_SHADERS = new Set<string>([
	"gaussian-blur",
	"glow",
	"sharpen",
	"skin-smooth",
]);

export type ClipPackType =
	| "effect"
	| "transition"
	| "textTemplate"
	| "lut"
	| "sticker"
	| "assetPack";

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
		version: string;
		params?: ClipPackParam[];
		render?: { passes: Array<{ shader: string; uniforms?: Record<string, string> }> };
		transition?: { defaultDuration?: number };
		textTemplate?: Record<string, unknown>;
		lut?: { size: number; file?: string };
		assets?: Array<{ path: string; kind: string; thumb?: string }>;
		license?: { type: string; source: string };
		tags?: string[];
		preview?: string;
	};
}

export interface ClipPackStatus {
	loaded: boolean;
	error: string;
	registered: string[];
	blocked: Array<{ id: string; reason: string }>;
	byType: Record<string, number>;
}

const status: ClipPackStatus = {
	loaded: false,
	error: "",
	registered: [],
	blocked: [],
	byType: {},
};

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

async function load(): Promise<void> {
	status.error = "";
	status.registered = [];
	status.blocked = [];
	status.byType = {};

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

		if (pack.type === "effect") {
			const { definition, reason } = toEffectDefinition(pack);
			if (!definition) {
				status.blocked.push({ id: pack.id, reason: reason || "无法注册" });
				continue;
			}
			if (!effectsRegistry.has(definition.type)) {
				effectsRegistry.register({ key: definition.type, definition });
			}
			status.registered.push(pack.id);
			continue;
		}

		// transition / textTemplate / lut 的渲染通道尚未接入编辑器，
		// 先保留在清单里供 UI 展示，不注册进 registry。
		if (pack.type === "transition") {
			status.blocked.push({ id: pack.id, reason: "转场渲染器尚未接入（需实现 transition pass）" });
		} else if (pack.type === "lut") {
			status.blocked.push({ id: pack.id, reason: "LUT 需要 shader 支持（需重编 opencut-wasm）" });
		} else if (pack.type === "textTemplate") {
			status.blocked.push({ id: pack.id, reason: "文字模板渲染尚未接入（数据已就绪）" });
		}
		// sticker / assetPack 由素材面板直接消费，无需注册。
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
