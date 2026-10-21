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
import {
	formatMediaFidRef,
	parseMediaFidRef,
	snapshotDownloadPath,
	type MediaFidRef,
} from "./fid-ref";

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

/** 深拷贝并把所有 mediaId 按映射换成新的本地 id。 */
export function remapMediaIds<T>({
	value,
	map,
}: {
	value: T;
	map: Record<string, string>;
}): T {
	const walk = (node: unknown): unknown => {
		if (Array.isArray(node)) return node.map(walk);
		if (node && typeof node === "object") {
			const out: Record<string, unknown> = {};
			for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
				out[key] =
					key === "mediaId" && typeof child === "string" && map[child]
						? map[child]
						: walk(child);
			}
			return out;
		}
		return node;
	};
	return walk(value) as T;
}

/**
 * 记录本地 mediaId → 云端版本引用。
 * 传 derivativeId 表示该本地素材实际是某衍生版，备份时据此还原版本。
 */
export function registerMediaFid(mediaId: string, fid: string, derivativeId?: string) {
	if (!mediaId || !fid) return;
	const map = readMap(FID_MAP_KEY);
	map[mediaId] = formatMediaFidRef(fid, derivativeId);
	writeMap(FID_MAP_KEY, map);
}

/** 只要裸 fid（AI 引用、上传去重等旧调用方依赖这个语义）。 */
export function getMediaFid(mediaId: string): string | null {
	const raw = readMap(FID_MAP_KEY)[mediaId];
	if (!raw) return null;
	return parseMediaFidRef(raw).fid || null;
}

/** 完整版本引用，需要区分衍生版时用这个。 */
export function getMediaFidRef(mediaId: string): MediaFidRef | null {
	const raw = readMap(FID_MAP_KEY)[mediaId];
	if (!raw) return null;
	const parsed = parseMediaFidRef(raw);
	return parsed.fid ? parsed : null;
}

/** 上传一个本地文件进素材库，返回 fid（云端快照与 .mlsclip 导出共用）。 */
export async function uploadFileToLibrary(file: File): Promise<string> {
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
	group: string;
	rev: number;
	assetsCount: number;
	sizeBytes: number;
	updatedAt: number;
}

export function getSnapshotBinding(
	projectId: string,
): { id: string; rev: number } | null {
	try {
		const raw = readMap(SNAPSHOT_MAP_KEY)[projectId];
		if (!raw) return null;
		const parsed = JSON.parse(raw);
		if (!parsed || !parsed.id) return null;
		return { id: String(parsed.id), rev: Number(parsed.rev) || 1 };
	} catch {
		return null;
	}
}

export function bindSnapshot(
	projectId: string,
	binding: { id: string; rev: number },
) {
	const map = readMap(SNAPSHOT_MAP_KEY);
	map[projectId] = JSON.stringify(binding);
	writeMap(SNAPSHOT_MAP_KEY, map);
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
	const mediaFidMap: Record<string, string> = {};
	let uploaded = 0;

	let done = 0;
	for (const item of media) {
		done += 1;
		const known = fidMap[item.id];
		if (known) {
			const parsed = parseMediaFidRef(known);
			// 快照 assets 清单只按裸 fid 记录，版本引用只放 mediaFidMap
			if (parsed.fid) fids.push(parsed.fid);
			mediaFidMap[item.id] = known;
			continue;
		}
		onProgress?.(`上传素材 ${done}/${media.length}`, 5 + Math.round((done / Math.max(1, media.length)) * 60));
		const fid = await uploadFileToLibrary(item.file);
		registerMediaFid(item.id, fid);
		fids.push(fid);
		mediaFidMap[item.id] = fid;
		uploaded += 1;
	}

	const existing = getSnapshotBinding(projectId);

	onProgress?.("写入快照", 80);
	const payload = {
		name: project.metadata.name,
		group: project.metadata.group || "",
		// 本地 mediaId → 库里 fid 跟着工程一起存云端，拉取端据此换成自己的本地 id
		data: { ...project, mediaFidMap },
		assets: [...new Set(fids)].map((fid) => ({ fid, role: "media" })),
		...(existing ? { rev: existing.rev } : {}),
	};

	let url = existing ? `/editor-api/snapshots/${existing.id}` : "/editor-api/snapshots";
	let method: "POST" | "PUT" = existing ? "PUT" : "POST";
	let res = await fetch(url, {
		method,
		headers: headers(true),
		body: JSON.stringify(payload),
	});

	// 绑定已失效（快照被删）：退化成新建
	if (existing && res.status === 404) {
		url = "/editor-api/snapshots";
		method = "POST";
		const { rev: _dropRev, ...rest } = payload;
		res = await fetch(url, {
			method,
			headers: headers(true),
			body: JSON.stringify(rest),
		});
	}

	// 版本冲突：拉回最新 rev 后重试一次（本地内容为准）
	if (existing && res.status === 409) {
		const latestRes = await fetch(`/editor-api/snapshots/${existing.id}`, {
			headers: headers(),
		});
		if (latestRes.ok) {
			const latest = await latestRes.json();
			const latestRev = Number(latest?.snapshot?.rev) || existing.rev;
			bindSnapshot(projectId, { id: existing.id, rev: latestRev });
			res = await fetch(`/editor-api/snapshots/${existing.id}`, {
				method: "PUT",
				headers: headers(true),
				body: JSON.stringify({ ...payload, rev: latestRev }),
			});
		}
	}

	if (!res.ok) {
		const text = await res.text();
		if (res.status === 409) {
			throw new Error("云端已有更新版本，请先拉取后再备份（避免覆盖别人的改动）");
		}
		throw new Error(text || `HTTP ${res.status}`);
	}
	const data = await res.json();
	const snap = data.snapshot;
	bindSnapshot(projectId, { id: snap.id, rev: snap.rev });

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

	const serialized = snapshot.data as SerializedProject & {
		mediaFidMap?: Record<string, string>;
	};
	const remoteMediaFidMap = serialized.mediaFidMap || {};
	const serializedWithoutMap: SerializedProject = { ...serialized };
	delete (serializedWithoutMap as { mediaFidMap?: Record<string, string> }).mediaFidMap;
	const localId = `local_${Date.now().toString(36)}`;
	const projectName = snapshot.name || serialized.metadata.name || "云端工程";

	const localSerialized: SerializedProject = {
		...serializedWithoutMap,
		metadata: {
			...serialized.metadata,
			id: localId,
			name: `${projectName}`,
			// 分组随工程一起从云端带下来，保持两端归类一致
			group: snapshot.group || serialized.metadata.group || "",
			createdAt: serialized.metadata.createdAt,
			updatedAt: new Date().toISOString(),
		},
	};

	onProgress?.("写入工程", 15);

	// 需要下载的版本：以 mediaFidMap 的值为准（它才带 derivativeId），
	// snapshot.assets 只按 fid 去重，仅用于兜底老快照/清单缺失的情况。
	const missing: string[] = [];
	const plannedVersions = new Map<string, { fid: string; derivativeId: string }>();
	for (const ref of Object.values(remoteMediaFidMap)) {
		const parsed = parseMediaFidRef(ref);
		if (!parsed.fid) {
			missing.push(String(ref));
			continue;
		}
		plannedVersions.set(formatMediaFidRef(parsed.fid, parsed.derivativeId), parsed);
	}
	const assets = (snapshot.assets || []) as Array<{ fid: string; role: string }>;
	const plannedFids = new Set([...plannedVersions.values()].map((v) => v.fid));
	for (const a of assets) {
		if (a.role !== "media" && a.role !== "audio") continue;
		if (!a.fid || plannedFids.has(a.fid)) continue;
		plannedVersions.set(a.fid, { fid: a.fid, derivativeId: "" });
	}

	const versionEntries = [...plannedVersions.entries()];
	const fidToLocalId: Record<string, string> = {};
	let imported = 0;

	for (let i = 0; i < versionEntries.length; i += 1) {
		const [ref, { fid, derivativeId }] = versionEntries[i];
		onProgress?.(
			`下载素材 ${i + 1}/${versionEntries.length}`,
			15 + Math.round(((i + 1) / Math.max(1, versionEntries.length)) * 75),
		);
		try {
			const fileRes = await fetch(snapshotDownloadPath(fid, derivativeId), {
				headers: headers(),
			});
			if (!fileRes.ok) throw new Error(`HTTP ${fileRes.status}`);
			const blob = await fileRes.blob();
			const mime = blob.type || "";
			const kind = mime.startsWith("video")
				? "video"
				: mime.startsWith("audio")
					? "audio"
					: mime.startsWith("image")
						? "image"
						: "";
			if (!kind) throw new Error(`Unsupported content type: ${mime || "unknown"}`);
			const suffix = derivativeId ? `_${String(derivativeId).slice(0, 8)}` : "";
			const name = kind === "video" ? `${fid}${suffix}.mp4` : kind === "audio" ? `${fid}${suffix}.m4a` : `${fid}${suffix}.png`;
			const file = new File([blob], name, { type: mime });
			const processed = await processMediaAssets({ files: [file] });
			if (processed.length === 0) {
				missing.push(ref);
				continue;
			}
			for (const p of processed) {
				// processMediaAssets 返回的资产没有 id（正常路径由 editor.media.addMediaAsset 生成），
				// 这里直接落库，需要自己补一个。
				const mediaAsset = { ...p, id: generateUUID() };
				await storageService.saveMediaAsset({
					projectId: localId,
					mediaAsset,
				});
				registerMediaFid(mediaAsset.id, fid, derivativeId);
				// 同一 fid 的两个版本必须是两条本地媒体，因此以版本引用为键
				fidToLocalId[ref] = mediaAsset.id;
				imported += 1;
			}
		} catch {
			missing.push(ref);
		}
	}

	// 云端不带本地 mediaId，拉取后时间轴里引用的仍是旧机器上的 id，
	// 按备份时记录的映射换成新导入的本地 id，否则画面会整片空白。
	const mediaFidMap = remoteMediaFidMap;
	const idRemap: Record<string, string> = {};
	for (const [oldId, ref] of Object.entries(mediaFidMap)) {
		const parsed = parseMediaFidRef(ref);
		const localMediaId = fidToLocalId[formatMediaFidRef(parsed.fid, parsed.derivativeId)];
		if (localMediaId) idRemap[oldId] = localMediaId;
	}

	onProgress?.("写入工程", 92);
	await storageService.saveSerializedProject({
		project:
			Object.keys(idRemap).length > 0
				? remapMediaIds({ value: localSerialized, map: idRemap })
				: localSerialized,
	});
	// 绑定云端快照：此后该工程的改动会由后台自动同步回同一个快照
	bindSnapshot(localId, { id: snapshot.id, rev: snapshot.rev || 1 });

	onProgress?.("完成", 100);
	return {
		localProjectId: localId,
		missing,
		imported,
	};
}
