/**
 * 工程文件（.mlsclip）导出 / 导入。
 *
 * 与云端快照的区别：
 * - 快照只存 JSON（素材本来就在库里，换机靠 fid 去库里拿）；
 * - `.mlsclip` 是一个可带媒体的单文件包，可以拷给别的机器/桌面版，
 *   因此导出时可以勾选"包含媒体"，导入时把包里的媒体重新登记进本地素材库。
 *
 * 素材 fid 的来源沿用快照那套：本地 mediaId → 库内 fid 记在 localStorage，
 * 没记录的先上传一次取 fid，否则包里留不住引用。
 *
 * 导入不要求素材齐全：缺的只回传清单，工程照样能打开（画面缺块但结构在）。
 */
import { storageService } from "@/services/storage/service";
import {
	remapMediaIds,
	registerMediaFid,
	getMediaFid,
	uploadFileToLibrary,
} from "@/services/cloud-snapshots";
import { processMediaAssets } from "@/media/processing";
import { generateUUID } from "@/utils/id";
import { downloadBuffer } from "@/export";
import type { TProject } from "@/project/types";
import type { SerializedProject } from "@/services/storage/types";

const EDITOR_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || "0.1.0";

function token(): string {
	try {
		return localStorage.getItem("ml_token") || "";
	} catch {
		return "";
	}
}

function headers(json = false): Record<string, string> {
	const h: Record<string, string> = {};
	const t = token();
	if (t) h.Authorization = `Bearer ${t}`;
	if (json) h["Content-Type"] = "application/json";
	return h;
}

async function errorText(res: Response): Promise<string> {
	const text = await res.text();
	try {
		const data = JSON.parse(text);
		if (data && typeof data.error === "string") return data.error;
	} catch {
		/* 非 JSON 原文直接返回 */
	}
	return text || `HTTP ${res.status}`;
}

export interface ClipExportResult {
	filename: string;
	size: number;
	/** 服务端给的非致命提示：单素材超 500MB 未内嵌、原文件读不到等 */
	warnings: string[];
	assets: number;
	embedded: number;
}

interface ClipAssetRef {
	fid: string;
	name: string;
	mime: string;
	size: number;
}

/**
 * 导出当前工程为 `.mlsclip` 并触发浏览器下载。
 * 调用前请先 `editor.project.saveCurrentProject()`，保证传进来的工程是最新的。
 */
export async function exportProjectFile({
	project,
	includeMedia,
	onProgress,
}: {
	project: TProject;
	includeMedia: boolean;
	onProgress?: (stage: string, percent: number) => void;
}): Promise<ClipExportResult> {
	const projectId = project.metadata.id;
	onProgress?.("收集素材", 5);

	const media = await storageService.loadAllMediaAssets({ projectId });
	const fidMap: Record<string, string> = {};
	const assets: ClipAssetRef[] = [];
	const seenFid = new Set<string>();

	for (let i = 0; i < media.length; i += 1) {
		const item = media[i];
		let fid = getMediaFid(item.id);
		if (!fid) {
			// 本地新拖进来的素材还没入库：先登记一次，否则包里没有可引用的 fid
			onProgress?.(
				`登记素材 ${i + 1}/${media.length}`,
				5 + Math.round(((i + 1) / Math.max(1, media.length)) * 55),
			);
			fid = await uploadFileToLibrary(item.file);
			registerMediaFid(item.id, fid);
		}
		fidMap[item.id] = fid;
		if (!seenFid.has(fid)) {
			seenFid.add(fid);
			assets.push({
				fid,
				name: item.name || item.file.name,
				mime: item.file.type || "",
				size: item.file.size,
			});
		}
	}

	onProgress?.("打包工程", 65);
	const serialized = storageService.serializeProject({ project });
	const res = await fetch(
		`/editor-api/projects/${encodeURIComponent(projectId)}/export`,
		{
			method: "POST",
			headers: headers(true),
			body: JSON.stringify({
				name: project.metadata.name,
				editorVersion: EDITOR_VERSION,
				includeMedia,
				// mediaFidMap 跟工程一起进包，导入端据此把 mediaId 换成新的本地 id
				project: { ...serialized, mediaFidMap: fidMap },
				assets,
			}),
		},
	);
	if (!res.ok) throw new Error(await errorText(res));
	const data = (await res.json()) as {
		ok: boolean;
		downloadUrl: string;
		filename: string;
		size: number;
		warnings?: string[];
		assets?: number;
		embedded?: number;
	};

	onProgress?.("下载工程包", 85);
	// 下载要带 token，所以先取成 blob 再交给统一的下载入口
	const fileRes = await fetch(data.downloadUrl, { headers: headers() });
	if (!fileRes.ok) throw new Error(await errorText(fileRes));
	const buffer = await fileRes.arrayBuffer();

	onProgress?.("写入磁盘", 96);
	downloadBuffer({
		buffer,
		filename: data.filename,
		mimeType: "application/zip",
	});

	return {
		filename: data.filename,
		size: data.size,
		warnings: data.warnings || [],
		assets: data.assets || assets.length,
		embedded: data.embedded || 0,
	};
}

export interface ClipImportResult {
	projectId: string;
	name: string;
	/** 包里引用了、但本机库里没有的素材 */
	missing: Array<{ fid: string; name: string }>;
	imported: number;
	warnings: string[];
}

interface ImportedMedia {
	fid: string;
	name: string;
	mime?: string;
	url: string;
}

/**
 * 导入 `.mlsclip`。
 * - 工程 id 一律换新，避免覆盖本机同名工程；
 * - 包内带媒体的素材逐个下载后走 processMediaAssets，宽高/缩略图与正常导入一致；
 * - 导入完返回新 projectId，调用方自行跳转。
 */
export async function importProjectFile({
	file,
	onProgress,
}: {
	file: File;
	onProgress?: (stage: string, percent: number) => void;
}): Promise<ClipImportResult> {
	onProgress?.("上传工程包", 8);
	const res = await fetch("/editor-api/projects/import", {
		method: "POST",
		headers: { ...headers(), "Content-Type": "application/zip" },
		body: file,
	});
	if (!res.ok) throw new Error(await errorText(res));
	const data = (await res.json()) as {
		ok: boolean;
		projectId: string;
		name: string;
		project: SerializedProject & { mediaFidMap?: Record<string, string> };
		missing?: Array<{ fid: string; name: string }>;
		media?: ImportedMedia[];
		warnings?: string[];
	};

	const projectId = data.projectId;
	const serialized: SerializedProject = { ...data.project };
	const remoteFidMap = data.project.mediaFidMap || {};
	delete (serialized as { mediaFidMap?: Record<string, string> }).mediaFidMap;
	serialized.metadata = {
		...serialized.metadata,
		id: projectId,
		updatedAt: new Date().toISOString(),
	};

	const fidToLocalId: Record<string, string> = {};
	const embedded = data.media || [];
	let imported = 0;

	for (let i = 0; i < embedded.length; i += 1) {
		const item = embedded[i];
		onProgress?.(
			`下载素材 ${i + 1}/${embedded.length}`,
			20 + Math.round(((i + 1) / Math.max(1, embedded.length)) * 70),
		);
		try {
			const fileRes = await fetch(item.url, { headers: headers() });
			if (!fileRes.ok) throw new Error(await errorText(fileRes));
			const blob = await fileRes.blob();
			const name = item.name || `${item.fid}.bin`;
			const mediaFile = new File([blob], name, {
				type: item.mime || blob.type || "application/octet-stream",
			});
			const processed = await processMediaAssets({ files: [mediaFile] });
			for (const p of processed) {
				// processMediaAssets 不生成 id，正常路径由 editor.media.addMediaAsset 生成
				const mediaAsset = { ...p, id: generateUUID() };
				await storageService.saveMediaAsset({ projectId, mediaAsset });
				registerMediaFid(mediaAsset.id, item.fid);
				fidToLocalId[item.fid] = mediaAsset.id;
				imported += 1;
			}
		} catch {
			// 单个素材下载失败不阻断导入，最后按"缺失"回报
			(data.missing ||= []).push({ fid: item.fid, name: item.name || item.fid });
		}
	}

	// 包里存的是原机器的 mediaId，换成本机新登记素材的 id，否则时间线整片空白
	const idRemap: Record<string, string> = {};
	for (const [oldId, fid] of Object.entries(remoteFidMap)) {
		const localMediaId = fidToLocalId[fid];
		if (localMediaId) idRemap[oldId] = localMediaId;
	}

	onProgress?.("写入工程", 94);
	await storageService.saveSerializedProject({
		project:
			Object.keys(idRemap).length > 0
				? remapMediaIds({ value: serialized, map: idRemap })
				: serialized,
	});

	onProgress?.("完成", 100);
	return {
		projectId,
		name: data.name,
		missing: data.missing || [],
		imported,
		warnings: data.warnings || [],
	};
}
