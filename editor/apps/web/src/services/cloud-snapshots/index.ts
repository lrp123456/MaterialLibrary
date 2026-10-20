/**
 * 云端快照：备份 / 列表 / 拉取。
 *
 * 语义（2026-10-20 定档）：
 * - 本地 IndexedDB 是唯一编辑入口，云端只存只读快照；
 * - 备份只传工程 JSON + 素材 fid 清单，素材字节本来就在素材库里；
 * - 覆盖备份用 rev 乐观锁，冲突不自动处理，交给用户先拉取。
 *
 * 素材 fid 的来源：
 * 从素材库导入时会把 mediaId → fid 记进 localStorage；
 * 本地新建（拖文件进来）的素材在备份前先上传取 fid，再记进映射。
 */
import { storageService } from "@/services/storage/service";
import { processMediaAssets } from "@/media/processing";
import { generateUUID } from "@/utils/id";
import type { TProject } from "@/project/types";
import type { SerializedProject } from "@/services/storage/types";

const FID_MAP_KEY = "ml_media_fid_map";
const SNAPSHOT_MAP_KEY = "ml_project_snapshot_map";

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

function readMap(key: string): Record<string, string> {
	try {
		return JSON.parse(localStorage.getItem(key) || "{}") || {};
	} catch {
		return {};
	}
}

function writeMap(key: string, value: Record<string, string>) {
	try {
		localStorage.setItem(key, JSON.stringify(value));
	} catch {
		/* 配额满时忽略，映射丢失只影响增量备份 */
	}
}

export function registerMediaFid(mediaId: string, fid: string) {
	const map = readMap(FID_MAP_KEY);
	map[mediaId] = fid;
	writeMap(FID_MAP_KEY, map);
}

export function getMediaFid(mediaId: string): string | null {
	return readMap(FID_MAP_KEY)[mediaId] || null;
}

async function uploadFileToLibrary(file: File): Promise<string> {
	const form = new FormData();
	form.append("file", file, file.name);
	form.append("shelf", "clip-material");
	const res = await fetch("/api/upload", {
		method: "POST",
		headers: headers(),
		body: form,
	});
	if (!res.ok) throw new Error((await res.text()) || `上传失败 HTTP ${res.status}`);
	const data = await res.json();
	if (!data.fid) throw new Error("上传未返回 fid");
	return data.fid as string;
}

export interface SnapshotSummary {
	id: string;
	name: string;
	rev: number;
	assetsCount: number;
	sizeBytes: number;
	updatedAt: number;
}

export async function listCloudSnapshots(): Promise<SnapshotSummary[]> {
	const res = await fetch("/editor-api/snapshots", { headers: headers() });
	if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
	const data = await res.json();
	return (data.items || []) as SnapshotSummary[];
}

export interface BackupResult {
	snapshotId: string;
	rev: number;
	assets: number;
	uploaded: number;
}

/**
 * 备份当前工程。返回快照 id 与 rev，调用方自行提示。
 * 会先把"本地新导入、库里还没有"的素材上传，确保别的机器拉下来不是黑块。
 */
export async function backupProject({
	project,
	onProgress,
}: {
	project: TProject;
	onProgress?: (stage: string, percent: number) => void;
}): Promise<BackupResult> {
	const projectId = project.metadata.id;
	onProgress?.("收集素材", 5);

	const media = await storageService.loadAllMediaAssets({ projectId });
	const fidMap = readMap(FID_MAP_KEY);
	const fids: string[] = [];
	let uploaded = 0;

	let done = 0;
	for (const item of media) {
		done += 1;
		const known = fidMap[item.id];
		if (known) {
			fids.push(known);
			continue;
		}
		onProgress?.(`上传素材 ${done}/${media.length}`, 5 + Math.round((done / Math.max(1, media.length)) * 60));
		const fid = await uploadFileToLibrary(item.file);
		registerMediaFid(item.id, fid);
		fids.push(fid);
		uploaded += 1;
	}

	const snapshotMap = readMap(SNAPSHOT_MAP_KEY);
	const existing = snapshotMap[projectId] ? JSON.parse(snapshotMap[projectId]) : null;

	onProgress?.("写入快照", 80);
	const payload = {
		name: project.metadata.name,
		data: project,
		assets: [...new Set(fids)].map((fid) => ({ fid, role: "media" })),
		...(existing ? { rev: existing.rev } : {}),
	};

	const url = existing ? `/editor-api/snapshots/${existing.id}` : "/editor-api/snapshots";
	const res = await fetch(url, {
		method: existing ? "PUT" : "POST",
		headers: headers(true),
		body: JSON.stringify(payload),
	});
	if (!res.ok) {
		const text = await res.text();
		if (res.status === 409) {
			throw new Error("云端已有更新版本，请先拉取后再备份（避免覆盖别人的改动）");
		}
		throw new Error(text || `HTTP ${res.status}`);
	}
	const data = await res.json();
	const snap = data.snapshot;
	snapshotMap[projectId] = JSON.stringify({ id: snap.id, rev: snap.rev });
	writeMap(SNAPSHOT_MAP_KEY, snapshotMap);

	onProgress?.("完成", 100);
	return { snapshotId: snap.id, rev: snap.rev, assets: payload.assets.length, uploaded };
}

export interface PullResult {
	/** 本地新建的工程 id，调用方据此跳转。 */
	localProjectId: string;
	missing: string[];
	imported: number;
}

/**
 * 拉取云端快照到本地。
 * - 工程 id 会换成本地新 id，避免覆盖本地同名工程；
 * - 素材逐个下载后走 processMediaAssets，保证宽高/时长/缩略图与正常导入一致；
 * - 下载失败的素材只记录，不阻断打开（画面会缺，但工程结构还在）。
 */
export async function pullSnapshot({
	snapshotId,
	onProgress,
}: {
	snapshotId: string;
	onProgress?: (stage: string, percent: number) => void;
}): Promise<PullResult> {
	onProgress?.("读取快照", 5);
	const res = await fetch(`/editor-api/snapshots/${encodeURIComponent(snapshotId)}`, {
		headers: headers(),
	});
	if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
	const { snapshot } = await res.json();

	const serialized = snapshot.data as SerializedProject;
	const localId = `local_${Date.now().toString(36)}`;
	const projectName = snapshot.name || serialized.metadata.name || "云端工程";

	const localSerialized: SerializedProject = {
		...serialized,
		metadata: {
			...serialized.metadata,
			id: localId,
			name: `${projectName}`,
			createdAt: serialized.metadata.createdAt,
			updatedAt: new Date().toISOString(),
		},
	};

	onProgress?.("写入工程", 15);
	await storageService.saveSerializedProject({ project: localSerialized });

	const assets = (snapshot.assets || []) as Array<{ fid: string; role: string }>;
	const mediaAssets = assets.filter((a) => a.role === "media" || a.role === "audio");
	const missing: string[] = [];
	let imported = 0;

	for (let i = 0; i < mediaAssets.length; i += 1) {
		const { fid } = mediaAssets[i];
		onProgress?.(
			`下载素材 ${i + 1}/${mediaAssets.length}`,
			15 + Math.round(((i + 1) / Math.max(1, mediaAssets.length)) * 75),
		);
		try {
			const fileRes = await fetch(`/api/viewer/assets/${encodeURIComponent(fid)}/file`, {
				headers: headers(),
			});
			if (!fileRes.ok) throw new Error(`HTTP ${fileRes.status}`);
			const blob = await fileRes.blob();
			const name = (blob.type || "").startsWith("video")
				? `${fid}.mp4`
				: (blob.type || "").startsWith("audio")
					? `${fid}.m4a`
					: `${fid}.png`;
			const file = new File([blob], name, { type: blob.type || "application/octet-stream" });
			const processed = await processMediaAssets({ files: [file] });
			for (const p of processed) {
				// processMediaAssets 返回的资产没有 id（正常路径由 editor.media.addMediaAsset 生成），
				// 这里直接落库，需要自己补一个。
				const mediaAsset = { ...p, id: generateUUID() };
				await storageService.saveMediaAsset({
					projectId: localId,
					mediaAsset,
				});
				registerMediaFid(mediaAsset.id, fid);
				imported += 1;
			}
		} catch {
			missing.push(fid);
		}
	}

	onProgress?.("完成", 100);
	return {
		localProjectId: localId,
		missing,
		imported,
	};
}
