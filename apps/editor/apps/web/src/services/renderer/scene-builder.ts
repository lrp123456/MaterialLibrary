import type { SceneTracks, TimelineElement, TimelineTrack } from "@/timeline";
import type { MediaAsset } from "@/media/types";
import { RootNode } from "./nodes/root-node";
import { VideoNode } from "./nodes/video-node";
import { ImageNode } from "./nodes/image-node";
import { TextNode } from "./nodes/text-node";
import { StickerNode } from "./nodes/sticker-node";
import { GraphicNode } from "./nodes/graphic-node";
import { ColorNode } from "./nodes/color-node";
import { BlurBackgroundNode } from "./nodes/blur-background-node";
import { EffectLayerNode } from "./nodes/effect-layer-node";
import { TransitionNode } from "./nodes/transition-node";
import type { AnyBaseNode } from "./nodes/base-node";
import type { TBackground, TCanvasSize } from "@/project/types";
import { DEFAULT_BACKGROUND_BLUR_INTENSITY } from "@/background/blur";
import { resolveTransitionRender } from "@/services/clip-packs";
import { TRANSITION_CUT_EPSILON } from "@/timeline/transition";
import {
	buildTransformFromParams,
	readBlendModeFromParams,
	readOpacityFromParams,
} from "@/rendering";

const PREVIEW_MAX_IMAGE_SIZE = 2048;

function getVisibleSortedElements({ track }: { track: TimelineTrack }) {
	return track.elements
		.filter((element) => !("hidden" in element && element.hidden))
		.slice()
		.sort((a, b) => {
			if (a.startTime !== b.startTime) return a.startTime - b.startTime;
			return a.id.localeCompare(b.id);
		});
}

/**
 * 把一条轨道上"有 transitionOut 的片段 + 紧邻的下一个片段"配成转场节点。
 *
 * 只做配对与几何换算，不判断窗口是否激活（那是 resolve 的活儿）。
 * 应用转场后的几何：B.start = A.start + A.duration - d，据此反推 B，容差 1 帧。
 */
function buildTransitionNodes({
	elements,
	nodeByElementId,
}: {
	elements: TimelineElement[];
	nodeByElementId: Map<string, AnyBaseNode>;
}): Map<AnyBaseNode, TransitionNode> {
	const transitionByFromNode = new Map<AnyBaseNode, TransitionNode>();

	for (const element of elements) {
		if (element.type !== "video" && element.type !== "image") continue;
		const transition = element.transitionOut;
		if (!transition || transition.duration <= 0) continue;

		const fromNode = nodeByElementId.get(element.id);
		if (!fromNode) continue;

		const expectedNextStart =
			element.startTime + element.duration - transition.duration;
		const next = elements.find(
			(item) =>
				item.id !== element.id &&
				Math.abs(item.startTime - expectedNextStart) <= TRANSITION_CUT_EPSILON,
		);
		if (!next) continue;

		const toNode = nodeByElementId.get(next.id);
		if (!toNode) continue;

		const render = resolveTransitionRender({
			type: transition.type,
			params: transition.params,
		});

		transitionByFromNode.set(
			fromNode,
			new TransitionNode({
				fromNode,
				toNode,
				// 渲染窗口 [C - d, C]，C = A 的结尾（A 不动，B 前移 d）
				startTime: element.startTime + element.duration - transition.duration,
				duration: transition.duration,
				mode: render.mode,
				scalars: render.scalars,
				direction: render.direction,
			}),
		);
	}

	return transitionByFromNode;
}

function buildTrackNodes({
	tracks,
	mediaMap,
	canvasSize,
	isPreview,
}: {
	tracks: TimelineTrack[];
	mediaMap: Map<string, MediaAsset>;
	canvasSize: TCanvasSize;
	isPreview?: boolean;
}): AnyBaseNode[] {
	const nodes: AnyBaseNode[] = [];

	for (const track of tracks) {
		const elements = getVisibleSortedElements({ track });
		// 本轨的节点先落到 trackNodes，最后按"A 的位置插入转场节点"的顺序并入 nodes，
		// 保证转场项的 z 序与原片段一致。
		const trackNodes: AnyBaseNode[] = [];
		const nodeByElementId = new Map<string, AnyBaseNode>();

		for (const element of elements) {
			const before = trackNodes.length;

			if (element.type === "effect") {
				trackNodes.push(
					new EffectLayerNode({
						effectType: element.effectType,
						effectParams: element.params,
						timeOffset: element.startTime,
						duration: element.duration,
					}),
				);
			} else if (element.type === "video" || element.type === "image") {
				const mediaAsset = mediaMap.get(element.mediaId);
				if (!mediaAsset?.file || !mediaAsset?.url) {
					continue;
				}

				if (element.type === "video" && mediaAsset.type === "video") {
					trackNodes.push(
						new VideoNode({
							mediaId: mediaAsset.id,
							url: mediaAsset.url,
							file: mediaAsset.file,
							duration: element.duration,
							timeOffset: element.startTime,
							trimStart: element.trimStart,
							trimEnd: element.trimEnd,
							retime: element.retime,
							transform: buildTransformFromParams({ params: element.params }),
							animations: element.animations,
							opacity: readOpacityFromParams({ params: element.params }),
							blendMode: readBlendModeFromParams({ params: element.params }),
							effects: element.effects ?? [],
							masks: element.masks ?? [],
						}),
					);
				}
				if (element.type === "image" && mediaAsset.type === "image") {
					trackNodes.push(
						new ImageNode({
							url: mediaAsset.url,
							duration: element.duration,
							timeOffset: element.startTime,
							trimStart: element.trimStart,
							trimEnd: element.trimEnd,
							transform: buildTransformFromParams({ params: element.params }),
							animations: element.animations,
							opacity: readOpacityFromParams({ params: element.params }),
							blendMode: readBlendModeFromParams({ params: element.params }),
							effects: element.effects ?? [],
							masks: element.masks ?? [],
							...(isPreview && {
								maxSourceSize: PREVIEW_MAX_IMAGE_SIZE,
							}),
						}),
					);
				}
			} else if (element.type === "text") {
				trackNodes.push(
					new TextNode({
						...element,
						transform: buildTransformFromParams({ params: element.params }),
						opacity: readOpacityFromParams({ params: element.params }),
						blendMode: readBlendModeFromParams({ params: element.params }),
						canvasCenter: { x: canvasSize.width / 2, y: canvasSize.height / 2 },
						canvasHeight: canvasSize.height,
						textBaseline: "middle",
						effects: element.effects ?? [],
					}),
				);
			} else if (element.type === "sticker") {
				trackNodes.push(
					new StickerNode({
						stickerId: element.stickerId,
						intrinsicWidth: element.intrinsicWidth,
						intrinsicHeight: element.intrinsicHeight,
						duration: element.duration,
						timeOffset: element.startTime,
						trimStart: element.trimStart,
						trimEnd: element.trimEnd,
						transform: buildTransformFromParams({ params: element.params }),
						animations: element.animations,
						opacity: readOpacityFromParams({ params: element.params }),
						blendMode: readBlendModeFromParams({ params: element.params }),
						effects: element.effects ?? [],
					}),
				);
			} else if (element.type === "graphic") {
				trackNodes.push(
					new GraphicNode({
						definitionId: element.definitionId,
						params: element.params,
						duration: element.duration,
						timeOffset: element.startTime,
						trimStart: element.trimStart,
						trimEnd: element.trimEnd,
						transform: buildTransformFromParams({ params: element.params }),
						animations: element.animations,
						opacity: readOpacityFromParams({ params: element.params }),
						blendMode: readBlendModeFromParams({ params: element.params }),
						effects: element.effects ?? [],
						masks: element.masks ?? [],
					}),
				);
			}

			// 一个元素可能产出多个节点（目前只有单节点），取第一个作为转场参与者
			if (trackNodes.length > before && !nodeByElementId.has(element.id)) {
				nodeByElementId.set(element.id, trackNodes[before]);
			}
		}

		const transitionByFromNode = buildTransitionNodes({
			elements,
			nodeByElementId,
		});

		for (const node of trackNodes) {
			const transition = transitionByFromNode.get(node);
			if (transition) {
				// 转场节点排在 A 之前：帧描述阶段它先出 transition item，
				// A / B 的普通 layer 在该帧被抑制，避免重复绘制。
				nodes.push(transition);
			}
			nodes.push(node);
		}
	}

	return nodes;
}

function buildBlurBackgroundNodes({
	track,
	mediaMap,
	blurIntensity,
}: {
	track: TimelineTrack | undefined;
	mediaMap: Map<string, MediaAsset>;
	blurIntensity: number;
}): AnyBaseNode[] {
	if (!track) {
		return [];
	}

	const nodes: AnyBaseNode[] = [];
	const elements = getVisibleSortedElements({ track });

	for (const element of elements) {
		if (element.type !== "video" && element.type !== "image") {
			continue;
		}

		const mediaAsset = mediaMap.get(element.mediaId);
		if (
			!mediaAsset?.file ||
			!mediaAsset?.url ||
			(mediaAsset.type !== "video" && mediaAsset.type !== "image")
		) {
			continue;
		}

		nodes.push(
			new BlurBackgroundNode({
				mediaId: mediaAsset.id,
				url: mediaAsset.url,
				file: mediaAsset.file,
				mediaType: mediaAsset.type,
				duration: element.duration,
				timeOffset: element.startTime,
				trimStart: element.trimStart,
				trimEnd: element.trimEnd,
				retime: element.type === "video" ? element.retime : undefined,
				blurIntensity,
			}),
		);
	}

	return nodes;
}

export type BuildSceneParams = {
	canvasSize: TCanvasSize;
	tracks: SceneTracks;
	mediaAssets: MediaAsset[];
	duration: number;
	background: TBackground;
	isPreview?: boolean;
};

export function buildScene({
	canvasSize,
	tracks,
	mediaAssets,
	duration,
	background,
	isPreview,
}: BuildSceneParams) {
	const rootNode = new RootNode({ duration });
	const mediaMap = new Map(mediaAssets.map((m) => [m.id, m]));

	const visibleTracks = [
		...tracks.overlay.filter((track) => !("hidden" in track && track.hidden)),
		...(!tracks.main.hidden ? [tracks.main] : []),
	];
	const orderedTracksBottomToTop = visibleTracks.slice().reverse();
	const mainTrack = tracks.main.hidden ? undefined : tracks.main;

	const allNodes = buildTrackNodes({
		tracks: orderedTracksBottomToTop,
		mediaMap,
		canvasSize,
		isPreview,
	});

	if (background.type === "blur") {
		const blurNodes = buildBlurBackgroundNodes({
			track: mainTrack,
			mediaMap,
			blurIntensity:
				background.blurIntensity ?? DEFAULT_BACKGROUND_BLUR_INTENSITY,
		});
		for (const node of blurNodes) {
			rootNode.add(node);
		}
	} else if (
		background.type === "color" &&
		background.color !== "transparent"
	) {
		rootNode.add(new ColorNode({ color: background.color }));
	}

	for (const node of allNodes) {
		rootNode.add(node);
	}

	return rootNode;
}
