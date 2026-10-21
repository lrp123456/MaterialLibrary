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

/**
 * Material Studio Pro 通信桥梁：
 * 负责接收父窗口派发的 MLS_IMPORT_ASSET 消息，并完成素材下载、OPFS 写入、FID 绑定与自动上轨。
 */
export function MlsBridge() {
	const editor = useEditor();
	const router = useRouter();
	const activeProject = useEditor((e) => e.project.getActiveOrNull());
	const isHandlingRef = useRef(false);

	const handleImportPayload = async (payload: MlsAssetPayload, projectId: string) => {
		if (isHandlingRef.current) return;
		isHandlingRef.current = true;
		const derivativeId = String(
			payload.derivativeId || payload.activeDerivativeId || "",
		);
		const mime = payload.mime
			|| (payload.kind === "image" ? "image/jpeg"
				: payload.kind === "audio" ? "audio/mpeg"
					: "video/mp4");
		const toastId = toast.loading(`正在从素材库加载「${payload.file_name}」...`);

		try {
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

			toast.success(`素材「${payload.file_name}」已自动载入并插入时间轴`, { id: toastId });
		} catch (err) {
			console.error("[MlsBridge Error]", err);
			toast.error(`加载素材失败: ${err instanceof Error ? err.message : "未知错误"}`, { id: toastId });
		} finally {
			isHandlingRef.current = false;
		}
	};

	useEffect(() => {
		// 1. 检查是否存在待消费的暂存素材（比如从列表页刚跳过来）
		if (activeProject) {
			try {
				const pending = sessionStorage.getItem(PENDING_STORAGE_KEY);
				if (pending) {
					sessionStorage.removeItem(PENDING_STORAGE_KEY);
					const payload = JSON.parse(pending) as MlsAssetPayload;
					void handleImportPayload(payload, activeProject.metadata.id);
				}
			} catch {
				/* ignore */
			}
		}

		// 2. 监听来自主系统的 postMessage
		const onMessage = async (event: MessageEvent) => {
			if (!event.data || typeof event.data !== "object") return;
			if (event.data.type === "MLS_IMPORT_ASSET" && event.data.asset) {
				const asset = event.data.asset as MlsAssetPayload;
				if (!asset.fid) return;

				if (activeProject) {
					// 已经在工程中，直接入库并上轨
					void handleImportPayload(asset, activeProject.metadata.id);
				} else {
					// 当前处于工程列表页，自动创建新工程并跳转
					try {
						sessionStorage.setItem(PENDING_STORAGE_KEY, JSON.stringify(asset));
						const newProjectId = await editor.project.createNewProject({
							name: asset.file_name ? `剪辑 · ${asset.file_name}` : "新建剪辑工程",
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
