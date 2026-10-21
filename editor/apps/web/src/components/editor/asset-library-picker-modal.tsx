"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useEditor } from "@/editor/use-editor";
import { processMediaAssets } from "@/media/processing";
import { registerMediaFid } from "@/services/cloud-snapshots";
import { buildElementFromMedia } from "@/timeline/element-utils";
import { DEFAULT_NEW_ELEMENT_DURATION } from "@/timeline/creation";
import { mediaTimeFromSeconds } from "@/wasm";
import { toast } from "sonner";
import {
	Search01Icon,
	FolderUploadIcon,
	CheckmarkCircle02Icon,
	Video01Icon,
	MusicNote03Icon,
	Image02Icon,
	FilterIcon,
	Loading03Icon,
	RefreshIcon,
	AlertCircleIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "@/utils/ui";
import {
	isSelected as isVersionSelected,
	toggleSelection,
	versionsOf,
	type AssetLike,
	type AssetVersion,
	type DerivativeLike,
} from "../../../../../../shared/ml-asset-core/index";

export interface MaterialAssetItem {
	fid: string;
	file_name: string;
	kind: "video" | "audio" | "image";
	mime: string;
	size: number;
	duration?: number;
	thumb_url?: string;
	width?: number;
	height?: number;
}

export interface AssetLibraryPickerModalProps {
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
	/** 本地文件上传回调（可选，若用户选用本地上传出口） */
	onLocalFilesSelected?: (files: File[]) => void;
	/** 是否直接一键上轨 */
	directInsertTimeline?: boolean;
}

// 模拟主系统四大板块
const SHELF_PLATES = [
	{ key: "all", label: "全部板块" },
	{ key: "interior_exterior", label: "空间案例库" },
	{ key: "walkthrough", label: "漫游实景" },
	{ key: "finished", label: "成品视频库" },
	{ key: "render", label: "精修/AI创作" },
] as const;

// 常用高频空间与设计标签
const SPACE_TAGS = ["全部空间", "客厅", "卧室", "厨房", "餐厅", "卫生间", "玄关", "阳台", "书房"];

function getAuthToken(): string {
	try {
		if (typeof window === "undefined") return "";
		const params = new URLSearchParams(window.location.search);
		const urlToken = params.get("token") || params.get("ml_token");
		if (urlToken) {
			localStorage.setItem("ml_token", urlToken);
			return urlToken;
		}
		const t = localStorage.getItem("ml_token") || localStorage.getItem("token");
		if (t) return t;
		const match = document.cookie.match(/(?:^|;\s*)ml_token=([^;]+)/);
		if (match) return match[1];
	} catch {
		/* ignore */
	}
	return "";
}

function authHeaders(): Record<string, string> {
	const h: Record<string, string> = {};
	const token = getAuthToken();
	if (token) h.Authorization = `Bearer ${token}`;
	return h;
}

function formatBytes(bytes: number): string {
	if (bytes === 0) return "0 B";
	const k = 1024;
	const sizes = ["B", "KB", "MB", "GB"];
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function toAssetLike(item: MaterialAssetItem): AssetLike {
	return {
		fid: item.fid,
		name: item.file_name,
		kind: item.kind,
		mediaToken: "",
		url: item.thumb_url || "",
	};
}

/** 剪辑器带 Bearer token，不走 media_token；原图必须 raw=1 才是真 origin。 */
function buildVersionUrls() {
	const token = getAuthToken();
	return {
		originUrl: (item: AssetLike) => {
			const q = new URLSearchParams();
			q.set("raw", "1");
			if (token) q.set("token", token);
			return `/api/viewer/assets/${encodeURIComponent(item.fid)}/image?${q.toString()}`;
		},
		derivativeUrl: (item: AssetLike, derivativeId: string) => {
			const q = new URLSearchParams();
			q.set("derivative", derivativeId);
			if (token) q.set("token", token);
			return `/api/viewer/assets/${encodeURIComponent(item.fid)}/image?${q.toString()}`;
		},
	};
}

/** 指定版本的字节下载地址；衍生版走后端已支持的 derivative 参数。 */
function buildDownloadPath(fid: string, derivativeId?: string): string {
	const base = `/api/viewer/assets/${encodeURIComponent(fid)}/file`;
	return derivativeId ? `${base}?derivative=${encodeURIComponent(derivativeId)}` : base;
}

/** 同名素材的原图与衍生版要能在媒体池里区分开。 */
function buildVersionFileName(version: AssetVersion): string {
	const name = version.name || version.fid;
	if (!version.derivativeId) return name;
	const dot = name.lastIndexOf(".");
	const suffix = `_${version.derivativeKind || version.derivativeId.slice(0, 8)}`;
	return dot > 0 ? `${name.slice(0, dot)}${suffix}${name.slice(dot)}` : `${name}${suffix}`;
}

export function AssetLibraryPickerModal({
	isOpen,
	onOpenChange,
	onLocalFilesSelected,
	directInsertTimeline = false,
}: AssetLibraryPickerModalProps) {
	const editor = useEditor();
	const activeProject = useEditor((e) => e.project.getActiveOrNull());
	const fileInputRef = useRef<HTMLInputElement>(null);

	const [items, setItems] = useState<MaterialAssetItem[]>([]);
	const [totalCount, setTotalCount] = useState<number>(0);
	const [loading, setLoading] = useState(false);
	const [fetchError, setFetchError] = useState<string>("");
	const [searchQuery, setSearchQuery] = useState("");
	const [activeShelf, setActiveShelf] = useState<string>("all");
	const [activeKind, setActiveKind] = useState<"all" | "video" | "audio" | "image">("all");
	const [selectedSpaceTag, setSelectedSpaceTag] = useState<string>("全部空间");
	// 版本级选中：key = fid 或 fid::derivativeId，同一素材的不同版本互不覆盖
	const [selectedVersions, setSelectedVersions] = useState<AssetVersion[]>([]);
	const [expandedFid, setExpandedFid] = useState<string>("");
	const [derivativeCache, setDerivativeCache] = useState<Record<string, DerivativeLike[]>>({});
	const [derivativeLoading, setDerivativeLoading] = useState<Record<string, boolean>>({});
	const [derivativeError, setDerivativeError] = useState<Record<string, string>>({});
	// 在途 fid：避免重复点击时并发拉同一份衍生详情
	const derivativeInFlight = useRef<Set<string>>(new Set());
	const [selectionNotice, setSelectionNotice] = useState<string>("");
	// 弹窗是一次性批量导入，实际不限制数量；传大值即等价于不限制
	const MAX_SELECT = 100;
	const [isSubmitting, setIsSubmitting] = useState(false);

	const loadAssets = useCallback(async () => {
		setLoading(true);
		setFetchError("");
		try {
			const q = new URLSearchParams();
			q.set("pageSize", "100");
			q.set("page", "1");

			if (searchQuery.trim()) {
				q.set("keyword", searchQuery.trim());
			}

			// 板块映射
			if (activeShelf === "interior_exterior") {
				q.set("category", "interior_exterior");
			} else if (activeShelf === "walkthrough") {
				q.set("media_type", "video");
			} else if (activeShelf === "finished") {
				q.set("shelf", "finished");
			} else if (activeShelf === "render") {
				q.set("shelf", "retouched");
			}

			// 媒体格式
			if (activeKind === "video") {
				q.set("media_type", "video");
			} else if (activeKind === "audio") {
				q.set("media_type", "music");
			} else if (activeKind === "image") {
				q.set("media_type", "image");
			}

			// 空间标签
			if (selectedSpaceTag !== "全部空间") {
				q.set("space", selectedSpaceTag);
			}

			const res = await fetch(`/api/viewer/assets?${q.toString()}`, {
				headers: authHeaders(),
			});

			if (res.ok) {
				const json = await res.json();
				// 后端规范统一在 json.data.items 中，此处做双重兼容
				const rawList = (json?.data?.items || json?.items || []) as any[];
				const token = getAuthToken();

				const processed: MaterialAssetItem[] = rawList.map((it) => {
					let thumb = it.thumb_url;
					if (!thumb) {
						if (it.kind === "video") {
							thumb = `/api/viewer/assets/${encodeURIComponent(it.fid)}/poster${token ? `?token=${encodeURIComponent(token)}` : ""}`;
						} else {
							thumb = `/api/viewer/assets/${encodeURIComponent(it.fid)}/image${token ? `?token=${encodeURIComponent(token)}` : ""}`;
						}
					} else if (token && !thumb.includes("token=")) {
						thumb += (thumb.includes("?") ? "&" : "?") + `token=${encodeURIComponent(token)}`;
					}

					return {
						fid: it.fid,
						file_name: it.file_name || it.fileName || "未命名素材",
						kind: it.kind || (it.category === "music" ? "audio" : "image"),
						mime: it.mime || (it.kind === "video" ? "video/mp4" : it.kind === "audio" ? "audio/mpeg" : "image/jpeg"),
						size: it.size || 0,
						duration: it.duration_s || it.duration || 0,
						width: it.width,
						height: it.height,
						thumb_url: thumb,
					};
				});

				setItems(processed);
				setTotalCount(json?.data?.total || json?.total || processed.length);
			} else if (res.status === 401) {
				setFetchError("未检测到有效登录凭据或会话已过期，请在主系统中重新登录。");
				setItems([]);
			} else {
				setFetchError(`拉取素材库失败 (HTTP ${res.status})`);
				setItems([]);
			}
		} catch (e: any) {
			setFetchError(`网络请求异常: ${e?.message || "请检查后端服务是否就绪"}`);
			setItems([]);
		} finally {
			setLoading(false);
		}
	}, [activeKind, activeShelf, selectedSpaceTag, searchQuery]);

	useEffect(() => {
		if (isOpen) {
			setSelectedVersions([]);
			setExpandedFid("");
			setSelectionNotice("");
			void loadAssets();
		}
	}, [isOpen, loadAssets]);

	// 监听 Token 跨帧同步就绪事件
	useEffect(() => {
		const handleTokenUpdated = () => {
			if (isOpen) void loadAssets();
		};
		window.addEventListener("mls_token_updated", handleTokenUpdated);
		return () => window.removeEventListener("mls_token_updated", handleTokenUpdated);
	}, [isOpen, loadAssets]);

	const itemHasSelection = (fid: string) => selectedVersions.some((v) => v.fid === fid);

	const versionCountBadge = (item: MaterialAssetItem) => {
		if (derivativeError[item.fid]) return "读取失败";
		const cached = derivativeCache[item.fid];
		if (!cached) return "1 版";
		const count = cached.filter((d) => d.kind !== "origin").length;
		return count > 0 ? `${count + 1} 版` : "1 版";
	};

	const toggleVersion = (item: MaterialAssetItem, version: AssetVersion) => {
		const res = toggleSelection(
			selectedVersions,
			{ ...version, name: version.name || item.file_name },
			MAX_SELECT,
		);
		setSelectedVersions(res.selected);
		setSelectionNotice(res.notice);
	};

	const ensureDerivatives = useCallback(async (item: MaterialAssetItem) => {
		if (!item.fid || item.kind !== "image") return;
		if (derivativeInFlight.current.has(item.fid)) return;
		if (Object.prototype.hasOwnProperty.call(derivativeCache, item.fid)) return;
		derivativeInFlight.current.add(item.fid);
		setDerivativeError((prev) => {
			const next = { ...prev };
			delete next[item.fid];
			return next;
		});
		setDerivativeLoading((prev) => ({ ...prev, [item.fid]: true }));
		try {
			const res = await fetch(`/api/viewer/assets/${encodeURIComponent(item.fid)}`, {
				headers: authHeaders(),
			});
			if (!res.ok) {
				setDerivativeError((prev) => ({ ...prev, [item.fid]: "读取衍生版本失败" }));
				return;
			}
			const json = await res.json();
			const detail = json?.data || json;
			const list = Array.isArray(detail?.derivatives) ? detail.derivatives : [];
			// 只有成功拿到详情才写缓存，失败不能被永久缓存成 []
			setDerivativeCache((prev) => ({ ...prev, [item.fid]: list }));
			setDerivativeError((prev) => {
				const next = { ...prev };
				delete next[item.fid];
				return next;
			});
		} catch {
			setDerivativeError((prev) => ({ ...prev, [item.fid]: "读取衍生版本失败" }));
		} finally {
			derivativeInFlight.current.delete(item.fid);
			setDerivativeLoading((prev) => ({ ...prev, [item.fid]: false }));
		}
	}, [derivativeCache]);

	const openVersions = (item: MaterialAssetItem) => {
		if (!item.fid) return;
		if (item.kind !== "image") {
			// 视频/音频没有衍生概念，直接按原图选中
			const origin = versionsOf(toAssetLike(item), undefined, buildVersionUrls())[0];
			if (origin) toggleVersion(item, origin);
			return;
		}
		if (expandedFid === item.fid) {
			setExpandedFid("");
			return;
		}
		setExpandedFid(item.fid);
		setSelectionNotice("");
		void ensureDerivatives(item);
	};

	const expandedItem = items.find((it) => it.fid === expandedFid) || null;
	const expandedVersions = expandedItem
		? versionsOf(toAssetLike(expandedItem), derivativeCache[expandedItem.fid], buildVersionUrls())
		: [];

	const handleLocalFileClick = () => {
		fileInputRef.current?.click();
	};

	const handleLocalFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const files = Array.from(e.target.files || []);
		if (files.length > 0) {
			onOpenChange(false);
			if (onLocalFilesSelected) {
				onLocalFilesSelected(files);
			}
		}
		e.target.value = "";
	};

	const handleConfirm = async (autoInsertTimeline = false) => {
		if (isSubmitting) return;
		if (!activeProject) {
			toast.error("请先进入一个工程");
			return;
		}

		const chosen = selectedVersions.filter((v) => v.fid);
		if (chosen.length === 0) return;

		setIsSubmitting(true);
		const toastId = toast.loading(`正在从素材库提取 ${chosen.length} 个版本...`);

		try {
			const filesToProcess: { file: File; version: AssetVersion }[] = [];
			const failedNames: string[] = [];

			// 完全不依赖 items：切换筛选/翻页/搜索后，选中项仍可按版本自身信息下载
			for (const version of chosen) {
				const resp = await fetch(buildDownloadPath(version.fid, version.derivativeId), {
					headers: authHeaders(),
				});
				if (!resp.ok) {
					failedNames.push(version.name || version.fid);
					continue;
				}
				const blob = await resp.blob();
				// 用响应真实 mime，避免 PNG/WebP 衍生版被硬编码成 jpeg
				const mime = blob.type || (version.derivativeId ? "image/jpeg" : "video/mp4");
				const file = new File([blob], buildVersionFileName(version), { type: mime });
				filesToProcess.push({ file, version });
			}

			if (filesToProcess.length === 0) {
				toast.error("导入素材失败：没有素材成功入库", { id: toastId });
				return;
			}

			// 原生解码落入 OPFS
			const processedAssets = await processMediaAssets({
				files: filesToProcess.map((f) => f.file),
			});

			// processMediaAssets 会跳过失败项，返回数组是输入的子序列，必须按 file 身份回查版本
			const versionByFile = new Map(
				filesToProcess.map(({ file, version }) => [file, version] as const),
			);
			let createdCount = 0;

			for (const asset of processedAssets) {
				const picked = versionByFile.get(asset.file);
				if (!picked) continue;

				// processMediaAssets 返回的资产没有 id，后续必须使用入库返回值，
				// 否则上轨元素的 mediaId 为 undefined，会直接把整页打成白屏。
				const created = await editor.media.addMediaAsset({
					projectId: activeProject.metadata.id,
					asset,
				});
				if (!created) {
					failedNames.push(picked.name || picked.fid);
					continue;
				}
				createdCount += 1;

				if (picked?.fid) {
					// 版本引用交给云备份/拉取共用，保证衍生版本能随工程往返
					registerMediaFid(created.id, picked.fid, picked.derivativeId || "");
				}

				if (autoInsertTimeline || directInsertTimeline) {
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
				}
			}

			if (createdCount === 0) {
				toast.error("导入素材失败：没有素材成功入库", { id: toastId });
				return;
			}

			const msg = autoInsertTimeline || directInsertTimeline
				? `已成功载入 ${createdCount} 个版本并自动上轨`
				: `已导入 ${createdCount} 个版本到工程媒体池`;

			if (failedNames.length > 0) {
				const shown = failedNames.slice(0, 3).join("、");
				const names = failedNames.length > 3 ? `${shown} 等` : shown;
				toast.warning(`${msg}，${failedNames.length} 个版本失败（${names}）`, { id: toastId });
			} else {
				toast.success(msg, { id: toastId });
			}
			onOpenChange(false);
		} catch (err) {
			toast.error(`导入素材失败: ${err instanceof Error ? err.message : "未知错误"}`, { id: toastId });
		} finally {
			setIsSubmitting(false);
		}
	};

	return (
		<Dialog open={isOpen} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-6xl w-[95vw] h-[92vh] flex flex-col p-6 bg-card border-border/80 shadow-2xl senior-adaptive">
				{/* 顶栏：微缩版素材库标题 + 已选提示 */}
				<DialogHeader className="shrink-0 pb-3 border-b border-border/50">
					<div className="flex items-center justify-between">
						<DialogTitle className="text-xl font-bold flex items-center gap-2.5">
							<span className="text-2xl">🏛️</span>
							<span>企业素材库微缩工作台</span>
							<span className="text-xs px-2.5 py-1 rounded-full bg-primary/10 text-primary font-bold border border-primary/20">
								已选 {selectedVersions.length} 项 / 总库 {totalCount}
							</span>
						</DialogTitle>
						<div className="flex items-center gap-2">
							<Button
								size="sm"
								variant="ghost"
								onClick={() => void loadAssets()}
								className="h-8 px-2.5 text-xs text-muted-foreground hover:text-foreground cursor-pointer gap-1.5"
								title="重新拉取素材库"
							>
								<HugeiconsIcon icon={RefreshIcon} className={cn("size-3.5", loading && "animate-spin")} />
								<span>刷新</span>
							</Button>
						</div>
					</div>
				</DialogHeader>

				{/* 综合过滤导航条 (仿主系统素材库微缩版) */}
				<div className="flex flex-col gap-2.5 shrink-0 py-2 border-b border-border/40">
					{/* 1. 四大核心板块切换 + 搜索 */}
					<div className="flex items-center justify-between gap-3">
						<div className="flex items-center gap-1.5 overflow-x-auto">
							{SHELF_PLATES.map((plate) => (
								<button
									key={plate.key}
									type="button"
									onClick={() => setActiveShelf(plate.key)}
									className={cn(
										"px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5",
										activeShelf === plate.key
											? "bg-primary text-primary-foreground shadow"
											: "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
									)}
								>
									<span>{plate.label}</span>
								</button>
							))}
						</div>

						{/* 实时搜索 */}
						<div className="relative w-80">
							<HugeiconsIcon icon={Search01Icon} className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
							<Input
								value={searchQuery}
								onChange={(e) => setSearchQuery(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === "Enter") void loadAssets();
								}}
								placeholder="按文件名或关键词快速检索 (Enter确认)..."
								className="pl-8 h-9 text-xs font-medium"
							/>
						</div>
					</div>

					{/* 2. 空间属性标签 + 媒体类别切换 */}
					<div className="flex items-center justify-between gap-4">
						{/* 空间标签筛选 */}
						<div className="flex items-center gap-1 overflow-x-auto py-0.5">
							<HugeiconsIcon icon={FilterIcon} className="size-3.5 text-muted-foreground mr-1 shrink-0" />
							{SPACE_TAGS.map((tag) => (
								<button
									key={tag}
									type="button"
									onClick={() => setSelectedSpaceTag(tag)}
									className={cn(
										"px-3 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer shrink-0",
										selectedSpaceTag === tag
											? "bg-foreground text-background font-bold shadow-xs"
											: "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
									)}
								>
									{tag}
								</button>
							))}
						</div>

						{/* 媒体格式切换 */}
						<div className="flex items-center gap-1 bg-muted/40 p-0.5 rounded-lg border border-border/40 shrink-0">
							{(["all", "video", "audio", "image"] as const).map((kind) => (
								<Button
									key={kind}
									size="sm"
									variant={activeKind === kind ? "secondary" : "ghost"}
									className="h-7 px-3 text-xs font-medium cursor-pointer"
									onClick={() => setActiveKind(kind)}
								>
									{kind === "all" ? "全部类型" : kind === "video" ? "空间视频" : kind === "audio" ? "配乐音频" : "空间图片"}
								</Button>
							))}
						</div>
					</div>
				</div>

				{/* 主体自适应瀑布流网格 */}
				<div className="flex-1 overflow-y-auto min-h-0 pr-1 py-2 scrollbar-thin">
					{loading ? (
						<div className="h-80 flex flex-col items-center justify-center gap-3 text-muted-foreground text-xs">
							<HugeiconsIcon icon={Loading03Icon} className="size-8 animate-spin text-primary" />
							<span className="font-medium text-sm">正在检索云端素材库列表...</span>
						</div>
					) : fetchError ? (
						<div className="h-80 flex flex-col items-center justify-center gap-3 text-muted-foreground text-xs p-6 text-center">
							<HugeiconsIcon icon={AlertCircleIcon} className="size-10 text-destructive" />
							<span className="font-bold text-sm text-foreground">{fetchError}</span>
							<Button
								size="sm"
								variant="outline"
								onClick={() => void loadAssets()}
								className="mt-2 text-xs font-semibold"
							>
								重试拉取
							</Button>
						</div>
					) : items.length === 0 ? (
						<div className="h-80 flex flex-col items-center justify-center gap-3 text-muted-foreground text-xs">
							<div className="size-16 rounded-2xl bg-muted/30 flex items-center justify-center text-3xl">📭</div>
							<span className="font-semibold text-sm">未检索到符合条件的云端素材</span>
							<span className="text-[11px] text-muted-foreground/80">
								您可以尝试切换板块、清除空间标签，或点击左下角直接从本地电脑上传。
							</span>
						</div>
					) : (
						<div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3.5">
							{items.map((item) => {
								const isSelected = itemHasSelection(item.fid);
								return (
									<div
										key={item.fid}
										onClick={() => openVersions(item)}
										className={cn(
											"group relative rounded-xl border p-2 flex flex-col gap-2 cursor-pointer transition-all select-none shadow-xs",
											isSelected
												? "border-primary bg-primary/10 ring-2 ring-primary/50 shadow-md"
												: "border-border/60 bg-muted/20 hover:border-border hover:bg-muted/40"
										)}
									>
										{/* 缩略图视窗 */}
										<div className="relative aspect-video w-full rounded-lg overflow-hidden bg-black/40 flex items-center justify-center">
											{item.thumb_url ? (
												<img
													src={item.thumb_url}
													alt={item.file_name}
													className="size-full object-cover group-hover:scale-105 transition-transform duration-300"
													loading="lazy"
													onError={(e) => {
														// 图像加载失败时的备用显示
														(e.target as HTMLElement).style.display = "none";
													}}
												/>
											) : item.kind === "video" ? (
												<HugeiconsIcon icon={Video01Icon} className="size-10 text-slate-500" />
											) : item.kind === "audio" ? (
												<HugeiconsIcon icon={MusicNote03Icon} className="size-10 text-slate-500" />
											) : (
												<HugeiconsIcon icon={Image02Icon} className="size-10 text-slate-500" />
											)}

											{item.kind === "image" && (
												<span className="absolute top-2 left-2 px-1.5 py-0.5 rounded-md bg-black/70 text-[10px] font-bold text-white">
													{versionCountBadge(item)}
												</span>
											)}

											{/* 勾选高对比指示器 */}
											<div
												className={cn(
													"absolute top-2 right-2 size-6 rounded-full flex items-center justify-center transition-all",
													isSelected
														? "bg-primary text-primary-foreground shadow-md ring-2 ring-white/50"
														: "bg-black/60 text-white/40 border border-white/30 backdrop-blur-xs"
												)}
											>
												{isSelected && <HugeiconsIcon icon={CheckmarkCircle02Icon} className="size-4" />}
											</div>

											{/* 时长标签 */}
											{item.duration != null && item.duration > 0 && (
												<span className="absolute bottom-1.5 right-2 px-2 py-0.5 rounded-md bg-black/75 text-[11px] font-mono font-bold text-white backdrop-blur-xs">
													{item.duration.toFixed(1)}s
												</span>
											)}
										</div>

										{/* 名称与属性卡片 */}
										<div className="min-w-0 flex flex-col gap-1">
											<div className="text-xs font-bold truncate leading-tight" title={item.file_name}>
												{item.file_name}
											</div>
											<div className="text-[10px] font-mono text-muted-foreground flex items-center justify-between">
												<span>{formatBytes(item.size)}</span>
												{item.width && item.height && (
													<span className="opacity-80">{item.width}×{item.height}</span>
												)}
											</div>
										</div>
									</div>
								);
							})}
						</div>
					)}
				</div>

				{/* 版本选择面板：原图 + 全部衍生版 */}
				{expandedItem && (
					<div className="shrink-0 border-t border-border/50 py-2 max-h-60 overflow-y-auto">
						<div className="flex items-center justify-between mb-2">
							<span className="text-xs font-bold truncate">
								选择版本 · {expandedItem.file_name}
							</span>
							<Button
								size="sm"
								variant="ghost"
								className="h-7 px-2 text-xs cursor-pointer"
								onClick={() => setExpandedFid("")}
							>
								收起
							</Button>
						</div>
						{derivativeLoading[expandedItem.fid] ? (
							<div className="h-16 flex items-center justify-center text-xs text-muted-foreground">
								读取衍生版本…
							</div>
						) : derivativeError[expandedItem.fid] ? (
							<div className="h-16 flex items-center justify-center gap-3 text-xs text-destructive">
								<span className="font-semibold">{derivativeError[expandedItem.fid]}</span>
								<Button
									size="sm"
									variant="ghost"
									className="h-7 px-2 text-xs cursor-pointer"
									onClick={() => void ensureDerivatives(expandedItem)}
								>
									重试
								</Button>
							</div>
						) : (
							<div className="flex flex-wrap gap-2">
								{expandedVersions.map((version) => (
									<button
										key={version.key}
										type="button"
										onClick={() => toggleVersion(expandedItem, version)}
										className={cn(
											"w-32 rounded-lg border p-1.5 flex flex-col gap-1 cursor-pointer text-left",
											isVersionSelected(selectedVersions, version.key)
												? "border-primary bg-primary/10 ring-2 ring-primary/40"
												: "border-border/60 bg-muted/20 hover:bg-muted/40",
										)}
									>
										<div className="aspect-video w-full rounded overflow-hidden bg-black/40">
											<img
												src={version.url}
												alt={version.label}
												className="size-full object-cover"
												loading="lazy"
											/>
										</div>
										<span className="text-[11px] font-semibold truncate">{version.label}</span>
										{version.geometry && (
											<span className="text-[10px] font-bold text-amber-500">选中会改画幅</span>
										)}
									</button>
								))}
							</div>
						)}
					</div>
				)}

				{/* 本地上传 input */}
				<input
					ref={fileInputRef}
					type="file"
					multiple
					accept="video/*,audio/*,image/*"
					className="hidden"
					onChange={handleLocalFileChange}
				/>

				{/* 底部操作工具栏 */}
				<DialogFooter className="shrink-0 pt-3 border-t border-border/50 flex items-center justify-between gap-3 sm:justify-between">
					<Button
						type="button"
						variant="outline"
						onClick={handleLocalFileClick}
						className="gap-2 text-xs font-bold h-11 px-4 cursor-pointer border-dashed border-border hover:bg-muted/80"
					>
						<HugeiconsIcon icon={FolderUploadIcon} className="size-4 text-primary" />
						<span>📂 本地电脑上传文件...</span>
					</Button>

					<div className="flex items-center gap-3">
						{selectionNotice && (
							<span className="text-[11px] font-bold text-amber-500">{selectionNotice}</span>
						)}

						<Button
							type="button"
							variant="ghost"
							onClick={() => onOpenChange(false)}
							className="h-11 text-xs px-4 cursor-pointer"
						>
							取消
						</Button>

						{/* 两个确认出口：仅导入媒体池 vs 一键追加到时间轴 */}
						<Button
							type="button"
							variant="outline"
							disabled={selectedVersions.length === 0 || isSubmitting}
							onClick={() => handleConfirm(false)}
							className="h-11 text-xs font-semibold px-4 cursor-pointer"
						>
							仅导入媒体池 ({selectedVersions.length})
						</Button>

						<Button
							type="button"
							disabled={selectedVersions.length === 0 || isSubmitting}
							onClick={() => handleConfirm(true)}
							className="gap-2 h-11 text-sm font-bold px-6 cursor-pointer bg-primary text-primary-foreground hover:bg-primary/90 shadow-md"
						>
							{isSubmitting ? (
								<>
									<HugeiconsIcon icon={Loading03Icon} className="size-4 animate-spin" />
									<span>处理中...</span>
								</>
							) : (
								<span>🎬 导入并上轨 ({selectedVersions.length})</span>
							)}
						</Button>
					</div>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
