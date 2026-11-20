"use client";

import { useElementSelection } from "@/timeline/hooks/element/use-element-selection";
import { TimelineElement } from "./timeline-element";
import type { TimelineTrack } from "@/timeline";
import type { TimelineElement as TimelineElementType } from "@/timeline";
import { TIMELINE_LAYERS } from "./layers";
import { TransitionOverlay } from "./transition-overlay";
import type { ElementDragView } from "@/timeline";

interface TimelineTrackContentProps {
	track: TimelineTrack;
	zoomLevel: number;
	dragView: ElementDragView;
	onResizeStart: (params: {
		event: React.PointerEvent;
		element: TimelineElementType;
		track: TimelineTrack;
		side: "left" | "right";
	}) => void;
	onElementPointerDown: (params: {
		event: React.PointerEvent;
		element: TimelineElementType;
		track: TimelineTrack;
	}) => void;
	onElementClick: (params: {
		event: React.MouseEvent;
		element: TimelineElementType;
		track: TimelineTrack;
	}) => void;
	onTrackMouseDown?: (event: React.PointerEvent) => void;
	onTrackMouseUp?: (event: React.PointerEvent) => void;
	shouldIgnoreClick?: () => boolean;
	targetElementId?: string | null;
}

export function TimelineTrackContent({
	track,
	zoomLevel,
	dragView,
	onResizeStart,
	onElementPointerDown,
	onElementClick,
	onTrackMouseDown,
	onTrackMouseUp,
	shouldIgnoreClick,
	targetElementId = null,
}: TimelineTrackContentProps) {
	const { isElementSelected } = useElementSelection();

	return (
		<div className="relative size-full">
			<button
				type="button"
				className="absolute inset-0 m-0 size-full appearance-none border-0 bg-transparent p-0 touch-pan-y"
				aria-label={`Select ${track.name} track`}
				onPointerUp={(event) => {
					if (shouldIgnoreClick?.()) return;
					onTrackMouseUp?.(event);
				}}
				onPointerDown={(event) => {
					// 触屏不能吞掉默认行为，否则随后的 click 可能不派发，点空白处 seek 就失效了
					if (event.pointerType === "mouse") event.preventDefault();
					onTrackMouseDown?.(event);
				}}
			/>
			{/* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- spatial gesture surface; the wrapping <button> handles keyboard track selection, this <div> only forwards background clicks for box-select / deselect. */}
			<div
				className="relative h-full min-w-full touch-pan-y"
				style={{ zIndex: TIMELINE_LAYERS.trackContent }}
				onPointerUp={(event) => {
					if (event.target !== event.currentTarget) return;
					if (shouldIgnoreClick?.()) return;
					onTrackMouseUp?.(event);
				}}
				onPointerDown={(event) => {
					if (event.target !== event.currentTarget) return;
					event.preventDefault();
					onTrackMouseDown?.(event);
				}}
			>
				{track.elements.length === 0 ? (
					<div className="text-muted-foreground border-muted/30 pointer-events-none flex size-full items-center justify-center rounded-sm border-2 border-dashed text-xs" />
				) : (
					track.elements.map((element) => {
						const isSelected = isElementSelected({
							trackId: track.id,
							elementId: element.id,
						});

						return (
							<TimelineElement
								key={element.id}
								element={element}
								track={track}
								zoomLevel={zoomLevel}
								isSelected={isSelected}
								onResizeStart={({ event, element, side }) =>
									onResizeStart({ event, element, track, side })
								}
								onElementPointerDown={({ event, element }) =>
									onElementPointerDown({ event, element, track })
								}
								onElementClick={({ event, element }) =>
									onElementClick({ event, element, track })
								}
								dragView={dragView}
								isDropTarget={element.id === targetElementId}
							/>
						);
					})
				)}
				<TransitionOverlay track={track} zoomLevel={zoomLevel} />
			</div>
		</div>
	);
}
