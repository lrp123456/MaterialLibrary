"use client";

import { useEffect, useRef } from "react";
import { useEditor } from "@/editor/use-editor";
import { processMediaAssets } from "@/media/processing";
import { registerMediaFid } from "@/services/cloud-snapshots";
import { buildElementFromMedia } from "@/timeline/element-utils";
import { DEFAULT_NEW_ELEMENT_DURATION } from "@/timeline/creation";
import { mediaTimeFromSeconds } from "@/wasm";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

export interface MlsAssetPayload {
	fid: string;
	file_name: string;
	mime?: string;
	duration?: number;
	/** 衍生版本 id；为空表示原图 */
	derivativeId?: string;
	/** 素材库详情页的旧字段名，兼容「素材库 → 送入剪辑」路径 */
	activeDerivativeId?: string;
	kind?: string;
	[key: string]: unknown;
}

const PENDING_STORAGE_KEY = "mls_pending_import_asset";
const IMPORT_QUERY_KEY = "import";

/**
 * 从地址栏读取待导入素材（App 的 WebView 无法向 iframe 发 postMessage，只能走 URL）。
 * 读取后立刻从地址栏摘掉，刷新或返回时不会重复导入。
 */
function consumeUrlImportAssets(): MlsAssetPayload[] {
	if (typeof window === "undefined") return [];
	const params = new URLSearchParams(window.location.search);
	const raw = params.getAll(IMPORT_QUERY_KEY);
	if (!raw.length) return [];

	const list: MlsAssetPayload[] = [];
	for (const item of raw) {
		try {
			const parsed = JSON.parse(item);
			list.push(...(Array.isArray(parsed) ? parsed : [parsed]));
		} catch {
			/* 坏参数直接忽略，不阻断进入编辑器 */
		}
	}

	const url = new URL(window.location.href);
	url.searchParams.delete(IMPORT_QUERY_KEY);
	window.history.replaceState(
		null,
		"",
		`${url.pathname}${url.search}${url.hash}`,
	);

	return list.filter(
		(asset) => asset && typeof asset === "object" && asset.fid,
	) as MlsAssetPayload[];
}

/** 判定素材 mime：响应头优先，其次载荷声明，再按 kind/扩展名兜底。 */
function resolveMediaMime(blobType: string, payload: MlsAssetPayload): string {
	const fromBlob = String(blobType || "").split(";")[0].trim().toLowerCase();
	if (/^(image|video|audio)\//.test(fromBlob)) return fromBlob;

	const declared = String(payload.mime || "").split(";")[0].trim().toLowerCase();
	if (/^(image|video|audio)\//.test(declared)) return declared;

	const kind = String(payload.kind || "").toLowerCase();
	if (kind === "image") return "image/jpeg";
	if (kind === "audio") return "audio/mpeg";
	if (kind === "video") return "video/mp4";

	const ext = (String(payload.file_name || "").toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || "");
	const byExt: Record<string, string> = {
		jpg: "image/jpeg",
		jpeg: "image/jpeg",
		png: "image/png",
		webp: "image/webp",
		gif: "image/gif",
		mp4: "video/mp4",
		webm: "video/webm",
		mov: "video/quicktime",
		mp3: "audio/mpeg",
		wav: "audio/wav",
		m4a: "audio/mp4",
	};
	return byExt[ext] || "";
}

/**
 * Material Studio Pro 通信桥梁：
 * 负责接收父窗口派发的 MLS_IMPORT_ASSET 消息，并完成素材下载、OPFS 写入、FID 绑定与自动上轨。
 * 支持批量：消息携带 assets 数组时按顺序逐个导入（素材库多选 → 进入剪辑）。
 */
export function MlsBridge() {
	const editor = useEditor();
	const router = useRouter();
	const activeProject = useEditor((e) => e.project.getActiveOrNull());
	const isHandlingRef = useRef(false);

	// 单体导入核心：下载 → 解码 → 入库 → 绑定 FID → 上轨。失败直接抛错，由调用方决定提示方式。
	const importOneAsset = async (payload: MlsAssetPayload, projectId: string) => {
		if (!payload?.fid) {
			throw new Error("素材信息不完整，无法导入");
		}
		const derivativeId = String(
			payload.derivativeId || payload.activeDerivativeId || "",
		);

		// 1. 获取素材二进制
		const token = localStorage.getItem("ml_token") || "";
		const headers: Record<string, string> = {};
		if (token) headers.Authorization = `Bearer ${token}`;

		const downloadBase = `/api/viewer/assets/${encodeURIComponent(payload.fid)}/file`;
		const downloadUrl = derivativeId
			? `${downloadBase}?derivative=${encodeURIComponent(derivativeId)}`
			: downloadBase;
		const res = await fetch(downloadUrl, { headers });
		if (!res.ok) {
			throw new Error(`下载素材失败 (HTTP ${res.status})`);
		}
		const blob = await res.blob();
		const mime = resolveMediaMime(blob.type, payload);
		if (!mime) throw new Error("无法识别素材类型");
		const file = new File([blob], payload.file_name, {
			type: mime,
		});

		// 2. 原生解码与 OPFS 写入
		const processedAssets = await processMediaAssets({ files: [file] });
		if (!processedAssets.length) {
			throw new Error("素材解码失败");
		}

		// processMediaAssets 返回的资产没有 id，必须使用入库后的返回值（带 id），
		// 否则 mediaId 为 undefined，时间轴渲染会直接抛错导致整页白屏。
		const created = await editor.media.addMediaAsset({
			projectId,
			asset: processedAssets[0],
		});
		if (!created) throw new Error("素材写入本地存储失败");

		// 3. 关联云端 FID
		registerMediaFid(created.id, payload.fid, derivativeId);

		// 4. 自动加入时间轴
		const duration =
			created.duration != null
				? mediaTimeFromSeconds({ seconds: created.duration })
				: DEFAULT_NEW_ELEMENT_DURATION;

		const element = buildElementFromMedia({
			mediaId: created.id,
			mediaType: created.type,
			name: created.name,
			duration,
			startTime: editor.playback.getCurrentTime(),
		});

		editor.timeline.insertElement({
			element,
			placement: { mode: "auto" },
		});
	};

	// 单体导入（自带 loading / 成功 / 失败 toast）：单件送入与旧行为完全一致
	const handleImportPayload = async (payload: MlsAssetPayload, projectId: string) => {
		if (!payload?.fid) {
			toast.error("素材信息不完整，无法导入");
			return;
		}
		if (isHandlingRef.current) return;
		isHandlingRef.current = true;
		const toastId = toast.loading(`正在从素材库加载「${payload.file_name}」...`);

		try {
			await importOneAsset(payload, projectId);
			toast.success(`素材「${payload.file_name}」已自动载入并插入时间轴`, { id: toastId });
		} catch (err) {
			console.error("[MlsBridge Error]", err);
			toast.error(`加载素材失败: ${err instanceof Error ? err.message : "未知错误"}`, { id: toastId });
		} finally {
			isHandlingRef.current = false;
		}
	};

	// 批量导入（素材库多选）：一个汇总 toast 顺序导入，单个失败不中断整批
	const importAssetBatch = async (list: MlsAssetPayload[], projectId: string) => {
		if (isHandlingRef.current) return;
		isHandlingRef.current = true;
		const toastId = toast.loading(`正在从素材库批量加载 ${list.length} 个素材…`);
		let done = 0;
		const failed: string[] = [];
		try {
			for (const payload of list) {
				if (!payload?.fid) continue;
				try {
					await importOneAsset(payload, projectId);
					done += 1;
					toast.loading(`正在导入素材…（${done}/${list.length}）`, { id: toastId });
				} catch (err) {
					console.error("[MlsBridge Batch Error]", payload.fid, err);
					failed.push(payload.file_name || String(payload.fid));
				}
			}
			if (failed.length) {
				toast.error(
					`${done} 个素材已插入时间轴，${failed.length} 个失败：${failed.slice(0, 3).join("、")}${failed.length > 3 ? " 等" : ""}`,
					{ id: toastId },
				);
			} else {
				toast.success(`${done} 个素材已全部载入并插入时间轴`, { id: toastId });
			}
		} finally {
			isHandlingRef.current = false;
		}
	};

	// 把一条 MLS_IMPORT_ASSET 消息规整为有效资产数组：批量取 assets，单体回退 asset
	const assetsFromMessage = (data: Record<string, unknown>): MlsAssetPayload[] => {
		const raw = Array.isArray(data.assets)
			? (data.assets as MlsAssetPayload[])
			: data.asset
				? [data.asset as MlsAssetPayload]
				: [];
		return raw.filter((a) => a && typeof a === "object" && a.fid);
	};

	useEffect(() => {
		// 0. App WebView 入口：地址栏 ?import=<json>（单体或数组）。
		// 编辑器页首帧工程还没加载完，必须等 activeProject 就绪，否则会误判成"从列表页进来"而新建工程。
		const isProjectsListPage =
			typeof window !== "undefined" &&
			/\/editor\/projects\/?$/.test(window.location.pathname);
		const urlAssets =
			activeProject || isProjectsListPage ? consumeUrlImportAssets() : [];
		if (urlAssets.length) {
			if (activeProject) {
				if (urlAssets.length === 1) {
					void handleImportPayload(urlAssets[0], activeProject.metadata.id);
				} else {
					void importAssetBatch(urlAssets, activeProject.metadata.id);
				}
			} else {
				// 工程列表页：先用暂存 + 新建工程，再由编辑器页消费
				try {
					sessionStorage.setItem(
						PENDING_STORAGE_KEY,
						JSON.stringify(urlAssets),
					);
					void editor.project
						.createNewProject({
							name: urlAssets[0].file_name
								? `剪辑 · ${urlAssets[0].file_name}`
								: "新建剪辑工程",
						})
						.then((newProjectId) => router.push(`/editor/${newProjectId}`))
						.catch(() => toast.error("自动创建剪辑工程失败"));
				} catch {
					toast.error("自动创建剪辑工程失败");
				}
			}
		}

		// 1. 检查是否存在待消费的暂存素材（比如从列表页刚跳过来；批量为数组，逐个导入）
		if (activeProject) {
			try {
				const pending = sessionStorage.getItem(PENDING_STORAGE_KEY);
				if (pending) {
					sessionStorage.removeItem(PENDING_STORAGE_KEY);
					const parsed = JSON.parse(pending);
					const list = (Array.isArray(parsed) ? parsed : [parsed]).filter(
						(p: MlsAssetPayload) => p && p.fid,
					) as MlsAssetPayload[];
					if (list.length === 1) {
						void handleImportPayload(list[0], activeProject.metadata.id);
					} else if (list.length > 1) {
						void importAssetBatch(list, activeProject.metadata.id);
					}
				}
			} catch {
				/* ignore */
			}
		}

		// 2. 监听来自主系统的 postMessage
		const onMessage = async (event: MessageEvent) => {
			if (!event.data || typeof event.data !== "object") return;
			if (event.data.type === "MLS_IMPORT_ASSET") {
				const list = assetsFromMessage(event.data as Record<string, unknown>);
				if (!list.length) return;

				if (activeProject) {
					// 已经在工程中：单体走原路径（保留逐件 toast），批量顺序导入
					if (list.length === 1) {
						void handleImportPayload(list[0], activeProject.metadata.id);
					} else {
						void importAssetBatch(list, activeProject.metadata.id);
					}
				} else {
					// 当前处于工程列表页，自动创建新工程并跳转，整批暂存待消费
					try {
						sessionStorage.setItem(PENDING_STORAGE_KEY, JSON.stringify(list));
						const newProjectId = await editor.project.createNewProject({
							name: list[0].file_name ? `剪辑 · ${list[0].file_name}` : "新建剪辑工程",
						});
						router.push(`/editor/${newProjectId}`);
					} catch (e) {
						toast.error("自动创建剪辑工程失败");
					}
				}
			}
		};

		window.addEventListener("message", onMessage);
		return () => window.removeEventListener("message", onMessage);
	}, [activeProject, editor, router]);

	return null;
}
