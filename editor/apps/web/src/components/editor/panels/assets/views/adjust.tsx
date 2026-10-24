"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { PanelView } from "./base-panel";
import { useEditor } from "@/editor/use-editor";
import { useElementSelection } from "@/timeline/hooks/element/use-element-selection";
import { useElementPreview } from "@/timeline/hooks/use-element-preview";
import { effectsRegistry, EFFECT_TARGET_ELEMENT_TYPES } from "@/effects";
import { buildDefaultParamValues } from "@/params/registry";
import {
	ADJUST_TYPE,
	CURVE_CHANNELS,
	HSL_BANDS,
	WHEEL_GROUPS,
} from "@/effects/definitions/color-advanced";
import {
	CURVE_VIEW_RANGE,
	curveControlPoints,
	curveTable,
} from "@/effects/curve";
import {
	computeAutoGrade,
	computeLabAffine,
	computeWhiteBalanceGains,
	type FrameStats,
} from "@/services/color-analysis";
import { grabFrameStats } from "@/services/color-probe";
import {
	mediaTimeToSeconds,
	roundMediaTime,
	type MediaTime,
} from "@/wasm";
import {
	buildEffectElement,
	type EffectElement,
	type TimelineElement,
	type TrackType,
	type VisualElement,
} from "@/timeline";
import type { EditorCore } from "@/core";
import { usePropertyDraft } from "@/components/editor/panels/properties/hooks/use-property-draft";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { NumberField } from "@/components/ui/number-field";
import {
	formatNumberForDisplay,
	getFractionDigitsForStep,
	clamp,
	snapToStep,
} from "@/utils/math";
import {
	Add01Icon,
	ColorPickerIcon,
	Delete02Icon,
	MagicWand01Icon,
	RefreshIcon,
	SlidersHorizontalIcon,
	Stamp01Icon,
	ViewIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { NumberParamDefinition, ParamDefinition, ParamValues } from "@/params";

/**
 * 「调节」面板，两种落点共用一套分组控件：
 * - 选中画面片段 → 参数写进片段的 effects（跟着片段走，删片段即消失）
 * - 选中调节层 → 参数写在 effect 元素的 params 上，覆盖它的时间宽度
 *
 * 调节层是后加的那条：剪映把亮度/曲线/HSL/色轮全塞进同一个调节条，
 * 所以这里也只有一个 effectType（com.mls.adjust.basic），靠 64 个标量槽装下全部参数。
 */

type SampleResult = { stats: FrameStats; label: string };

type AdjustHandle = {
	params: ParamValues;
	preview: (patch: ParamValues) => void;
	commit: () => void;
	reset: () => void;
	remove: () => void;
	sample: () => Promise<SampleResult | null>;
	title: string;
	hint: string;
};

/**
 * 定义表必须延迟取：effectsRegistry 由 registerDefaultEffects() 填充，
 * 模块加载时就 get() 会拿到空表。
 */
function adjustDefinition() {
	return effectsRegistry.get(ADJUST_TYPE);
}

function num(value: unknown, fallback = 0): number {
	const parsed = typeof value === "number" ? value : Number.parseFloat(String(value));
	return Number.isFinite(parsed) ? parsed : fallback;
}

function paramDefsByKey(): Map<string, ParamDefinition> {
	const map = new Map<string, ParamDefinition>();
	for (const param of adjustDefinition().params) {
		map.set(param.key, param);
	}
	return map;
}

/**
 * 取某个画面元素在当前时间上的源帧统计。
 * retime（变速）没参与换算 —— 变速片段取到的帧会偏一点，用作统计基准可以接受。
 */
async function sampleElementFrame({
	editor,
	element,
	time,
}: {
	editor: EditorCore;
	element: TimelineElement;
	time: MediaTime;
}): Promise<SampleResult | null> {
	if (element.type !== "video" && element.type !== "image") {
		return null;
	}
	const asset = editor.media.getAssets().find((item) => item.id === element.mediaId);
	if (!asset || asset.type === "audio") {
		return null;
	}
	const sourceTime = roundMediaTime({
		time: element.trimStart + (time - element.startTime),
	});
	const stats = await grabFrameStats({
		asset,
		timeSeconds: Math.max(0, mediaTimeToSeconds({ time: sourceTime })),
	});
	return stats ? { stats, label: asset.name } : null;
}

/** 调节层没有"自己的画面"，就取播放头处最上面那条视频/图片。 */
async function sampleTopVisual({
	editor,
	time,
}: {
	editor: EditorCore;
	time: MediaTime;
}): Promise<SampleResult | null> {
	// 效果轨与文字/贴图轨都排在 overlay 里，音频轨没有画面可取，跳过。
	const { main, overlay } = editor.scenes.getActiveScene().tracks;
	const candidates = [...overlay, main].filter(
		(track) => !track.hidden,
	);
	let best: TimelineElement | undefined;
	for (const track of candidates) {
		for (const element of track.elements) {
			if (element.type !== "video" && element.type !== "image") continue;
			if (time < element.startTime || time >= element.startTime + element.duration) {
				continue;
			}
			best = element;
		}
	}
	if (!best) return null;
	return sampleElementFrame({ editor, element: best, time });
}

export function AdjustView() {
	const editor = useEditor();
	const { selectedElements } = useElementSelection();
	useEditor((e) => e.scenes.getActiveSceneOrNull());

	if (selectedElements.length !== 1) {
		return (
			<PanelView title="调节">
				<CreateLayer />
			</PanelView>
		);
	}

	const found = editor.timeline.getElementsWithTracks({
		elements: selectedElements,
	})[0];

	if (found?.element.type === "effect" && found.element.effectType === ADJUST_TYPE) {
		return (
			<LayerAdjust trackId={found.track.id} element={found.element} />
		);
	}

	if (
		found &&
		(EFFECT_TARGET_ELEMENT_TYPES as readonly string[]).includes(found.element.type)
	) {
		return (
			<ClipAdjust trackId={found.track.id} element={found.element as VisualElement} />
		);
	}

	return (
		<PanelView title="调节">
			<EmptyHint
				title="这个片段不支持调节"
				description="只有视频、图片、文字、贴纸、图形这类画面元素可以调色。"
			/>
		</PanelView>
	);
}

/** 没选中东西时给一个入口：从播放头建一条覆盖全片的调节层。 */
function CreateLayer() {
	const editor = useEditor();

	const create = () => {
		const start = editor.playback.getCurrentTime();
		const total = editor.timeline.getTotalDuration();
		const duration = roundMediaTime({ time: Math.max(1, total - start) });
		editor.timeline.insertElement({
			element: buildEffectElement({
				effectType: ADJUST_TYPE,
				startTime: start,
				duration,
			}),
			placement: { mode: "auto", trackType: "effect" as TrackType },
		});
	};

	return (
		<div className="flex flex-col gap-3 px-2 py-4">
			<div className="flex flex-col items-center gap-2 py-6 text-center">
				<HugeiconsIcon
					icon={SlidersHorizontalIcon}
					size={28}
					className="text-muted-foreground/60"
				/>
				<p className="text-sm font-medium">用调节层统一校色</p>
				<p className="text-muted-foreground max-w-[16rem] text-xs leading-relaxed">
					调节层单独占一条轨道，拖它的首尾就能决定作用区间，
					亮度、曲线、HSL、色轮、色彩克隆都写在同一条上。
					也可以直接选中一个片段，只给它加调节。
				</p>
				<Button size="sm" onClick={create}>
					<HugeiconsIcon icon={Add01Icon} size={14} />
					从播放头新建调节层
				</Button>
			</div>
		</div>
	);
}

function EmptyHint({
	title,
	description,
}: {
	title: string;
	description: string;
}) {
	return (
		<div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
			<HugeiconsIcon
				icon={SlidersHorizontalIcon}
				size={28}
				className="text-muted-foreground/60"
			/>
			<p className="text-sm font-medium">{title}</p>
			<p className="text-muted-foreground text-xs leading-relaxed">{description}</p>
		</div>
	);
}

function LayerAdjust({
	trackId,
	element,
}: {
	trackId: string;
	element: EffectElement;
}) {
	const editor = useEditor();
	const { renderElement, previewUpdates, commit } = useElementPreview({
		trackId,
		elementId: element.id,
		fallback: element,
	});

	const params = (renderElement as EffectElement).params ?? {};

	const handle = useMemo<AdjustHandle>(
		() => ({
			params,
			title: renderElement.name || "调节层",
			hint: "拖动时间线上这条调节层的两端可以改变作用区间。",
			preview: (patch) => {
				previewUpdates({ params: { ...params, ...patch } });
			},
			commit,
			reset: () => {
				editor.timeline.updateElements({
					updates: [
						{
							trackId,
							elementId: element.id,
							patch: {
								params: buildDefaultParamValues(adjustDefinition().params),
							},
						},
					],
				});
			},
			remove: () => {
				editor.timeline.deleteElements({
					elements: [{ trackId, elementId: element.id }],
				});
			},
			sample: async () => {
				const time = editor.playback.getCurrentTime();
				return sampleTopVisual({ editor, time });
			},
		}),
		[editor, params, previewUpdates, commit, trackId, element.id, renderElement.name],
	);

	return (
		<PanelView title="调节" actions={<PanelActions handle={handle} />}>
			<AdjustGroups handle={handle} />
		</PanelView>
	);
}

function ClipAdjust({
	trackId,
	element,
}: {
	trackId: string;
	element: VisualElement;
}) {
	const editor = useEditor();
	const { renderElement, previewUpdates, commit } = useElementPreview({
		trackId,
		elementId: element.id,
		fallback: element,
	});

	const current = (renderElement as VisualElement).effects?.find(
		(effect) => effect.type === ADJUST_TYPE,
	);
	const params = current?.params ?? {};

	const preview = useCallback(
		(patch: ParamValues) => {
			if (!current) return;
			const effects = ((renderElement as VisualElement).effects ?? []).map((effect) =>
				effect.id !== current.id
					? effect
					: { ...effect, params: { ...effect.params, ...patch } },
			);
			previewUpdates({ effects });
		},
		[current, renderElement, previewUpdates],
	);

	const handle = useMemo<AdjustHandle>(
		() => ({
			params,
			title: `${element.name} 的调节`,
			hint: "参数只作用于这个片段；想要一段区间的统一校色，请建调节层。",
			preview,
			commit,
			reset: () => {
				if (!current) return;
				editor.timeline.updateClipEffectParams({
					trackId,
					elementId: element.id,
					effectId: current.id,
					params: buildDefaultParamValues(adjustDefinition().params),
				});
			},
			remove: () => {
				if (!current) return;
				editor.timeline.removeClipEffect({
					trackId,
					elementId: element.id,
					effectId: current.id,
				});
			},
			sample: async () => {
				const time = editor.playback.getCurrentTime();
				return sampleElementFrame({ editor, element, time });
			},
		}),
		[editor, params, element, preview, commit, current, trackId],
	);

	if (!current) {
		return (
			<PanelView title="调节">
				<div className="flex flex-col gap-3 px-2 py-4">
					<p className="text-muted-foreground text-xs leading-relaxed">
						这个片段还没有调节参数。添加后可以实时调整亮度、曲线、HSL 与色轮，
						参数会跟片段一起保存。
					</p>
					<Button
						size="sm"
						onClick={() => {
							editor.timeline.addClipEffect({
								trackId,
								elementId: element.id,
								effectType: ADJUST_TYPE,
							});
						}}
					>
						添加调节
					</Button>
				</div>
			</PanelView>
		);
	}

	return (
		<PanelView title="调节" actions={<PanelActions handle={handle} />}>
			<AdjustGroups handle={handle} />
		</PanelView>
	);
}

function PanelActions({ handle }: { handle: AdjustHandle }) {
	return (
		<div className="flex items-center gap-1">
			<Button variant="ghost" size="icon" aria-label="重置调节" onClick={handle.reset}>
				<HugeiconsIcon icon={RefreshIcon} size={16} />
			</Button>
			<Button variant="ghost" size="icon" aria-label="移除调节" onClick={handle.remove}>
				<HugeiconsIcon icon={Delete02Icon} size={16} />
			</Button>
		</div>
	);
}

function Group({
	title,
	defaultOpen = false,
	children,
}: {
	title: string;
	defaultOpen?: boolean;
	children: React.ReactNode;
}) {
	const [open, setOpen] = useState(defaultOpen);
	return (
		<div className="border-border/60 rounded-md border">
			<button
				type="button"
				onClick={() => setOpen((value) => !value)}
				className="hover:bg-muted/40 flex w-full items-center justify-between px-2 py-1.5 text-xs font-medium"
			>
				<span>{title}</span>
				<span className="text-muted-foreground text-[10px]">
					{open ? "收起" : "展开"}
				</span>
			</button>
			{open ? <div className="flex flex-col gap-2 px-1 pb-2">{children}</div> : null}
		</div>
	);
}

function AdjustGroups({ handle }: { handle: AdjustHandle }) {
	const defs = useMemo(paramDefsByKey, []);
	const [reference, setReference] = useState<SampleResult | null>(null);
	const [status, setStatus] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const write = async ({
		patch,
		message,
	}: {
		patch: ParamValues;
		message: string;
	}) => {
		setBusy(true);
		setStatus(message);
		try {
			handle.preview(patch);
			handle.commit();
		} finally {
			setBusy(false);
		}
	};

	const autoCorrect = async () => {
		const sample = await handle.sample();
		if (!sample) {
			setStatus("取不到当前画面：播放头请停在视频或图片上。");
			return;
		}
		const gains = computeWhiteBalanceGains({ stats: sample.stats });
		if (!gains.confident) {
			setStatus("这一帧几乎是纯灰，没有可靠的色偏信息，已跳过。");
			return;
		}
		await write({
			patch: { wbR: gains.r, wbG: gains.g, wbB: gains.b },
			message: `已按「${sample.label}」校正色偏（R ${gains.r.toFixed(2)} / G ${gains.g.toFixed(2)} / B ${gains.b.toFixed(2)}）。`,
		});
	};

	const autoGrade = async () => {
		const sample = await handle.sample();
		if (!sample) {
			setStatus("取不到当前画面：播放头请停在视频或图片上。");
			return;
		}
		const gains = computeWhiteBalanceGains({ stats: sample.stats });
		const grade = computeAutoGrade({ stats: sample.stats });
		await write({
			patch: {
				brightness: grade.brightness,
				contrast: grade.contrast,
				saturation: grade.saturation,
				...(gains.confident
					? { wbR: gains.r, wbG: gains.g, wbB: gains.b }
					: {}),
			},
			message: `已自动曝光：亮度 ${(grade.brightness * 100).toFixed(0)}、对比 ${(grade.contrast * 100).toFixed(0)}、饱和 ${(grade.saturation * 100).toFixed(0)}。`,
		});
	};

	const takeReference = async () => {
		const sample = await handle.sample();
		if (!sample) {
			setStatus("取不到参考帧：播放头请停在视频或图片上。");
			return;
		}
		setReference(sample);
		setStatus(`已记下参考画面「${sample.label}」。`);
	};

	const cloneToCurrent = async () => {
		if (!reference) {
			setStatus("先取一帧作为参考。");
			return;
		}
		const sample = await handle.sample();
		if (!sample) {
			setStatus("取不到当前画面：播放头请停在视频或图片上。");
			return;
		}
		if (sample.label === reference.label) {
			setStatus("参考帧和当前帧是同一个素材，克隆只会得到恒等变换。");
			return;
		}
		const affine = computeLabAffine({ source: sample.stats, reference: reference.stats });
		await write({
			patch: { ...affine, cloneStrength: 1 },
			message: `已把「${reference.label}」的影调与色调迁移到「${sample.label}」。`,
		});
	};

	return (
		<div className="flex flex-col gap-2 px-1 pb-6">
			<div className="grid grid-cols-2 gap-1.5 px-1">
				<Button
					variant="outline"
					size="sm"
					disabled={busy}
					onClick={() => {
						void autoGrade();
					}}
				>
					<HugeiconsIcon icon={MagicWand01Icon} size={14} />
					自动调色
				</Button>
				<Button
					variant="outline"
					size="sm"
					disabled={busy}
					onClick={() => {
						void autoCorrect();
					}}
				>
					<HugeiconsIcon icon={ColorPickerIcon} size={14} />
					色彩校正
				</Button>
			</div>
			{status ? (
				<p className="text-muted-foreground px-1 text-[11px] leading-relaxed">{status}</p>
			) : null}

			<Group title="基础" defaultOpen>
				<ParamRow defs={defs} handle={handle} paramKey="brightness" />
				<ParamRow defs={defs} handle={handle} paramKey="contrast" />
				<ParamRow defs={defs} handle={handle} paramKey="saturation" />
				<ParamRow defs={defs} handle={handle} paramKey="temperature" />
				<ParamRow defs={defs} handle={handle} paramKey="tint" />
				<BooleanRow defs={defs} handle={handle} paramKey="invert" />
			</Group>

			<Group title="光影">
				<ParamRow defs={defs} handle={handle} paramKey="shadows" />
				<ParamRow defs={defs} handle={handle} paramKey="highlights" />
				<ParamRow defs={defs} handle={handle} paramKey="shadowEdge" label="阴影范围" />
				<ParamRow defs={defs} handle={handle} paramKey="highlightEdge" label="高光范围" />
				<ParamRow defs={defs} handle={handle} paramKey="vibrance" />
				<ParamRow defs={defs} handle={handle} paramKey="vibProtect" label="肤色保护" />
			</Group>

			<Group title="白平衡">
				<ParamRow defs={defs} handle={handle} paramKey="wbR" label="R 增益" />
				<ParamRow defs={defs} handle={handle} paramKey="wbG" label="G 增益" />
				<ParamRow defs={defs} handle={handle} paramKey="wbB" label="B 增益" />
				<p className="text-muted-foreground px-1 text-[11px] leading-relaxed">
					增益 1 为原样。上面「色彩校正」按灰世界自动算，也可以手动压住某一路。
				</p>
			</Group>

			<Group title="HSL 分色">
				<HslSection defs={defs} handle={handle} />
			</Group>

			<Group title="曲线">
				<CurveSection defs={defs} handle={handle} />
			</Group>

			<Group title="色轮">
				<WheelSection defs={defs} handle={handle} />
				<ParamRow defs={defs} handle={handle} paramKey="wheelMix" label="强度" />
			</Group>

			<Group title="色彩克隆">
				<div className="grid grid-cols-2 gap-1.5 px-1">
					<Button
						variant="outline"
						size="sm"
						disabled={busy}
						onClick={() => {
							void takeReference();
						}}
					>
						<HugeiconsIcon icon={ViewIcon} size={14} />
						取当前帧为参考
					</Button>
					<Button
						variant="outline"
						size="sm"
						disabled={busy || !reference}
						onClick={() => {
							void cloneToCurrent();
						}}
					>
						<HugeiconsIcon icon={Stamp01Icon} size={14} />
						克隆到当前
					</Button>
				</div>
				<p className="text-muted-foreground px-1 text-[11px] leading-relaxed">
					{reference
						? `参考画面：${reference.label}`
						: "把播放头移到参考素材上取样，再移到目标素材上克隆。"}
				</p>
				<CloneModeRow handle={handle} />
				<ParamRow defs={defs} handle={handle} paramKey="cloneStrength" label="强度" />
				<ParamRow defs={defs} handle={handle} paramKey="cloneScaleL" label="L 缩放" />
				<ParamRow defs={defs} handle={handle} paramKey="cloneShiftL" label="L 偏移" />
				<ParamRow defs={defs} handle={handle} paramKey="cloneScaleA" label="a 缩放" />
				<ParamRow defs={defs} handle={handle} paramKey="cloneShiftA" label="a 偏移" />
				<ParamRow defs={defs} handle={handle} paramKey="cloneScaleB" label="b 缩放" />
				<ParamRow defs={defs} handle={handle} paramKey="cloneShiftB" label="b 偏移" />
			</Group>

			<p className="text-muted-foreground px-1 text-[11px] leading-relaxed">
				{handle.hint} 滑杆实时预览、松手才写入撤销记录。
			</p>
		</div>
	);
}

function ParamRow({
	defs,
	handle,
	paramKey,
	label,
}: {
	defs: Map<string, ParamDefinition>;
	handle: AdjustHandle;
	paramKey: string;
	label?: string;
}) {
	const def = defs.get(paramKey);
	if (!def || def.type !== "number") {
		return null;
	}
	return (
		<ParamSliderRow
			param={def}
			label={label}
			value={num(handle.params[paramKey], def.default as number)}
			onPreview={(value) => handle.preview({ [paramKey]: value })}
			onCommit={handle.commit}
		/>
	);
}

function BooleanRow({
	defs,
	handle,
	paramKey,
}: {
	defs: Map<string, ParamDefinition>;
	handle: AdjustHandle;
	paramKey: string;
}) {
	const def = defs.get(paramKey);
	if (!def || def.type !== "boolean") {
		return null;
	}
	return (
		<div className="flex items-center gap-2 px-1">
			<span className="text-muted-foreground w-16 shrink-0 text-xs">{def.label}</span>
			<div className="min-w-0 flex-1" />
			<Switch
				checked={Boolean(handle.params[paramKey] ?? def.default)}
				onCheckedChange={(checked) => {
					handle.preview({ [paramKey]: checked });
					handle.commit();
				}}
			/>
		</div>
	);
}

/**
 * 剪映式一行：名称 + 滑杆 + 数字框。
 * 参数定义的 min/max/step 已在显示空间，存储值仍是 shader 要的归一化值。
 */
function ParamSliderRow({
	param,
	label,
	value,
	onPreview,
	onCommit,
}: {
	param: NumberParamDefinition;
	label?: string;
	value: number;
	onPreview: (value: number) => void;
	onCommit: () => void;
}) {
	const gain = param.displayMultiplier ?? 1;
	const min = param.min;
	const max = param.max ?? param.min;
	const step = param.step;
	const display = value * gain;
	const clampDisplay = (next: number) =>
		clamp({ value: snapToStep({ value: next, step }), min, max });

	const draft = usePropertyDraft({
		displayValue: formatNumberForDisplay({
			value: display,
			maxFractionDigits: getFractionDigitsForStep({ step }),
		}),
		parse: (input) => {
			const parsed = Number.parseFloat(input);
			return Number.isFinite(parsed) ? clampDisplay(parsed) : null;
		},
		onPreview: (nextDisplay) => onPreview(nextDisplay / gain),
		onCommit,
	});

	const hasZero = min <= 0 && max >= 0;
	const fraction = hasZero ? (0 - min) / (max - min) : 0.5;

	return (
		<div className="flex items-center gap-2 px-1">
			<span className="text-muted-foreground w-16 shrink-0 text-xs">
				{label ?? param.label}
			</span>
			<div className="relative min-w-0 flex-1">
				<Slider
					min={min}
					max={max}
					step={step}
					value={[clampDisplay(display)]}
					onValueChange={(next) => onPreview((next[0] ?? 0) / gain)}
					onValueCommit={(next) => {
						onPreview((next[0] ?? 0) / gain);
						onCommit();
					}}
					className="h-4"
				/>
				{hasZero ? (
					<span
						className="bg-border pointer-events-none absolute top-1/2 h-3 w-px -translate-x-1/2 -translate-y-1/2"
						style={{ left: `${fraction * 100}%` }}
					/>
				) : null}
			</div>
			<NumberField
				value={draft.displayValue}
				className="h-7 w-16 shrink-0"
				onFocus={draft.onFocus}
				onChange={draft.onChange}
				onBlur={draft.onBlur}
			/>
		</div>
	);
}

const CLONE_MODES = [
	{ value: 0, label: "整体" },
	{ value: 1, label: "仅色彩" },
	{ value: 2, label: "仅亮度" },
] as const;

function CloneModeRow({ handle }: { handle: AdjustHandle }) {
	const current = num(handle.params.cloneMode);
	return (
		<div className="flex items-center gap-2 px-1">
			<span className="text-muted-foreground w-16 shrink-0 text-xs">作用范围</span>
			<div className="bg-muted flex flex-1 gap-1 rounded-md p-1">
				{CLONE_MODES.map((mode) => (
					<button
						key={mode.value}
						type="button"
						onClick={() => {
							handle.preview({ cloneMode: mode.value });
							handle.commit();
						}}
						className={
							current === mode.value
								? "bg-background text-foreground flex-1 rounded-sm py-0.5 text-xs"
								: "text-muted-foreground flex-1 rounded-sm py-0.5 text-xs"
						}
					>
						{mode.label}
					</button>
				))}
			</div>
		</div>
	);
}

function HslSection({
	defs,
	handle,
}: {
	defs: Map<string, ParamDefinition>;
	handle: AdjustHandle;
}) {
	const [bandIndex, setBandIndex] = useState(0);
	const band = HSL_BANDS[bandIndex];
	return (
		<div className="flex flex-col gap-2">
			<div className="flex items-center justify-between gap-1 px-1">
				{HSL_BANDS.map((item, index) => {
					const active =
						Math.abs(num(handle.params[`${item.prefix}Hue`])) > 0.002 ||
						Math.abs(num(handle.params[`${item.prefix}Sat`])) > 0.002 ||
						Math.abs(num(handle.params[`${item.prefix}Light`])) > 0.002;
					return (
						<button
							key={item.prefix}
							type="button"
							title={item.label}
							onClick={() => setBandIndex(index)}
							className={
								index === bandIndex
									? "size-6 rounded-full ring-2 ring-foreground/70"
									: "size-6 rounded-full opacity-80 hover:opacity-100"
							}
							style={{
								backgroundColor: item.color,
								outline: active ? "2px solid rgba(255,255,255,0.35)" : undefined,
							}}
						/>
					);
				})}
			</div>
			<ParamRow defs={defs} handle={handle} paramKey={`${band.prefix}Hue`} label={`${band.label} 色相`} />
			<ParamRow defs={defs} handle={handle} paramKey={`${band.prefix}Sat`} label={`${band.label} 饱和`} />
			<ParamRow defs={defs} handle={handle} paramKey={`${band.prefix}Light`} label={`${band.label} 亮度`} />
			<Button
				variant="ghost"
				size="sm"
				onClick={() => {
					handle.preview({
						[`${band.prefix}Hue`]: 0,
						[`${band.prefix}Sat`]: 0,
						[`${band.prefix}Light`]: 0,
					});
					handle.commit();
				}}
			>
				<HugeiconsIcon icon={RefreshIcon} size={14} />
				复位 {band.label}
			</Button>
		</div>
	);
}

const CURVE_TAB_COLORS: Record<string, string> = {
	rgb: "#e5e7eb",
	r: "#f87171",
	g: "#4ade80",
	b: "#60a5fa",
};

function CurveSection({
	defs,
	handle,
}: {
	defs: Map<string, ParamDefinition>;
	handle: AdjustHandle;
}) {
	const [channelIndex, setChannelIndex] = useState(0);
	const channel = CURVE_CHANNELS[channelIndex];
	const prefix = channel.prefix;
	return (
		<div className="flex flex-col gap-2">
			<div className="flex items-center gap-1 px-1">
				{CURVE_CHANNELS.map((item, index) => (
					<button
						key={item.prefix}
						type="button"
						onClick={() => setChannelIndex(index)}
						className={
							index === channelIndex
								? "bg-background text-foreground rounded-sm px-2 py-0.5 text-xs"
								: "text-muted-foreground hover:bg-muted rounded-sm px-2 py-0.5 text-xs"
						}
					>
						{item.label}
					</button>
				))}
				<div className="flex-1" />
				<Button
					variant="ghost"
					size="sm"
					onClick={() => {
						handle.preview({
							[`${prefix}Black`]: 0,
							[`${prefix}Mid`]: 0,
							[`${prefix}White`]: 0,
						});
						handle.commit();
					}}
				>
					<HugeiconsIcon icon={RefreshIcon} size={14} />
					复位
				</Button>
			</div>
			<CurveWidget
				color={CURVE_TAB_COLORS[prefix] ?? "#e5e7eb"}
				keys={[`${prefix}Black`, `${prefix}Mid`, `${prefix}White`]}
				black={num(handle.params[`${prefix}Black`])}
				mid={num(handle.params[`${prefix}Mid`])}
				white={num(handle.params[`${prefix}White`])}
				onPreview={handle.preview}
				onCommit={handle.commit}
			/>
			<ParamRow defs={defs} handle={handle} paramKey={`${prefix}Black`} label="黑场" />
			<ParamRow defs={defs} handle={handle} paramKey={`${prefix}Mid`} label="中间调" />
			<ParamRow defs={defs} handle={handle} paramKey={`${prefix}White`} label="白场" />
		</div>
	);
}

/**
 * 三点曲线：黑场/中间调/白场各能上下拖，单调三次插值展开成 41 点 LUT 后再画。
 * 纵轴故意留出 ±0.3 的余量 —— 黑场压到 0 以下、白场顶到 1 以上才是"加大对比度"那一半。
 */
function CurveWidget({
	color,
	keys,
	black,
	mid,
	white,
	onPreview,
	onCommit,
}: {
	color: string;
	keys: [string, string, string];
	black: number;
	mid: number;
	white: number;
	onPreview: (patch: ParamValues) => void;
	onCommit: () => void;
}) {
	const svgRef = useRef<SVGSVGElement>(null);
	const dragIndex = useRef<number | null>(null);
	const [y0, y1] = CURVE_VIEW_RANGE;
	const toSvgY = (value: number) => (1 - (value - y0) / (y1 - y0)) * 100;
	const knots = { black, mid, white };
	const points = curveControlPoints({ knots });
	const table = curveTable({ knots });
	const path = table
		.map((value, index) => {
			const x = table.length === 1 ? 0 : (index / (table.length - 1)) * 100;
			return `${x.toFixed(1)},${toSvgY(value).toFixed(1)}`;
		})
		.join(" ");

	const valueFrom = (index: number, clientY: number) => {
		const rect = svgRef.current?.getBoundingClientRect();
		if (!rect || rect.height === 0) {
			return null;
		}
		const curveY = y1 - ((clientY - rect.top) / rect.height) * (y1 - y0);
		const raw = index === 0 ? curveY * 2 : index === 1 ? (curveY - 0.5) * 2 : (curveY - 1) * 2;
		return clamp({ value: raw, min: -1, max: 1 });
	};

	return (
		<div className="flex justify-center px-1 pt-1">
			<svg
				ref={svgRef}
				viewBox="0 0 100 100"
				className="bg-muted/40 aspect-square w-[150px] touch-none rounded-md"
			>
				<rect
					x={0}
					y={toSvgY(1)}
					width={100}
					height={toSvgY(0) - toSvgY(1)}
					className="fill-background/40 stroke-border"
					strokeWidth={0.8}
				/>
				<line
					x1={0}
					y1={toSvgY(0)}
					x2={100}
					y2={toSvgY(1)}
					className="stroke-border"
					strokeWidth={0.6}
					strokeDasharray="3 3"
				/>
				<polyline
					points={path}
					fill="none"
					stroke={color}
					strokeWidth={1.6}
					strokeLinecap="round"
				/>
				{points.map((point, index) => (
					<circle
						key={keys[index]}
						cx={point.x * 100}
						cy={toSvgY(point.y)}
						r={4.5}
						fill={color}
						stroke="rgba(0,0,0,0.55)"
						strokeWidth={1}
						className="cursor-ns-resize"
						onPointerDown={(event) => {
							dragIndex.current = index;
							event.currentTarget.setPointerCapture(event.pointerId);
						}}
						onPointerMove={(event) => {
							if (dragIndex.current !== index) return;
							const value = valueFrom(index, event.clientY);
							if (value === null) return;
							onPreview({ [keys[index]]: value });
						}}
						onPointerUp={(event) => {
							if (dragIndex.current !== index) return;
							dragIndex.current = null;
							const value = valueFrom(index, event.clientY);
							if (value !== null) onPreview({ [keys[index]]: value });
							onCommit();
						}}
						onLostPointerCapture={() => {
							dragIndex.current = null;
						}}
					/>
				))}
			</svg>
		</div>
	);
}

function WheelSection({
	defs,
	handle,
}: {
	defs: Map<string, ParamDefinition>;
	handle: AdjustHandle;
}) {
	return (
		<div className="flex flex-col gap-3">
			{WHEEL_GROUPS.map((group) => {
				const r = num(handle.params[`${group.prefix}R`]);
				const g = num(handle.params[`${group.prefix}G`]);
				const b = num(handle.params[`${group.prefix}B`]);
				return (
					<div key={group.prefix} className="flex items-start gap-2 px-1">
						<WheelPad
							label={group.label}
							color={group.color}
							r={r}
							g={g}
							b={b}
							onPreview={(next) => {
								handle.preview({
									[`${group.prefix}R`]: next.r,
									[`${group.prefix}G`]: next.g,
									[`${group.prefix}B`]: next.b,
								});
							}}
							onCommit={handle.commit}
						/>
						<div className="flex min-w-0 flex-1 flex-col gap-1">
							<ParamRow defs={defs} handle={handle} paramKey={`${group.prefix}R`} label="R" />
							<ParamRow defs={defs} handle={handle} paramKey={`${group.prefix}G`} label="G" />
							<ParamRow defs={defs} handle={handle} paramKey={`${group.prefix}B`} label="B" />
						</div>
					</div>
				);
			})}
		</div>
	);
}

/**
 * 色轮垫。圆盘上的 (x, y) 与 R/G/B 三参数不是同一个坐标系，
 * 这里用 x = R−G、y = B−(R+G)/2 的正交轴，反解取最小范数解，
 * 于是拖垫子和推滑杆永远指向同一个偏色方向。
 */
function WheelPad({
	label,
	color,
	r,
	g,
	b,
	onPreview,
	onCommit,
}: {
	label: string;
	color: string;
	r: number;
	g: number;
	b: number;
	onPreview: (value: { r: number; g: number; b: number }) => void;
	onCommit: () => void;
}) {
	const svgRef = useRef<SVGSVGElement>(null);
	const dragging = useRef(false);
	const [local, setLocal] = useState<{ x: number; y: number } | null>(null);

	const axisX = clamp({ value: r - g, min: -1, max: 1 });
	const axisY = clamp({ value: b - (r + g) / 2, min: -1, max: 1 });
	const dot = local ?? { x: axisX, y: axisY };

	const read = (event: React.PointerEvent<SVGSVGElement>) => {
		const rect = svgRef.current?.getBoundingClientRect();
		if (!rect || rect.width === 0) return null;
		const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
		const y = 1 - ((event.clientY - rect.top) / rect.height) * 2;
		if (Math.hypot(x, y) > 1) {
			const scale = 1 / Math.hypot(x, y);
			return { x: x * scale, y: y * scale };
		}
		return { x, y };
	};

	const toRgb = ({ x, y }: { x: number; y: number }) => {
		const scale = 1.7;
		return {
			r: clamp({ value: ((7 * x - 2 * y) / 12) * scale, min: -1, max: 1 }),
			g: clamp({ value: (-(5 * x + 2 * y) / 12) * scale, min: -1, max: 1 }),
			b: clamp({ value: ((x + 10 * y) / 12) * scale, min: -1, max: 1 }),
		};
	};

	return (
		<div className="flex shrink-0 flex-col items-center gap-1">
			<svg
				ref={svgRef}
				viewBox="-52 -52 104 104"
				className="size-[76px] cursor-pointer touch-none"
				onPointerDown={(event) => {
					dragging.current = true;
					event.currentTarget.setPointerCapture(event.pointerId);
					const next = read(event);
					if (!next) return;
					setLocal(next);
					onPreview(toRgb(next));
				}}
				onPointerMove={(event) => {
					if (!dragging.current) return;
					const next = read(event);
					if (!next) return;
					setLocal(next);
					onPreview(toRgb(next));
				}}
				onPointerUp={() => {
					if (!dragging.current) return;
					dragging.current = false;
					setLocal(null);
					onCommit();
				}}
				onLostPointerCapture={() => {
					dragging.current = false;
					setLocal(null);
				}}
			>
				<defs>
					<radialGradient id={`wheel-${label}`} cx="50%" cy="50%" r="50%">
						<stop offset="0%" stopColor="rgba(255,255,255,0.16)" />
						<stop offset="100%" stopColor="rgba(255,255,255,0.02)" />
					</radialGradient>
				</defs>
				<circle cx={0} cy={0} r={50} fill={`url(#wheel-${label})`} stroke="currentColor" strokeOpacity={0.25} />
				<circle cx={0} cy={0} r={25} fill="none" stroke="currentColor" strokeOpacity={0.12} />
				<line x1={-50} y1={0} x2={50} y2={0} stroke="currentColor" strokeOpacity={0.1} />
				<line x1={0} y1={-50} x2={0} y2={50} stroke="currentColor" strokeOpacity={0.1} />
				<circle
					cx={dot.x * 50}
					cy={-dot.y * 50}
					r={6}
					fill={color}
					stroke="rgba(0,0,0,0.6)"
					strokeWidth={1.5}
				/>
			</svg>
			<span className="text-muted-foreground text-[10px]">{label}</span>
		</div>
	);
}
