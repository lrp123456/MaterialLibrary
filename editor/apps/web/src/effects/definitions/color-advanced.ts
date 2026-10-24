import type { EffectPass } from "@/effects/types";
import type { NumberParamDefinition, ParamDefinition, ParamValues } from "@/params";
import { curveTable, isCurveIdentity, type CurveKnots } from "@/effects/curve";

/**
 * 调节面板的高级分组（B 档）：自然饱和度 / 高光阴影 / HSL / 曲线 / 色轮 / 色彩克隆。
 *
 * 这些参数全部并进 com.mls.adjust.basic 这一份参数表，而不是各建一个特效定义 ——
 * 一个调节层(effect 元素)只带一个 effectType，剪映那条"调节轨"也是一层装全部参数，
 * 拆成六个定义就得在时间线上叠六个条，UI 和用户习惯都会拧着。
 */

export const ADJUST_TYPE = "com.mls.adjust.basic";

function num(value: unknown, fallback = 0): number {
	const n = typeof value === "number" ? value : Number.parseFloat(String(value));
	return Number.isFinite(n) ? n : fallback;
}

function anyActive({
	values,
	threshold = 0.002,
}: {
	values: number[];
	threshold?: number;
}): boolean {
	return values.some((value) => Math.abs(value) > threshold);
}

function bipolar(key: string, label: string, extra: Partial<NumberParamDefinition> = {}): NumberParamDefinition {
	return {
		key,
		label,
		type: "number",
		default: 0,
		min: -100,
		max: 100,
		step: 1,
		displayMultiplier: 100,
		keyframable: true,
		...extra,
	};
}

export const HSL_BANDS = [
	{ prefix: "red", label: "红", color: "#ef4444", center: 0, halfWidth: 26 },
	{ prefix: "orange", label: "橙", color: "#f97316", center: 30, halfWidth: 24 },
	{ prefix: "yellow", label: "黄", color: "#eab308", center: 60, halfWidth: 26 },
	{ prefix: "green", label: "绿", color: "#22c55e", center: 120, halfWidth: 40 },
	{ prefix: "cyan", label: "青", color: "#06b6d4", center: 185, halfWidth: 30 },
	{ prefix: "blue", label: "蓝", color: "#3b82f6", center: 240, halfWidth: 30 },
	{ prefix: "purple", label: "紫", color: "#a855f7", center: 290, halfWidth: 32 },
] as const;

export const WHEEL_GROUPS = [
	{ prefix: "lift", label: "暗部", color: "#38bdf8" },
	{ prefix: "gamma", label: "中间调", color: "#a3e635" },
	{ prefix: "gain", label: "亮部", color: "#fbbf24" },
] as const;

export const CURVE_CHANNELS = [
	{ prefix: "rgb", label: "RGB", mode: 0 },
	{ prefix: "r", label: "R", mode: 1 },
	{ prefix: "g", label: "G", mode: 2 },
	{ prefix: "b", label: "B", mode: 3 },
] as const;

const VIBRANCE_PARAMS: ParamDefinition[] = [
	bipolar("vibrance", "自然饱和度"),
	{
		key: "vibProtect",
		label: "肤色保护",
		type: "number",
		default: 0,
		min: 0,
		max: 100,
		step: 1,
		displayMultiplier: 100,
	},
];

/**
 * 白平衡三通道增益：一键色彩校正算出来就写在这三个参数上，
 * 渲染时并进 channel 那一段（见 basicAdjustDefinition 的 buildPasses）。
 * 存数值而不是"重新分析一次"，是为了让导出结果和当时看到的完全一致。
 */
const WB_PARAMS: ParamDefinition[] = [
	{ key: "wbR", label: "R 增益", type: "number", default: 1, min: 0.5, max: 2, step: 0.01 },
	{ key: "wbG", label: "G 增益", type: "number", default: 1, min: 0.5, max: 2, step: 0.01 },
	{ key: "wbB", label: "B 增益", type: "number", default: 1, min: 0.5, max: 2, step: 0.01 },
];

const LIGHT_PARAMS: ParamDefinition[] = [
	bipolar("shadows", "阴影"),
	bipolar("highlights", "高光"),
	{
		key: "shadowEdge",
		label: "阴影范围",
		type: "number",
		default: 0.5,
		min: 0.1,
		max: 0.9,
		step: 0.01,
	},
	{
		key: "highlightEdge",
		label: "高光范围",
		type: "number",
		default: 0.75,
		min: 0.2,
		max: 0.98,
		step: 0.01,
	},
];

const HSL_PARAMS: ParamDefinition[] = HSL_BANDS.flatMap((band) => [
	bipolar(`${band.prefix}Hue`, "色相"),
	bipolar(`${band.prefix}Sat`, "饱和度"),
	bipolar(`${band.prefix}Light`, "明亮度"),
]);

const CURVE_PARAMS: ParamDefinition[] = CURVE_CHANNELS.flatMap((channel) => [
	bipolar(`${channel.prefix}Black`, "黑场"),
	bipolar(`${channel.prefix}Mid`, "中间调"),
	bipolar(`${channel.prefix}White`, "白场"),
]);

const WHEEL_PARAMS: ParamDefinition[] = [
	...WHEEL_GROUPS.flatMap((group) => [
		bipolar(`${group.prefix}R`, "R"),
		bipolar(`${group.prefix}G`, "G"),
		bipolar(`${group.prefix}B`, "B"),
	]),
	{
		key: "wheelMix",
		label: "强度",
		type: "number",
		default: 1,
		min: 0,
		max: 1,
		step: 0.01,
	},
];

const CLONE_PARAMS: ParamDefinition[] = [
	{ key: "cloneScaleL", label: "L 缩放", type: "number", default: 1, min: 0.1, max: 3, step: 0.01 },
	{ key: "cloneScaleA", label: "a 缩放", type: "number", default: 1, min: 0.1, max: 3, step: 0.01 },
	{ key: "cloneScaleB", label: "b 缩放", type: "number", default: 1, min: 0.1, max: 3, step: 0.01 },
	{ key: "cloneShiftL", label: "L 偏移", type: "number", default: 0, min: -60, max: 60, step: 0.5 },
	{ key: "cloneShiftA", label: "a 偏移", type: "number", default: 0, min: -60, max: 60, step: 0.5 },
	{ key: "cloneShiftB", label: "b 偏移", type: "number", default: 0, min: -60, max: 60, step: 0.5 },
	{ key: "cloneMode", label: "作用范围", type: "number", default: 0, min: 0, max: 2, step: 1 },
	{
		key: "cloneStrength",
		label: "强度",
		type: "number",
		default: 1,
		min: 0,
		max: 1,
		step: 0.01,
	},
];

export const advancedAdjustParams: ParamDefinition[] = [
	...WB_PARAMS,
	...VIBRANCE_PARAMS,
	...LIGHT_PARAMS,
	...HSL_PARAMS,
	...CURVE_PARAMS,
	...WHEEL_PARAMS,
	...CLONE_PARAMS,
];

function buildVibrancePasses(effectParams: ParamValues): EffectPass[] {
	const vibrance = num(effectParams.vibrance);
	const protect = num(effectParams.vibProtect);
	if (!anyActive({ values: [vibrance, protect] })) {
		return [];
	}
	return [
		{
			shader: "vibrance",
			uniforms: { u_scalar0: vibrance, u_scalar1: 0, u_scalar2: protect },
		},
	];
}

function buildLightPasses(effectParams: ParamValues): EffectPass[] {
	const shadows = num(effectParams.shadows);
	const highlights = num(effectParams.highlights);
	if (!anyActive({ values: [shadows, highlights] })) {
		return [];
	}
	return [
		{
			shader: "shadows-highlights",
			uniforms: {
				u_scalar0: shadows,
				u_scalar1: highlights,
				u_scalar2: num(effectParams.shadowEdge, 0.5),
				u_scalar3: num(effectParams.highlightEdge, 0.75),
			},
		},
	];
}

function buildHslPasses(effectParams: ParamValues): EffectPass[] {
	const passes: EffectPass[] = [];
	for (const band of HSL_BANDS) {
		const hue = num(effectParams[`${band.prefix}Hue`]);
		const sat = num(effectParams[`${band.prefix}Sat`]);
		const light = num(effectParams[`${band.prefix}Light`]);
		if (!anyActive({ values: [hue, sat, light] })) {
			continue;
		}
		passes.push({
			shader: "hsl-band",
			uniforms: {
				u_scalar0: band.center,
				u_scalar1: band.halfWidth,
				u_scalar2: 0.7,
				u_scalar3: hue * 60,
				u_scalar4: sat,
				u_scalar5: light,
				u_scalar6: 1,
			},
		});
	}
	return passes;
}

function knotsOf(params: ParamValues, prefix: string): CurveKnots {
	return {
		black: num(params[`${prefix}Black`]),
		mid: num(params[`${prefix}Mid`]),
		white: num(params[`${prefix}White`]),
	};
}

function buildCurvePasses(effectParams: ParamValues): EffectPass[] {
	const passes: EffectPass[] = [];
	for (const channel of CURVE_CHANNELS) {
		const knots = knotsOf(effectParams, channel.prefix);
		if (isCurveIdentity({ knots })) {
			continue;
		}
		const table = curveTable({ knots });
		const uniforms: Record<string, number> = {
			u_scalar0: channel.mode,
			u_scalar1: table.length,
		};
		table.forEach((value, index) => {
			uniforms[`u_scalar${index + 2}`] = value;
		});
		passes.push({ shader: "curve", uniforms });
	}
	return passes;
}

function buildWheelPasses(effectParams: ParamValues): EffectPass[] {
	const values = WHEEL_GROUPS.flatMap((group) => [
		num(effectParams[`${group.prefix}R`]),
		num(effectParams[`${group.prefix}G`]),
		num(effectParams[`${group.prefix}B`]),
	]);
	const mix = num(effectParams.wheelMix, 1);
	if (!anyActive({ values }) || mix <= 0.001) {
		return [];
	}
	const uniforms: Record<string, number> = { u_scalar9: mix };
	values.forEach((value, index) => {
		uniforms[`u_scalar${index}`] = value;
	});
	return [{ shader: "color-wheel", uniforms }];
}

/**
 * 色彩克隆：参考帧与目标帧的 Lab 统计在 CPU 侧算完，这里只存展开后的 6 个仿射系数，
 * 所以导出时无需重新取样 —— 换台机器结果也一样。
 */
function buildClonePasses(effectParams: ParamValues): EffectPass[] {
	const strength = num(effectParams.cloneStrength, 1);
	const scales = [
		num(effectParams.cloneScaleL, 1),
		num(effectParams.cloneScaleA, 1),
		num(effectParams.cloneScaleB, 1),
	];
	const shifts = [
		num(effectParams.cloneShiftL),
		num(effectParams.cloneShiftA),
		num(effectParams.cloneShiftB),
	];
	const identity =
		scales.every((scale) => Math.abs(scale - 1) < 0.002) &&
		!anyActive({ values: shifts });
	if (identity || strength <= 0.001) {
		return [];
	}
	return [
		{
			shader: "color-match",
			uniforms: {
				u_scalar0: scales[0],
				u_scalar1: scales[1],
				u_scalar2: scales[2],
				u_scalar3: shifts[0],
				u_scalar4: shifts[1],
				u_scalar5: shifts[2],
				u_scalar6: num(effectParams.cloneMode),
				u_scalar7: strength,
			},
		},
	];
}

/**
 * 顺序是有意义的：白平衡/曲线这类校色要排在风格化之前，
 * 否则 HSL 分色是按"已经调过的色相"选段的，同一组参数会得到不同结果。
 */
export function buildAdvancedPasses({
	effectParams,
}: {
	effectParams: ParamValues;
}): EffectPass[] {
	return [
		...buildClonePasses(effectParams),
		...buildCurvePasses(effectParams),
		...buildLightPasses(effectParams),
		...buildVibrancePasses(effectParams),
		...buildHslPasses(effectParams),
		...buildWheelPasses(effectParams),
	];
}

export {
	CLONE_PARAMS,
	CURVE_PARAMS,
	HSL_PARAMS,
	LIGHT_PARAMS,
	VIBRANCE_PARAMS,
	WB_PARAMS,
	WHEEL_PARAMS,
};
