/**
 * 取帧：把某个素材在指定源时间上的画面缩成统计量，供白平衡 / 色彩克隆 / 智能调色使用。
 *
 * 只读原始素材，不碰合成结果 —— 渲染画布是 WebGPU 的，随时 drawImage 过去
 * 拿到什么取决于换链时机，时机不对就是一张黑图。源素材取样没有这个问题，
 * 而且视频直接复用 videoCache 里已经解码好的那一帧，不再另起一个 <video>。
 */

import { sampleFrameStats, type FrameStats } from "@/services/color-analysis";
import { videoCache } from "@/services/video-cache/service";
import type { MediaAsset } from "@/media/types";

async function grabImageFrame({ file }: { file: File }): Promise<FrameStats | null> {
	try {
		const bitmap = await createImageBitmap(file);
		const stats = sampleFrameStats({
			source: bitmap,
			width: bitmap.width,
			height: bitmap.height,
		});
		bitmap.close();
		return stats;
	} catch {
		return null;
	}
}

export async function grabFrameStats({
	asset,
	timeSeconds = 0,
}: {
	asset: MediaAsset;
	timeSeconds?: number;
}): Promise<FrameStats | null> {
	if (typeof document === "undefined" || asset.type === "audio") {
		return null;
	}
	if (asset.type === "image") {
		return grabImageFrame({ file: asset.file });
	}
	try {
		const frame = await videoCache.getFrameAt({
			mediaId: asset.id,
			file: asset.file,
			time: Math.max(0, timeSeconds),
		});
		if (!frame) {
			return null;
		}
		return sampleFrameStats({
			source: frame.canvas,
			width: frame.canvas.width,
			height: frame.canvas.height,
		});
	} catch {
		return null;
	}
}
