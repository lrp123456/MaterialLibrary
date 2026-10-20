import type { FrameRate } from "opencut-wasm";
import { EXPORT_MIME_TYPES } from "./mime-types";

export const EXPORT_QUALITY_VALUES = [
	"low",
	"medium",
	"high",
	"very_high",
] as const;

export const EXPORT_FORMAT_VALUES = ["mp4", "webm"] as const;

export type ExportFormat = (typeof EXPORT_FORMAT_VALUES)[number];
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

export type DeliverMode = "upload" | "download";

export interface DeliveredAsset {
	ok: boolean;
	mode: DeliverMode;
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
 * 成片出口。
 * - upload（默认）：直接进素材库成品架，用户可在「成品」里看到；
 * - download：退回浏览器下载，用于离线或临时导出。
 * 上传失败不静默 —— 回退到下载并带回错误，避免用户以为已经入库。
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
	if (mode === "download") {
		downloadBuffer({ buffer, filename, mimeType });
		return { ok: true, mode };
	}
	try {
		const form = new FormData();
		form.append("file", new Blob([buffer], { type: mimeType }), filename);
		form.append("shelf", shelf);
		const res = await fetch("/api/upload", {
			method: "POST",
			headers: authHeaders(),
			body: form,
		});
		if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
		const data = await res.json();
		return {
			ok: true,
			mode,
			fid: data.fid,
			url: data.fid ? `/api/viewer/assets/${encodeURIComponent(data.fid)}/file` : undefined,
		};
	} catch (e) {
		downloadBuffer({ buffer, filename, mimeType });
		return {
			ok: false,
			mode,
			error: e instanceof Error ? e.message : String(e),
		};
	}
}
