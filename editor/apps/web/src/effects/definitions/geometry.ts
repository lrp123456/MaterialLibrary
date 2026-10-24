import type { EffectDefinition, EffectPassTemplate } from "@/effects/types";

/**
 * warp.wgsl 的七个几何模式。amount/scale/phase 都是 0 基参数，mode 固定在通道里。
 * 时间相关的动画靠 phase 关键帧驱动——shader 本身没有时钟，保证渲染无状态。
 */
const WARP_MODES = {
	wave: 0,
	turbulent: 1,
	twirl: 2,
	spherize: 3,
	mirror: 4,
	magnify: 5,
	grid: 6,
} as const;

type WarpMode = (typeof WARP_MODES)[keyof typeof WARP_MODES];

function num(value: unknown, fallback: number): number {
	const n = typeof value === "number" ? value : Number.parseFloat(String(value));
	return Number.isFinite(n) ? n : fallback;
}

function warpPass({
	mode,
	amount = 0.35,
	scale = 8,
	phase = 0,
}: {
	mode: WarpMode;
	amount?: number;
	scale?: number;
	phase?: number;
}): EffectPassTemplate {
	return {
		shader: "warp",
		uniforms: ({ effectParams }) => ({
			u_scalar0: num(effectParams.amount, amount),
			u_scalar1: num(effectParams.scale, scale),
			u_scalar2: num(effectParams.phase, phase),
			u_scalar3: mode,
		}),
	};
}

const AMOUNT_PARAM = {
	key: "amount",
	label: "强度",
	type: "number",
	min: 0,
	max: 1,
	step: 0.01,
	keyframable: true,
} as const;

const PHASE_PARAM = {
	key: "phase",
	label: "相位",
	type: "number",
	default: 0,
	min: 0,
	max: 6.28,
	step: 0.01,
	keyframable: true,
} as const;

function scaleParam(defaultValue: number, max = 64) {
	return {
		key: "scale",
		label: "尺度",
		type: "number",
		default: defaultValue,
		min: 1,
		max,
		step: 1,
		keyframable: true,
	} as const;
}

interface WarpLook {
	type: string;
	name: string;
	keywords: string[];
	mode: WarpMode;
	defaultAmount: number;
	/** 不展示尺度参数的模式（旋转/球面/放大只跟强度有关） */
	showScale?: boolean;
	defaultScale?: number;
	maxScale?: number;
	showPhase?: boolean;
}

const WARP_LOOKS: WarpLook[] = [
	{
		type: "com.mls.effect.wave",
		name: "水波",
		keywords: ["水波", "波纹", "荡漾"],
		mode: WARP_MODES.wave,
		defaultAmount: 0.35,
		showScale: true,
		defaultScale: 8,
		showPhase: true,
	},
	{
		type: "com.mls.effect.turbulent",
		name: "湍流",
		keywords: ["湍流", "抖动", "信号干扰", "故障"],
		mode: WARP_MODES.turbulent,
		defaultAmount: 0.4,
		showScale: true,
		defaultScale: 12,
		showPhase: true,
	},
	{
		type: "com.mls.effect.twirl",
		name: "旋转扭曲",
		keywords: ["旋转", "扭曲", "漩涡"],
		mode: WARP_MODES.twirl,
		defaultAmount: 0.3,
	},
	{
		type: "com.mls.effect.spherize",
		name: "球面化",
		keywords: ["球面", "鱼眼", "凸起"],
		mode: WARP_MODES.spherize,
		defaultAmount: 0.5,
	},
	{
		type: "com.mls.effect.mirror",
		name: "镜像",
		keywords: ["镜像", "对称", "翻转"],
		mode: WARP_MODES.mirror,
		defaultAmount: 1,
	},
	{
		type: "com.mls.effect.magnify",
		name: "中心放大",
		keywords: ["放大", "推近", "特写"],
		mode: WARP_MODES.magnify,
		defaultAmount: 0.3,
	},
	{
		type: "com.mls.effect.grid",
		name: "像素错位",
		keywords: ["像素", "马赛克", "错位", "故障"],
		mode: WARP_MODES.grid,
		defaultAmount: 0.5,
		showScale: true,
		defaultScale: 24,
		maxScale: 64,
	},
];

export const geometryEffectDefinitions: EffectDefinition[] = WARP_LOOKS.map(
	(look) => {
		const params = [
			{ ...AMOUNT_PARAM, default: look.defaultAmount },
			...(look.showScale
				? [scaleParam(look.defaultScale ?? 8, look.maxScale ?? 64)]
				: []),
			...(look.showPhase ? [PHASE_PARAM] : []),
		];
		return {
			type: look.type,
			name: look.name,
			keywords: look.keywords,
			category: "effect",
			params,
			renderer: {
				passes: [
					warpPass({
						mode: look.mode,
						amount: look.defaultAmount,
						scale: look.defaultScale ?? 8,
					}),
				],
			},
		} satisfies EffectDefinition;
	},
);
