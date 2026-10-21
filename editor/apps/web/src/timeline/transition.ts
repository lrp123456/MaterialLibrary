/**
 * 转场的时间线几何。
 *
 * 时间模型（真重叠，B 前移）：
 *   - 转场绑定在剪辑点左侧片段 A 的尾部，B 为紧邻的下一段，剪辑点 C = A 的结尾；
 *   - 应用转场时 **A 完全不动**，B 整体前移 d，两段在 [C - d, C] 这 d 秒里同时存在；
 *   - 渲染窗口就是 [C - d, C]，A 播它的最后 d 秒、B 播它的开头 d 秒；
 *   - 同轨后续元素整体前移 d（波纹），总时长减 d。
 *
 * 为什么不是"两边各让 d/2"（方案书 v1 的写法）：
 *   A 尾部扩 d/2 同时 B 头部提前 d/2 时，B 的结尾位置不变，总时长只减 d/2，
 *   再让后续元素前移 d 就会让 B 被下一段压住 d。"各让一半"与"总时长减 d"在几何上
 *   无法同时成立；本模型牺牲的是"对称"，换来的是**两边都不吃素材余量、不会冻结**。
 *
 * 这里只放纯函数（不碰 store），命令、渲染、UI 都复用同一套判定，避免三处各算一遍。
 */
import type { ParamValues } from "@/params";
import { mediaTime, TICKS_PER_SECOND, type MediaTime, roundMediaTime } from "@/wasm";
import type { SceneTracks, TimelineElement, TimelineTrack, VideoElement } from "./types";

/**
 * 剪辑点判定的容差：1 帧（按 60fps 计）。
 * 时间戳是整数 tick，浮点换算后可能差几 tick，不允许严格相等。
 */
export const TRANSITION_CUT_EPSILON = mediaTime({
	ticks: Math.round(TICKS_PER_SECOND / 60),
});

export interface TransitionPair {
	track: TimelineTrack;
	element: VideoElement;
	next: TimelineElement;
	/** 剪辑点 C：A 的结尾，也是窗口 [C-d, C] 的右端 */
	clipPoint: MediaTime;
	/** d/2：窗口中心相对 C 的偏移，供 UI 定位 */
	half: MediaTime;
}

function elementEndTime({ element }: { element: TimelineElement }): number {
	return element.startTime + element.duration;
}

function isNear({
	value,
	expected,
	tolerance = TRANSITION_CUT_EPSILON,
}: {
	value: number;
	expected: number;
	tolerance?: number;
}): boolean {
	return Math.abs(value - expected) <= tolerance;
}

/** 元素所在轨道（含主轨 / 覆盖轨；音频轨不参与转场） */
export function findTrackOfElement({
	tracks,
	elementId,
}: {
	tracks: SceneTracks;
	elementId: string;
}): TimelineTrack | null {
	const candidates: TimelineTrack[] = [tracks.main, ...tracks.overlay];
	for (const track of candidates) {
		if (track.elements.some((element) => element.id === elementId)) {
			return track;
		}
	}
	return null;
}

/**
 * 应用转场前用：找 A 后面**紧邻**的 B。
 * 判定为同轨且 `B.startTime === A.startTime + A.duration`（允许 1 帧误差）。
 */
export function findAdjacentSuccessor({
	tracks,
	elementId,
}: {
	tracks: SceneTracks;
	elementId: string;
}): { track: TimelineTrack; element: VideoElement; next: TimelineElement } | null {
	const track = findTrackOfElement({ tracks, elementId });
	if (!track) return null;

	const element = track.elements.find((item) => item.id === elementId);
	if (!element || element.type !== "video") return null;

	const expectedStart = elementEndTime({ element });
	const next = track.elements.find(
		(item) => item.id !== element.id && isNear({ value: item.startTime, expected: expectedStart }),
	);
	if (!next) return null;

	// B 必须从 A 的结尾开始（而不是与 A 重叠），否则不是"剪辑点"
	if (next.startTime < elementEndTime({ element }) - TRANSITION_CUT_EPSILON) {
		return null;
	}

	return { track, element, next };
}

/**
 * 已有转场时用：由 A.transitionOut.duration 反推 B 与剪辑点。
 * 应用后的几何：A.end 不变（= C），B.start = C - d，因此
 *   B.start   = A.startTime + A.duration - d
 *   clipPoint = A.startTime + A.duration - d/2
 */
export function resolveTransitionPair({
	tracks,
	elementId,
}: {
	tracks: SceneTracks;
	elementId: string;
}): TransitionPair | null {
	const track = findTrackOfElement({ tracks, elementId });
	if (!track) return null;

	const element = track.elements.find((item) => item.id === elementId);
	if (!element || element.type !== "video") return null;

	const transition = element.transitionOut;
	if (!transition || transition.duration <= 0) return null;

	const half = roundMediaTime({ time: transition.duration / 2 });
	const expectedStart = elementEndTime({ element }) - transition.duration;
	const next = track.elements.find(
		(item) => item.id !== element.id && isNear({ value: item.startTime, expected: expectedStart }),
	);
	if (!next) return null;

	return {
		track,
		element,
		next,
		clipPoint: roundMediaTime({ time: elementEndTime({ element }) - half }),
		half,
	};
}

function replaceTrack({
	tracks,
	trackId,
	nextTrack,
}: {
	tracks: SceneTracks;
	trackId: string;
	nextTrack: TimelineTrack;
}): SceneTracks {
	if (tracks.main.id === trackId) {
		return { ...tracks, main: nextTrack as SceneTracks["main"] };
	}
	return {
		...tracks,
		overlay: tracks.overlay.map((track) =>
			track.id === trackId ? (nextTrack as (typeof tracks.overlay)[number]) : track,
		),
	};
}

export interface ApplyTransitionOptions {
	elementId: string;
	type: string;
	duration: MediaTime;
	params: ParamValues;
}

/**
 * 应用转场：改的时间线结构（纯函数，不改入参）。
 *
 * - A：只写入 transitionOut，**时长与 trim 都不动**（因此不需要素材余量）
 * - B：startTime -= d（trimStart / duration 都不动）
 * - 同轨后续元素整体前移 d（波纹），总时长减 d
 * - d 上限为 A 的时长，避免 B 越过 A 的起点
 */
export function applyTransitionToTracks({
	tracks,
	pair,
	options,
}: {
	tracks: SceneTracks;
	pair: { track: TimelineTrack; element: VideoElement; next: TimelineElement };
	options: ApplyTransitionOptions;
}): SceneTracks {
	const { track, element, next } = pair;

	// 转场不能比 A 本身还长，否则窗口会越过 A 的起点
	const duration = roundMediaTime({
		time: Math.min(options.duration, element.duration),
	});
	if (duration <= 0) return tracks;

	const nextEndTime = elementEndTime({ element: next });

	const updatedElements = track.elements.map((item) => {
		if (item.id === element.id) {
			return {
				...item,
				transitionOut: {
					type: options.type,
					duration,
					// 拷贝一份，避免多个片段共享预设的 defaultParams 对象
					params: { ...options.params },
				},
			} as TimelineElement;
		}
		if (item.id === next.id) {
			return {
				...item,
				startTime: roundMediaTime({ time: item.startTime - duration }),
			} as TimelineElement;
		}
		// 波纹：只动剪辑点之后的元素
		if (item.startTime >= nextEndTime - TRANSITION_CUT_EPSILON) {
			return {
				...item,
				startTime: roundMediaTime({ time: item.startTime - duration }),
			} as TimelineElement;
		}
		return item;
	});

	return replaceTrack({
		tracks,
		trackId: track.id,
		nextTrack: { ...track, elements: updatedElements } as TimelineTrack,
	});
}

/**
 * 去掉元素上的转场字段。
 * TimelineElement 是联合类型，只有 VideoElement 声明了 transitionOut，
 * 这里用交叉类型绕开窄化，避免在 map 里对每个分支重复断言。
 */
function withoutTransitionFields<T extends TimelineElement>({
	element,
}: {
	element: T;
}): T {
	const copy = { ...element } as T & {
		transitionOut?: unknown;
		transitionDegraded?: unknown;
	};
	delete copy.transitionOut;
	delete copy.transitionDegraded;
	return copy;
}

/** 删除转场：B 与后续元素整体后移 d，A 不动（A 本来就没被改过） */
export function removeTransitionFromTracks({
	tracks,
	pair,
}: {
	tracks: SceneTracks;
	pair: TransitionPair;
}): SceneTracks {
	const { track, element, next } = pair;
	const duration = element.transitionOut?.duration ?? 0;
	if (duration <= 0) return tracks;

	const nextEndTime = elementEndTime({ element: next });

	const updatedElements = track.elements.map((item) => {
		if (item.id === element.id) {
			return withoutTransitionFields({ element: item }) as TimelineElement;
		}
		if (item.id === next.id) {
			return {
				...withoutTransitionFields({ element: item }),
				startTime: roundMediaTime({ time: item.startTime + duration }),
			} as TimelineElement;
		}
		// 加转场时这些元素被前移了 d，这里原路退回
		if (item.startTime >= nextEndTime - TRANSITION_CUT_EPSILON) {
			return {
				...item,
				startTime: roundMediaTime({ time: item.startTime + duration }),
			} as TimelineElement;
		}
		return item;
	});

	return replaceTrack({
		tracks,
		trackId: track.id,
		nextTrack: { ...track, elements: updatedElements } as TimelineTrack,
	});
}

export interface ClipPointCandidate {
	elementId: string;
	trackId: string;
	time: MediaTime;
}

/**
 * 全部可用剪辑点，供 UI 找"离播放头最近的剪辑点"。
 * 两种情况都算剪辑点：
 *   - 尚未加转场：A 的结尾（A.end）
 *   - 已有转场：窗口中心 C - d/2
 */
export function collectClipPoints({
	tracks,
}: {
	tracks: SceneTracks;
}): ClipPointCandidate[] {
	const points: ClipPointCandidate[] = [];
	for (const track of [tracks.main, ...tracks.overlay]) {
		for (const element of track.elements) {
			if (element.type !== "video") continue;

			if (element.transitionOut && element.transitionOut.duration > 0) {
				const pair = resolveTransitionPair({ tracks, elementId: element.id });
				if (pair) {
					points.push({
						elementId: element.id,
						trackId: track.id,
						time: pair.clipPoint,
					});
				}
				continue;
			}

			const hasSuccessor = track.elements.some(
				(item) =>
					item.id !== element.id &&
					isNear({ value: item.startTime, expected: elementEndTime({ element }) }),
			);
			if (!hasSuccessor) continue;
			points.push({
				elementId: element.id,
				trackId: track.id,
				time: elementEndTime({ element }) as MediaTime,
			});
		}
	}
	return points;
}

/**
 * 选中片段优先，否则取离播放头最近的剪辑点（1 秒内）。
 * UI 的"点选转场应用到哪"就靠这一条，避免两处各写一份判定。
 */
export function pickTransitionTarget({
	tracks,
	selectedElementIds,
	playheadTime,
}: {
	tracks: SceneTracks;
	selectedElementIds: string[];
	playheadTime: MediaTime;
}): { elementId: string } | null {
	if (selectedElementIds.length === 1) {
		const [elementId] = selectedElementIds;
		if (findAdjacentSuccessor({ tracks, elementId })) {
			return { elementId };
		}
		// 已经加过转场的片段不再"相邻"，用几何反推判定
		if (resolveTransitionPair({ tracks, elementId })) {
			return { elementId };
		}
	}

	const tolerance = TICKS_PER_SECOND;
	let best: ClipPointCandidate | null = null;
	for (const candidate of collectClipPoints({ tracks })) {
		const distance = Math.abs(candidate.time - playheadTime);
		if (distance > tolerance) continue;
		if (!best || distance < Math.abs(best.time - playheadTime)) {
			best = candidate;
		}
	}
	return best ? { elementId: best.elementId } : null;
}
