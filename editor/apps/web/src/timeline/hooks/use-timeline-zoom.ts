import {
	type WheelEvent as ReactWheelEvent,
	type RefObject,
	useEffect,
	useLayoutEffect,
	useReducer,
	useState,
} from "react";
import { useEditor } from "@/editor/use-editor";
import { cancelInteraction } from "@/editor/cancel-interaction";
import { useCommittedRef } from "@/hooks/use-committed-ref";
import { TIMELINE_ZOOM_MIN } from "@/timeline/scale";
import {
	ZoomController,
	type ZoomConfig,
} from "@/timeline/controllers/zoom-controller";
import type { MediaTime } from "@/wasm";

interface UseTimelineZoomProps {
	containerRef: RefObject<HTMLDivElement | null>;
	minZoom?: number;
	initialZoom?: number;
	initialScrollLeft?: number;
	initialPlayheadTime?: MediaTime;
	tracksScrollRef: RefObject<HTMLDivElement | null>;
	rulerScrollRef: RefObject<HTMLDivElement | null>;
}

interface UseTimelineZoomReturn {
	zoomLevel: number;
	setZoomLevel: (zoomLevel: number | ((prev: number) => number)) => void;
	handleWheel: (event: ReactWheelEvent) => void;
	saveScrollPosition: () => void;
}

export function useTimelineZoom({
	containerRef,
	minZoom = TIMELINE_ZOOM_MIN,
	initialZoom,
	initialScrollLeft,
	initialPlayheadTime,
	tracksScrollRef,
	rulerScrollRef,
}: UseTimelineZoomProps): UseTimelineZoomReturn {
	const editor = useEditor();
	const config: ZoomConfig = {
		minZoom,
		getContainerEl: () => containerRef.current,
		getTracksScrollEl: () => tracksScrollRef.current,
		getRulerScrollEl: () => rulerScrollRef.current,
		getCurrentPlayheadTime: () => editor.playback.getCurrentTime(),
		seek: (time) => editor.playback.seek({ time }),
		setTimelineViewState: ({ zoomLevel, scrollLeft, playheadTime }) =>
			editor.project.setTimelineViewState({
				viewState: {
					zoomLevel,
					scrollLeft,
					playheadTime,
				},
			}),
	};
	const configRef = useCommittedRef(config);
	const [controller] = useState(
		() => new ZoomController({ configRef, initialZoom }),
	);
	const zoomLevel = controller.zoomLevel;

	const [, rerender] = useReducer((n: number) => n + 1, 0);
	useEffect(() => controller.subscribe(rerender), [controller]);

	useEffect(() => {
		controller.reconcileInitialAndMinZoom({ minZoom, initialZoom });
	}, [controller, minZoom, initialZoom]);

	useLayoutEffect(() => {
		controller.applyZoomLayout(zoomLevel);
	}, [controller, zoomLevel]);

	useEffect(() => {
		return controller.restoreInitialScrollIfNeeded(initialScrollLeft);
	}, [controller, initialScrollLeft]);

	useEffect(() => {
		controller.restoreInitialPlayheadIfNeeded(initialPlayheadTime);
	}, [controller, initialPlayheadTime]);

	useEffect(() => controller.bindPreventBrowserZoom(), [controller]);

	// 双指捏合缩放：触屏没有 Ctrl+滚轮，捏合是时间轴缩放的唯一自然手势。
	// 第二根手指落下时先取消正在进行的拖拽/框选，避免缩放的同事误移片段。
	useEffect(() => {
		const el = containerRef.current;
		if (!el) return;

		const points = new Map<number, { x: number; y: number }>();
		let lastDistance = 0;
		const getDistance = () => {
			const [a, b] = [...points.values()];
			if (!a || !b) return 0;
			return Math.hypot(a.x - b.x, a.y - b.y);
		};

		const handleDown = (event: PointerEvent) => {
			if (event.pointerType === "mouse") return;
			points.set(event.pointerId, { x: event.clientX, y: event.clientY });
			if (points.size === 2) {
				cancelInteraction();
				lastDistance = getDistance();
			}
		};

		const handleMove = (event: PointerEvent) => {
			if (!points.has(event.pointerId)) return;
			points.set(event.pointerId, { x: event.clientX, y: event.clientY });
			if (points.size !== 2 || lastDistance <= 0) return;

			const nextDistance = getDistance();
			if (nextDistance <= 0) return;
			const ratio = nextDistance / lastDistance;
			lastDistance = nextDistance;
			if (Math.abs(ratio - 1) < 0.004) return;
			controller.setZoomLevel((prev) => prev * ratio);
		};

		const handleUp = (event: PointerEvent) => {
			if (!points.delete(event.pointerId)) return;
			if (points.size < 2) lastDistance = 0;
		};

		el.addEventListener("pointerdown", handleDown);
		el.addEventListener("pointermove", handleMove);
		el.addEventListener("pointerup", handleUp);
		el.addEventListener("pointercancel", handleUp);

		return () => {
			el.removeEventListener("pointerdown", handleDown);
			el.removeEventListener("pointermove", handleMove);
			el.removeEventListener("pointerup", handleUp);
			el.removeEventListener("pointercancel", handleUp);
		};
	}, [containerRef, controller]);

	useEffect(() => () => controller.destroy(), [controller]);

	return {
		zoomLevel,
		setZoomLevel: controller.setZoomLevel,
		handleWheel: controller.handleWheel,
		saveScrollPosition: controller.saveScrollPosition,
	};
}
