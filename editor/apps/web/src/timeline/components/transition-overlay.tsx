"use client";

import { useCallback, useRef, useState, type PointerEvent } from "react";
import { useEditor } from "@/editor/use-editor";
import { usePropertiesStore } from "@/components/editor/panels/properties/stores/properties-store";
import { UpdateTransitionCommand } from "@/commands/timeline/element";
import { resolveTransitionPair } from "@/timeline/transition";
import { getTransitionPreset } from "@/services/clip-packs";
import { getTimelinePixelsPerSecond } from "@/timeline/pixel-utils";
import { mediaTimeFromSeconds, TICKS_PER_SECOND } from "@/wasm";
import type { TimelineTrack } from "@/timeline";

const MIN_DURATION_SECONDS = 0.1;
const DURATION_STEP_SECONDS = 0.05;

interface DragState {
	elementId: string;
	startX: number;
	startSeconds: number;
	maxSeconds: number;
	moved: boolean;
}

/**
 * 时间线接缝上的转场覆盖条（Pr 式）。
 *
 * - 点击：选中左侧片段并打开「转场」属性页
 * - 左右拖动：调整转场时长（A.end 固定，左边缘移动）
 * - 拖动只产生一条 UpdateTransitionCommand，撤销一次即还原
 */
export function TransitionOverlay({
	track,
	zoomLevel,
}: {
	track: TimelineTrack;
	zoomLevel: number;
}) {
	const editor = useEditor();
	const tracks = useEditor(
		(e) => e.scenes.getActiveSceneOrNull()?.tracks ?? null,
	);
	const [draft, setDraft] = useState<{
		elementId: string;
		seconds: number;
	} | null>(null);
	const dragRef = useRef<DragState | null>(null);

	const pixelsPerSecond = getTimelinePixelsPerSecond({ zoomLevel });

	const handlePointerDown = useCallback(
		(
			event: PointerEvent<HTMLDivElement>,
			params: {
				elementId: string;
				durationSeconds: number;
				maxSeconds: number;
			},
		) => {
			event.preventDefault();
			event.stopPropagation();
			event.currentTarget.setPointerCapture(event.pointerId);
			dragRef.current = {
				elementId: params.elementId,
				startX: event.clientX,
				startSeconds: params.durationSeconds,
				maxSeconds: params.maxSeconds,
				moved: false,
			};
		},
		[],
	);

	const handlePointerMove = useCallback(
		(event: PointerEvent<HTMLDivElement>) => {
			const drag = dragRef.current;
			if (!drag) return;
			const dx = event.clientX - drag.startX;
			if (Math.abs(dx) > 2) drag.moved = true;
			if (!drag.moved) return;
			// 右边缘固定（A.end），向左拖变长、向右拖变短
			const seconds = Math.min(
				drag.maxSeconds,
				Math.max(
					MIN_DURATION_SECONDS,
					drag.startSeconds - dx / pixelsPerSecond,
				),
			);
			setDraft({ elementId: drag.elementId, seconds });
		},
		[pixelsPerSecond],
	);

	const handlePointerUp = useCallback(
		(event: PointerEvent<HTMLDivElement>, elementType: string) => {
			event.stopPropagation();
			const drag = dragRef.current;
			dragRef.current = null;
			const final = draft;
			setDraft(null);
			if (!drag) return;

			if (drag.moved && final) {
				const seconds =
					Math.round(final.seconds / DURATION_STEP_SECONDS) *
					DURATION_STEP_SECONDS;
				editor.command.execute({
					command: new UpdateTransitionCommand({
						elementId: drag.elementId,
						duration: mediaTimeFromSeconds({ seconds }),
					}),
				});
				return;
			}

			editor.selection.setSelectedElements({
				elements: [{ trackId: track.id, elementId: drag.elementId }],
			});
			usePropertiesStore.getState().setActiveTab({
				elementType,
				tabId: "transition",
			});
		},
		[draft, editor, track.id],
	);

	if (!tracks) return null;

	return (
		<div className="pointer-events-none absolute inset-0">
			{track.elements.map((element) => {
				if (element.type !== "video" && element.type !== "image") return null;
				if (!element.transitionOut) return null;
				const pair = resolveTransitionPair({
					tracks,
					elementId: element.id,
				});
				if (!pair) return null;

				const seconds =
					draft?.elementId === element.id
						? draft.seconds
						: element.transitionOut.duration / TICKS_PER_SECOND;
				const width = Math.max(10, seconds * pixelsPerSecond);
				const clipEndSeconds =
					(element.startTime + element.duration) / TICKS_PER_SECOND;
				const left = Math.max(0, clipEndSeconds * pixelsPerSecond - width);
				const preset = getTransitionPreset({ type: element.transitionOut.type });
				const maxSeconds = Math.min(
					element.duration,
					pair.next.duration,
				) / TICKS_PER_SECOND;

				return (
					<div
						key={`transition:${element.id}`}
						role="button"
						tabIndex={0}
						aria-label={`转场 ${preset?.nameZh ?? element.transitionOut.type}，${seconds.toFixed(2)} 秒`}
						title={`${preset?.nameZh ?? element.transitionOut.type} · ${seconds.toFixed(2)}s\n拖动调整时长，点击打开属性`}
						className="bg-primary/25 border-primary/70 text-primary-foreground pointer-events-auto absolute top-1 bottom-1 flex cursor-ew-resize items-center justify-center overflow-hidden rounded-[3px] border shadow-sm backdrop-blur-[1px] hover:bg-primary/35"
						style={{
							left: `${left}px`,
							width: `${width}px`,
						}}
						onPointerDown={(event) =>
							handlePointerDown(event, {
								elementId: element.id,
								durationSeconds: seconds,
								maxSeconds,
							})
						}
						onPointerMove={handlePointerMove}
						onPointerUp={(event) => handlePointerUp(event, element.type)}
						onKeyDown={(event) => {
							if (event.key !== "Enter" && event.key !== " ") return;
							event.preventDefault();
							editor.selection.setSelectedElements({
								elements: [{ trackId: track.id, elementId: element.id }],
							});
							usePropertiesStore.getState().setActiveTab({
								elementType: element.type,
								tabId: "transition",
							});
						}}
					>
						<span className="truncate px-1 text-[10px] leading-none">
							{width > 46 ? (preset?.nameZh ?? "转场") : ""}
						</span>
					</div>
				);
			})}
		</div>
	);
}
