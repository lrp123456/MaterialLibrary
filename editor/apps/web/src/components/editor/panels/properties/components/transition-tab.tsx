"use client";

import { useCallback, useEffect, useState } from "react";
import { useEditor } from "@/editor/use-editor";
import { useElementPreview } from "@/timeline/hooks/use-element-preview";
import {
	UpdateTransitionCommand,
	RemoveTransitionCommand,
} from "@/commands/timeline/element";
import {
	resolveTransitionPair,
	canElementHaveTransition,
} from "@/timeline/transition";
import { getTransitionPreset } from "@/services/clip-packs";
import { PropertyParamField } from "./property-param-field";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { HugeiconsIcon } from "@hugeicons/react";
import { Delete02Icon, RefreshIcon } from "@hugeicons/core-free-icons";
import { mediaTimeFromSeconds, TICKS_PER_SECOND } from "@/wasm";
import type { ParamValues } from "@/params";
import type { TransitionableElement } from "@/timeline";

const MIN_DURATION_SECONDS = 0.1;
const DURATION_STEP_SECONDS = 0.05;

/**
 * 属性面板的「转场」页：时长与预设参数。
 *
 * 时长改动会同时平移 B 与后续素材（见 timeline/transition.ts），
 * 与时间线覆盖条拖动共用 UpdateTransitionCommand，撤销行为一致。
 */
export function TransitionTab({
	element,
	trackId,
}: {
	element: TransitionableElement;
	trackId: string;
}) {
	const editor = useEditor();
	useEditor((e) => e.scenes.getActiveSceneOrNull());
	const { renderElement, previewUpdates, commit } =
		useElementPreview<TransitionableElement>({
			trackId,
			elementId: element.id,
			fallback: element,
		});

	const current = canElementHaveTransition(renderElement)
		? renderElement
		: element;
	const transition = current.transitionOut;
	const tracks = editor.scenes.getActiveSceneOrNull()?.tracks ?? null;
	const pair =
		tracks && transition
			? resolveTransitionPair({ tracks, elementId: current.id })
			: null;
	const preset = transition
		? getTransitionPreset({ type: transition.type })
		: null;

	const durationSeconds = transition
		? transition.duration / TICKS_PER_SECOND
		: 0;
	const maxSeconds = pair
		? Math.min(pair.element.duration, pair.next.duration) / TICKS_PER_SECOND
		: durationSeconds;
	const params: ParamValues = {
		...(preset?.defaultParams ?? {}),
		...(transition?.params ?? {}),
	};

	const [draftSeconds, setDraftSeconds] = useState<number | null>(null);

	useEffect(() => {
		setDraftSeconds(null);
	}, [transition?.type, transition?.duration]);

	const commitTransition = useCallback(
		(next: { seconds?: number; params?: ParamValues }) => {
			if (!transition) return;
			const seconds = next.seconds ?? draftSeconds ?? durationSeconds;
			editor.command.execute({
				command: new UpdateTransitionCommand({
					elementId: current.id,
					duration: mediaTimeFromSeconds({
						seconds: Math.min(
							maxSeconds,
							Math.max(MIN_DURATION_SECONDS, seconds),
						),
					}),
					params: next.params ?? params,
				}),
			});
		},
		[
			transition,
			draftSeconds,
			durationSeconds,
			maxSeconds,
			params,
			editor,
			current.id,
		],
	);

	if (!transition || !pair) {
		return (
			<div className="text-muted-foreground px-3 py-6 text-xs leading-relaxed">
				这个片段尾部没有有效的转场。把播放头放到两段素材之间，再从「转场」面板选一个预设。
			</div>
		);
	}

	const displaySeconds = draftSeconds ?? durationSeconds;

	return (
		<div className="flex flex-col gap-3 px-1 pb-6">
			<div className="flex items-center justify-between px-1">
				<span className="text-muted-foreground text-xs">
					{preset?.nameZh ?? transition.type}
				</span>
				<div className="flex items-center gap-1">
					<Button
						variant="ghost"
						size="icon"
						aria-label="恢复转场默认参数"
						onClick={() => {
							commitTransition({
								seconds: preset?.defaultDuration ?? durationSeconds,
								params: preset?.defaultParams ?? {},
							});
						}}
					>
						<HugeiconsIcon icon={RefreshIcon} size={16} />
					</Button>
					<Button
						variant="ghost"
						size="icon"
						aria-label="移除转场"
						onClick={() =>
							editor.command.execute({
								command: new RemoveTransitionCommand({ elementId: current.id }),
							})
						}
					>
						<HugeiconsIcon icon={Delete02Icon} size={16} />
					</Button>
				</div>
			</div>

			<div className="flex flex-col gap-2 px-1">
				<div className="flex items-center justify-between">
					<span className="text-muted-foreground text-xs">转场时长</span>
					<span className="text-foreground font-mono text-xs">
						{displaySeconds.toFixed(2)}s
					</span>
				</div>
				<input
					type="range"
					min={MIN_DURATION_SECONDS}
					max={Math.max(MIN_DURATION_SECONDS, maxSeconds)}
					step={DURATION_STEP_SECONDS}
					value={displaySeconds}
					onChange={(event) => setDraftSeconds(Number(event.currentTarget.value))}
					onPointerUp={() => commitTransition({})}
					onKeyUp={() => commitTransition({})}
					aria-label="转场时长"
					className="accent-primary w-full"
				/>
				<p className="text-muted-foreground text-[11px] leading-relaxed">
					拖动会同步平移下一段素材；也可以直接拖时间线上接缝处的转场条。
				</p>
			</div>

			{(preset?.params.length ?? 0) > 0 && <Separator />}
			{preset?.params.map((param) => (
				<div key={param.key} className="flex flex-col gap-3">
					<div className="px-1">
						<PropertyParamField
							param={param}
							value={params[param.key] ?? param.default}
							onPreview={(value) => {
								previewUpdates({
									transitionOut: {
										...transition,
										params: { ...params, [param.key]: value },
									},
								} as Partial<TransitionableElement>);
							}}
							onCommit={() => {
								const latest = current.transitionOut?.params ?? params;
								commit();
								commitTransition({ params: latest });
							}}
						/>
					</div>
					<Separator />
				</div>
			))}
			<p className="text-muted-foreground px-1 text-[11px] leading-relaxed">
				拖动滑杆实时预览，松手才写入撤销记录。
			</p>
		</div>
	);
}
