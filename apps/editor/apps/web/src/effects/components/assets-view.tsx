"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PanelView } from "@/components/editor/panels/assets/views/base-panel";
import { DraggableItem } from "@/components/editor/panels/assets/draggable-item";
import {
	effectsRegistry,
	EFFECT_TARGET_ELEMENT_TYPES,
} from "@/effects";
import { effectPreviewService } from "@/services/renderer/effect-preview";
import {
	initializeGpuRenderer,
	isGpuAvailable,
} from "@/services/renderer/gpu-renderer";
import { subscribeClipPacks } from "@/services/clip-packs";
import { useEditor } from "@/editor/use-editor";
import type { EditorCore } from "@/core";
import { buildEffectElement } from "@/timeline/element-utils";
import type { EffectCategory, EffectDefinition } from "@/effects/types";
import type { TrackType, VisualElement } from "@/timeline";

export function EffectsView({
	category = "effect",
}: {
	category?: EffectCategory;
}) {
	// 资源包异步注册：订阅一下，加载完成后自动刷新列表（否则只显示内置项）。
	const [, forceRefresh] = useState(0);
	useEffect(
		() =>
			subscribeClipPacks(() => {
				forceRefresh((version) => version + 1);
			}),
		[],
	);

	const [query, setQuery] = useState("");

	const effects = effectsRegistry
		.getAll()
		.filter((effect) => (effect.category ?? "effect") === category);
	const visible = filterEffects({ effects, query });

	const title =
		category === "filter" ? "滤镜" : category === "adjust" ? "调节" : "特效";

	return (
		<PanelView title={title}>
			<input
				value={query}
				onChange={(event) => setQuery(event.target.value)}
				placeholder={
					category === "filter" ? "搜索滤镜" : "搜索特效（如：模糊、美肤、水波）"
				}
				className="border-border bg-muted text-foreground placeholder:text-muted-foreground focus:border-primary mb-2 w-full rounded-md border px-2 py-1.5 text-xs outline-none"
			/>
			<p className="text-muted-foreground px-1 pb-2 text-[11px] leading-relaxed">
				{category === "filter"
					? "点击套用到选中片段；未选中时作用于整幅画面。也可以拖到时间线的片段上。"
					: "点击加到画面（新建特效轨）；拖到片段上则只作用于该片段。"}
			</p>
			<EffectsGrid effects={visible} hasQuery={query.trim().length > 0} />
		</PanelView>
	);
}

function filterEffects({
	effects,
	query,
}: {
	effects: EffectDefinition[];
	query: string;
}): EffectDefinition[] {
	const q = query.trim().toLowerCase();
	if (!q) return effects;
	return effects.filter(
		(effect) =>
			effect.name.toLowerCase().includes(q) ||
			effect.type.toLowerCase().includes(q) ||
			effect.keywords.some((keyword) => keyword.toLowerCase().includes(q)),
	);
}

function EffectsGrid({
	effects,
	hasQuery,
}: {
	effects: EffectDefinition[];
	hasQuery: boolean;
}) {
	if (effects.length === 0) {
		return (
			<div className="text-muted-foreground flex flex-col items-center gap-2 px-4 py-10 text-center text-xs">
				<span>{hasQuery ? "没有匹配的效果" : "还没有可用的效果"}</span>
				{!hasQuery && (
					<span className="text-[11px] opacity-70">
						资源包加载失败时，内置模糊/调节/滤镜仍会出现在这里。
					</span>
				)}
			</div>
		);
	}

	return (
		<div
			className="grid gap-2"
			style={{ gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))" }}
		>
			{effects.map((effect) => (
				<EffectItem key={effect.type} effect={effect} />
			))}
		</div>
	);
}

function EffectPreviewCanvas({ effectType }: { effectType: string }) {
	const canvasRef = useRef<HTMLCanvasElement>(null);

	useEffect(() => {
		let cancelled = false;
		const render = async () => {
			// GPU 初始化是异步的；没等它完成就渲染会拿到原图，看起来"没有预览"。
			await initializeGpuRenderer();
			if (cancelled || !canvasRef.current) return;
			effectPreviewService.renderPreview({
				effectType,
				params: {},
				targetCanvas: canvasRef.current,
			});
			if (!isGpuAvailable() && canvasRef.current) {
				canvasRef.current.dataset.gpu = "off";
			}
		};

		void render();
		const off = effectPreviewService.onPreviewImageReady({
			callback: () => void render(),
		});
		return () => {
			cancelled = true;
			off();
		};
	}, [effectType]);

	return <canvas ref={canvasRef} className="size-full" />;
}

function findSelectedVisual({
	editor,
}: {
	editor: EditorCore;
}): { trackId: string; element: VisualElement } | null {
	const selected = editor.selection.getSelectedElements();
	if (selected.length !== 1) return null;
	const found = editor.timeline.getElementsWithTracks({ elements: selected })[0];
	if (!found) return null;
	if (
		!(EFFECT_TARGET_ELEMENT_TYPES as readonly string[]).includes(
			found.element.type,
		)
	) {
		return null;
	}
	return { trackId: found.track.id, element: found.element as VisualElement };
}

function EffectItem({ effect }: { effect: EffectDefinition }) {
	const editor = useEditor();

	const handleAddToTimeline = useCallback(() => {
		const hit = findSelectedVisual({ editor });
		if (hit) {
			editor.timeline.addClipEffect({
				trackId: hit.trackId,
				elementId: hit.element.id,
				effectType: effect.type,
			});
			return;
		}

		const currentTime = editor.playback.getCurrentTime();
		const element = buildEffectElement({
			effectType: effect.type,
			startTime: currentTime,
		});

		editor.timeline.insertElement({
			placement: { mode: "auto", trackType: "effect" as TrackType },
			element,
		});
	}, [editor, effect.type]);

	const preview = <EffectPreviewCanvas effectType={effect.type} />;

	return (
		<DraggableItem
			name={effect.name}
			preview={preview}
			dragData={{
				id: effect.type,
				name: effect.name,
				type: "effect",
				effectType: effect.type,
				targetElementTypes: EFFECT_TARGET_ELEMENT_TYPES,
			}}
			onAddToTimeline={handleAddToTimeline}
			applyOnClick
			aspectRatio={1}
			isRounded
			variant="card"
			containerClassName="w-full"
		/>
	);
}
