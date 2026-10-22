"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { HugeiconsIcon } from "@hugeicons/react";
import { RefreshIcon } from "@hugeicons/core-free-icons";
import {
	ensureClipPacksLoaded,
	getClipPackStatus,
	getPluginOperations,
	type ClipPackEntry,
	type ClipPackStatus,
	type ClipPackType,
	type PluginOperation,
} from "@/services/clip-packs";
import { PanelView } from "./base-panel";
import { TtsView } from "./tts";
import { useEditor } from "@/editor/use-editor";

/**
 * 「插件」栏的两个二级视图。
 *
 * AI 工具：能力卡片，数据只来自 /editor-api/ai/capabilities 与 /editor-api/ai/voices，
 *          就绪/未配置都由服务端 ready 字段决定，不在这里编造状态。
 * 已装资源包：clip-packs 加载器的逐包快照（含 operation 能力插件）。
 */

/** capabilities 的返回项（src/clip-ai.js）。error 字段目前不存在，存在时原样展示。 */
interface Capability {
	type: string;
	ready: boolean;
	error?: string;
	reason?: string;
}

interface VoiceItem {
	id: string;
	name: string;
	hasRef: boolean;
}

/**
 * 本期要做成"插件"的三项能力。
 * 其余能力（字幕/抠像等）不在插件栏重复出现，避免和 AI 任务面板重叠。
 */
const PLUGIN_CARDS = [
	{
		type: "tts",
		name: "文本转语音（TTS）",
		desc: "用参考音频克隆音色朗读文本，产物可直接插入音频轨。",
		openable: true,
	},
	{
		type: "scene-split",
		name: "镜头切分",
		desc: "按画面突变切分镜头，产出切点时间表（秒）。",
		openable: false,
	},
	{
		type: "vocal-separate",
		name: "人声分离",
		desc: "拆出人声与伴奏，人声可单独编进音频轨。",
		openable: false,
	},
] as const;

/** 服务端还会返回、但本轮不给面板入口的能力（保留可见性，避免"能力消失"的错觉）。 */
const OTHER_CAP_LABELS: Record<string, string> = {
	subtitle: "AI 字幕",
	matting: "智能抠像",
	beauty_pro: "美颜精修",
	face_reshape: "瘦脸瘦身",
	upscale: "画质增强",
};

function authHeaders(): Record<string, string> {
	const h: Record<string, string> = {};
	try {
		const token = localStorage.getItem("ml_token");
		if (token) h.Authorization = `Bearer ${token}`;
	} catch {
		/* 未登录时交给服务端回 401 */
	}
	return h;
}

export function AiToolsView() {
	const editor = useEditor();
	const [panel, setPanel] = useState<"list" | "tts">("list");
	const [caps, setCaps] = useState<Capability[]>([]);
	const [voices, setVoices] = useState<VoiceItem[]>([]);
	const [loaded, setLoaded] = useState(false);
	/** 已加载的 operation 资源包：用来在卡片上标出「这个能力由哪个包声明」。 */
	const [operations, setOperations] = useState<PluginOperation[]>([]);

	useEffect(() => {
		let alive = true;
		Promise.all([
			fetch("/editor-api/ai/capabilities", { headers: authHeaders() })
				.then((r) => (r.ok ? r.json() : { items: [] }))
				.then((d) => (Array.isArray(d.items) ? (d.items as Capability[]) : []))
				.catch(() => []),
			fetch("/editor-api/ai/voices", { headers: authHeaders() })
				.then((r) => (r.ok ? r.json() : { items: [] }))
				.then((d) => (Array.isArray(d.items) ? (d.items as VoiceItem[]) : []))
				.catch(() => []),
		]).then(([capItems, voiceItems]) => {
			if (!alive) return;
			setCaps(capItems);
			setVoices(voiceItems);
			setLoaded(true);
		});
		return () => {
			alive = false;
		};
	}, []);

	// operation 包只提供"能力声明"，这里幂等触发加载后取一次快照。
	useEffect(() => {
		let alive = true;
		void ensureClipPacksLoaded().then(() => {
			if (alive) setOperations(getPluginOperations());
		});
		return () => {
			alive = false;
		};
	}, []);

	if (panel === "tts") {
		return <TtsView onBack={() => setPanel("list")} />;
	}

	const others = caps.filter(
		(c) => !PLUGIN_CARDS.some((card) => card.type === c.type),
	);

	return (
		<PanelView
			title="AI 工具"
			contentClassName="flex flex-col gap-2 pb-4"
			actions={
				<span className="text-muted-foreground text-[11px]">
					音色库 {voices.length}
				</span>
			}
		>
			{!loaded && <span className="text-muted-foreground text-xs">读取能力列表…</span>}

			{PLUGIN_CARDS.map((card) => {
				const cap = caps.find((c) => c.type === card.type);
				const ready = !!cap?.ready;
				// 服务端返回的原因优先；它没给就只显示「未配置」，不自编错误文案。
				const detail = !ready ? (cap?.error || cap?.reason || "") : "";
				const declaredBy = operations.find((op) => op.runner === card.type);
				return (
					<button
						key={card.type}
						type="button"
						disabled={!card.openable}
						draggable={ready}
						title={ready ? "拖到时间线上的音频/视频素材上即可自动处理" : undefined}
						onDragStart={(e) => {
							if (!ready) {
								e.preventDefault();
								return;
							}
							editor.timeline.dragSource.begin({
								dataTransfer: e.dataTransfer,
								dragData: {
									type: "plugin",
									pluginType: card.type,
									name: card.name,
								},
							});
						}}
						onDragEnd={() => editor.timeline.dragSource.end()}
						onClick={card.openable ? () => setPanel("tts") : undefined}
						className={`flex flex-col gap-1 rounded-md border p-2 text-left ${
							card.openable
								? "hover:bg-accent cursor-pointer"
								: "cursor-default opacity-90"
						}`}
					>
						<span className="flex items-center justify-between gap-2">
							<span className="text-xs font-medium">{card.name}</span>
							<span
								className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] ${
									ready
										? "border-emerald-500/40 text-emerald-500"
										: "text-muted-foreground border-dashed"
								}`}
							>
								{ready ? "就绪" : "未配置"}
							</span>
						</span>
						<span className="text-muted-foreground text-[11px]">{card.desc}</span>
						{detail && (
							<span className="text-destructive text-[11px] break-all">{detail}</span>
						)}
						{declaredBy && (
							<span className="text-muted-foreground text-[11px] break-all">
								资源包：{declaredBy.nameZh}（{declaredBy.input.join("/")} →{" "}
								{declaredBy.output} · runner {declaredBy.runner}）
							</span>
						)}
						{!card.openable && (
							<span className="text-muted-foreground text-[11px]">
								提交面板接入中
							</span>
						)}
					</button>
				);
			})}

			{others.length > 0 && (
				<div className="flex flex-col gap-1 rounded-md border border-dashed p-2">
					<span className="text-xs font-medium">其他能力</span>
					<div className="flex flex-wrap gap-1.5">
						{others.map((c) => (
							<span
								key={c.type}
								className={`rounded-full border px-2 py-0.5 text-[11px] ${
									c.ready
										? "border-emerald-500/40 text-emerald-500"
										: "text-muted-foreground border-dashed"
								}`}
							>
								{OTHER_CAP_LABELS[c.type] ?? c.type} · {c.ready ? "就绪" : "未配置"}
							</span>
						))}
					</div>
					<span className="text-muted-foreground text-[11px]">
						这些能力暂无面板入口。
					</span>
				</div>
			)}
		</PanelView>
	);
}

/** 类型 → 中文；operation 是本轮新增的第 7 种清单类型。 */
const PACK_TYPE_LABELS: Record<ClipPackType, string> = {
	effect: "特效",
	transition: "转场",
	textTemplate: "文字模板",
	lut: "LUT",
	sticker: "贴纸",
	assetPack: "素材包",
	operation: "能力插件",
};

/** 取深拷贝快照：加载器是单例且原地更新的，直接引用 React 认为没变。 */
function snapshot(): ClipPackStatus {
	const status = getClipPackStatus();
	return {
		...status,
		registered: [...status.registered],
		blocked: status.blocked.map((b) => ({ ...b })),
		byType: { ...status.byType },
		packs: status.packs.map((p) => ({ ...p })),
	};
}

export function PackListView() {
	const [status, setStatus] = useState<ClipPackStatus>(() => snapshot());

	// 加载器可能在编辑器启动时才跑；这里幂等触发一次，等它落定再取快照。
	useEffect(() => {
		let alive = true;
		void ensureClipPacksLoaded().then(() => {
			if (alive) setStatus(snapshot());
		});
		return () => {
			alive = false;
		};
	}, []);

	const operationRunners = new Map<string, string>();
	for (const op of getPluginOperations()) {
		operationRunners.set(op.id, op.runner);
	}

	const usableCount = status.packs.filter((p) => p.usable).length;
	const blockedCount = status.packs.length - usableCount;

	return (
		<PanelView
			title="已装资源包"
			contentClassName="flex flex-col gap-3 pb-4"
			actions={
				<Button
					size="icon"
					variant="ghost"
					aria-label="刷新资源包状态"
					onClick={() => setStatus(snapshot())}
				>
					<HugeiconsIcon icon={RefreshIcon} />
				</Button>
			}
		>
			<div className="flex flex-wrap items-center gap-1.5">
				<span
					className={
						status.loaded
							? "rounded-full border border-emerald-500/40 px-2 py-0.5 text-[11px] text-emerald-500"
							: "text-muted-foreground rounded-full border border-dashed px-2 py-0.5 text-[11px]"
					}
				>
					{status.loaded ? "已加载" : "未加载"}
				</span>
				<span className="text-muted-foreground rounded-full border px-2 py-0.5 text-[11px] tabular-nums">
					可用 {usableCount}
				</span>
				<span className="text-muted-foreground rounded-full border px-2 py-0.5 text-[11px] tabular-nums">
					不可用 {blockedCount}
				</span>
				{Object.entries(status.byType).map(([type, count]) => (
					<span key={type} className="bg-muted/40 rounded px-2 py-0.5 text-[11px]">
						{PACK_TYPE_LABELS[type as ClipPackType] ?? type} · {count}
					</span>
				))}
			</div>

			{status.error && (
				<div className="border-destructive/20 bg-destructive/10 text-destructive rounded-md border p-2 text-xs break-all">
					{status.error}
				</div>
			)}

			{status.packs.length === 0 ? (
				<span className="text-muted-foreground text-xs">
					{status.loaded ? "尚未加载任何资源包" : "资源包状态未就绪"}
				</span>
			) : (
				<div className="flex flex-col gap-1">
					{status.packs.map((pack) => (
						<PackRow
							key={`${pack.type}-${pack.id}`}
							pack={pack}
							runner={operationRunners.get(pack.id)}
						/>
					))}
				</div>
			)}
		</PanelView>
	);
}

function PackRow({ pack, runner }: { pack: ClipPackEntry; runner?: string }) {
	return (
		<div className="rounded border px-2 py-1.5 text-[11px]">
			<div className="flex items-center justify-between gap-2">
				<span className="truncate text-xs">{pack.nameZh}</span>
				<span
					className={`shrink-0 rounded-full border px-2 py-0.5 ${
						pack.usable
							? "border-emerald-500/40 text-emerald-500"
							: "text-muted-foreground border-dashed"
					}`}
				>
					{pack.usable ? "可用" : "不可用"}
				</span>
			</div>
			<div className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-1.5">
				<span className="bg-muted/40 rounded px-1.5 py-0.5">
					{PACK_TYPE_LABELS[pack.type] ?? pack.type}
				</span>
				<span className="font-mono break-all">{pack.id}</span>
			</div>
			{pack.reason && (
				<div className="text-muted-foreground mt-0.5 break-all">{pack.reason}</div>
			)}
			{runner && (
				<div className="text-muted-foreground mt-0.5 font-mono break-all">
					runner: {runner}
				</div>
			)}
		</div>
	);
}
