import type { FrameRate } from "opencut-wasm";
import { EXPORT_MIME_TYPES } from "./mime-types";

export const EXPORT_FORMAT_VALUES = ["mp4", "webm"] as const;
export type ExportFormat = (typeof EXPORT_FORMAT_VALUES)[number];

export const EXPORT_QUALITY_VALUES = [
	"low",
	"medium",
	"high",
	"very_high",
] as const;
export type ExportQuality = (typeof EXPORT_QUALITY_VALUES)[number];

export interface ExportOptions {
	format: ExportFormat;
	quality: ExportQuality;
	fps?: FrameRate;
	includeAudio?: boolean;
}

export interface ExportResult {
	success: boolean;
	buffer?: ArrayBuffer;
	error?: string;
	cancelled?: boolean;
}

export interface ExportState {
	isExporting: boolean;
	progress: number;
	result: ExportResult | null;
}

export function getExportMimeType({
	format,
}: {
	format: ExportFormat;
}): string {
	return EXPORT_MIME_TYPES[format];
}

export function getExportFileExtension({
	format,
}: {
	format: ExportFormat;
}): string {
	return `.${format}`;
}

export function downloadBuffer({
	buffer,
	filename,
	mimeType,
}: {
	buffer: ArrayBuffer;
	filename: string;
	mimeType: string;
}): void {
	const blob = new Blob([buffer], { type: mimeType });
	const url = URL.createObjectURL(blob);
	const downloadLink = document.createElement("a");
	downloadLink.href = url;
	downloadLink.download = filename;
	document.body.appendChild(downloadLink);
	downloadLink.click();
	document.body.removeChild(downloadLink);
	URL.revokeObjectURL(url);
}

export type DeliverMode = "upload" | "download" | "both";

export interface DeliveredAsset {
	ok: boolean;
	mode: DeliverMode;
	downloaded?: boolean;
	uploaded?: boolean;
	fid?: string;
	url?: string;
	error?: string;
}

function authHeaders(): Record<string, string> {
	try {
		const token = localStorage.getItem("ml_token") || "";
		return token ? { Authorization: `Bearer ${token}` } : {};
	} catch {
		return {};
	}
}

/**
 * 成品双出口交付（同时导出到本地并同步至素材库成品库）。
 * - 默认模式同时触发：
 *   1. 浏览器端下载到本地磁盘（downloadBuffer）
 *   2. POST /api/upload（shelf='finished'）自动归档入库
 */
export async function deliverBuffer({
	buffer,
	filename,
	mimeType,
	mode = "upload",
	shelf = "finished",
}: {
	buffer: ArrayBuffer;
	filename: string;
	mimeType: string;
	mode?: DeliverMode;
	shelf?: string;
}): Promise<DeliveredAsset> {
	// 无论如何，首先触发本地下载到用户计算机
	try {
		downloadBuffer({ buffer, filename, mimeType });
	} catch (dlErr) {
		console.warn("本地下载触发异常:", dlErr);
	}

	// 如果仅需本地下载，直接返回
	if (mode === "download") {
		return { ok: true, mode: "download", downloaded: true };
	}

	// 同步上传至素材库成品库
	try {
		// 分类按实际产物推断：纯音频导出以前会被记成视频，进库后归类错乱
		const category = mimeType.startsWith("audio/")
			? "audio"
			: mimeType.startsWith("image/")
				? "image"
				: "video";

		const form = new FormData();
		form.append("file", new Blob([buffer], { type: mimeType }), filename);
		form.append("shelf", shelf);
		form.append("category", category);

		const res = await fetch("/api/upload", {
			method: "POST",
			headers: authHeaders(),
			body: form,
		});

		if (!res.ok) {
			const errText = await res.text();
			throw new Error(errText || `HTTP ${res.status}`);
		}

		const data = await res.json();
		return {
			ok: true,
			mode: "both",
			downloaded: true,
			uploaded: true,
			fid: data.fid,
			url: data.fid ? `/api/viewer/assets/${encodeURIComponent(data.fid)}/file` : undefined,
		};
	} catch (e) {
		return {
			ok: false,
			mode: "both",
			downloaded: true,
			uploaded: false,
			error: e instanceof Error ? e.message : String(e),
		};
	}
}
