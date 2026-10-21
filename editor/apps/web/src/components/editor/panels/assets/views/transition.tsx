"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { PanelView } from "./base-panel";
import { useEditor } from "@/editor/use-editor";
import { t } from "@/i18n";
import { cn } from "@/utils/ui";
import { ApplyTransitionCommand, RemoveTransitionCommand } from "@/commands";
import {
	getTransitionPresets,
	reloadClipPacks,
	type TransitionPreset,
} from "@/services/clip-packs";
import { mediaTimeFromSeconds } from "@/wasm";
import { pickTransitionTarget, resolveTransitionPair } from "@/timeline/transition";

/**
 * 转场面板。
 *
 * 12 个预设全部来自 `type=transition` 的资源包（loader 已把 mode 与 uniform
 * 表达式解析好），这里只负责"选一个 → 落到某个剪辑点"。
 *
 * 落点规则（与命令共用同一套判定，见 timeline/transition.ts）：
 *   1. 只选中一个片段且它后面有紧邻片段 → 落到这个剪辑点；
 *   2. 否则取离播放头最近的剪辑点（1 秒内）。
 */
export function TransitionView() {
	const editor = useEditor();
	const [presets, setPresets] = useState<TransitionPreset[]>(() =>
		getTransitionPresets(),
	);

	// 资源包在编辑器启动时异步加载：这里轮询几次，加载完成后自动刷新列表
	useEffect(() => {
		let attempts = 0;
		let timer: ReturnType<typeof setTimeout> | null = null;
		const tick = () => {
			const next = getTransitionPresets();
			if (next.length > 0) {
				setPresets(next);
				return;
			}
			attempts += 1;
			if (attempts >= 10) return;
			timer = setTimeout(tick, 500);
		};
		tick();
		return () => {
			if (timer) clearTimeout(timer);
		};
	}, []);

	const handleReload = useCallback(async () => {
		await reloadClipPacks();
		setPresets(getTransitionPresets());
	}, []);

	const tracks = editor.scenes.getActiveSceneOrNull()?.tracks ?? null;
	const target = tracks
		? pickTransitionTarget({
				tracks,
				selectedElementIds: editor.selection
					.getSelectedElements()
					.map((element) => element.elementId),
				playheadTime: editor.playback.getCurrentTime(),
			})
		: null;
	const currentTransition = tracks && target
		? (resolveTransitionPair({ tracks, elementId: target.elementId })?.element
				.transitionOut ?? null)
		: null;

	const handleApply = useCallback(
		(preset: TransitionPreset) => {
			if (!tracks || !target) {
				toast.error("没有可用的剪辑点：请选中片段，或把播放头放到两段之间");
				return;
			}

			// 已有转场时先移除再应用，保证 d 不会被重复计入时间线
			if (currentTransition) {
				editor.command.execute({
					command: new RemoveTransitionCommand({ elementId: target.elementId }),
				});
			}

			editor.command.execute({
				command: new ApplyTransitionCommand({
					elementId: target.elementId,
					type: preset.id,
					duration: mediaTimeFromSeconds({ seconds: preset.defaultDuration }),
					params: preset.defaultParams,
				}),
			});
			toast.success(`已应用转场：${preset.nameZh}`);
		},
		[editor, tracks, target, currentTransition],
	);

	const handleRemove = useCallback(() => {
		if (!target) {
			toast.error("没有可移除的转场");
			return;
		}
		editor.command.execute({
			command: new RemoveTransitionCommand({ elementId: target.elementId }),
		});
		toast.success("已移除转场");
	}, [editor, target]);

	return (
		<PanelView
			title={t("assets.transition.title", "转场")}
			actions={
				<button
					type="button"
					onClick={handleRemove}
					disabled={!currentTransition}
					className={cn(
						"text-muted-foreground hover:text-foreground rounded-sm px-2 py-1 text-xs transition-colors",
						!currentTransition && "pointer-events-none opacity-40",
					)}
				>
					{t("assets.transition.remove", "移除转场")}
				</button>
			}
		>
			{currentTransition ? (
				<p className="text-muted-foreground px-1 pb-2 text-xs">
					{t("assets.transition.current", "当前剪辑点已有转场，再次点选会替换")}
				</p>
			) : null}

			{presets.length === 0 ? (
				<div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
					<p className="text-muted-foreground text-xs">
						{t(
							"assets.transition.empty",
							"未加载到转场资源包，请确认 /editor-api/packs 返回了 type=transition 的包。",
						)}
					</p>
					<button
						type="button"
						onClick={handleReload}
						className="bg-accent text-foreground rounded-sm px-3 py-1.5 text-xs"
					>
						{t("assets.transition.reload", "重新加载资源包")}
					</button>
				</div>
			) : (
				<div
					className="grid gap-2 pb-2"
					style={{ gridTemplateColumns: "repeat(auto-fill, minmax(88px, 1fr))" }}
				>
					{presets.map((preset) => (
						<TransitionCard
							key={preset.id}
							preset={preset}
							active={currentTransition?.type === preset.id}
							onSelect={handleApply}
						/>
					))}
				</div>
			)}
		</PanelView>
	);
}

function TransitionCard({
	preset,
	active,
	onSelect,
}: {
	preset: TransitionPreset;
	active: boolean;
	onSelect: (preset: TransitionPreset) => void;
}) {
	return (
		<button
			type="button"
			onClick={() => onSelect(preset)}
			title={preset.descriptionZh || preset.nameZh}
			className={cn(
				"group flex flex-col gap-1 rounded-sm border p-1 text-left transition-colors",
				active
					? "border-primary/70 bg-accent"
					: "border-border hover:border-primary/50 hover:bg-accent/60",
			)}
		>
			{/* 缩略图纯 CSS：按 mode 给不同渐变，不引入任何图片资源 */}
			<div
				className="relative aspect-video w-full overflow-hidden rounded-[2px]"
				style={thumbnailStyle({ mode: preset.mode })}
			>
				<div
					className="absolute inset-0"
					style={thumbnailOverlayStyle({ mode: preset.mode })}
				/>
			</div>
			<span className="text-foreground truncate text-[11px] leading-4">
				{preset.nameZh}
			</span>
		</button>
	);
}

/** 底色：左右两半模拟 A/B 两段画面 */
function thumbnailStyle({ mode }: { mode: number }): React.CSSProperties {
	const base =
		"linear-gradient(115deg, #2f6f8f 0%, #2f6f8f 48%, #b4673a 52%, #b4673a 100%)";
	switch (mode) {
		case 1:
			return { background: "#111111" };
		case 2:
			return { background: "#f2f2f2" };
		case 9:
			return {
				background:
					"repeating-linear-gradient(180deg, #2f6f8f 0 4px, #b4673a 4px 8px)",
			};
		case 7:
			return { background: base, filter: "blur(0.6px)" };
		case 10:
			return { background: base };
		default:
			return { background: base };
	}
}

/** 叠加层：模拟每个 mode 的画面特征 */
function thumbnailOverlayStyle({
	mode,
}: {
	mode: number;
}): React.CSSProperties {
	switch (mode) {
		case 0:
			return {
				background:
					"linear-gradient(90deg, rgba(255,255,255,0) 30%, rgba(255,255,255,0.35) 50%, rgba(255,255,255,0) 70%)",
			};
		case 3:
			return {
				background:
					"linear-gradient(90deg, rgba(0,0,0,0) 40%, rgba(0,0,0,0.25) 55%)",
			};
		case 4:
			return {
				background:
					"linear-gradient(180deg, rgba(0,0,0,0) 40%, rgba(0,0,0,0.25) 55%)",
			};
		case 5:
			return {
				background:
					"radial-gradient(circle at 50% 50%, rgba(255,255,255,0.45) 0%, rgba(255,255,255,0) 65%)",
			};
		case 6:
			return {
				background:
					"conic-gradient(from 210deg at 50% 50%, rgba(255,255,255,0.35), rgba(255,255,255,0) 45%)",
			};
		case 8:
			return {
				background:
					"linear-gradient(90deg, rgba(0,0,0,0) 45%, rgba(255,255,255,0.5) 50%, rgba(0,0,0,0) 55%)",
			};
		case 10:
			return {
				background:
					"repeating-linear-gradient(90deg, rgba(255,0,80,0.35) 0 6px, rgba(0,200,255,0.3) 6px 12px, rgba(0,0,0,0) 12px 20px)",
			};
		case 11:
			return {
				background:
					"linear-gradient(90deg, rgba(0,0,0,0) 55%, rgba(0,0,0,0.35) 70%, rgba(255,255,255,0.5) 76%, rgba(0,0,0,0) 82%)",
			};
		default:
			return { background: "transparent" };
	}
}
