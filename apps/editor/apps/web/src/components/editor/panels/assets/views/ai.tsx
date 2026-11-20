"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useEditor } from "@/editor/use-editor";
import { getMediaFid } from "@/services/cloud-snapshots";

/**
 * AI 面板。
 *
 * 真实推理在服务端（src/clip-ai.js 的 clip_ai_jobs 队列），这里只做三件事：
 * 选素材 → 提交任务 → 轮询进度并展示结果。
 * 引擎没配置时服务端会明确失败（"引擎未配置"），不会被这里掩盖。
 */

type JobType = "subtitle" | "matting" | "beauty_pro" | "face_reshape" | "upscale";

const TYPE_LABELS: Record<JobType, string> = {
	subtitle: "AI 字幕",
	matting: "智能抠像",
	beauty_pro: "美颜精修",
	face_reshape: "瘦脸瘦身",
	upscale: "画质增强",
};

interface Capability {
	type: JobType;
	ready: boolean;
}

interface Job {
	id: string;
	type: JobType;
	fid: string;
	status: string;
	progress: number;
	stage: string;
	error: string;
	outputUrl: string | null;
	result: unknown;
	createdAt: number;
}

function authHeaders(json = false): Record<string, string> {
	const h: Record<string, string> = {};
	try {
		const t = localStorage.getItem("ml_token");
		if (t) h.Authorization = `Bearer ${t}`;
	} catch {
		/* 忽略 */
	}
	if (json) h["Content-Type"] = "application/json";
	return h;
}

export function AiView() {
	const editor = useEditor();
	const media = useEditor((e) => e.media.getAssets());
	const [caps, setCaps] = useState<Capability[]>([]);
	const [jobs, setJobs] = useState<Job[]>([]);
	const [type, setType] = useState<JobType>("subtitle");
	const [mediaId, setMediaId] = useState<string>("");
	const [busy, setBusy] = useState(false);

	const candidates = useMemo(
		() =>
			(media || [])
				.map((m) => ({ id: m.id, name: m.name, fid: getMediaFid(m.id) }))
				.filter((m) => !!m.fid),
		[media],
	);

	useEffect(() => {
		if (!mediaId && candidates.length) setMediaId(candidates[0].id);
	}, [candidates, mediaId]);

	const loadJobs = useCallback(async () => {
		try {
			const res = await fetch("/editor-api/ai/jobs?limit=20", { headers: authHeaders() });
			if (!res.ok) return;
			const data = await res.json();
			setJobs((data.items || []) as Job[]);
		} catch {
			/* 轮询失败不打扰用户 */
		}
	}, []);

	useEffect(() => {
		fetch("/editor-api/ai/capabilities", { headers: authHeaders() })
			.then((r) => (r.ok ? r.json() : { items: [] }))
			.then((d) => setCaps(d.items || []))
			.catch(() => setCaps([]));
		void loadJobs();
		const timer = setInterval(() => {
			void loadJobs();
		}, 4000);
		return () => clearInterval(timer);
	}, [loadJobs]);

	const handleSubmit = async () => {
		const target = candidates.find((c) => c.id === mediaId);
		if (!target || !target.fid) {
			toast.error("请选择一个已入库的素材（本地新建素材需先备份或导入素材库）");
			return;
		}
		setBusy(true);
		try {
			const res = await fetch("/editor-api/ai/jobs", {
				method: "POST",
				headers: authHeaders(true),
				body: JSON.stringify({ type, fid: target.fid, params: {} }),
			});
			if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
			toast.success(`已提交：${TYPE_LABELS[type]}`);
			await loadJobs();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="flex h-full flex-col gap-3 overflow-y-auto p-3">
			<div>
				<div className="text-sm font-medium">AI 任务</div>
				<div className="text-muted-foreground mt-1 text-xs">
					推理在本机/服务器完成，结果会回到素材库或字幕轨。
				</div>
			</div>

			<div className="flex flex-wrap gap-1.5">
				{caps.length === 0 && (
					<span className="text-muted-foreground text-xs">未读取到能力列表</span>
				)}
				{caps.map((c) => (
					<span
						key={c.type}
						className={`rounded-full border px-2 py-0.5 text-[11px] ${
							c.ready
								? "border-emerald-500/40 text-emerald-500"
								: "text-muted-foreground border-dashed"
						}`}
						title={c.ready ? "引擎已就绪" : "引擎未配置：放入 clip-ai-runners 后重启服务"}
					>
						{TYPE_LABELS[c.type] || c.type}
						{c.ready ? "" : " · 未配置"}
					</span>
				))}
			</div>

			<div className="flex flex-col gap-2 rounded-md border p-2">
				<label className="text-xs font-medium">素材</label>
				<select
					className="bg-background w-full rounded border px-2 py-1 text-xs"
					value={mediaId}
					onChange={(e) => setMediaId(e.target.value)}
				>
					{candidates.length === 0 && <option value="">（没有已入库素材）</option>}
					{candidates.map((c) => (
						<option key={c.id} value={c.id}>
							{c.name}
						</option>
					))}
				</select>

				<label className="text-xs font-medium">任务</label>
				<select
					className="bg-background w-full rounded border px-2 py-1 text-xs"
					value={type}
					onChange={(e) => setType(e.target.value as JobType)}
				>
					{(Object.keys(TYPE_LABELS) as JobType[]).map((k) => (
						<option key={k} value={k}>
							{TYPE_LABELS[k]}
						</option>
					))}
				</select>

				<Button size="sm" onClick={handleSubmit} disabled={busy || !candidates.length}>
					{busy ? "提交中…" : "提交任务"}
				</Button>
				<p className="text-muted-foreground text-[11px]">
					只有已入库（有 fid）的素材能提交；本地新导入的素材请先备份到云端或进素材库。
				</p>
			</div>

			<div className="flex flex-col gap-2">
				<div className="text-xs font-medium">最近任务</div>
				{jobs.length === 0 && <div className="text-muted-foreground text-xs">暂无</div>}
				{jobs.map((j) => (
					<div key={j.id} className="rounded border px-2 py-1.5 text-xs">
						<div className="flex items-center justify-between gap-2">
							<span className="truncate">
								{TYPE_LABELS[j.type] || j.type} · {j.status}
							</span>
							<span className="text-muted-foreground shrink-0 tabular-nums">
								{j.progress}%
							</span>
						</div>
						{j.stage && <div className="text-muted-foreground mt-0.5">{j.stage}</div>}
						{j.error && <div className="text-destructive mt-0.5 break-all">{j.error}</div>}
						{j.outputUrl && (
							<a
								className="text-primary mt-0.5 inline-block underline"
								href={j.outputUrl}
								target="_blank"
								rel="noreferrer"
							>
								下载产出
							</a>
						)}
					</div>
				))}
			</div>
		</div>
	);
}
