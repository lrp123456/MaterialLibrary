/**
 * 素材版本引用：`fid` 或 `fid::derivativeId`。
 * 云备份把版本引用存进 mediaFidMap，拉取时据此还原到具体衍生版。
 */
export interface MediaFidRef {
	fid: string;
	derivativeId: string;
}

export function parseMediaFidRef(value: string | null | undefined): MediaFidRef {
	const raw = String(value || "");
	const idx = raw.indexOf("::");
	if (idx < 0) return { fid: raw, derivativeId: "" };
	return { fid: raw.slice(0, idx), derivativeId: raw.slice(idx + 2) };
}

export function formatMediaFidRef(fid: string, derivativeId?: string): string {
	return derivativeId ? `${fid}::${derivativeId}` : String(fid || "");
}

/** 快照拉取时的字节下载路径；后端已支持 derivative 参数。 */
export function snapshotDownloadPath(fid: string, derivativeId?: string): string {
	const base = `/api/viewer/assets/${encodeURIComponent(fid)}/file`;
	return derivativeId ? `${base}?derivative=${encodeURIComponent(derivativeId)}` : base;
}
