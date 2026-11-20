/**
 * 曲线：界面只暴露"黑场 / 中间调 / 白场"三个可上下拖的锚点，
 * 渲染前用单调三次插值（Fritsch–Carlson）把它们展开成一张密集表塞进 uniform。
 *
 * 为什么不在 shader 里插值：单调性判断要在 WGSL 里写循环和除零保护，
 * 而这段计算每次参数变化才跑一次（每帧只是查表），放 JS 侧便宜得多。
 */

export type CurveKnots = {
	black: number;
	mid: number;
	white: number;
};

export const CURVE_TABLE_SIZE = 41;

/** 曲线控件的显示纵轴范围：留出越界锚点的位置，不然端点拖到边框就卡住。 */
export const CURVE_VIEW_RANGE: [number, number] = [-0.3, 1.3];

export const IDENTITY_CURVE: CurveKnots = { black: 0, mid: 0, white: 0 };

function clamp01(value: number): number {
	return Math.min(1, Math.max(0, value));
}

/**
 * 锚点偏移(-1..1) → 曲线目标值。端点允许越界：黑场压到 0 以下、白场顶到 1 以上
 * 正是"加大对比度"的那一半，钳在这里就把 S 形曲线的一半废掉了。
 * 越界的部分由 sampleCurve 输出端钳回 0..1 —— 曲线在那里早已触顶，效果照样保留。
 */
export function curveControlPoints({ knots }: { knots: CurveKnots }) {
	return [
		{ x: 0, y: knots.black * 0.5 },
		{ x: 0.5, y: 0.5 + knots.mid * 0.5 },
		{ x: 1, y: 1 + knots.white * 0.5 },
	];
}

/**
 * 单调三次插值采样。d[i]===0 时把两侧切线归零，避免出现"平的区段被切线顶出鼓包"。
 */
export function sampleCurve({
	points,
	samples = CURVE_TABLE_SIZE,
}: {
	points: { x: number; y: number }[];
	samples?: number;
}): number[] {
	const n = points.length;
	if (n === 0) {
		return new Array(samples).fill(0);
	}
	if (n === 1) {
		return new Array(samples).fill(clamp01(points[0].y));
	}

	const slopes: number[] = [];
	for (let i = 0; i < n - 1; i += 1) {
		const dx = points[i + 1].x - points[i].x;
		slopes.push(dx === 0 ? 0 : (points[i + 1].y - points[i].y) / dx);
	}

	const tangents: number[] = new Array(n).fill(0);
	tangents[0] = slopes[0];
	tangents[n - 1] = slopes[n - 2];
	for (let i = 1; i < n - 1; i += 1) {
		tangents[i] = slopes[i - 1] * slopes[i] <= 0 ? 0 : (slopes[i - 1] + slopes[i]) / 2;
	}

	// Fritsch–Carlson 约束：切线长度不能超过割线斜率的 3 倍
	for (let i = 0; i < n - 1; i += 1) {
		if (slopes[i] === 0) {
			tangents[i] = 0;
			tangents[i + 1] = 0;
			continue;
		}
		const alpha = tangents[i] / slopes[i];
		const beta = tangents[i + 1] / slopes[i];
		const radius = Math.hypot(alpha, beta);
		if (radius > 3) {
			const scale = 3 / radius;
			tangents[i] = scale * alpha * slopes[i];
			tangents[i + 1] = scale * beta * slopes[i];
		}
	}

	const table: number[] = [];
	for (let s = 0; s < samples; s += 1) {
		const x = samples === 1 ? 0 : s / (samples - 1);
		let segment = n - 2;
		for (let i = 0; i < n - 1; i += 1) {
			if (x <= points[i + 1].x) {
				segment = i;
				break;
			}
		}
		const x0 = points[segment].x;
		const x1 = points[segment + 1].x;
		const width = x1 - x0 || 1;
		const t = (x - x0) / width;
		const t2 = t * t;
		const t3 = t2 * t;
		const h00 = 2 * t3 - 3 * t2 + 1;
		const h10 = t3 - 2 * t2 + t;
		const h01 = -2 * t3 + 3 * t2;
		const h11 = t3 - t2;
		const y =
			h00 * points[segment].y +
			h10 * width * tangents[segment] +
			h01 * points[segment + 1].y +
			h11 * width * tangents[segment + 1];
		table.push(clamp01(y));
	}
	return table;
}

export function curveTable({ knots }: { knots: CurveKnots }): number[] {
	return sampleCurve({ points: curveControlPoints({ knots }) });
}

export function isCurveIdentity({ knots }: { knots: CurveKnots }): boolean {
	return (
		Math.abs(knots.black) < 0.001 &&
		Math.abs(knots.mid) < 0.001 &&
		Math.abs(knots.white) < 0.001
	);
}
