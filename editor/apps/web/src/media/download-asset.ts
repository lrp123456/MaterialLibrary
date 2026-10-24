import type { MediaAsset } from "@/media/types";

function triggerDownload(blob: Blob, filename: string): void {
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = filename;
	document.body.appendChild(link);
	link.click();
	document.body.removeChild(link);
	URL.revokeObjectURL(url);
}

/** 把本地素材池里的原始文件直接交给浏览器下载（不改动时间线，不做转码）。 */
export function downloadMediaAsset(asset: MediaAsset): boolean {
	if (!asset.file) return false;
	triggerDownload(asset.file, asset.name || `media-${asset.id}`);
	return true;
}

export async function downloadMediaUrl(
	url: string,
	filename: string,
	init?: RequestInit,
): Promise<void> {
	const res = await fetch(url, init);
	if (!res.ok) throw new Error(`下载失败 (HTTP ${res.status})`);
	triggerDownload(await res.blob(), filename);
}
