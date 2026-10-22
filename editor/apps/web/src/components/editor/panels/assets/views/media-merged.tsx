"use client";

/**
 * media 栏「统一列表」的数据层：本地媒体与云端素材合并、云端项按需下载。
 *
 * 约束（见 docs/clip/功能补全-执行方案.md 第 4 节）：
 * - 本地 IndexedDB + OPFS 是唯一编辑入口，云端 clip-assets 只是只读仓库；
 * - 两边靠 fid 对齐：本地 mediaId 通过 cloud-snapshots 的 fid 映射换算出 fid；
 * - 云端项不在素材池里，只有拖到时间线时才下载，因此需要「占位元素」这一层。
 *
 * 占位元素怎么来的：时间线的 drop 控制器会按 dragData.id 去 media 池里找素材，
 * 找不到就整段放弃落点。所以拖拽开始前我们把云端项临时挂成一条 ephemeral 媒体
 * （id 就是 pendingMediaId，等价于 pendingFid），让控制器能正常算出轨道、时长并落元素；
 * 落地后再把这条临时媒体摘掉，元素上留着的 pendingMediaId 就是"待替换"标记。
 */

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import type { EditorCore } from "@/core";
import type { MaterialAssetItem } from "@/components/editor/asset-library-picker-modal";
import type { MediaSortKey, MediaSortOrder } from "@/components/editor/panels/assets/assets-panel-store";
import type { MediaAsset } from "@/media/types";
import type { TimelineElement } from "@/timeline";
import type { MediaTime } from "@/wasm";
import { processMediaAssets } from "@/media/processing";
import { DEFAULT_NEW_ELEMENT_DURATION, toElementDurationTicks } from "@/timeline/creation";
import { buildElementFromMedia } from "@/timeline/element-utils";
import { getMediaFid, registerMediaFid } from "@/services/cloud-snapshots";
import { snapshotDownloadPath } from "@/services/cloud-snapshots/fid-ref";

/* ------------------------------------------------------------------ */
/* 云端鉴权：素材库侧栏、云端大窗、统一列表共用同一套取值逻辑            */
/* ------------------------------------------------------------------ */

export function getAuthToken(): string {
	try {
		if (typeof window === "undefined") return "";
		const params = new URLSearchParams(window.location.search);
		const urlToken = params.get("token") || params.get("ml_token");
		if (urlToken) {
			localStorage.setItem("ml_token", urlToken);
			return urlToken;
		}
		const stored = localStorage.getItem("ml_token") || localStorage.getItem("token");
		if (stored) return stored;
		const match = document.cookie.match(/(?:^|;\s*)ml_token=([^;]+)/);
		if (match) return match[1];
	} catch {
		/* localStorage 被禁用时按未登录处理 */
	}
	return "";
}

export function authHeaders(): Record<string, string> {
	const h: Record<string, string> = {};
	const token = getAuthToken();
	if (token) h.Authorization = `Bearer ${token}`;
	return h;
}

/* ------------------------------------------------------------------ */
/* 云端列表                                                            */
/* ------------------------------------------------------------------ */

/** 云端列表错误：authRequired 的失败只走面板内联提示，不弹全局 toast。 */
export class CloudAssetsError extends Error {
	readonly authRequired: boolean;

	constructor({ message, authRequired = false }: { message: string; authRequired?: boolean }) {
		super(message);
		this.name = "CloudAssetsError";
		this.authRequired = authRequired;
	}
}

/** 拉取云端素材列表。失败直接抛中文错误，调用方只负责 toast。 */
export async function fetchCloudAssets({
	query,
}: {
	query: Record<string, string>;
}): Promise<MaterialAssetItem[]> {
	const search = new URLSearchParams(query).toString();
	const res = await fetch(`/api/viewer/assets?${search}`, { headers: authHeaders() });

	if (!res.ok) {
		if (res.status === 401) {
			throw new CloudAssetsError({
				message: "未登录或会话已过期，请在主系统刷新",
				authRequired: true,
			});
		}
		throw new CloudAssetsError({ message: `拉取失败 (HTTP ${res.status})` });
	}

	const json = await res.json();
	const rawList = (json?.data?.items || json?.items || []) as any[];
	const total =
		Number(json?.data?.total ?? json?.total ?? rawList.length) || rawList.length;
	const token = getAuthToken();

	const list = rawList.map((it) => {
		const kind = it.kind || (it.category === "music" ? "audio" : "image");
		const tokenQ = token ? `?token=${encodeURIComponent(token)}` : "";
		/*
		 * 缩略图一律走后端端点（poster/image，带 token），不再使用 it.thumb_url。
		 * 原因：网盘同步类素材（Camera_XHS、FB_IMG 等）的 thumb_url 存的是
		 * 夸克网盘分享页链接（open-api-drive.quark.cn/s/...），是网页不是图片，
		 * <img> 渲染不出内容——这就是"云素材大量不可见"的根因。
		 * 后端 poster/image 端点由服务端代理生成真正的缩略图。
		 */
		const thumb =
			kind === "video"
				? `/api/viewer/assets/${encodeURIComponent(it.fid)}/poster${tokenQ}`
				: kind === "audio"
					? ""
					: `/api/viewer/assets/${encodeURIComponent(it.fid)}/image${tokenQ}`;

		return {
			fid: it.fid,
			file_name: it.file_name || it.fileName || "未命名素材",
			kind,
			mime:
				it.mime ||
				(kind === "video"
					? "video/mp4"
					: kind === "audio"
						? "audio/mpeg"
						: "image/jpeg"),
			size: it.size || 0,
			duration: it.duration_s || it.duration || 0,
			width: it.width,
			height: it.height,
			thumb_url: thumb,
		} as MaterialAssetItem;
	});

	// 分页元信息挂在数组上（保持数组返回形状，library 视图零改动）
	(list as any).__total = total;
	(list as any).__page = Number(new URLSearchParams(search).get("page")) || 1;
	return list;
}

/** 云端列表的故障提示只弹一次（视图会随 chip 切换反复挂载）。 */
let cloudErrorNotified = false;

/** 统一列表挂载时拉一次云端目录；带 token 握手事件与失败重试。 */
export function useCloudMediaList() {
	/** 后端单页上限是 100（api.js: Math.min(100, pageSize)），按 100 拉满 */
	const PAGE_SIZE = 100;
	const [items, setItems] = useState<MaterialAssetItem[]>([]);
	const [total, setTotal] = useState(0);
	const [isLoading, setIsLoading] = useState(false);
	const [isLoadingMore, setIsLoadingMore] = useState(false);
	const [error, setError] = useState("");

	const fetchPage = useCallback(async (page: number, append: boolean) => {
		if (append) setIsLoadingMore(true);
		else setIsLoading(true);
		setError("");
		try {
			const list = await fetchCloudAssets({
				query: { pageSize: String(PAGE_SIZE), page: String(page) },
			});
			cloudErrorNotified = false;
			setTotal(Number((list as any).__total) || 0);
			setItems((prev) => (append ? [...prev, ...list] : list));
		} catch (err) {
			const message = err instanceof Error ? err.message : "未知错误";
			setError(message);
			if (!append) setItems([]);
			// 未登录时面板内联状态条已经说清楚了，不必再弹红条；
			// 切二级 chip 会重新挂载本视图，同一次故障也只提示一次。
			const authRequired = err instanceof CloudAssetsError && err.authRequired;
			if (!authRequired && !cloudErrorNotified) {
				cloudErrorNotified = true;
				toast.error(`云端素材加载失败：${message}`);
			}
		} finally {
			setIsLoading(false);
			setIsLoadingMore(false);
		}
	}, []);

	const reload = useCallback(() => fetchPage(1, false), [fetchPage]);

	const loadMore = useCallback(() => {
		if (isLoading || isLoadingMore) return;
		if (items.length === 0 || (total > 0 && items.length >= total)) return;
		void fetchPage(Math.floor(items.length / PAGE_SIZE) + 1, true);
	}, [fetchPage, isLoading, isLoadingMore, items.length, total]);

	useEffect(() => {
		void reload();
	}, [reload]);

	// 主系统可能晚一拍把 token 递进来，收到握手事件后补拉一次
	useEffect(() => {
		const onTokenUpdated = () => {
			void reload();
		};
		window.addEventListener("mls_token_updated", onTokenUpdated);
		return () => window.removeEventListener("mls_token_updated", onTokenUpdated);
	}, [reload]);

	return { items, total, isLoading, isLoadingMore, error, reload, loadMore };
}

/* ------------------------------------------------------------------ */
/* 云端素材下载（唯一实现，library 视图与统一列表都走这里）              */
/* ------------------------------------------------------------------ */

/**
 * 把一个云端素材拉成本地媒体资产：下载 → 本地解码入库 → 记录 fid 映射。
 * 不做 toast，调用方决定提示方式（素材库用上传进度条，统一列表用轻提示）。
 */
export async function downloadCloudAssetToLocal({
	editor,
	projectId,
	item,
}: {
	editor: EditorCore;
	projectId: string;
	item: MaterialAssetItem;
}): Promise<MediaAsset> {
	const resp = await fetch(snapshotDownloadPath(item.fid), {
		headers: authHeaders(),
	});
	if (!resp.ok) {
		throw new Error(`下载失败 (HTTP ${resp.status})`);
	}

	const blob = await resp.blob();
	const file = new File([blob], item.file_name, { type: blob.type || item.mime || "video/mp4" });
	const processed = await processMediaAssets({ files: [file] });
	const asset = processed[0];
	if (!asset) {
		throw new Error("素材解码失败，浏览器可能不支持该编码");
	}

	const created = await editor.media.addMediaAsset({ projectId, asset });
	if (!created) {
		throw new Error("素材入库失败（本地存储可能已满）");
	}

	// 只有入库成功后才有 mediaId，fid 映射必须绑在真实 id 上
	registerMediaFid(created.id, item.fid, "");
	return created;
}

// 同一个 fid 并发拖两次只下载一份
const inFlightDownloads = new Map<string, Promise<MediaAsset>>();

export function downloadCloudAssetOnce({
	editor,
	projectId,
	item,
}: {
	editor: EditorCore;
	projectId: string;
	item: MaterialAssetItem;
}): Promise<MediaAsset> {
	const key = `${projectId}:${item.fid}`;
	const existing = inFlightDownloads.get(key);
	if (existing) return existing;

	const task = downloadCloudAssetToLocal({ editor, projectId, item }).finally(() => {
		inFlightDownloads.delete(key);
	});
	inFlightDownloads.set(key, task);
	return task;
}

/* ------------------------------------------------------------------ */
/* 占位元素：pendingFid ↔ 临时 mediaId                                  */
/* ------------------------------------------------------------------ */

const PENDING_MEDIA_PREFIX = "cloud-pending:";

/** 占位元素的 mediaId：由 fid 派生，既能去重也等于 pendingFid。 */
export function pendingMediaIdForFid({ fid }: { fid: string }): string {
	return `${PENDING_MEDIA_PREFIX}${fid}`;
}

function pendingClipName({ item }: { item: MaterialAssetItem }): string {
	return `下载中 · ${item.file_name}`;
}

/** 图片没有可靠时长，统一落默认 5s；视频/音频用云端上报时长。 */
function pendingDurationSeconds({ item }: { item: MaterialAssetItem }): number | undefined {
	if (item.kind === "image") return undefined;
	return item.duration && item.duration > 0 ? item.duration : undefined;
}

/**
 * 拖拽开始前挂一条临时媒体（只在内存里，不落库）。
 * drop 控制器靠它拿到媒体类型与时长，否则会直接放弃落点。
 */
export function registerPendingMediaAsset({
	editor,
	item,
	mediaId,
}: {
	editor: EditorCore;
	item: MaterialAssetItem;
	mediaId: string;
}): void {
	const assets = editor.media.getAssets();
	if (assets.some((asset) => asset.id === mediaId)) return;

	const placeholder: MediaAsset = {
		id: mediaId,
		name: pendingClipName({ item }),
		type: item.kind,
		duration: pendingDurationSeconds({ item }),
		ephemeral: true,
		file: new File([], item.file_name, { type: item.mime || "" }),
	};

	editor.media.setAssets({ assets: [...assets, placeholder] });
}

/** 把临时媒体摘掉，避免它出现在素材池列表里（再次读当前数组，防止覆盖并发写入）。 */
export function releasePendingMediaAsset({
	editor,
	mediaId,
}: {
	editor: EditorCore;
	mediaId: string;
}): void {
	const assets = editor.media.getAssets();
	if (!assets.some((asset) => asset.id === mediaId)) return;
	editor.media.setAssets({ assets: assets.filter((asset) => asset.id !== mediaId) });
}

/** 找出引用了某个 mediaId 的全部时间线元素（占位、或已替换后的同一元素）。 */
function findElementsByMediaId({
	editor,
	mediaId,
}: {
	editor: EditorCore;
	mediaId: string;
}): { trackId: string; elementId: string }[] {
	const scene = editor.scenes.getActiveSceneOrNull();
	if (!scene) return [];

	const tracks = [scene.tracks.main, ...scene.tracks.overlay, ...scene.tracks.audio];
	const found: { trackId: string; elementId: string }[] = [];
	for (const track of tracks) {
		for (const element of track.elements) {
			if ("mediaId" in element && element.mediaId === mediaId) {
				found.push({ trackId: track.id, elementId: element.id });
			}
		}
	}
	return found;
}

/**
 * 时间线上是否已经有引用该 pendingId 的占位元素。
 * 拖拽结束时用它判断"这一拖到底落没落在时间线上"，没落就不用下载。
 */
export function hasPendingCloudElement({
	editor,
	mediaId,
}: {
	editor: EditorCore;
	mediaId: string;
}): boolean {
	return findElementsByMediaId({ editor, mediaId }).length > 0;
}

/**
 * 占位落地后的收尾：下载 → 把占位元素的 mediaId 换成真实 mediaId。
 *
 * 时序：
 * 1. 先确认时间线上确实有这个占位（拖到面板/预览区等落点之外时不会产生占位，直接返回）；
 * 2. 下载失败 → 删除占位 + toast，绝不留一个下载不完的空片段；
 * 3. 下载成功 → 重新按 mediaId 找一次元素（下载期间用户可能已经撤销掉它）；
 * 4. 找到就 patch mediaId，找不到就把素材留给素材池并提示。
 *
 * 撤销粒度：占位插入是 drop 自己产生的一步历史，替换/回滚各自是独立的一步，
 * 因此 undo 一次回到"下载中的占位"，再 undo 一次整段消失，不会卡在中间态。
 */
export async function resolvePendingCloudElement({
	editor,
	mediaId,
	item,
}: {
	editor: EditorCore;
	mediaId: string;
	item: MaterialAssetItem;
}): Promise<void> {
	const placeholders = findElementsByMediaId({ editor, mediaId });
	if (placeholders.length === 0) return;

	const projectId = editor.project.getActiveOrNull()?.metadata.id;
	if (!projectId) {
		editor.timeline.deleteElements({ elements: placeholders });
		toast.error("当前没有打开的工程，无法下载云端素材");
		return;
	}

	let created: MediaAsset;
	try {
		created = await downloadCloudAssetOnce({ editor, projectId, item });
	} catch (err) {
		editor.timeline.deleteElements({ elements: placeholders });
		toast.error(
			`下载「${item.file_name}」失败：${err instanceof Error ? err.message : "未知错误"}`,
		);
		return;
	}

	// 下载期间用户可能撤销/删掉了占位，这里以最新状态为准
	const targets = findElementsByMediaId({ editor, mediaId });
	if (targets.length === 0) {
		toast.success(`「${item.file_name}」已下载到素材池`);
		return;
	}

	const patch: Partial<TimelineElement> = {
		mediaId: created.id,
		name: created.name,
	} as Partial<TimelineElement>;
	// 视频的真实时长通常比云端上报的准，顺手把片段长度对齐
	if (created.type === "video" && created.duration) {
		const duration = toElementDurationTicks({ seconds: created.duration });
		patch.duration = duration;
		patch.sourceDuration = duration;
	}

	editor.timeline.updateElements({
		updates: targets.map((target) => ({ ...target, patch })),
	});
	toast.success(`「${item.file_name}」已下载并落到时间线`);
}

/**
 * 加号按钮路径：直接按当前播放头落占位再下载，不经过 HTML5 拖拽。
 * 与拖拽路径共用「占位 → 下载 → 替换」同一套收尾逻辑。
 */
export async function insertPendingCloudElement({
	editor,
	item,
	startTime,
}: {
	editor: EditorCore;
	item: MaterialAssetItem;
	startTime: MediaTime;
}): Promise<void> {
	const mediaId = pendingMediaIdForFid({ fid: item.fid });
	const duration =
		item.duration && item.duration > 0
			? toElementDurationTicks({ seconds: item.duration })
			: DEFAULT_NEW_ELEMENT_DURATION;

	editor.timeline.insertElement({
		element: buildElementFromMedia({
			mediaId,
			mediaType: item.kind,
			name: pendingClipName({ item }),
			duration,
			startTime,
		}),
		placement: { mode: "auto" },
	});

	await resolvePendingCloudElement({ editor, mediaId, item });
}

/* ------------------------------------------------------------------ */
/* 合并规则                                                            */
/* ------------------------------------------------------------------ */

export type MergedMediaRow =
	| { origin: "local"; key: string; asset: MediaAsset }
	| { origin: "cloud"; key: string; item: MaterialAssetItem };

/** 云端项在列表里的可选中 id（本地项直接用 mediaId）。 */
export function cloudRowSelectionId({ fid }: { fid: string }): string {
	return `cloud:${fid}`;
}

function rowSortValue({
	row,
	sortBy,
}: {
	row: MergedMediaRow;
	sortBy: MediaSortKey;
}): string | number {
	if (row.origin === "local") {
		const asset = row.asset;
		switch (sortBy) {
			case "name":
				return asset.name.toLowerCase();
			case "type":
				return asset.type;
			case "duration":
				return asset.duration ?? 0;
			case "size":
				return asset.file.size;
		}
	}

	const item = row.origin === "cloud" ? row.item : null;
	if (!item) return 0;
	switch (sortBy) {
		case "name":
			return item.file_name.toLowerCase();
		case "type":
			return item.kind;
		case "duration":
			return item.duration ?? 0;
		case "size":
			return item.size;
	}
}

/**
 * 合并本地与云端，返回可直接渲染的行。
 *
 * 去重键：fid。
 * - 本地素材的 fid 来自 mediaId → fid 映射（getMediaFid），没有映射的本地素材用 mediaId 兜底；
 * - 云端项的 fid 就是它自己的 fid，只要本地已经存在同 fid 的素材，云端行就不再出现，
 *   因此"下载过的素材"会自然从云端行变成本地行，不需要额外的下载状态表。
 *
 * media 栏只放画面元素，云端音频不进这个列表（音频有独立的 audio 栏）。
 */
export function mergeMediaRows({
	localAssets,
	cloudItems,
	filter,
	sortBy,
	sortOrder,
}: {
	localAssets: MediaAsset[];
	cloudItems: MaterialAssetItem[];
	filter: "all" | "image" | "video";
	sortBy: MediaSortKey;
	sortOrder: MediaSortOrder;
}): MergedMediaRow[] {
	const rows: MergedMediaRow[] = [];
	const localFids = new Set<string>();

	for (const asset of localAssets) {
		// 占位用的临时媒体不进列表
		if (asset.ephemeral) continue;
		if (filter !== "all" && asset.type !== filter) continue;

		const fid = getMediaFid(asset.id);
		if (fid) localFids.add(fid);
		rows.push({
			origin: "local",
			key: fid ? `fid:${fid}` : `media:${asset.id}`,
			asset,
		});
	}

	for (const item of cloudItems) {
		if (item.kind !== "image" && item.kind !== "video") continue;
		if (filter !== "all" && item.kind !== filter) continue;
		if (localFids.has(item.fid)) continue;

		rows.push({ origin: "cloud", key: `fid:${item.fid}`, item });
	}

	rows.sort((a, b) => {
		const valueA = rowSortValue({ row: a, sortBy });
		const valueB = rowSortValue({ row: b, sortBy });
		if (valueA < valueB) return sortOrder === "asc" ? -1 : 1;
		if (valueA > valueB) return sortOrder === "asc" ? 1 : -1;
		return 0;
	});

	return rows;
}
