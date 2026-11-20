import type { EffectDefinition, EffectPassTemplate } from "@/effects/types";
import { gradePass } from "./color";

/**
 * 内置版发光/锐化/磨皮。
 *
 * type 与资源包里的同名 pack 保持一致是有意的：pack 加载后会覆盖这份定义，
 * 后端/资源包不可用时它自己顶上，工程里已保存的 effect type 不会因此失效。
 * 所以参数 key、默认值和取值范围都对齐 pack，避免"同一特效两种表现"。
 */

function num(value: unknown, fallback: number): number {
	const n = typeof value === "number" ? value : Number.parseFloat(String(value));
	return Number.isFinite(n) ? n : fallback;
}

/** 半径按 1080p 基准给像素，低分辨率等比缩小；下限保证 160px 缩略图仍看得出效果。 */
function scaledRadius({
	radius,
	height,
	reference = 1080,
}: {
	radius: number;
	height: number;
	reference?: number;
}): number {
	return Math.max(2.5, (radius * height) / reference);
}

function glowPass({
	threshold = 0.6,
	intensity = 0.8,
	radius = 12,
}: {
	threshold?: number;
	intensity?: number;
	radius?: number;
}): EffectPassTemplate {
	return {
		shader: "glow",
		uniforms: ({ effectParams, height }) => ({
			u_scalar0: num(effectParams.threshold, threshold),
			u_scalar1: num(effectParams.intensity, intensity),
			u_scalar2: scaledRadius({
				radius: num(effectParams.radius, radius),
				height,
			}),
		}),
	};
}

function sharpenPass({
	amount = 0.8,
	radius = 2,
}: {
	amount?: number;
	radius?: number;
}): EffectPassTemplate {
	return {
		shader: "sharpen",
		uniforms: ({ effectParams, height }) => ({
			u_scalar0: num(effectParams.amount, amount),
			u_scalar1: scaledRadius({ radius: num(effectParams.radius, radius), height }),
		}),
	};
}

function skinSmoothPass({
	strength = 0.5,
	radius = 6,
}: {
	strength?: number;
	radius?: number;
}): EffectPassTemplate {
	return {
		shader: "skin-smooth",
		uniforms: ({ effectParams, height }) => ({
			u_scalar0: num(effectParams.strength, strength),
			u_scalar1: scaledRadius({ radius: num(effectParams.radius, radius), height }),
		}),
	};
}

function numberParam({
	key,
	label,
	defaultValue,
	min,
	max,
	step = 0.01,
}: {
	key: string;
	label: string;
	defaultValue: number;
	min: number;
	max: number;
	step?: number;
}) {
	return {
		key,
		label,
		type: "number" as const,
		default: defaultValue,
		min,
		max,
		step,
		keyframable: true,
	};
}

export const glowEffectDefinition: EffectDefinition = {
	type: "com.mls.effect.glow",
	name: "发光",
	keywords: ["发光", "柔光", "光晕", "梦幻"],
	category: "effect",
	params: [
		numberParam({ key: "threshold", label: "亮度阈值", defaultValue: 0.75, min: 0, max: 1 }),
		numberParam({ key: "intensity", label: "强度", defaultValue: 0.8, min: 0, max: 3, step: 0.05 }),
		numberParam({ key: "radius", label: "半径", defaultValue: 12, min: 1, max: 64, step: 1 }),
	],
	renderer: { passes: [glowPass({ threshold: 0.75 })] },
};

export const sharpenEffectDefinition: EffectDefinition = {
	type: "com.mls.effect.sharpen",
	name: "锐化",
	keywords: ["锐化", "清晰", "细节", "高清"],
	category: "effect",
	params: [
		numberParam({ key: "amount", label: "强度", defaultValue: 0.6, min: 0, max: 3, step: 0.05 }),
		numberParam({ key: "radius", label: "半径", defaultValue: 1, min: 0.5, max: 4, step: 0.1 }),
	],
	renderer: { passes: [sharpenPass({ amount: 0.6, radius: 1 })] },
};

export const skinSmoothEffectDefinition: EffectDefinition = {
	type: "com.mls.effect.skin-smooth",
	name: "磨皮",
	keywords: ["磨皮", "美肤", "平滑", "降噪"],
	category: "effect",
	params: [
		numberParam({ key: "strength", label: "强度", defaultValue: 0.6, min: 0, max: 1 }),
		numberParam({ key: "radius", label: "半径", defaultValue: 3, min: 1, max: 12, step: 0.5 }),
	],
	renderer: { passes: [skinSmoothPass({ strength: 0.6, radius: 3 })] },
};

/**
 * 组合特效：多遍 shader 串联，顺序即执行顺序。
 * 这些是「一键出片」类预设，参数仍可单独调。
 */
export const composedEffectDefinitions: EffectDefinition[] = [
	{
		type: "com.mls.effect.beauty",
		name: "人像美肤",
		keywords: ["美肤", "人像", "磨皮", "白皙"],
		category: "effect",
		params: [
			numberParam({ key: "strength", label: "磨皮", defaultValue: 0.55, min: 0, max: 1 }),
			numberParam({ key: "brightness", label: "提亮", defaultValue: 0.06, min: -0.5, max: 0.5 }),
			numberParam({ key: "amount", label: "细节", defaultValue: 0.4, min: 0, max: 2, step: 0.05 }),
		],
		renderer: {
			passes: [
				skinSmoothPass({ strength: 0.55, radius: 6 }),
				// 磨皮会糊掉边缘，补一遍轻锐化找回轮廓
				sharpenPass({ amount: 0.4, radius: 1 }),
				gradePass({ brightness: 0.06, contrast: 0.04, saturation: -0.04, temperature: 0.04 }),
			],
		},
	},
	{
		type: "com.mls.effect.dreamlight",
		name: "梦幻光晕",
		keywords: ["梦幻", "光晕", "婚礼", "少女"],
		category: "effect",
		params: [
			numberParam({ key: "intensity", label: "光晕", defaultValue: 1, min: 0, max: 3, step: 0.05 }),
			numberParam({ key: "threshold", label: "阈值", defaultValue: 0.55, min: 0, max: 1 }),
			numberParam({ key: "strength", label: "柔焦", defaultValue: 0.35, min: 0, max: 1 }),
		],
		renderer: {
			passes: [
				skinSmoothPass({ strength: 0.35, radius: 8 }),
				glowPass({ threshold: 0.55, intensity: 1, radius: 16 }),
				gradePass({ brightness: 0.05, contrast: -0.06, saturation: 0.08, temperature: 0.12 }),
			],
		},
	},
	{
		type: "com.mls.effect.hud",
		name: "信号干扰",
		keywords: ["故障", "干扰", "Glitch", "赛博"],
		category: "effect",
		params: [
			numberParam({ key: "amount", label: "扰动", defaultValue: 0.35, min: 0, max: 1 }),
			numberParam({ key: "split", label: "色差", defaultValue: 0.5, min: 0, max: 1 }),
		],
		renderer: {
			passes: [
				{
					shader: "warp",
					uniforms: ({ effectParams }) => ({
						u_scalar0: num(effectParams.amount, 0.35),
						u_scalar1: 16,
						u_scalar3: 1,
					}),
				},
				{
					shader: "channel",
					uniforms: ({ effectParams }) => {
						const split = num(effectParams.split, 0.5);
						return {
							u_scalar0: 1 + split * 0.25,
							u_scalar1: 1,
							u_scalar2: 1 - split * 0.25,
						};
					},
				},
			],
		},
	},
];
