/**
 * 画面取样：给「一键色彩校正 / 智能调色 / 色彩克隆」提供统计量。
 *
 * 全部在 CPU 侧、缩略图上算（64×36），不进渲染链路。
 * 算完把结果写成普通特效参数存进工程，导出时不依赖这里 —— 换机器也不会变。
 */

export type FrameStats = {
	/** sRGB 三通道均值 / 标准差（0..1） */
	mean: [number, number, number];
	std: [number, number, number];
	/** Lab 均值 / 标准差，Reinhard 迁移就靠这六个数 */
	labMean: [number, number, number];
	labStd: [number, number, number];
	lumaMean: number;
	lumaStd: number;
	/** 饱和度过低（近似灰）的像素占比，用来判断"这帧能不能拿来做白平衡" */
	grayRatio: number;
	blackClip: number;
	whiteClip: number;
	pixels: number;
};

const PROBE_WIDTH = 64;
const PROBE_HEIGHT = 36;

function srgbToLinear({ value }: { value: number }): number {
	return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
}

const WHITE_REF: [number, number, number] = [0.95047, 1, 1.08883];

function labF({ value }: { value: number }): number {
	return value > 0.008856451679035635
		? Math.cbrt(value)
		: (903.2962962962963 * value + 16) / 116;
}

export function rgbToLab({
	r,
	g,
	b,
}: {
	r: number;
	g: number;
	b: number;
}): [number, number, number] {
	const lr = srgbToLinear({ value: r });
	const lg = srgbToLinear({ value: g });
	const lb = srgbToLinear({ value: b });
	const x =
		(lr * 0.4124564 + lg * 0.3575761 + lb * 0.1804375) / WHITE_REF[0];
	const y = lr * 0.2126729 + lg * 0.7151522 + lb * 0.072175;
	const z =
		(lr * 0.0193339 + lg * 0.119192 + lb * 0.9503041) / WHITE_REF[2];
	const fx = labF({ value: x });
	const fy = labF({ value: y });
	const fz = labF({ value: z });
	return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function moments({ values }: { values: number[] }): [number, number] {
	const n = values.length || 1;
	const mean = values.reduce((sum, value) => sum + value, 0) / n;
	const variance =
		values.reduce((sum, value) => sum + (value - mean) * (value - mean), 0) / n;
	return [mean, Math.sqrt(variance)];
}

/** 从任意可绘制源（video / image / bitmap / canvas）取一帧统计量。 */
export function sampleFrameStats({
	source,
	width,
	height,
}: {
	source: CanvasImageSource;
	width: number;
	height: number;
}): FrameStats | null {
	if (typeof document === "undefined" || width <= 0 || height <= 0) {
		return null;
	}
	const canvas = document.createElement("canvas");
	canvas.width = PROBE_WIDTH;
	canvas.height = PROBE_HEIGHT;
	const context = canvas.getContext("2d", { willReadFrequently: true });
	if (!context) {
		return null;
	}
	context.drawImage(source, 0, 0, canvas.width, canvas.height);
	// 跨域素材会污染 canvas，这里直接抛 SecurityError —— 调用方负责给出人话提示
	let data: Uint8ClampedArray;
	try {
		data = context.getImageData(0, 0, canvas.width, canvas.height).data;
	} catch {
		return null;
	}

	const channels: [number[], number[], number[]] = [[], [], []];
	const labs: [number[], number[], number[]] = [[], [], []];
	const lumas: number[] = [];
	let gray = 0;
	let black = 0;
	let white = 0;

	for (let i = 0; i < data.length; i += 4) {
		if (data[i + 3] < 8) {
			continue;
		}
		const r = data[i] / 255;
		const g = data[i + 1] / 255;
		const b = data[i + 2] / 255;
		channels[0].push(r);
		channels[1].push(g);
		channels[2].push(b);
		const lab = rgbToLab({ r, g, b });
		labs[0].push(lab[0]);
		labs[1].push(lab[1]);
		labs[2].push(lab[2]);
		const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
		lumas.push(luma);
		const max = Math.max(r, g, b);
		const min = Math.min(r, g, b);
		if (max - min < 0.04) {
			gray += 1;
		}
		if (max < 0.06) {
			black += 1;
		}
		if (min > 0.94) {
			white += 1;
		}
	}

	const pixels = lumas.length;
	if (pixels === 0) {
		return null;
	}
	const [mr, sr] = moments({ values: channels[0] });
	const [mg, sg] = moments({ values: channels[1] });
	const [mb, sb] = moments({ values: channels[2] });
	const [lL, sL] = moments({ values: labs[0] });
	const [lA, sA] = moments({ values: labs[1] });
	const [lB, sB] = moments({ values: labs[2] });
	const [lumaMean, lumaStd] = moments({ values: lumas });

	return {
		mean: [mr, mg, mb],
		std: [sr, sg, sb],
		labMean: [lL, lA, lB],
		labStd: [sL, sA, sB],
		lumaMean,
		lumaStd,
		grayRatio: gray / pixels,
		blackClip: black / pixels,
		whiteClip: white / pixels,
		pixels,
	};
}

/**
 * 灰世界白平衡：假设场景里三通道应该均衡，把偏差补回来。
 * 补完按"亮度保持"归一，否则整幅画面会跟着增益一起变亮/变暗。
 * 纯灰画面（grayRatio 很高）没有信息量，直接放弃，免得把中性帧推出色偏。
 */
export function computeWhiteBalanceGains({
	stats,
}: {
	stats: FrameStats;
}): { r: number; g: number; b: number; confident: boolean } {
	if (stats.grayRatio > 0.92) {
		return { r: 1, g: 1, b: 1, confident: false };
	}
	const linear = [
		srgbToLinear({ value: stats.mean[0] }),
		srgbToLinear({ value: stats.mean[1] }),
		srgbToLinear({ value: stats.mean[2] }),
	];
	const target = (linear[0] + linear[1] + linear[2]) / 3;
	const raw = linear.map((value) => target / Math.max(value, 1e-4));
	// 几何归一：让三增益的乘积为 1，整体亮度基本不动
	const norm = Math.cbrt(raw[0] * raw[1] * raw[2]);
	const clampGain = (value: number) => Math.min(2, Math.max(0.5, value / norm));
	return {
		r: clampGain(raw[0]),
		g: clampGain(raw[1]),
		b: clampGain(raw[2]),
		confident: true,
	};
}

/** 智能调色的建议值：目标影调 0.47、目标对比（亮度标准差）0.17。 */
export function computeAutoGrade({
	stats,
}: {
	stats: FrameStats;
}): { brightness: number; contrast: number; saturation: number } {
	const chroma = Math.hypot(stats.labStd[1], stats.labStd[2]);
	const targetChroma = 28;
	return {
		brightness: clampRange({ value: (0.47 - stats.lumaMean) * 0.7, min: -0.3, max: 0.3 }),
		contrast: clampRange({ value: (0.17 - stats.lumaStd) * 1.6, min: -0.35, max: 0.45 }),
		saturation: clampRange({ value: (targetChroma - chroma) / 60, min: -0.4, max: 0.5 }),
	};
}

/** Reinhard 统计迁移：out = (in - srcMean) * (refStd / srcStd) + refMean，展开成 scale/shift。 */
export function computeLabAffine({
	source,
	reference,
}: {
	source: FrameStats;
	reference: FrameStats;
}): {
	scaleL: number;
	scaleA: number;
	scaleB: number;
	shiftL: number;
	shiftA: number;
	shiftB: number;
} {
	const axes = [0, 1, 2];
	const scales = axes.map((axis) => {
		const srcStd = source.labStd[axis];
		if (srcStd < 0.5) {
			return 1;
		}
		return clampRange({ value: reference.labStd[axis] / srcStd, min: 0.4, max: 2.2 });
	});
	const shifts = axes.map((axis) => {
		const shift = reference.labMean[axis] - source.labMean[axis] * scales[axis];
		// L 与 a/b 都是 ±60 封顶：再大的位移意味着两边素材根本不是一个东西，宁可少动
		return clampRange({ value: shift, min: -60, max: 60 });
	});
	return {
		scaleL: scales[0],
		scaleA: scales[1],
		scaleB: scales[2],
		shiftL: shifts[0],
		shiftA: shifts[1],
		shiftB: shifts[2],
	};
}

function clampRange({
	value,
	min,
	max,
}: {
	value: number;
	min: number;
	max: number;
}): number {
	return Math.min(max, Math.max(min, value));
}
