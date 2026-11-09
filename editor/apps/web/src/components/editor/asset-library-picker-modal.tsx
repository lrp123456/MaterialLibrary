"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useEditor } from "@/editor/use-editor";
import { processMediaAssets } from "@/media/processing";
import { getMediaStorageIssue, getVideoDecodeIssue } from "@/media/runtime-capabilities";
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
	Loading03Icon,
	RefreshIcon,
	AlertCircleIcon,
	FavouriteIcon,
	ViewIcon,
	Cancel01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "@/utils/ui";
import {
	isSelected as isVersionSelected,
	missingSlotPresets,
	onDerivativeSlotPrefsChange,
	readDerivativeSlotPrefs,
	slotStatusFromDetail,
	toggleSelection,
	versionsOf,
	type AssetLike,
	type AssetVersion,
	type DerivativeLike,
	type DerivativeSlotPrefs,
	type DerivativeSlotPreset,
} from "../../../../../../shared/ml-asset-core/index";
import { AssetLibraryFilterPanel } from "./asset-library-filter-panel";
import { AssetLibraryPreviewLightbox } from "./asset-library-preview-lightbox";
import {
	EMPTY_FACETS,
	PAGE_SIZE_OPTIONS,
	SORT_OPTIONS,
	buildAssetQueryParams,
	countActiveFilters,
	createDefaultFilters,
	formatBytes,
	formatDuration,
	sanitizeFilters,
	type AssetFacets,
	type AssetFilterState,
	type AssetSortKey,
	type MaterialAssetItem,
} from "./asset-library-picker-shared";

// 媒体池 / 素材面板按这个类型消费云端素材，保持原有导出路径不变
export type { MaterialAssetItem } from "./asset-library-picker-shared";

export interface AssetLibraryPickerModalProps {
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
	/** 本地文件上传回调（可选，若用户选用本地上传出口） */
	onLocalFilesSelected?: (files: File[]) => void;
	/** 是否直接一键上轨 */
	directInsertTimeline?: boolean;
}

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

function toAssetLike(item: MaterialAssetItem): AssetLike {
	return {
		fid: item.fid,
		name: item.file_name,
		kind: item.kind,
		mediaToken: "",
		url: item.thumb_url || "",
		category: item.category,
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

/** 服务端列表行 → 前端视图模型；只做字段归一，不做任何过滤。 */
function toMaterialItem(raw: any, token: string): MaterialAssetItem {
	const fid = String(raw?.fid || "");
	const kind = (raw?.kind || (raw?.category === "music" ? "audio" : "image")) as MaterialAssetItem["kind"];

	// 缩略图一律走后端代理端点（poster/image，带 token）。
	// 不再使用 thumb_url/poster_url：网盘同步素材的 thumb_url 存的是夸克网盘
	// 分享页链接（网页而非图片），<img> 渲染不出内容——即"云素材弹窗看不到预览"。
	const thumb =
		kind === "video"
			? `/api/viewer/assets/${encodeURIComponent(fid)}/poster${token ? `?token=${encodeURIComponent(token)}` : ""}`
			: kind === "audio"
				? ""
				: `/api/viewer/assets/${encodeURIComponent(fid)}/image${token ? `?token=${encodeURIComponent(token)}` : ""}`;

	const tagLabels: string[] = Array.isArray(raw?.tags)
		? raw.tags
				.map((t: any) => (typeof t === "string" ? t : t?.label || t?.dir || ""))
				.filter(Boolean)
		: [];

	return {
		fid,
		file_name: raw?.file_name || raw?.fileName || "未命名素材",
		kind,
		mime:
			raw?.mime ||
			(kind === "video" ? "video/mp4" : kind === "audio" ? "audio/mpeg" : "image/jpeg"),
		size: Number(raw?.size) || 0,
		duration: Number(raw?.duration_s || raw?.duration) || 0,
		width: Number(raw?.width) || undefined,
		height: Number(raw?.height) || undefined,
		thumb_url: thumb,
		tag_labels: tagLabels,
		favorited: Boolean(raw?.favorited_at),
		is_ai: raw?.is_ai === 1 || raw?.is_ai === true,
		created_at: Number(raw?.created_at) || undefined,
		category: raw?.category || "",
	};
}

/** 服务端随列表返回的候选值字典（filterOptions），用于渲染带计数的筛选块。 */
function readFacets(options: any): AssetFacets {
	const toList = (value: any) =>
		Array.isArray(value)
			? value
					.filter((item: any) => item && (item.dir || item.label))
					.map((item: any) => ({
						dir: String(item.dir || item.label),
						label: String(item.label || item.dir),
						count: Number(item.count) || 0,
					}))
			: [];
	return {
		space: toList(options?.space),
		styleAtom: toList(options?.style_atom),
		materialKind: toList(options?.material_kind),
		orientation: toList(options?.orientation),
		colors: toList(options?.colors),
		furnitureItem: toList(options?.furniture_item),
		furnitureCraft: toList(options?.furniture_craft),
	};
}

const KIND_LABEL: Record<MaterialAssetItem["kind"], string> = {
	image: "图片",
	video: "视频",
	audio: "音频",
};

export function AssetLibraryPickerModal({
	isOpen,
	onOpenChange,
	onLocalFilesSelected,
	directInsertTimeline = false,
}: AssetLibraryPickerModalProps) {
	const editor = useEditor();
	const activeProject = useEditor((e) => e.project.getActiveOrNull());
	const fileInputRef = useRef<HTMLInputElement>(null);

	// 筛选状态：全部维度都翻译成服务端查询参数，见 buildAssetQueryParams
	const [filters, setFilters] = useState<AssetFilterState>(createDefaultFilters);
	const [facets, setFacets] = useState<AssetFacets>(EMPTY_FACETS);
	// 搜索框与「已生效关键词」分离：回车/点检索才真正查询
	const [keywordInput, setKeywordInput] = useState("");
	const [keyword, setKeyword] = useState("");
	const [sort, setSort] = useState<AssetSortKey>("latest");
	const [pageSize, setPageSize] = useState<number>(PAGE_SIZE_OPTIONS[1]);
	const [page, setPage] = useState(1);
	// 手动刷新计数：仅用来触发一次重新拉取
	const [reloadToken, setReloadToken] = useState(0);

	const [items, setItems] = useState<MaterialAssetItem[]>([]);
	const [totalCount, setTotalCount] = useState(0);
	const [loading, setLoading] = useState(false);
	const [fetchError, setFetchError] = useState("");

	// 版本级选中：key = fid 或 fid::derivativeId，同一素材的不同版本互不覆盖
	const [selectedVersions, setSelectedVersions] = useState<AssetVersion[]>([]);
	const [expandedFid, setExpandedFid] = useState("");
	const [derivativeCache, setDerivativeCache] = useState<Record<string, DerivativeLike[]>>({});
	const [derivativeLoading, setDerivativeLoading] = useState<Record<string, boolean>>({});
	const [derivativeError, setDerivativeError] = useState<Record<string, string>>({});
	// 默认衍生图插槽：缺哪档补哪档；设置页可整体关闭或按类目改规格
	const [slotPrefs, setSlotPrefs] = useState<DerivativeSlotPrefs>(() => readDerivativeSlotPrefs());
	const [restageStatusByFid, setRestageStatusByFid] = useState<
		Record<string, Record<string, unknown>>
	>({});
	const [slotBusyFid, setSlotBusyFid] = useState("");
	const [slotErrorByFid, setSlotErrorByFid] = useState<Record<string, string>>({});
	// 在途 fid：避免重复点击时并发拉同一份衍生详情
	const derivativeInFlight = useRef<Set<string>>(new Set());
	const [selectionNotice, setSelectionNotice] = useState("");
	// 大图预览：记录 fid 与在版本列表中的下标
	const [previewFid, setPreviewFid] = useState("");
	const [previewIndex, setPreviewIndex] = useState(0);
	// 弹窗是一次性批量导入，实际不限制数量；传大值即等价于不限制
	const MAX_SELECT = 100;
	const [isSubmitting, setIsSubmitting] = useState(false);

	// 请求序号：筛选/翻页连点时只让最后一次响应落地，避免旧结果覆盖新结果
	const requestSeq = useRef(0);

	const loadAssets = useCallback(async () => {
		const seq = ++requestSeq.current;
		setLoading(true);
		setFetchError("");
		try {
			const params = buildAssetQueryParams({ filters, keyword, sort, page, pageSize });
			const res = await fetch(`/api/viewer/assets?${new URLSearchParams(params).toString()}`, {
				headers: authHeaders(),
			});
			if (seq !== requestSeq.current) return;

			if (res.ok) {
				const json = await res.json();
				if (seq !== requestSeq.current) return;
				// 后端规范统一在 json.data，兼容旧结构直接铺在根上
				const data = json?.data || json;
				const rawList = (Array.isArray(data?.items) ? data.items : []) as any[];
				const token = getAuthToken();
				setItems(rawList.map((it) => toMaterialItem(it, token)));
				setTotalCount(Number(data?.total) || 0);
				setFacets(readFacets(data?.filterOptions));
			} else if (res.status === 401) {
				setFetchError("未检测到有效登录凭据或会话已过期，请在主系统中重新登录。");
				setItems([]);
				setTotalCount(0);
			} else {
				setFetchError(`拉取素材库失败 (HTTP ${res.status})`);
				setItems([]);
				setTotalCount(0);
			}
		} catch (e: any) {
			if (seq !== requestSeq.current) return;
			setFetchError(`网络请求异常: ${e?.message || "请检查后端服务是否就绪"}`);
			setItems([]);
			setTotalCount(0);
		} finally {
			if (seq === requestSeq.current) setLoading(false);
		}
	}, [filters, keyword, sort, page, pageSize, reloadToken]);

	// 设置页改了「默认衍生图预置」后，弹窗不用重开也能跟着变
	useEffect(() => onDerivativeSlotPrefsChange(setSlotPrefs), []);

	// 每次打开只清空「选择态」，保留上次的筛选条件（素材库习惯：再次打开接着上次的位置）
	useEffect(() => {
		if (!isOpen) return;
		setSelectedVersions([]);
		setExpandedFid("");
		setSelectionNotice("");
		setPreviewFid("");
		setSlotErrorByFid({});
		setPage(1);
	}, [isOpen]);

	// 打开、筛选、排序、翻页、手动刷新都会重新走服务端
	useEffect(() => {
		if (!isOpen) return;
		void loadAssets();
	}, [isOpen, loadAssets, reloadToken]);

	// 监听 Token 跨帧同步就绪事件
	useEffect(() => {
		const handleTokenUpdated = () => {
			if (isOpen) void loadAssets();
		};
		window.addEventListener("mls_token_updated", handleTokenUpdated);
		return () => window.removeEventListener("mls_token_updated", handleTokenUpdated);
	}, [isOpen, loadAssets]);

	const patchFilters = useCallback((patch: Partial<AssetFilterState>) => {
		// sanitizeFilters 会清掉切换大类后已经不可见的维度，避免隐藏条件拖空结果
		setFilters((prev) => sanitizeFilters({ ...prev, ...patch }));
		// 任何筛选变化都回到第一页，否则会停在一个空白的深页
		setPage(1);
	}, []);

	const resetFilters = useCallback(() => {
		setFilters(createDefaultFilters());
		setKeyword("");
		setKeywordInput("");
		setPage(1);
	}, []);

	const applyKeyword = useCallback(() => {
		setKeyword(keywordInput.trim());
		setPage(1);
	}, [keywordInput]);

	const clearKeyword = useCallback(() => {
		setKeywordInput("");
		setKeyword("");
		setPage(1);
	}, []);

	const totalPages = Math.max(1, Math.ceil(totalCount / Math.max(1, pageSize)));
	const activeFilterCount = countActiveFilters(filters);

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

	const ensureDerivatives = useCallback(
		async (item: MaterialAssetItem, options: { force?: boolean } = {}) => {
			if (!item.fid || item.kind !== "image") return;
			if (derivativeInFlight.current.has(item.fid)) return;
			if (!options.force && Object.prototype.hasOwnProperty.call(derivativeCache, item.fid)) return;
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
				// 插槽要显示「排队中 / 生成中 / 失败」而不是一律「待生成」
				setRestageStatusByFid((prev) => ({
					...prev,
					[item.fid]: detail?.restageStatus || {},
				}));
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
		},
		[derivativeCache],
	);

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

	const openPreview = (item: MaterialAssetItem) => {
		// 预览依赖 image 端点渲染原图与衍生图，视频/音频暂不提供（它们的缩略图已是海报帧）
		if (item.kind !== "image" || !item.fid) return;
		setPreviewFid(item.fid);
		setPreviewIndex(0);
		void ensureDerivatives(item);
	};

	const expandedItem = items.find((it) => it.fid === expandedFid) || null;
	const expandedVersions = expandedItem
		? versionsOf(toAssetLike(expandedItem), derivativeCache[expandedItem.fid], buildVersionUrls())
		: [];
	/** 这类图片默认还缺哪几档画幅；详情没读到之前不显示插槽，避免误报。 */
	const expandedSlots =
		expandedItem && expandedItem.kind === "image" && derivativeCache[expandedItem.fid]
			? missingSlotPresets(expandedItem.category, derivativeCache[expandedItem.fid], slotPrefs)
			: [];

	const slotStatus = (slot: DerivativeSlotPreset) => {
		if (!expandedItem) return "missing" as const;
		if (slotBusyFid === expandedItem.fid) return "running" as const;
		return slotStatusFromDetail(slot.kind, restageStatusByFid[expandedItem.fid]);
	};

	const slotHeadline = (slot: DerivativeSlotPreset) => {
		const status = slotStatus(slot);
		if (status === "running") return "生成中…";
		if (status === "queued") return "排队中";
		if (status === "failed") return `${slot.shortLabel} 待重试`;
		return `${slot.shortLabel} 待生成`;
	};

	const slotActionText = (slot: DerivativeSlotPreset) => {
		const status = slotStatus(slot);
		if (status === "running") return "生成中…";
		if (status === "queued") return "排队中";
		if (status === "failed") return "重试生成";
		return "点击生成";
	};

	/**
	 * 触发生成。后端 restage 是同步长请求，多档缺失时合并成一次调用，
	 * 同一时刻只允许一张图在跑，避免把生图通道打爆。
	 *
	 * model 显式传 Seedream 5.0 Flash：default 工作流的 restage_dual 可能为省成本挂到
	 * 本机免费模型，手动点的人是盯着插槽等出图的，不能跟着排进本机 GPU 长队。
	 */
	const generateSlots = async (slots: DerivativeSlotPreset[]) => {
		if (!expandedItem || !expandedItem.fid || slots.length === 0) return;
		if (slotBusyFid) return;
		const fid = expandedItem.fid;
		setSlotBusyFid(fid);
		setSlotErrorByFid((prev) => ({ ...prev, [fid]: "" }));
		try {
			const res = await fetch(`/api/viewer/assets/${encodeURIComponent(fid)}/restage`, {
				method: "POST",
				headers: { ...authHeaders(), "Content-Type": "application/json" },
				body: JSON.stringify({
					ratios: slots.map((slot) => slot.ratio),
					model: "seedream5flash",
					gpuPriority: "high",
					forceMember: true,
				}),
			});
			const json = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(json?.error || `生成失败 (HTTP ${res.status})`);
			const channels = (json?.data?.channels || {}) as Record<string, { adapterId?: string; model?: string }>;
			const models = Object.values(channels)
				.map((entry) => entry?.model || entry?.adapterId || "")
				.filter(Boolean);
			if (models.length) {
				toast.success(`已生成 · 走 ${[...new Set(models)].join(" / ")}`);
			}
			// 缓存里那份是生成前的快照，必须强制重读，否则插槽会一直停在「待生成」
			await ensureDerivatives(expandedItem, { force: true });
		} catch (e: any) {
			setSlotErrorByFid((prev) => ({
				...prev,
				[fid]: String(e?.message || "生成失败，请稍后重试"),
			}));
		} finally {
			setSlotBusyFid("");
		}
	};

	const previewItem = items.find((it) => it.fid === previewFid) || null;
	const previewVersions = useMemo(
		() =>
			previewItem
				? versionsOf(toAssetLike(previewItem), derivativeCache[previewItem.fid], buildVersionUrls())
				: [],
		[previewItem, derivativeCache],
	);

	/** 全选本页：同一素材已有任一版本入选时跳过，避免原图与衍生版重复占位 */
	const selectAllCurrentPage = () => {
		const next = selectedVersions.slice();
		for (const item of items) {
			if (next.length >= MAX_SELECT) break;
			if (!item.fid) continue;
			if (next.some((v) => v.fid === item.fid)) continue;
			const version = versionsOf(toAssetLike(item), undefined, buildVersionUrls())[0];
			if (!version) continue;
			next.push({ ...version, name: version.name || item.file_name });
		}
		setSelectedVersions(next);
		setSelectionNotice(
			next.length >= MAX_SELECT ? `最多同时选择 ${MAX_SELECT} 个版本` : "",
		);
	};

	const handleLocalFileClick = () => {
		fileInputRef.current?.click();
	};

	/**
	 * 本地上传同时入两边：
	 * 1. 本次素材（media pool，立即可上轨）——走 onLocalFilesSelected
	 * 2. 企业素材库（云端持久化，素材库 = 剪辑库素材）——走 /api/sync/upload
	 */
	const uploadToLibrary = async (files: File[]) => {
		const ok: string[] = [];
		for (const file of files) {
			try {
				const fd = new FormData();
				fd.append("file", file);
				fd.append("filename", file.name);
				const res = await fetch("/api/sync/upload", {
					method: "POST",
					headers: authHeaders(),
					body: fd,
				});
				if (res.ok) ok.push(file.name);
			} catch (err) {
				console.error("上传素材库失败:", err);
			}
		}
		if (ok.length > 0) {
			toast.success(`已入库素材库 ${ok.length} 个文件（云端可再选）`);
		} else {
			toast.error("上传素材库失败（本次素材不受影响）");
		}
	};

	const handleLocalFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const files = Array.from(e.target.files || []);
		if (files.length > 0) {
			onOpenChange(false);
			if (onLocalFilesSelected) {
				onLocalFilesSelected(files);
			}
			// 异步入库素材库，不阻塞本次素材的导入
			void uploadToLibrary(files);
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
			// 非安全上下文会同时禁用 OPFS 与 WebCodecs，先在入口说清楚，
			// 否则只会得到「没有素材成功入库」这种看不出原因的结果。
			const storageIssue = getMediaStorageIssue();
			if (storageIssue) {
				toast.error(storageIssue.title, {
					id: toastId,
					description: storageIssue.description,
					duration: 12000,
				});
				return;
			}

			const videoVersions = chosen.filter((version) => version.kind === "video");
			const videoIssue = videoVersions.length > 0 ? getVideoDecodeIssue() : null;
			if (videoIssue && videoVersions.length === chosen.length) {
				toast.error(videoIssue.title, {
					id: toastId,
					description: videoIssue.description,
					duration: 12000,
				});
				return;
			}
			if (videoIssue) {
				toast.warning(`${videoIssue.title}（已跳过 ${videoVersions.length} 个视频）`, {
					description: videoIssue.description,
					duration: 12000,
				});
			}
			const importable = videoIssue
				? chosen.filter((version) => version.kind !== "video")
				: chosen;

			const filesToProcess: { file: File; version: AssetVersion }[] = [];
			const failedNames: string[] = [];

			// 完全不依赖 items：切换筛选/翻页/搜索后，选中项仍可按版本自身信息下载
			for (const version of importable) {
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
				const names = failedNames.slice(0, 3).join("、");
				toast.error(
					failedNames.length > 0
						? `导入素材失败：${names}${failedNames.length > 3 ? " 等" : ""} 下载失败`
						: "导入素材失败：所选版本没有可导入的文件",
					{ id: toastId },
				);
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
				toast.error("导入素材失败：文件已下载，但没有素材成功入库（详见上方错误提示）", {
					id: toastId,
				});
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
			toast.error(`导入素材失败: ${err instanceof Error ? err.message : "未知错误"}`, {
				id: toastId,
			});
		} finally {
			setIsSubmitting(false);
		}
	};

	return (
		<Dialog open={isOpen} onOpenChange={onOpenChange}>
			<DialogContent className="flex h-[92vh] w-[96vw] max-w-[1440px] flex-col gap-0 overflow-hidden border-border/80 bg-card p-0 shadow-2xl senior-adaptive">
				{/* 顶栏：标题 + 库存概览 + 刷新 */}
				<DialogHeader className="shrink-0 border-b border-border/50 p-0">
					<div className="flex items-center justify-between gap-3 px-5 py-3 pr-12">
						<DialogTitle className="flex items-center gap-2.5 text-lg font-bold">
							<span className="text-xl">🏛️</span>
							<span>企业素材库</span>
							<span className="rounded-full border border-primary/20 bg-primary/10 px-2.5 py-0.5 text-[11px] font-bold text-primary">
								已选 {selectedVersions.length} 个版本 / 共 {totalCount} 件
							</span>
						</DialogTitle>
						<div className="flex items-center gap-2">
							<Button
								size="sm"
								variant="ghost"
								onClick={() => setReloadToken((prev) => prev + 1)}
								className="h-8 cursor-pointer gap-1.5 px-2.5 text-xs text-muted-foreground hover:text-foreground"
								title="按当前筛选重新拉取素材库"
							>
								<HugeiconsIcon
									icon={RefreshIcon}
									className={cn("size-3.5", loading && "animate-spin")}
								/>
								<span>刷新</span>
							</Button>
						</div>
					</div>
				</DialogHeader>

				{/* 工具栏：搜索 + 排序 + 每页数量 + 批量选择 */}
				<div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border/40 px-5 py-2">
					<div className="relative w-72">
						<HugeiconsIcon
							icon={Search01Icon}
							className="absolute left-2.5 top-2.5 size-4 text-muted-foreground"
						/>
						<Input
							value={keywordInput}
							onChange={(e) => setKeywordInput(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === "Enter") applyKeyword();
							}}
							placeholder="搜索文件名、空间、风格、材质标签…"
							className="h-9 pl-8 text-xs font-medium"
						/>
					</div>
					<Button
						type="button"
						size="sm"
						variant="secondary"
						onClick={applyKeyword}
						className="h-9 cursor-pointer px-3 text-xs font-bold"
					>
						检索
					</Button>
					{keyword ? (
						<Button
							type="button"
							size="sm"
							variant="ghost"
							onClick={clearKeyword}
							className="h-9 cursor-pointer gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
						>
							<HugeiconsIcon icon={Cancel01Icon} className="size-3.5" />
							<span>清除「{keyword}」</span>
						</Button>
					) : null}

					<div className="ml-auto flex flex-wrap items-center gap-2">
						<span className="text-[11px] font-semibold text-muted-foreground">排序</span>
						<select
							value={sort}
							onChange={(e) => {
								setSort(e.target.value as AssetSortKey);
								setPage(1);
							}}
							className="h-8 cursor-pointer rounded-lg border border-border/60 bg-background px-2 text-[11px] font-semibold"
						>
							{SORT_OPTIONS.map((option) => (
								<option key={option.key} value={option.key}>
									{option.label}
								</option>
							))}
						</select>

						<span className="ml-1 text-[11px] font-semibold text-muted-foreground">每页</span>
						<select
							value={String(pageSize)}
							onChange={(e) => {
								setPageSize(Number(e.target.value));
								setPage(1);
							}}
							className="h-8 cursor-pointer rounded-lg border border-border/60 bg-background px-2 text-[11px] font-semibold"
						>
							{PAGE_SIZE_OPTIONS.map((size) => (
								<option key={size} value={size}>
									{size} 件
								</option>
							))}
						</select>

						<span className="ml-1 rounded-lg bg-muted/50 px-2 py-1 text-[11px] font-semibold text-muted-foreground">
							已筛选 {activeFilterCount} 项
						</span>

						<Button
							type="button"
							size="sm"
							variant="outline"
							onClick={selectAllCurrentPage}
							disabled={items.length === 0}
							className="h-8 cursor-pointer px-2.5 text-[11px] font-semibold"
							title="把当前页所有素材的原图加入选择"
						>
							全选本页
						</Button>
						<Button
							type="button"
							size="sm"
							variant="ghost"
							onClick={() => {
								setSelectedVersions([]);
								setSelectionNotice("");
							}}
							disabled={selectedVersions.length === 0}
							className="h-8 cursor-pointer px-2.5 text-[11px] font-semibold text-muted-foreground hover:text-foreground"
						>
							清空选择
						</Button>
					</div>
				</div>

				{/* 主体：左侧多维筛选 + 右侧素材网格 */}
				<div className="flex min-h-0 flex-1">
					<AssetLibraryFilterPanel
						filters={filters}
						facets={facets}
						onPatch={patchFilters}
						onReset={resetFilters}
					/>

					<div className="flex min-w-0 flex-1 flex-col">
						<div className="min-h-0 flex-1 overflow-y-auto p-4 scrollbar-thin">
							{loading && items.length === 0 ? (
								<div className="flex h-72 flex-col items-center justify-center gap-3 text-xs text-muted-foreground">
									<HugeiconsIcon icon={Loading03Icon} className="size-8 animate-spin text-primary" />
									<span className="text-sm font-medium">正在按当前筛选检索素材库…</span>
								</div>
							) : fetchError ? (
								<div className="flex h-72 flex-col items-center justify-center gap-3 p-6 text-center text-xs text-muted-foreground">
									<HugeiconsIcon icon={AlertCircleIcon} className="size-10 text-destructive" />
									<span className="text-sm font-bold text-foreground">{fetchError}</span>
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
								<div className="flex h-72 flex-col items-center justify-center gap-3 text-xs text-muted-foreground">
									<div className="flex size-16 items-center justify-center rounded-2xl bg-muted/30 text-3xl">
										📭
									</div>
									<span className="text-sm font-semibold">未检索到符合条件的云端素材</span>
									<span className="text-[11px]">
										可以尝试切换来源板块、放宽筛选维度，或从本地电脑上传文件。
									</span>
								</div>
							) : (
								<div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
									{items.map((item) => {
										const picked = itemHasSelection(item.fid);
										return (
											<div
												key={item.fid}
												onClick={() => openVersions(item)}
												className={cn(
													"group relative flex cursor-pointer select-none flex-col gap-2 rounded-xl border p-2 shadow-xs transition-all",
													picked
														? "border-primary bg-primary/10 ring-2 ring-primary/50 shadow-md"
														: "border-border/60 bg-muted/20 hover:border-border hover:bg-muted/40",
												)}
											>
												{/* 缩略图视窗 */}
												<div className="relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-lg bg-black/40">
													{item.thumb_url ? (
														<img
															src={item.thumb_url}
															alt={item.file_name}
															className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
															loading="lazy"
															onError={(e) => {
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

													{/* 左上角：版本数 / 收藏 / AI 标记 */}
													<div className="absolute left-1.5 top-1.5 flex items-center gap-1">
														{item.kind === "image" ? (
															<span className="rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] font-bold text-white">
																{versionCountBadge(item)}
															</span>
														) : null}
														{item.favorited ? (
															<span
																className="flex items-center rounded-md bg-black/70 px-1 py-0.5"
																title="已收藏"
															>
																<HugeiconsIcon icon={FavouriteIcon} className="size-3 text-amber-400" />
															</span>
														) : null}
														{item.is_ai ? (
															<span
																className="rounded-md bg-violet-500/90 px-1.5 py-0.5 text-[10px] font-bold text-white"
																title="AI 生成素材"
															>
																AI 生成
															</span>
														) : null}
													</div>

													{/* 右上角：勾选指示器 */}
													<div
														className={cn(
															"absolute right-1.5 top-1.5 flex size-6 items-center justify-center rounded-full transition-all",
															picked
																? "bg-primary text-primary-foreground shadow-md ring-2 ring-white/50"
																: "border border-white/30 bg-black/60 text-white/40 backdrop-blur-xs",
														)}
													>
														{picked ? (
															<HugeiconsIcon icon={CheckmarkCircle02Icon} className="size-4" />
														) : null}
													</div>

													{/* 右下角：时长 */}
													{item.duration != null && item.duration > 0 ? (
														<span className="absolute bottom-1.5 right-1.5 rounded-md bg-black/75 px-1.5 py-0.5 font-mono text-[10px] font-bold text-white backdrop-blur-xs">
															{formatDuration(item.duration)}
														</span>
													) : null}

													{/* 悬浮操作：预览大图（仅图片有原图 / 衍生图概念），放左下角避开时长角标 */}
													{item.kind === "image" ? (
														<button
															type="button"
															onClick={(e) => {
																e.stopPropagation();
																openPreview(item);
															}}
															title="放大预览原图与衍生版本"
															className="absolute bottom-1.5 left-1.5 flex cursor-pointer items-center gap-1 rounded-md border border-white/20 bg-black/70 px-1.5 py-0.5 text-[10px] font-bold text-white opacity-0 backdrop-blur-xs transition-opacity hover:bg-black/85 group-hover:opacity-100"
														>
															<HugeiconsIcon icon={ViewIcon} className="size-3" />
															<span>预览</span>
														</button>
													) : null}
												</div>

												{/* 名称与属性 */}
												<div className="flex min-w-0 flex-col gap-0.5">
													<div className="truncate text-xs font-bold leading-tight" title={item.file_name}>
														{item.file_name}
													</div>
													<div className="flex items-center justify-between gap-2 font-mono text-[10px] text-muted-foreground">
														<span className="truncate">
															{KIND_LABEL[item.kind] || "素材"} · {formatBytes(item.size)}
														</span>
														{item.width && item.height ? (
															<span className="shrink-0 opacity-80">
																{item.width}×{item.height}
															</span>
														) : null}
													</div>
													{item.tag_labels && item.tag_labels.length > 0 ? (
														<div
															className="truncate text-[10px] text-muted-foreground/80"
															title={item.tag_labels.join(" · ")}
														>
															{item.tag_labels.slice(0, 3).join(" · ")}
														</div>
													) : null}
												</div>
											</div>
										);
									})}
								</div>
							)}
						</div>

						{/* 分页：总数与页码都由服务端口径决定 */}
						<div className="flex shrink-0 items-center justify-between gap-3 border-t border-border/40 px-4 py-2 text-[11px] text-muted-foreground">
							<span className="font-mono">
								{loading
									? "正在按当前筛选更新…"
									: `共 ${totalCount} 件 · 第 ${page} / ${totalPages} 页 · 本页 ${items.length} 件`}
							</span>
							<div className="flex items-center gap-1.5">
								<Button
									type="button"
									size="sm"
									variant="outline"
									disabled={page <= 1 || loading}
									onClick={() => setPage(1)}
									className="h-7 cursor-pointer px-2 text-[11px] font-semibold"
								>
									首页
								</Button>
								<Button
									type="button"
									size="sm"
									variant="outline"
									disabled={page <= 1 || loading}
									onClick={() => setPage((prev) => Math.max(1, prev - 1))}
									className="h-7 cursor-pointer px-2 text-[11px] font-semibold"
								>
									上一页
								</Button>
								<Button
									type="button"
									size="sm"
									variant="outline"
									disabled={page >= totalPages || loading}
									onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
									className="h-7 cursor-pointer px-2 text-[11px] font-semibold"
								>
									下一页
								</Button>
								<Button
									type="button"
									size="sm"
									variant="outline"
									disabled={page >= totalPages || loading}
									onClick={() => setPage(totalPages)}
									className="h-7 cursor-pointer px-2 text-[11px] font-semibold"
								>
									末页
								</Button>
							</div>
						</div>
					</div>
				</div>

				{/* 版本选择面板：原图 + 全部衍生版 */}
				{expandedItem ? (
					<div className="max-h-72 shrink-0 overflow-y-auto border-t border-border/50 px-5 py-2 scrollbar-thin">
						<div className="mb-2 flex items-center justify-between gap-3">
							<span className="truncate text-xs font-bold">
								选择版本 · {expandedItem.file_name}
							</span>
							<Button
								size="sm"
								variant="ghost"
								className="h-7 shrink-0 cursor-pointer px-2 text-xs"
								onClick={() => setExpandedFid("")}
							>
								收起
							</Button>
						</div>
						{derivativeLoading[expandedItem.fid] ? (
							<div className="flex h-16 items-center justify-center text-xs text-muted-foreground">
								读取衍生版本…
							</div>
						) : derivativeError[expandedItem.fid] ? (
							<div className="flex h-16 items-center justify-center gap-3 text-xs text-destructive">
								<span className="font-semibold">{derivativeError[expandedItem.fid]}</span>
								<Button
									size="sm"
									variant="ghost"
									className="h-7 cursor-pointer px-2 text-xs"
									onClick={() => void ensureDerivatives(expandedItem)}
								>
									重试
								</Button>
							</div>
						) : (
							<div className="flex flex-wrap gap-2">
								{expandedVersions.map((version) => (
									<div
										key={version.key}
										className={cn(
											"flex w-32 flex-col gap-1 rounded-lg border p-1.5",
											isVersionSelected(selectedVersions, version.key)
												? "border-primary bg-primary/10 ring-2 ring-primary/40"
												: "border-border/60 bg-muted/20",
										)}
									>
										<button
											type="button"
											onClick={() => {
												setPreviewFid(expandedItem.fid);
												const idx = expandedVersions.findIndex((v) => v.key === version.key);
												setPreviewIndex(idx >= 0 ? idx : 0);
											}}
											title="放大查看此版本"
											className="aspect-video w-full cursor-zoom-in overflow-hidden rounded bg-black/40"
										>
											<img
												src={version.url}
												alt={version.label}
												className="size-full object-cover"
												loading="lazy"
											/>
										</button>
										<button
											type="button"
											onClick={() => toggleVersion(expandedItem, version)}
											className="flex flex-col items-start gap-0.5 text-left cursor-pointer"
										>
											<span className="w-full truncate text-[11px] font-semibold">{version.label}</span>
											{version.geometry ? (
												<span className="text-[10px] font-bold text-amber-500">选中会改画幅</span>
											) : (
												<span className="text-[10px] text-muted-foreground">
													{isVersionSelected(selectedVersions, version.key) ? "已选中" : "点击选中"}
												</span>
											)}
										</button>
									</div>
								))}

								{/* 缺失画幅插槽：这类图片默认就该有这一档，缺的就地补出来 */}
								{expandedSlots.map((slot) => (
									<button
										key={`slot-${slot.kind}`}
										type="button"
										disabled={Boolean(slotBusyFid) || slotStatus(slot) === "queued"}
										onClick={() => void generateSlots([slot])}
										title={`${slot.label} 是这张图的默认规格，点一下现场生成（Seedream 5.0 Flash）`}
										className={cn(
											"flex w-32 flex-col gap-1 rounded-lg border-2 border-dashed p-1.5 text-left cursor-pointer",
											slotStatus(slot) === "failed"
												? "border-rose-400/70 bg-rose-500/5"
												: "border-sky-400/60 bg-sky-400/5",
											(Boolean(slotBusyFid) || slotStatus(slot) === "queued") &&
												"opacity-70 cursor-wait",
										)}
									>
										<div className="flex aspect-video w-full flex-col items-center justify-center gap-1 rounded bg-sky-400/5">
											{slotStatus(slot) === "running" || slotStatus(slot) === "queued" ? (
												<HugeiconsIcon
													icon={Loading03Icon}
													className="size-5 animate-spin text-sky-500"
												/>
											) : (
												<span
													className={cn(
														"text-[13px] font-black",
														slotStatus(slot) === "failed" ? "text-rose-500" : "text-sky-600",
													)}
												>
													{slotHeadline(slot)}
												</span>
											)}
											<span className="rounded border border-sky-400/40 px-1.5 py-0.5 font-mono text-[9px] font-bold text-sky-600">
												{slot.ratio}
											</span>
										</div>
										<span className="w-full truncate text-[11px] font-semibold">{slot.label}</span>
										<span className="text-[10px] text-muted-foreground">
											{slotActionText(slot)}
										</span>
									</button>
								))}
							</div>
						)}
						{expandedSlots.length > 1 ? (
							<div className="mt-2 flex justify-end">
								<Button
									size="sm"
									variant="ghost"
									className="h-7 cursor-pointer px-2 text-[11px] font-bold text-sky-600"
									disabled={Boolean(slotBusyFid)}
									onClick={() => void generateSlots(expandedSlots)}
								>
									补齐 {expandedSlots.length} 档缺失画幅
								</Button>
							</div>
						) : null}
						{slotErrorByFid[expandedItem.fid] ? (
							<div className="mt-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[11px] font-semibold text-destructive">
								{slotErrorByFid[expandedItem.fid]}
							</div>
						) : null}
					</div>
				) : null}

				{/* 大图预览灯箱：覆盖整个弹窗，可左右切版本并与原图对比 */}
				{previewItem && previewVersions.length > 0 ? (
					<AssetLibraryPreviewLightbox
						versions={previewVersions}
						index={previewIndex}
						title={previewItem.file_name}
						isPicked={(version) => isVersionSelected(selectedVersions, version.key)}
						onIndexChange={setPreviewIndex}
						onTogglePick={(version) => toggleVersion(previewItem, version)}
						onClose={() => setPreviewFid("")}
					/>
				) : null}

				{/* 本地上传 input */}
				<input
					ref={fileInputRef}
					type="file"
					multiple
					accept="video/*,audio/*,image/*"
					className="hidden"
					onChange={handleLocalFileChange}
				/>

				{/* 底部操作栏 */}
				<DialogFooter className="shrink-0 border-t border-border/50 p-0">
					<div className="flex w-full flex-wrap items-center justify-between gap-3 px-5 py-3">
						{/* 只有调用方接了 onLocalFilesSelected 才显示，否则点了没反应 */}
						{onLocalFilesSelected ? (
							<Button
								type="button"
								variant="outline"
								onClick={handleLocalFileClick}
								className="h-11 cursor-pointer gap-2 border-dashed border-border px-4 text-xs font-bold hover:bg-muted/80"
							>
								<HugeiconsIcon icon={FolderUploadIcon} className="size-4 text-primary" />
								<span>📂 本地电脑上传文件…</span>
							</Button>
						) : null}

						<div className="flex items-center gap-3">
							{selectionNotice ? (
								<span className="text-[11px] font-bold text-amber-500">{selectionNotice}</span>
							) : null}

							<span className="text-[11px] font-bold text-muted-foreground">
								已选 <span className="font-mono text-sm text-primary">{selectedVersions.length}</span> 个版本
							</span>

							<Button
								type="button"
								variant="ghost"
								onClick={() => onOpenChange(false)}
								className="h-11 cursor-pointer px-4 text-xs"
							>
								取消
							</Button>

							{/* 两个确认出口：仅导入媒体池 vs 一键追加到时间轴 */}
							<Button
								type="button"
								variant="outline"
								disabled={selectedVersions.length === 0 || isSubmitting}
								onClick={() => handleConfirm(false)}
								className="h-11 cursor-pointer px-4 text-xs font-semibold"
							>
								仅导入媒体池 ({selectedVersions.length})
							</Button>

							<Button
								type="button"
								disabled={selectedVersions.length === 0 || isSubmitting}
								onClick={() => handleConfirm(true)}
								className="h-11 cursor-pointer gap-2 bg-primary px-6 text-sm font-bold text-primary-foreground shadow-md hover:bg-primary/90"
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
					</div>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
