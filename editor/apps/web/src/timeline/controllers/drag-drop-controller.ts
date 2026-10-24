import type { DragEvent } from "react";
import { processMediaAssets } from "@/media/processing";
import { showMediaUploadToast } from "@/media/upload-toast";
import {
	DEFAULT_NEW_ELEMENT_DURATION,
	toElementDurationTicks,
} from "@/timeline/creation";
import { BASE_TIMELINE_PIXELS_PER_SECOND } from "@/timeline/scale";
import type { FrameRate } from "opencut-wasm";
import {
	buildTextElement,
	buildGraphicElement,
	buildStickerElement,
	buildElementFromMedia,
	buildEffectElement,
} from "@/timeline/element-utils";
import { AddTrackCommand, InsertElementCommand } from "@/commands/timeline";
import {
	ApplyTransitionCommand,
	UpdateTransitionCommand,
} from "@/commands/timeline/element";
import {
	findAdjacentSuccessor,
	findNearestCutPoint,
	resolveTransitionPair,
} from "@/timeline/transition";
import { BatchCommand } from "@/commands";
import type { Command } from "@/commands/base-command";
import { computeDropTarget } from "@/timeline/components/drop-target";
import type { TimelineDragSource } from "@/timeline/drag-source";
import type {
	TrackType,
	DropTarget,
	ElementType,
	SceneTracks,
	TimelineTrack,
	TimelineElement,
	CreateTimelineElement,
} from "@/timeline";
import type { TimelineDragData } from "@/timeline/drag";
import type { MediaAsset } from "@/media/types";
import type { ProcessedMediaAsset } from "@/media/processing";
import { roundFrameTime, mediaTimeFromSeconds, mediaTimeToSeconds, type MediaTime } from "@/wasm";
import { toast } from "sonner";
import { EditorCore } from "@/core";
import { runPluginOnAsset, toastPluginError } from "@/timeline/plugin-apply";
import { canElementHaveAudio } from "@/timeline/element-utils";
import { isElementMuted } from "@/timeline/audio-state";
import { getClipTimeAtSourceTime } from "@/retime/resolve";
import type { RetimeConfig } from "@/timeline/types";
import {
	getMediaFid,
	registerMediaFid,
	uploadFileToLibrary,
} from "@/services/cloud-snapshots";

// --- Config ---

export interface DragDropConfig {
	zoomLevel: number;
	getContainerEl: () => HTMLDivElement | null;
	getHeaderEl: () => HTMLElement | null;
	getTracksScrollEl: () => HTMLDivElement | null;
	getActiveProjectFps: () => FrameRate | null;
	getActiveProjectId: () => string | null;
	getSceneTracks: () => SceneTracks;
	getCurrentPlayheadTime: () => MediaTime;
	getMediaAssets: () => MediaAsset[];
	dragSource: TimelineDragSource;
	addMediaAsset: (args: {
		projectId: string;
		asset: ProcessedMediaAsset;
	}) => Promise<MediaAsset | null>;
	executeCommand: (command: Command) => void;
	insertElement: (args: {
		placement: { mode: "explicit"; trackId: string };
		element: CreateTimelineElement;
	}) => void;
	addClipEffect: (args: {
		trackId: string;
		elementId: string;
		effectType: string;
	}) => void;
}

export interface DragDropConfigRef {
	readonly current: DragDropConfig;
}

/** toast 里只能放文字，进度条用方块字符画 20 格，随轮询刷新。 */
function buildProgressBar({ percent }: { percent: number }): string {
	const cells = 20;
	const filled = Math.max(0, Math.min(cells, Math.round((cells * percent) / 100)));
	return `▕${"█".repeat(filled)}${"░".repeat(cells - filled)}▏`;
}

// --- State ---

interface DragOverState {
	kind: "over";
	dropTarget: DropTarget | null;
	elementType: ElementType | null;
}

type DragDropState = { kind: "idle" } | DragOverState;

interface TimelineCoords {
	mouseX: number;
	mouseY: number;
}

// --- Pure helpers ---

function elementTypeFromDrag({
	dragData,
}: {
	dragData: TimelineDragData;
}): ElementType {
	switch (dragData.type) {
		case "text":
			return "text";
		case "graphic":
			return "graphic";
		case "sticker":
			return "sticker";
		case "effect":
			return "effect";
		case "media":
			return dragData.mediaType;
		case "plugin":
			// 插件不落新元素，指示器按效果样式高亮目标即可
			return "effect";
		case "transition":
			// 转场也不落元素，落点是素材接缝
			return "video";
	}
}

function getTargetElementTypesForDrag({
	dragData,
}: {
	dragData: TimelineDragData;
}): string[] | undefined {
	if (dragData.type === "plugin") return ["audio", "video", "image"];
	if (dragData.type === "effect") return dragData.targetElementTypes;
	if (dragData.type === "media") return dragData.targetElementTypes;
	return undefined;
}

function getDurationForDrag({
	dragData,
	mediaAssets,
}: {
	dragData: TimelineDragData;
	mediaAssets: MediaAsset[];
}): MediaTime {
	if (dragData.type !== "media") return DEFAULT_NEW_ELEMENT_DURATION;
	const media = mediaAssets.find((asset) => asset.id === dragData.id);
	return toElementDurationTicks({ seconds: media?.duration });
}

function orderedTracks({
	sceneTracks,
}: {
	sceneTracks: SceneTracks;
}): TimelineTrack[] {
	return [...sceneTracks.overlay, sceneTracks.main, ...sceneTracks.audio];
}

// --- Controller ---

export class DragDropController {
	private state: DragDropState = { kind: "idle" };
	private enterCount = 0;
	private readonly subscribers = new Set<() => void>();
	private readonly configRef: DragDropConfigRef;

	constructor(deps: { configRef: DragDropConfigRef }) {
		this.configRef = deps.configRef;
		this.onDragEnter = this.onDragEnter.bind(this);
		this.onDragOver = this.onDragOver.bind(this);
		this.onDragLeave = this.onDragLeave.bind(this);
		this.onDrop = this.onDrop.bind(this);
	}

	private get config(): DragDropConfig {
		return this.configRef.current;
	}

	get isDragOver(): boolean {
		return this.state.kind !== "idle";
	}

	get dropTarget(): DropTarget | null {
		return this.state.kind === "over" ? this.state.dropTarget : null;
	}

	get dragElementType(): ElementType | null {
		return this.state.kind === "over" ? this.state.elementType : null;
	}

	subscribe(fn: () => void): () => void {
		this.subscribers.add(fn);
		return () => this.subscribers.delete(fn);
	}

	destroy(): void {
		this.subscribers.clear();
	}

	// --- Drag event handlers (bound, stable, passed as React props) ---

	onDragEnter(event: DragEvent): void {
		event.preventDefault();
		const hasAsset = this.config.dragSource.isActive();
		const hasFiles = event.dataTransfer.types.includes("Files");
		if (!hasAsset && !hasFiles) return;

		this.enterCount += 1;
		if (this.state.kind === "idle") {
			this.setOver({ dropTarget: null, elementType: null });
		}
	}

	onDragOver(event: DragEvent): void {
		event.preventDefault();

		const coords = this.getMouseTimelineCoords({ event });
		if (!coords) return;

		const dragData = this.config.dragSource.getActive();
		const hasFiles = event.dataTransfer.types.includes("Files");
		const isExternal = hasFiles && !dragData;

		if (!dragData) {
			if (hasFiles && isExternal) {
				this.setOver({ dropTarget: null, elementType: null });
			}
			return;
		}

		const elementType = elementTypeFromDrag({ dragData });
		const duration = getDurationForDrag({
			dragData,
			mediaAssets: this.config.getMediaAssets(),
		});
		const targetElementTypes = getTargetElementTypesForDrag({ dragData });

		const sceneTracks = this.config.getSceneTracks();
		const target = computeDropTarget({
			elementType,
			mouseX: coords.mouseX,
			mouseY: coords.mouseY,
			tracks: sceneTracks,
			playheadTime: this.config.getCurrentPlayheadTime(),
			isExternalDrop: isExternal,
			elementDuration: duration,
			pixelsPerSecond: BASE_TIMELINE_PIXELS_PER_SECOND,
			zoomLevel: this.config.zoomLevel,
			targetElementTypes,
		});

		const fps = this.config.getActiveProjectFps();
		target.xPosition = fps
			? roundFrameTime({ time: target.xPosition, fps })
			: target.xPosition;

		// 转场落点是素材接缝而不是鼠标横坐标：把指示线吸到最近的剪辑点，
		// 拖动过程中就能看出"会加在哪两段之间"（与 executeTransitionDrop 同一判定）。
		if (dragData.type === "transition") {
			const cut = findNearestCutPoint({
				tracks: sceneTracks,
				time: target.xPosition,
			});
			if (cut) {
				target.xPosition = cut.time;
			}
		}

		this.setOver({ dropTarget: target, elementType });
		event.dataTransfer.dropEffect = "copy";
	}

	onDragLeave(event: DragEvent): void {
		event.preventDefault();
		if (this.enterCount === 0) return;
		this.enterCount -= 1;
		if (this.enterCount === 0) {
			this.setIdle();
		}
	}

	onDrop(event: DragEvent): void {
		event.preventDefault();
		this.enterCount = 0;

		const dragData = this.config.dragSource.getActive();
		const hasFiles = event.dataTransfer.files?.length > 0;
		if (!dragData && !hasFiles) return;

		const currentTarget = this.dropTarget;
		this.setIdle();

		try {
			if (dragData) {
				if (!currentTarget) return;
				this.executeAssetDrop({ target: currentTarget, dragData });
				return;
			}

			const coords = this.getMouseTimelineCoords({ event });
			if (!coords) return;
			this.executeFileDrop({
				files: Array.from(event.dataTransfer.files),
				mouseX: coords.mouseX,
				mouseY: coords.mouseY,
			}).catch((error) => {
				console.error("Failed to process file drop:", error);
			});
		} catch (error) {
			console.error("Failed to process drop:", error);
		}
	}

	// --- Private ---

	private setOver(state: {
		dropTarget: DropTarget | null;
		elementType: ElementType | null;
	}): void {
		this.state = { kind: "over", ...state };
		this.notify();
	}

	private setIdle(): void {
		this.state = { kind: "idle" };
		this.notify();
	}

	private notify(): void {
		for (const fn of this.subscribers) fn();
	}

	private getMouseTimelineCoords({
		event,
	}: {
		event: DragEvent;
	}): TimelineCoords | null {
		const scrollContainer = this.config.getTracksScrollEl();
		const referenceRect =
			scrollContainer?.getBoundingClientRect() ??
			this.config.getContainerEl()?.getBoundingClientRect();
		if (!referenceRect) return null;

		const scrollLeft = scrollContainer?.scrollLeft ?? 0;
		const scrollTop = scrollContainer?.scrollTop ?? 0;
		const headerHeight =
			this.config.getHeaderEl()?.getBoundingClientRect().height ?? 0;

		return {
			mouseX: event.clientX - referenceRect.left + scrollLeft,
			mouseY: event.clientY - referenceRect.top + scrollTop - headerHeight,
		};
	}

	// Shared insertion logic — new track vs existing track.
	private insertAtTarget({
		element,
		target,
		trackType,
	}: {
		element: CreateTimelineElement;
		target: DropTarget;
		trackType: TrackType;
	}): void {
		if (target.isNewTrack) {
			const addTrackCmd = new AddTrackCommand({
				type: trackType,
				index: target.trackIndex,
			});
			this.config.executeCommand(
				new BatchCommand([
					addTrackCmd,
					new InsertElementCommand({
						element,
						placement: { mode: "explicit", trackId: addTrackCmd.getTrackId() },
					}),
				]),
			);
			return;
		}

		const tracks = orderedTracks({ sceneTracks: this.config.getSceneTracks() });
		const track = tracks[target.trackIndex];
		if (!track) return;
		this.config.insertElement({
			placement: { mode: "explicit", trackId: track.id },
			element,
		});
	}

	private executeAssetDrop({
		target,
		dragData,
	}: {
		target: DropTarget;
		dragData: TimelineDragData;
	}): void {
		switch (dragData.type) {
			case "text":
				this.executeTextDrop({ target, dragData });
				return;
			case "graphic":
				this.executeGraphicDrop({ target, dragData });
				return;
			case "sticker":
				this.executeStickerDrop({ target, dragData });
				return;
			case "effect":
				this.executeEffectDrop({ target, dragData });
				return;
			case "media":
				this.executeMediaDrop({ target, dragData });
				return;
			case "plugin":
				this.executePluginDrop({ target, dragData });
				return;
			case "transition":
				this.executeTransitionDrop({ target, dragData });
				return;
		}
	}

	private executeTextDrop({
		target,
		dragData,
	}: {
		target: DropTarget;
		dragData: Extract<TimelineDragData, { type: "text" }>;
	}): void {
		const element = buildTextElement({
			raw: {
				name: dragData.name ?? "",
				params: { content: dragData.content ?? "" },
			},
			startTime: target.xPosition,
		});
		this.insertAtTarget({ element, target, trackType: "text" });
	}

	private executeStickerDrop({
		target,
		dragData,
	}: {
		target: DropTarget;
		dragData: Extract<TimelineDragData, { type: "sticker" }>;
	}): void {
		const element = buildStickerElement({
			stickerId: dragData.stickerId,
			name: dragData.name,
			startTime: target.xPosition,
		});
		this.insertAtTarget({ element, target, trackType: "graphic" });
	}

	private executeGraphicDrop({
		target,
		dragData,
	}: {
		target: DropTarget;
		dragData: Extract<TimelineDragData, { type: "graphic" }>;
	}): void {
		const element = buildGraphicElement({
			definitionId: dragData.definitionId,
			name: dragData.name,
			startTime: target.xPosition,
			params: dragData.params,
		});
		this.insertAtTarget({ element, target, trackType: "graphic" });
	}

	private executeMediaDrop({
		target,
		dragData,
	}: {
		target: DropTarget;
		dragData: Extract<TimelineDragData, { type: "media" }>;
	}): void {
		if (target.targetElement) {
			// Replace media source — not yet implemented
			return;
		}

		const mediaAsset = this.config
			.getMediaAssets()
			.find((asset) => asset.id === dragData.id);
		if (!mediaAsset) return;

		const trackType: TrackType =
			dragData.mediaType === "audio" ? "audio" : "video";
		const element = buildElementFromMedia({
			mediaId: mediaAsset.id,
			mediaType: mediaAsset.type,
			name: mediaAsset.name,
			duration: toElementDurationTicks({ seconds: mediaAsset.duration }),
			startTime: target.xPosition,
		});
		this.insertAtTarget({ element, target, trackType });
	}

	private executeEffectDrop({
		target,
		dragData,
	}: {
		target: DropTarget;
		dragData: Extract<TimelineDragData, { type: "effect" }>;
	}): void {
		if (target.targetElement) {
			this.config.addClipEffect({
				trackId: target.targetElement.trackId,
				elementId: target.targetElement.elementId,
				effectType: dragData.effectType,
			});
			return;
		}

		const element = buildEffectElement({
			effectType: dragData.effectType,
			startTime: target.xPosition,
		});

		const existingEffectTrack = orderedTracks({
			sceneTracks: this.config.getSceneTracks(),
		}).find((track) => track.type === "effect");

		if (existingEffectTrack) {
			this.config.insertElement({
				placement: { mode: "explicit", trackId: existingEffectTrack.id },
				element,
			});
			return;
		}

		this.insertAtTarget({ element, target, trackType: "effect" });
	}

	/**
	 * 转场拖拽：落点是两段相邻素材的剪辑点，不是鼠标所在轨道的任意位置。
	 * 已有转场时直接替换预设，避免"先删再加"产生两步撤销。
	 */
	private executeTransitionDrop({
		target,
		dragData,
	}: {
		target: DropTarget;
		dragData: Extract<TimelineDragData, { type: "transition" }>;
	}): void {
		const tracks = this.config.getSceneTracks();
		const cut = findNearestCutPoint({ tracks, time: target.xPosition });
		if (!cut) {
			toast.error("请把转场拖到两段相邻素材的接缝处");
			return;
		}

		const duration = mediaTimeFromSeconds({
			seconds: Math.max(0.1, dragData.defaultDuration),
		});
		const existing = resolveTransitionPair({
			tracks,
			elementId: cut.elementId,
		});
		if (existing) {
			this.config.executeCommand(
				new UpdateTransitionCommand({
					elementId: cut.elementId,
					type: dragData.transitionType,
					duration,
					params: dragData.params,
				}),
			);
			toast.success(`已替换转场：${dragData.name}`);
			return;
		}

		if (!findAdjacentSuccessor({ tracks, elementId: cut.elementId })) {
			toast.error("这个剪辑点没有紧邻的下一段素材");
			return;
		}
		this.config.executeCommand(
			new ApplyTransitionCommand({
				elementId: cut.elementId,
				type: dragData.transitionType,
				duration,
				params: dragData.params,
			}),
		);
		toast.success(`已应用转场：${dragData.name}`);
	}

	/**
	 * 插件拖拽应用：不是落元素，而是对目标素材执行 AI 任务。
	 * 目前支持人声分离——完成自动落「人声」「背景音」两条命名轨。
	 */
	private executePluginDrop({
		target,
		dragData,
	}: {
		target: DropTarget;
		dragData: Extract<TimelineDragData, { type: "plugin" }>;
	}): void {
		const hit = target.targetElement;
		if (!hit) {
			toastPluginError(dragData.name, new Error("请拖到时间线上的音频/视频素材上"));
			return;
		}

		// 元素 → mediaId → 云素材 fid（AI 任务按 fid 消费）
		const tracks = orderedTracks({ sceneTracks: this.config.getSceneTracks() });
		const sourceElement = tracks
			.flatMap((track) =>
				"elements" in track ? (track.elements as TimelineElement[]) : [],
			)
			.find((element) => element.id === hit.elementId) ?? null;
		const mediaId =
			(sourceElement as { mediaId?: string } | null)?.mediaId ?? null;
		const fid = mediaId ? getMediaFid(mediaId) : null;
		// 本地导入的素材没有 fid：素材字节在 OPFS 里，先自动上传到素材库换取 fid，
		// 否则 AI 任务的服务端读不到输入（之前只报错、不给出路）。
		const localFile = mediaId
			? (this.config
					.getMediaAssets()
					.find((asset) => asset.id === mediaId)?.file ?? null)
			: null;
		if (!sourceElement || (!fid && !localFile)) {
			toastPluginError(
				dragData.name,
				new Error("找不到目标素材对应的文件，请重新导入后再试"),
			);
			return;
		}

		const startTime = target.xPosition;
		// 常驻右下角的同一条 toast 当进度条用：AI 任务要跑几十秒到几分钟，
		// 只弹一次「已提交」的话，用户会以为没反应（人声分离就被当成坏了）。
		const toastId = `ai-${dragData.pluginType}-${hit.elementId}`;
		const showProgress = ({
			stage,
			percent,
		}: {
			stage: string;
			percent: number;
		}) => {
			toast.loading(`${dragData.name} ${percent}%`, {
				id: toastId,
				description: `${buildProgressBar({ percent })} ${stage}`,
				duration: Infinity,
			});
		};
		showProgress({ stage: "提交任务", percent: 1 });

		void (async () => {
			try {
				let uploadFid = fid;
				if (!uploadFid && localFile) {
					showProgress({ stage: "本地素材先入库", percent: 3 });
					uploadFid = await uploadFileToLibrary(localFile);
					if (mediaId) registerMediaFid(mediaId, uploadFid);
				}
				if (!uploadFid) throw new Error("无法取得素材 id");

				/**
				 * 人声分离默认只处理拖到的那一段：GPU 侧按秒裁剪，
				 * 产出长度正好等于片段长度（整条素材会让 3 分钟的 BGM 白等 2 分钟）。
				 * 变速片段跳过裁剪——源时间轴与片段时长不成线性关系，交给整条素材更稳。
				 */
				const retimeOfSource = (sourceElement as { retime?: RetimeConfig })
					.retime;
				const cropParams =
					dragData.pluginType === "vocal-separate" && !retimeOfSource
						? {
								start: mediaTimeToSeconds({ time: sourceElement.trimStart }),
								duration: mediaTimeToSeconds({ time: sourceElement.duration }),
							}
						: {};

				const { outputs, result } = await runPluginOnAsset({
					pluginType: dragData.pluginType,
					pluginName: dragData.name,
					fid: uploadFid,
					params: cropParams,
					onProgress: (stage, percent) => showProgress({ stage, percent }),
				});

				const editor = EditorCore.getInstance();

				// 镜头切分：按切点从后往前切开目标元素（时间从后往前，避免后续切点偏移）
				if (dragData.pluginType === "scene-split") {
					const cuts: number[] = Array.isArray(result?.cuts)
						? (result.cuts as number[]).filter((x) => Number.isFinite(x))
						: [];
					if (cuts.length === 0) {
						throw new Error("没有检测到镜头切点");
					}
					// runner 给的是「源素材」秒数，splitElements 要的是「时间线」秒数：
					// 素材没从头用（trimStart>0）或做过变速时，直接拿源秒数切会切错位置。
					const trimStart = mediaTimeToSeconds({ time: sourceElement.trimStart });
					const clipStart = mediaTimeToSeconds({ time: sourceElement.startTime });
					const clipDuration = mediaTimeToSeconds({ time: sourceElement.duration });
					const retime = (sourceElement as { retime?: RetimeConfig }).retime;
					const timelineCuts = cuts
						.map((sec) => {
							const at =
								clipStart +
								getClipTimeAtSourceTime({ sourceTime: sec - trimStart, retime });
							return Math.max(clipStart + 0.01, Math.min(clipStart + clipDuration - 0.01, at));
						})
						.filter((t) => t > clipStart && t < clipStart + clipDuration);
					if (timelineCuts.length === 0) {
						throw new Error("切点都落在片段之外（素材可能被裁掉了）");
					}
					const targets = [{ trackId: hit.trackId, elementId: hit.elementId }];
					for (const sec of [...timelineCuts].sort((a, b) => b - a)) {
						editor.timeline.splitElements({
							elements: targets,
							splitTime: mediaTimeFromSeconds({ seconds: sec }),
						});
					}
					toast.success(`「${dragData.name}」完成，已切成 ${cuts.length + 1} 段`, {
						id: toastId,
						duration: 8000,
					});
					return;
				}
				const projectId = editor.project.getActive().metadata.id;
				const commands: Command[] = [];

				for (const out of outputs) {
					const file = new File([out.blob], out.fileName, { type: "audio/wav" });
					const processed = await processMediaAssets({ files: [file] });
					const asset = processed[0];
					if (!asset) continue;
					const created = await editor.media.addMediaAsset({ projectId, asset });
					if (!created) continue;

					// 每份产出一条命名轨（人声 / 背景音），便于区分
					const addTrack = new AddTrackCommand({
						type: "audio",
						name: out.trackName,
					});
					const element = buildElementFromMedia({
						mediaId: created.id,
						mediaType: created.type,
						name: out.trackName,
						duration: toElementDurationTicks({
							seconds: created.duration ?? asset.duration,
						}),
						startTime,
					});
					commands.push(
						addTrack,
						new InsertElementCommand({
							element,
							placement: { mode: "explicit", trackId: addTrack.getTrackId() },
						}),
					);
				}

				if (commands.length > 0) {
					this.config.executeCommand(new BatchCommand(commands));
				}

				/**
				 * 原片段的出声必须关掉：人声/背景音落在下面几条轨时，
				 * 上面那条视频还在放原声，听感就是「人声轨跟原声一模一样」。
				 */
				let mutedSource = false;
				if (
					sourceElement &&
					canElementHaveAudio(sourceElement) &&
					!isElementMuted({ element: sourceElement })
				) {
					EditorCore.getInstance().timeline.toggleElementsMuted({
						elements: [{ trackId: hit.trackId, elementId: hit.elementId }],
					});
					mutedSource = true;
				}

				const note =
					typeof result?.note === "string" && result.note ? `\n${result.note}` : "";
				toast.success(
					`「${dragData.name}」完成，已落轨：${outputs.map((o) => o.trackName).join(" / ")}${
						mutedSource ? "（原片段已静音）" : ""
					}`,
					{ id: toastId, duration: 12000, description: note || undefined },
				);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				toast.error(`「${dragData.name}」执行失败`, {
					id: toastId,
					description: message,
					duration: 10000,
				});
			}
		})();
	}

	private async executeFileDrop({
		files,
		mouseX,
		mouseY,
	}: {
		files: File[];
		mouseX: number;
		mouseY: number;
	}): Promise<void> {
		const projectId = this.config.getActiveProjectId();
		if (!projectId) return;

		await showMediaUploadToast({
			filesCount: files.length,
			promise: async () => {
				const processedAssets = await processMediaAssets({ files });

				// Sequential on purpose: each iteration reads getSceneTracks()
				// to decide placement (reuse empty main vs new track) and that
				// decision depends on the effects of prior inserts.
				for (const asset of processedAssets) {
					const createdAsset = await this.config.addMediaAsset({
						projectId,
						asset,
					});
					if (!createdAsset) continue;

					const duration = toElementDurationTicks({
						seconds: createdAsset.duration,
					});

					const sceneTracks = this.config.getSceneTracks();
					const currentTime = this.config.getCurrentPlayheadTime();

					const reuseMainTrackId =
						createdAsset.type !== "audio" &&
						sceneTracks.overlay.length === 0 &&
						sceneTracks.audio.length === 0 &&
						sceneTracks.main.elements.length === 0
							? sceneTracks.main.id
							: null;

					if (reuseMainTrackId) {
						this.config.insertElement({
							placement: { mode: "explicit", trackId: reuseMainTrackId },
							element: buildElementFromMedia({
								mediaId: createdAsset.id,
								mediaType: createdAsset.type,
								name: createdAsset.name,
								duration,
								startTime: currentTime,
							}),
						});
						continue;
					}

					const dropTarget = computeDropTarget({
						elementType: createdAsset.type,
						mouseX,
						mouseY,
						tracks: sceneTracks,
						playheadTime: currentTime,
						isExternalDrop: true,
						elementDuration: duration,
						pixelsPerSecond: BASE_TIMELINE_PIXELS_PER_SECOND,
						zoomLevel: this.config.zoomLevel,
					});

					const trackType: TrackType =
						createdAsset.type === "audio" ? "audio" : "video";
					this.insertAtTarget({
						element: buildElementFromMedia({
							mediaId: createdAsset.id,
							mediaType: createdAsset.type,
							name: createdAsset.name,
							duration,
							startTime: dropTarget.xPosition,
						}),
						target: dropTarget,
						trackType,
					});
				}

				return {
					uploadedCount: processedAssets.length,
					assetNames: processedAssets.map((asset) => asset.name),
				};
			},
		});
	}
}
