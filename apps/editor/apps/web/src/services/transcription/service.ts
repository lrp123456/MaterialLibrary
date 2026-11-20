/**
 * 转录服务（已被服务端方案取代）。
 *
 * 原实现用 @huggingface/transformers + onnxruntime-web 在浏览器里跑 Whisper：
 * - 首屏要下几十到上百 MB 的模型与 wasm；
 * - 与本机 GPU 抢资源，和编辑器合成器打架；
 * - 不同显卡/浏览器结果不一致。
 *
 * 2026-10-20 定档：AI 一律走服务端网关（POST /editor-api/ai/jobs, type=subtitle），
 * 因此这里只保留同名接口，调用时给出明确指引，不再打包任何推理依赖。
 * 需要恢复浏览器端 ASR 时，git 历史里有原实现。
 */
import type {
	TranscriptionProgress,
	TranscriptionResult,
} from "@/transcription/types";

export interface TranscribeOptions {
	audioData: Float32Array;
	language?: string;
	modelId?: string;
	onProgress?: (progress: TranscriptionProgress) => void;
}

class ServerTranscriptionService {
	async transcribe(_options: TranscribeOptions): Promise<TranscriptionResult> {
		throw new Error(
			"字幕已改为服务端生成：请在左侧 AI 面板提交字幕任务（type=subtitle）。" +
				"浏览器端本地转录已移除，用于避免上百 MB 模型下载与 GPU 争用。",
		);
	}

	cancel(): void {
		/* 服务端任务取消请用 /editor-api/ai/jobs/:id/cancel */
	}

	terminate(): void {
		/* 无 worker 可终止 */
	}
}

export const transcriptionService = new ServerTranscriptionService();
