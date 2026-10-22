/**
 * 插件拖拽应用（"拖到素材上自动处理"）。
 *
 * 目前支持 vocal-separate（人声分离）：
 *   拖到音频/视频元素 → 提交 AI 任务 → 轮询 → 下载人声 + 伴奏 →
 *   返回 [{ blob, fileName, trackName }]，由调用方落轨（人声 / 背景音）。
 *
 * 扩展新插件：在 STEPS 里加一个 type 的产出映射即可，落轨侧不用改。
 */
import { toast } from "sonner";

function authHeaders(): Record<string, string> {
	const h: Record<string, string> = {};
	try {
		const token = localStorage.getItem("ml_token");
		if (token) h.Authorization = `Bearer ${token}`;
	} catch {
		/* 未登录交给服务端 401 */
	}
	return h;
}

/** 每种插件的产出文件 → 自动落轨的轨道命名。 */
const OUTPUT_TRACKS: Record<string, { file: string; trackName: string }[]> = {
	"vocal-separate": [
		{ file: "vocals.wav", trackName: "人声" },
		{ file: "no_vocals.wav", trackName: "背景音" },
	],
};

export interface PluginOutput {
	blob: Blob;
	fileName: string;
	trackName: string;
}

/**
 * 提交插件任务并等待产出。
 * @param fid 目标素材的 fid（云素材库 id）
 * @param params 透传给 runner 的参数（如时间范围）
 * @returns 产出文件列表（已下载），调用方负责落轨
 */
export async function runPluginOnAsset({
	pluginType,
	pluginName,
	fid,
	params = {},
	onProgress,
}: {
	pluginType: string;
	pluginName: string;
	fid: string;
	params?: Record<string, unknown>;
	onProgress?: (stage: string) => void;
}): Promise<PluginOutput[]> {
	const tracks = OUTPUT_TRACKS[pluginType];
	if (!tracks) {
		throw new Error(`插件「${pluginName}」暂不支持拖拽应用`);
	}

	// 1) 提交任务（后端 runner 执行，vocal-separate 走 Demucs）
	onProgress?.("提交任务");
	const submit = await fetch(`/editor-api/ai/${pluginType}`, {
		method: "POST",
		headers: { ...authHeaders(), "Content-Type": "application/json" },
		body: JSON.stringify({ fid, params }),
	});
	const submitJson = await submit.json().catch(() => ({}));
	if (!submit.ok) {
		throw new Error(submitJson.error || `提交失败 (HTTP ${submit.status})`);
	}
	const jobId = submitJson.jobId || submitJson.job?.id;
	if (!jobId) throw new Error("服务端没有返回任务 id");

	// 2) 轮询到结束（3 秒一次，10 分钟上限）
	onProgress?.("推理中");
	const deadline = Date.now() + 10 * 60 * 1000;
	let job: any = null;
	while (Date.now() < deadline) {
		await new Promise((r) => setTimeout(r, 3000));
		const res = await fetch(`/editor-api/ai/jobs/${encodeURIComponent(jobId)}`, {
			headers: authHeaders(),
		});
		if (!res.ok) continue;
		const json = await res.json();
		job = json.job || json;
		if (job?.stage) onProgress?.(String(job.stage));
		if (job?.status === "done") break;
		if (job?.status === "failed" || job?.status === "canceled") {
			throw new Error(job.error || `任务${job.status === "canceled" ? "已取消" : "失败"}`);
		}
	}
	if (job?.status !== "done") {
		throw new Error("任务超时（10 分钟）");
	}

	// 3) 下载产出（?file= 取同目录下的多份产出）
	const outputs: PluginOutput[] = [];
	for (const t of tracks) {
		const res = await fetch(
			`/editor-api/ai/jobs/${encodeURIComponent(jobId)}/output?file=${encodeURIComponent(t.file)}`,
			{ headers: authHeaders() },
		);
		if (!res.ok) continue;
		outputs.push({
			blob: await res.blob(),
			fileName: t.file,
			trackName: t.trackName,
		});
	}
	if (outputs.length === 0) {
		throw new Error("任务完成但没有产出文件");
	}
	return outputs;
}

/** 失败时统一的轻提示（调用方在 catch 里用）。 */
export function toastPluginError(pluginName: string, err: unknown) {
	const message = err instanceof Error ? err.message : String(err);
	toast.error(`「${pluginName}」执行失败：${message}`);
}
