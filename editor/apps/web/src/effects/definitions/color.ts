import type {
	EffectDefinition,
	EffectPass,
	EffectPassTemplate,
} from "@/effects/types";
import { advancedAdjustParams, buildAdvancedPasses } from "./color-advanced";

function num(value: unknown, fallback = 0): number {
	const n = typeof value === "number" ? value : Number.parseFloat(String(value));
	return Number.isFinite(n) ? n : fallback;
}

export function gradePass({
	brightness = 0,
	contrast = 0,
	saturation = 0,
	temperature = 0,
	invert = false,
}: {
	brightness?: number;
	contrast?: number;
	saturation?: number;
	temperature?: number;
	invert?: boolean;
}): EffectPassTemplate {
	return {
		shader: "grade",
		uniforms: ({ effectParams }) => {
			const inverted =
				effectParams.invert !== undefined
					? Boolean(effectParams.invert)
					: invert;
			return {
				u_scalar0: effectParams.brightness !== undefined ? num(effectParams.brightness) : brightness,
				u_scalar1: effectParams.contrast !== undefined ? num(effectParams.contrast) : contrast,
				u_scalar2: effectParams.saturation !== undefined ? num(effectParams.saturation) : saturation,
				u_scalar3: effectParams.temperature !== undefined ? num(effectParams.temperature) : temperature,
				u_direction: inverted ? [1, 0] : [0, 0],
			};
		},
	};
}

const ADJUST_GRADE = gradePass({});

/**
 * 「调节」面板用的内置调色特效。
 *
 * 量纲约定：shader 只认 -1..1 的偏移，但界面按剪映习惯给 -100..100，
 * 所以参数的 min/max/step 写在显示空间、用 displayMultiplier 换算回存储值。
 * 早先直接把 -1..1 暴露成输入范围，用户按习惯输个两位数就被钳到 1，
 * 加性亮度 +1 = 整帧全白，这就是「一调就白了」的根因。
 */
export const basicAdjustDefinition: EffectDefinition = {
	type: "com.mls.adjust.basic",
	name: "基础调节",
	category: "adjust",
	keywords: ["调节", "亮度", "对比度", "饱和度", "色温", "色调", "反相"],
	params: [
		{
			key: "brightness",
			label: "亮度",
			type: "number",
			default: 0,
			min: -100,
			max: 100,
			step: 1,
			displayMultiplier: 100,
			keyframable: true,
		},
		{
			key: "contrast",
			label: "对比度",
			type: "number",
			default: 0,
			min: -100,
			max: 100,
			step: 1,
			displayMultiplier: 100,
			keyframable: true,
		},
		{
			key: "saturation",
			label: "饱和度",
			type: "number",
			default: 0,
			min: -100,
			max: 100,
			step: 1,
			displayMultiplier: 100,
			keyframable: true,
		},
		{
			key: "temperature",
			label: "色温",
			type: "number",
			default: 0,
			min: -100,
			max: 100,
			step: 1,
			displayMultiplier: 100,
			keyframable: true,
		},
		{
			key: "tint",
			label: "色调",
			type: "number",
			default: 0,
			min: -100,
			max: 100,
			step: 1,
			displayMultiplier: 100,
			keyframable: true,
		},
		{
			key: "invert",
			label: "反相",
			type: "boolean",
			default: false,
			keyframable: false,
		},
		...advancedAdjustParams,
	],
	renderer: {
		passes: [ADJUST_GRADE],
		buildPasses: ({ effectParams, width, height }) => {
			const passes: EffectPass[] = [
				{
					shader: "grade",
					uniforms: ADJUST_GRADE.uniforms({
						effectParams,
						width,
						height,
					}),
				},
			];
			// 色调走 channel 的通道增益：正=偏品红（抬 R/B 压 G），负=偏绿。
			// 白平衡增益也乘在同一段上，两者都归零时不发这一遍，省一次全屏 pass。
			const tint = num(effectParams.tint);
			const wb = [num(effectParams.wbR, 1), num(effectParams.wbG, 1), num(effectParams.wbB, 1)];
			const wbActive = wb.some((gain) => Math.abs(gain - 1) >= 0.005);
			if (Math.abs(tint) >= 0.005 || wbActive) {
				passes.push({
					shader: "channel",
					uniforms: {
						u_scalar0: wb[0] * (1 + 0.1 * tint),
						u_scalar1: wb[1] * (1 - 0.12 * tint),
						u_scalar2: wb[2] * (1 + 0.06 * tint),
						u_scalar3: 0,
					},
				});
			}
			passes.push(...buildAdvancedPasses({ effectParams }));
			return passes;
		},
	},
};

interface FilmLook {
	type: string;
	name: string;
	keywords: string[];
	brightness: number;
	contrast: number;
	saturation: number;
	temperature: number;
	/** 可选的第二遍通道处理：[r,g,b] 权重 */
	channel?: [number, number, number];
	/** channel.wgsl 的模式：0=通道增益(默认) 1=单色着色 2=去色偏 */
	channelMode?: number;
	/** 可选的高光柔化（glow），给「微光」类滤镜用 */
	bloom?: { threshold: number; intensity: number; radius: number };
}

const FILM_LOOKS: FilmLook[] = [
	{
		type: "com.mls.filter.clear",
		name: "清透",
		keywords: ["清透", "通透", "日常"],
		brightness: 0.03,
		contrast: 0.1,
		saturation: 0.12,
		temperature: -0.05,
	},
	{
		type: "com.mls.filter.warm",
		name: "暖阳",
		keywords: ["暖", "阳光", "人像"],
		brightness: 0.03,
		contrast: 0.06,
		saturation: 0.14,
		temperature: 0.38,
	},
	{
		type: "com.mls.filter.cool",
		name: "冷调",
		keywords: ["冷", "蓝调", "空间"],
		brightness: 0,
		contrast: 0.12,
		saturation: -0.06,
		temperature: -0.38,
	},
	{
		type: "com.mls.filter.cinema",
		name: "电影感",
		keywords: ["电影", "青橙", "叙事"],
		brightness: -0.02,
		contrast: 0.2,
		saturation: -0.12,
		temperature: 0.1,
		channel: [1.02, 1.0, 0.98],
	},
	{
		type: "com.mls.filter.mono",
		name: "黑白",
		keywords: ["黑白", "单色", "纪实"],
		brightness: 0,
		contrast: 0.1,
		saturation: -1,
		temperature: 0,
	},
	{
		type: "com.mls.filter.faded",
		name: "褪色",
		keywords: ["褪色", "胶片", "复古"],
		brightness: 0.08,
		contrast: -0.18,
		saturation: -0.32,
		temperature: 0.06,
	},
	{
		type: "com.mls.filter.punch",
		name: "高反差",
		keywords: ["反差", "冲击", "广告"],
		brightness: 0,
		contrast: 0.36,
		saturation: 0.06,
		temperature: 0,
	},
	{
		type: "com.mls.filter.night",
		name: "夜景蓝",
		keywords: ["夜景", "蓝", "冷"],
		brightness: -0.06,
		contrast: 0.22,
		saturation: -0.1,
		temperature: -0.5,
	},
	{
		type: "com.mls.filter.sunset",
		name: "日落",
		keywords: ["日落", "金色", "氛围"],
		brightness: 0.02,
		contrast: 0.12,
		saturation: 0.26,
		temperature: 0.52,
	},
	{
		type: "com.mls.filter.cream",
		name: "奶油",
		keywords: ["奶油", "柔和", "人像"],
		brightness: 0.09,
		contrast: -0.06,
		saturation: -0.08,
		temperature: 0.12,
	},
	{
		type: "com.mls.filter.hongkong",
		name: "港风",
		keywords: ["港风", "复古", "霓虹"],
		brightness: -0.02,
		contrast: 0.24,
		saturation: -0.18,
		temperature: 0.26,
		channel: [1.04, 0.99, 0.94],
	},
	{
		type: "com.mls.filter.cyber",
		name: "赛博",
		keywords: ["赛博", "未来", "冷紫"],
		brightness: -0.02,
		contrast: 0.26,
		saturation: 0.16,
		temperature: -0.55,
		channel: [0.95, 0.97, 1.1],
	},
	{
		type: "com.mls.filter.tealorange",
		name: "青橙",
		keywords: ["青橙", "好莱坞", "商业"],
		brightness: -0.03,
		contrast: 0.24,
		saturation: 0.04,
		temperature: 0.2,
		// 抬红压蓝做暖肤色，冷背景交给负色温
		channel: [1.08, 0.99, 0.94],
	},
	{
		type: "com.mls.filter.kodak",
		name: "柯达",
		keywords: ["柯达", "胶片", "暖色"],
		brightness: 0.02,
		contrast: 0.16,
		saturation: 0.1,
		temperature: 0.18,
		channel: [1.05, 1.0, 0.95],
	},
	{
		type: "com.mls.filter.fuji",
		name: "富士",
		keywords: ["富士", "胶片", "青绿"],
		brightness: 0.04,
		contrast: 0.08,
		saturation: 0.06,
		temperature: -0.14,
		channel: [0.97, 1.02, 1.02],
	},
	{
		type: "com.mls.filter.haze",
		name: "灰雾",
		keywords: ["灰雾", "低反差", "文艺"],
		brightness: 0.12,
		contrast: -0.25,
		saturation: -0.2,
		temperature: 0.04,
	},
	{
		type: "com.mls.filter.vivid",
		name: "通透高饱和",
		keywords: ["通透", "饱和", "带货", "广告"],
		brightness: 0.04,
		contrast: 0.14,
		saturation: 0.3,
		temperature: 0,
	},
	{
		type: "com.mls.filter.coldwhite",
		name: "冷白",
		keywords: ["冷白", "ins", "干净", "美白"],
		brightness: 0.08,
		contrast: 0.05,
		saturation: -0.12,
		temperature: -0.2,
		channel: [0.97, 1.0, 1.04],
	},
	{
		type: "com.mls.filter.darkera",
		name: "复古暗调",
		keywords: ["复古", "暗调", "沉稳"],
		brightness: -0.06,
		contrast: 0.28,
		saturation: -0.2,
		temperature: 0.18,
		channel: [1.05, 0.98, 0.9],
	},
	{
		type: "com.mls.filter.blueprint",
		name: "蓝晒",
		keywords: ["蓝晒", "单色", "冷调", "cyanotype"],
		brightness: 0.02,
		contrast: 0.18,
		saturation: 0,
		temperature: 0,
		channel: [0.55, 0.75, 1],
		channelMode: 1,
	},
	{
		type: "com.mls.filter.sepiatone",
		name: "棕褐",
		keywords: ["棕褐", "老照片", "怀旧", "sepia"],
		brightness: 0.03,
		contrast: 0.16,
		saturation: 0,
		temperature: 0,
		channel: [1, 0.78, 0.55],
		channelMode: 1,
	},
	{
		type: "com.mls.filter.neutral",
		name: "去色偏",
		keywords: ["去色偏", "白平衡", "校正", "偏黄"],
		brightness: 0,
		contrast: 0.06,
		saturation: 0,
		temperature: 0,
		// mode 2 按权重做除法，>1 即压回该通道
		channel: [1.1, 1.06, 0.94],
		channelMode: 2,
	},
	{
		type: "com.mls.filter.softbloom",
		name: "微光",
		keywords: ["微光", "高光", "柔和", "呼吸感"],
		brightness: 0.04,
		contrast: -0.04,
		saturation: 0.06,
		temperature: 0.1,
		bloom: { threshold: 0.68, intensity: 0.55, radius: 14 },
	},
];

function buildFilterDefinition(look: FilmLook): EffectDefinition {
	const passes: EffectPassTemplate[] = [
		gradePass({
			brightness: look.brightness,
			contrast: look.contrast,
			saturation: look.saturation,
			temperature: look.temperature,
		}),
	];
	if (look.channel) {
		const [r, g, b] = look.channel;
		passes.push({
			shader: "channel",
			uniforms: () => ({
				u_scalar0: r,
				u_scalar1: g,
				u_scalar2: b,
				u_scalar3: look.channelMode ?? 0,
			}),
		});
	}
	if (look.bloom) {
		const { threshold, intensity, radius } = look.bloom;
		passes.push({
			shader: "glow",
			// 半径按 1080p 基准给像素，低分辨率（含 160px 预览）自动等比缩小
			uniforms: ({ height }) => ({
				u_scalar0: threshold,
				u_scalar1: intensity,
				u_scalar2: Math.max(2.5, (radius * height) / 1080),
			}),
		});
	}

	return {
		type: look.type,
		name: look.name,
		keywords: look.keywords,
		category: "filter",
		params: [],
		renderer: { passes },
	};
}

/** 内置滤镜（不依赖资源包，后端/WSL 掉线也能用）。 */
export const filterEffectDefinitions: EffectDefinition[] =
	FILM_LOOKS.map(buildFilterDefinition);
