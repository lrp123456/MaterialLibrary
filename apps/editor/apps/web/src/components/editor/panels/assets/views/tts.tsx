"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useEditor } from "@/editor/use-editor";
import { getMediaFid } from "@/services/cloud-snapshots";
import { buildLibraryAudioElement } from "@/timeline/element-utils";
import { mediaTimeFromSeconds } from "@/wasm";
import { PanelView } from "./base-panel";

/**
 * TTS 面板（文本转语音）。
 *
 * 契约来自服务端，前端只调用不改契约：
 *   GET  /editor-api/ai/voices        音色库列表
 *   POST /editor-api/ai/tts           { text, lang, voiceId | refFid, durationFactor }
 *   GET  /editor-api/ai/jobs/:id      轮询进度（与 ai.tsx 同一套模式）
 *
 * 合成在服务端 worker 里跑，缺引擎时任务会失败并带回服务端原文，
 * 这里只负责原样展示，不自己编错误文案。
 */

/** 服务端 LANGS（src/clip-ai-tts.js）支持的语言。 */
const LANGS = [
	{ value: "ZH", label: "中文" },
	{ value: "EN", label: "英语" },
	{ value: "JA", label: "日语" },
	{ value: "ES", label: "西语" },
	{ value: "AR", label: "阿语" },
] as const;

const MAX_TEXT_LEN = 5000;

interface Voice {
	id: string;
	name: string;
	lang: string;
	tags: string[];
	license: string;
	source: string;
	hasRef: boolean;
}

interface TtsResult {
	ok?: boolean;
	url?: string;
	localPath?: string;
	durationMs?: number;
}

interface TtsJob {
	id: string;
	type: string;
	status: string;
	progress: number;
	stage: string;
	error: string;
	outputUrl: string | null;
	result: TtsResult | null;
}

/** 参考音频来源：音色库 vs 素材库。音色库为空时只能走素材库。 */
type RefMode = "voice" | "asset";

function authHeaders(json = false): Record<string, string> {
	const h: Record<string, string> = {};
	try {
		const token = localStorage.getItem("ml_token");
		if (token) h.Authorization = `Bearer ${token}`;
	} catch {
		/* localStorage 不可用时按未登录处理，服务端会明确回 401 */
	}
	if (json) h["Content-Type"] = "application/json";
	return h;
}

/** 需要登录头的地址才带 token；/api/cache/temp 是公开直出，带不带都行。 */
function headersFor(url: string): Record<string, string> | undefined {
	return url.startsWith("/editor-api/") ? authHeaders() : undefined;
}

/**
 * 解码用的 AudioContext 复用一份：每次插入都 new 一个会一直泄漏，
 * 关闭它又会让已解码的 buffer 在别处播放时受影响。
 */
let decodeContext: AudioContext | null = null;
function getDecodeContext(): AudioContext {
	if (!decodeContext || decodeContext.state === "closed") {
		decodeContext = new AudioContext();
	}
	return decodeContext;
}

const isFinished = (status: string) =>
	status === "done" || status === "failed" || status === "canceled";

export function TtsView({ onBack }: { onBack?: () => void }) {
	const editor = useEditor();
	const media = useEditor((e) => e.media.getAssets());

	const [text, setText] = useState("");
	const [lang, setLang] = useState<string>("ZH");
	const [durationFactor, setDurationFactor] = useState(1);
	const [refMode, setRefMode] = useState<RefMode>("voice");
	const [voiceId, setVoiceId] = useState("");
	const [refMediaId, setRefMediaId] = useState("");
	const [voices, setVoices] = useState<Voice[]>([]);
	const [voicesLoaded, setVoicesLoaded] = useState(false);

	const [jobId, setJobId] = useState("");
	const [job, setJob] = useState<TtsJob | null>(null);
	const [submitting, setSubmitting] = useState(false);
	const [inserting, setInserting] = useState(false);

	/** 素材库里已入库（有 fid）的音频，才能作为 refFid 交给服务端。 */
	const refCandidates = useMemo(
		() =>
			(media || [])
				.filter((m) => m.type === "audio")
				.map((m) => ({ id: m.id, name: m.name, fid: getMediaFid(m.id) }))
				.filter((m) => !!m.fid),
		[media],
	);

	useEffect(() => {
		fetch("/editor-api/ai/voices", { headers: authHeaders() })
			.then((r) => (r.ok ? r.json() : { items: [] }))
			.then((d) => setVoices(Array.isArray(d.items) ? (d.items as Voice[]) : []))
			.catch(() => setVoices([]))
			.finally(() => setVoicesLoaded(true));
	}, []);

	// 音色库为空时默认落到素材库；有音色时默认选第一个，避免提交时才发现没选。
	useEffect(() => {
		if (!voicesLoaded) return;
		if (voices.length === 0) {
			setRefMode("asset");
			return;
		}
		if (!voiceId) setVoiceId(voices[0].id);
	}, [voicesLoaded, voices, voiceId]);

	useEffect(() => {
		if (!refMediaId && refCandidates.length) setRefMediaId(refCandidates[0].id);
	}, [refCandidates, refMediaId]);

	// 轮询：与 ai.tsx 一致，任务进终态就停表。
	useEffect(() => {
		if (!jobId) return;
		let alive = true;
		let timer: ReturnType<typeof setInterval> | null = null;
		const poll = async () => {
			try {
				const res = await fetch(`/editor-api/ai/jobs/${jobId}`, {
					headers: authHeaders(),
				});
				if (!res.ok) return;
				const data = await res.json();
				if (!alive) return;
				const next = data.job as TtsJob | undefined;
				if (!next) return;
				setJob(next);
				if (isFinished(next.status) && timer) {
					clearInterval(timer);
					timer = null;
				}
			} catch {
				/* 单次轮询失败不打扰用户，下个周期再试 */
			}
		};
		void poll();
		timer = setInterval(() => {
			void poll();
		}, 1500);
		return () => {
			alive = false;
			if (timer) clearInterval(timer);
		};
	}, [jobId]);

	const refReady = refMode === "voice" ? !!voiceId : !!refMediaId;

	const handleSubmit = async () => {
		const trimmed = text.trim();
		if (!trimmed) {
			toast.error("请先输入要合成的文本");
			return;
		}
		const target = refCandidates.find((c) => c.id === refMediaId);
		if (refMode === "voice" && !voiceId) {
			toast.error("音色库为空，请先上传参考音频，或从素材库选一段音频");
			return;
		}
		if (refMode === "asset" && !target?.fid) {
			toast.error("请选择一段已入库的音频作为参考（本地新导入的素材需先入库）");
			return;
		}

		setSubmitting(true);
		setJobId("");
		setJob(null);
		try {
			const body: Record<string, unknown> = { text: trimmed, lang, durationFactor };
			if (refMode === "voice") body.voiceId = voiceId;
			else body.refFid = target?.fid;

			const res = await fetch("/editor-api/ai/tts", {
				method: "POST",
				headers: authHeaders(true),
				body: JSON.stringify(body),
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
			if (!data.jobId) throw new Error("服务端没有返回 jobId");
			if (data.job) setJob(data.job as TtsJob);
			setJobId(String(data.jobId));
			toast.success("已提交合成任务");
		} catch (e) {
			toast.error(e instanceof Error ? e.message : String(e));
		} finally {
			setSubmitting(false);
		}
	};

	const previewUrl = job?.result?.url || "";
	const doneUrl = previewUrl || job?.outputUrl || "";

	const handleDownload = async () => {
		if (!doneUrl) return;
		try {
			const res = await fetch(doneUrl, { headers: headersFor(doneUrl) });
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const blob = await res.blob();
			const href = URL.createObjectURL(blob);
			const a = document.createElement("a");
			a.href = href;
			a.download = `tts-${job?.id || Date.now()}.wav`;
			a.click();
			setTimeout(() => URL.revokeObjectURL(href), 10_000);
		} catch (e) {
			toast.error(`下载失败：${e instanceof Error ? e.message : String(e)}`);
		}
	};

	/** 把产物作为 LibraryAudioElement 插入当前场景的 audio 轨（复用 sounds 的插入路径）。 */
	const handleInsert = useCallback(async () => {
		if (!doneUrl) {
			toast.error("没有可插入的产物");
			return;
		}
		setInserting(true);
		try {
			const res = await fetch(doneUrl, { headers: headersFor(doneUrl) });
			if (!res.ok) throw new Error(`读取产物失败：HTTP ${res.status}`);
			const arrayBuffer = await res.arrayBuffer();
			const buffer = await getDecodeContext().decodeAudioData(arrayBuffer);

			const seconds =
				Number.isFinite(buffer.duration) && buffer.duration > 0
					? buffer.duration
					: Math.max(0.2, (job?.result?.durationMs ?? 0) / 1000);

			const element = buildLibraryAudioElement({
				sourceUrl: doneUrl,
				name: `TTS · ${text.trim().slice(0, 12) || "语音"}`,
				duration: mediaTimeFromSeconds({ seconds }),
				startTime: editor.playback.getCurrentTime(),
				buffer,
			});

			// insertElement 在无轨可用时会静默返回，这里比一次音频元素数量，
			// 数量没变就当作失败抛出去，落到下面的 toast，避免"点了没反应"。
			const countAudioElements = () => {
				const tracks = editor.scenes.getActiveSceneOrNull()?.tracks;
				if (!tracks) return 0;
				return tracks.audio.reduce((sum, track) => sum + track.elements.length, 0);
			};
			const before = countAudioElements();
			editor.timeline.insertElement({
				element,
				placement: { mode: "auto", trackType: "audio" },
			});
			if (countAudioElements() <= before) {
				throw new Error("时间线没有接受这个片段（当前场景没有可用音频轨）");
			}
			toast.success("已插入音频轨");
		} catch (e) {
			// 插入失败必须让用户看见，不能静默吞掉。
			toast.error(
				`插入音频轨失败：${e instanceof Error ? e.message : String(e)}`,
			);
		} finally {
			setInserting(false);
		}
	}, [doneUrl, editor, job?.result?.durationMs, text]);

	return (
		<PanelView
			title="文本转语音（TTS）"
			contentClassName="flex flex-col gap-3 pb-4"
			actions={
				onBack ? (
					<Button size="sm" variant="ghost" onClick={onBack}>
						返回
					</Button>
				) : undefined
			}
		>
			<div className="flex flex-col gap-1.5">
				<label className="text-xs font-medium" htmlFor="tts-text">
					文本
				</label>
				<textarea
					id="tts-text"
					className="bg-background min-h-24 w-full resize-y rounded border px-2 py-1.5 text-xs"
					placeholder="输入要合成的文本，最长 5000 字"
					maxLength={MAX_TEXT_LEN}
					value={text}
					onChange={(e) => setText(e.target.value)}
				/>
				<span className="text-muted-foreground text-[11px] tabular-nums">
					{text.length} / {MAX_TEXT_LEN}
				</span>
			</div>

			<div className="flex flex-col gap-1.5">
				<label className="text-xs font-medium" htmlFor="tts-lang">
					语言
				</label>
				<select
					id="tts-lang"
					className="bg-background w-full rounded border px-2 py-1 text-xs"
					value={lang}
					onChange={(e) => setLang(e.target.value)}
				>
					{LANGS.map((l) => (
						<option key={l.value} value={l.value}>
							{l.label}（{l.value}）
						</option>
					))}
				</select>
			</div>

			<div className="flex flex-col gap-1.5">
				<span className="text-xs font-medium">参考音频</span>
				<div className="flex gap-1.5">
					<button
						type="button"
						disabled={voices.length === 0}
						onClick={() => setRefMode("voice")}
						className={`flex-1 cursor-pointer rounded border px-2 py-1 text-[11px] disabled:cursor-not-allowed disabled:opacity-50 ${
							refMode === "voice" ? "bg-primary text-primary-foreground" : ""
						}`}
					>
						音色库（{voices.length}）
					</button>
					<button
						type="button"
						onClick={() => setRefMode("asset")}
						className={`flex-1 cursor-pointer rounded border px-2 py-1 text-[11px] ${
							refMode === "asset" ? "bg-primary text-primary-foreground" : ""
						}`}
					>
						素材库音频
					</button>
				</div>

				{voices.length === 0 ? (
					<p className="text-muted-foreground text-[11px]">
						音色库为空，请先上传参考音频（data/voices/&lt;id&gt;/ref.wav），
						或直接从素材库选一段音频作为参考。
					</p>
				) : null}

				{refMode === "voice" ? (
					voices.length > 0 ? (
						<select
							className="bg-background w-full rounded border px-2 py-1 text-xs"
							value={voiceId}
							onChange={(e) => setVoiceId(e.target.value)}
						>
							{voices.map((v) => (
								<option key={v.id} value={v.id}>
									{v.name}
									{v.lang ? ` · ${v.lang}` : ""}
									{v.hasRef ? "" : "（缺 ref.wav）"}
								</option>
							))}
						</select>
					) : null
				) : (
					<select
						className="bg-background w-full rounded border px-2 py-1 text-xs"
						value={refMediaId}
						onChange={(e) => setRefMediaId(e.target.value)}
					>
						{refCandidates.length === 0 && (
							<option value="">（素材库没有已入库的音频）</option>
						)}
						{refCandidates.map((c) => (
							<option key={c.id} value={c.id}>
								{c.name}
							</option>
						))}
					</select>
				)}
			</div>

			<div className="flex flex-col gap-1.5">
				<label className="flex items-center justify-between text-xs font-medium">
					<span>时长系数（0.5–2）</span>
					<span className="text-muted-foreground tabular-nums">
						{durationFactor.toFixed(2)}
					</span>
				</label>
				<input
					type="range"
					min={0.5}
					max={2}
					step={0.05}
					value={durationFactor}
					onChange={(e) => setDurationFactor(Number(e.target.value))}
					className="w-full"
				/>
				<p className="text-muted-foreground text-[11px]">
					大于 1 更慢更长，小于 1 更快更短；服务端会夹到 0.5–2。
				</p>
			</div>

			<Button
				size="sm"
				onClick={handleSubmit}
				disabled={submitting || !text.trim() || !refReady}
			>
				{submitting ? "提交中…" : "开始合成"}
			</Button>

			{job && (
				<div className="flex flex-col gap-1.5 rounded-md border p-2">
					<div className="flex items-center justify-between gap-2 text-xs">
						<span className="truncate">任务 {job.id}</span>
						<span className="text-muted-foreground shrink-0 tabular-nums">
							{job.status} · {job.progress}%
						</span>
					</div>
					<div className="bg-muted h-1.5 w-full overflow-hidden rounded-full">
						<div
							className="bg-primary h-full transition-[width]"
							style={{ width: `${Math.max(0, Math.min(100, job.progress))}%` }}
						/>
					</div>
					{job.stage && (
						<span className="text-muted-foreground text-[11px]">{job.stage}</span>
					)}
					{/* 失败原因一律用服务端原文（如「引擎未配置：…」），不在这里改写成泛化提示 */}
					{job.error && (
						<span className="text-destructive text-[11px] break-all">{job.error}</span>
					)}

					{job.status === "done" && doneUrl && (
						<div className="flex flex-col gap-1.5">
							{previewUrl ? (
								<audio className="w-full" controls src={previewUrl} />
							) : null}
							<div className="flex flex-wrap gap-1.5">
								<Button size="sm" variant="outline" onClick={handleDownload}>
									下载
								</Button>
								<Button size="sm" onClick={handleInsert} disabled={inserting}>
									{inserting ? "插入中…" : "插入音频轨"}
								</Button>
							</div>
						</div>
					)}
				</div>
			)}
		</PanelView>
	);
}
