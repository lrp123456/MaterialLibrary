"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PanelView } from "./base-panel";
import { useEditor } from "@/editor/use-editor";
import { showMediaUploadToast } from "@/media/upload-toast";
import { AssetLibraryPickerModal, type MaterialAssetItem } from "@/components/editor/asset-library-picker-modal";
import {
	downloadCloudAssetToLocal,
	fetchCloudAssets,
} from "@/components/editor/panels/assets/views/media-merged";
import { toast } from "sonner";
import {
	Search01Icon,
	CloudDownloadIcon,
	Video01Icon,
	MusicNote03Icon,
	Image02Icon,
	CleanIcon,
	Maximize02Icon,
	RefreshIcon,
	AlertCircleIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "@/utils/ui";
import { t } from "@/i18n";

const SHELF_PLATES = [
	{ key: "all", label: "全部" },
	{ key: "interior_exterior", label: "空间案例" },
	{ key: "walkthrough", label: "漫游" },
	{ key: "finished", label: "成品" },
	{ key: "render", label: "精修/AI" },
] as const;

function formatBytes(bytes: number): string {
	if (bytes === 0) return "0 B";
	const k = 1024;
	const sizes = ["B", "KB", "MB", "GB"];
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function LibraryView() {
	const editor = useEditor();
	const activeProject = useEditor((e) => e.project.getActiveOrNull());

	const [items, setItems] = useState<MaterialAssetItem[]>([]);
	const [loading, setLoading] = useState(false);
	const [fetchError, setFetchError] = useState<string>("");
	const [searchQuery, setSearchQuery] = useState("");
	const [activeShelf, setActiveShelf] = useState<string>("all");
	const [importingFid, setImportingFid] = useState<string | null>(null);
	const [opfsUsage, setOpfsUsage] = useState<string>("估算中...");
	const [isModalOpen, setIsModalOpen] = useState(false);

	const updateStorageUsage = useCallback(async () => {
		try {
			if (navigator.storage && navigator.storage.estimate) {
				const estimate = await navigator.storage.estimate();
				const usage = estimate.usage || 0;
				setOpfsUsage(formatBytes(usage));
			} else {
				setOpfsUsage("不受支持");
			}
		} catch {
			setOpfsUsage("未知");
		}
	}, []);

	const loadAssets = useCallback(async () => {
		setLoading(true);
		setFetchError("");
		try {
			const q: Record<string, string> = { pageSize: "80", page: "1" };

			if (searchQuery.trim()) {
				q.keyword = searchQuery.trim();
			}

			// 板块映射
			if (activeShelf === "interior_exterior") {
				q.category = "interior_exterior";
			} else if (activeShelf === "walkthrough") {
				q.media_type = "video";
			} else if (activeShelf === "finished") {
				q.shelf = "finished";
			} else if (activeShelf === "render") {
				q.shelf = "retouched";
			}

			const processed = await fetchCloudAssets({ query: q });
			setItems(processed);
		} catch (error) {
			setFetchError(error instanceof Error ? error.message : "拉取失败");
			setItems([]);
		} finally {
			setLoading(false);
		}
	}, [activeShelf, searchQuery]);

	useEffect(() => {
		void loadAssets();
		void updateStorageUsage();
	}, [loadAssets, updateStorageUsage]);

	// 监听 Token 跨帧握手更新
	useEffect(() => {
		const onTokenUpdate = () => {
			void loadAssets();
		};
		window.addEventListener("mls_token_updated", onTokenUpdate);
		return () => window.removeEventListener("mls_token_updated", onTokenUpdate);
	}, [loadAssets]);

	const handleImport = async (item: MaterialAssetItem) => {
		if (!activeProject) {
			toast.error(t("common.error", "请先打开或创建一个工程"));
			return;
		}

		setImportingFid(item.fid);
		try {
			await showMediaUploadToast({
				filesCount: 1,
				promise: async () => {
					// 下载 + 解码 + 入库 + fid 映射都在 media-merged 里，与统一列表共用一份实现
					const created = await downloadCloudAssetToLocal({
						editor,
						projectId: activeProject.metadata.id,
						item,
					});
					return {
						uploadedCount: 1,
						assetNames: [created.name],
					};
				},
			});

			toast.success(`素材「${item.file_name}」已成功导入`);
			void updateStorageUsage();
		} catch (err) {
			toast.error(`导入素材失败: ${err instanceof Error ? err.message : "未知错误"}`);
		} finally {
			setImportingFid(null);
		}
	};

	return (
		<PanelView
			title={t("assets.library", "云端素材库")}
			className="h-full flex flex-col senior-adaptive"
			contentClassName="p-3 flex-1 flex flex-col gap-2.5 min-h-0"
			actions={
				<Button
					size="sm"
					variant="outline"
					onClick={() => setIsModalOpen(true)}
					className="h-8 px-2.5 text-xs font-bold gap-1.5 cursor-pointer hover:bg-primary hover:text-primary-foreground shadow-xs"
					title="打开企业素材库大窗筛选"
				>
					<HugeiconsIcon icon={Maximize02Icon} className="size-3.5" />
					<span>展开大窗</span>
				</Button>
			}
		>
			{/* 一键放大弹窗醒目横幅 */}
			<div
				onClick={() => setIsModalOpen(true)}
				className="p-3 rounded-xl border border-primary/40 bg-primary/10 hover:bg-primary/20 transition-all flex items-center justify-between cursor-pointer select-none shrink-0 shadow-xs group"
			>
				<div className="flex items-center gap-2.5">
					<span className="text-xl group-hover:scale-110 transition-transform">🏛️</span>
					<div className="flex flex-col">
						<span className="text-xs font-bold text-foreground">素材库微缩大工作台</span>
						<span className="text-[11px] text-muted-foreground">点此打开全景视窗高阶多维筛选</span>
					</div>
				</div>
				<HugeiconsIcon icon={Maximize02Icon} className="size-4 text-primary shrink-0 group-hover:scale-110 transition-transform" />
			</div>

			{/* 搜索栏 */}
			<div className="relative shrink-0">
				<HugeiconsIcon icon={Search01Icon} className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
				<Input
					value={searchQuery}
					onChange={(e) => setSearchQuery(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter") void loadAssets();
					}}
					placeholder="搜索文件名 (Enter确认)..."
					className="pl-8 h-8 text-xs font-medium"
				/>
			</div>

			{/* 快捷板块 */}
			<div className="flex items-center gap-1 overflow-x-auto pb-0.5 shrink-0 scrollbar-none">
				{SHELF_PLATES.map((plate) => (
					<button
						key={plate.key}
						type="button"
						onClick={() => setActiveShelf(plate.key)}
						className={cn(
							"px-2.5 py-1 rounded-md text-[11px] font-bold transition-all cursor-pointer shrink-0",
							activeShelf === plate.key
								? "bg-primary text-primary-foreground shadow-xs"
								: "bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground"
						)}
					>
						{plate.label}
					</button>
				))}
			</div>

			{/* 侧栏素材列表 */}
			<div className="flex-1 overflow-y-auto space-y-2 pr-1 min-h-0 scrollbar-thin">
				{loading ? (
					<div className="py-12 text-center text-xs text-muted-foreground flex flex-col items-center gap-2">
						<HugeiconsIcon icon={RefreshIcon} className="size-5 animate-spin text-primary" />
						<span>{t("common.loading", "正在拉取素材库...")}</span>
					</div>
				) : fetchError ? (
					<div className="py-8 text-center flex flex-col items-center gap-2 text-xs p-3">
						<HugeiconsIcon icon={AlertCircleIcon} className="size-6 text-destructive" />
						<span className="text-foreground font-semibold">{fetchError}</span>
						<Button
							size="sm"
							variant="outline"
							onClick={() => void loadAssets()}
							className="text-[11px] h-7 px-2.5 mt-1"
						>
							重试
						</Button>
					</div>
				) : items.length === 0 ? (
					<div className="py-10 text-center flex flex-col items-center gap-2 text-xs text-muted-foreground">
						<span>暂无符合条件的素材</span>
						<Button
							size="sm"
							variant="outline"
							onClick={() => setIsModalOpen(true)}
							className="text-[11px] h-7 px-3 mt-1 cursor-pointer font-bold"
						>
							进入大窗全维筛选
						</Button>
					</div>
				) : (
					items.map((item) => {
						const isBusy = importingFid === item.fid;
						return (
							<div
								key={item.fid}
								className="group flex items-center justify-between p-2 rounded-lg border border-border/40 hover:border-border bg-card/50 hover:bg-card transition-all"
							>
								<div className="flex items-center gap-2.5 min-w-0 flex-1 mr-2">
									<div className="size-9 rounded bg-muted/60 flex items-center justify-center shrink-0 text-muted-foreground overflow-hidden">
										{item.thumb_url ? (
											<img
												src={item.thumb_url}
												alt=""
												className="size-full object-cover"
												onError={(e) => {
													(e.target as HTMLElement).style.display = "none";
												}}
											/>
										) : item.kind === "video" ? (
											<HugeiconsIcon icon={Video01Icon} className="size-4 text-slate-500" />
										) : item.kind === "audio" ? (
											<HugeiconsIcon icon={MusicNote03Icon} className="size-4 text-slate-500" />
										) : (
											<HugeiconsIcon icon={Image02Icon} className="size-4 text-slate-500" />
										)}
									</div>
									<div className="min-w-0 flex-1">
										<div className="text-xs font-bold truncate leading-tight" title={item.file_name}>
											{item.file_name}
										</div>
										<div className="text-[10px] text-muted-foreground font-mono mt-0.5">
											{formatBytes(item.size)}
											{item.duration ? ` · ${item.duration.toFixed(1)}s` : ""}
										</div>
									</div>
								</div>

								<Button
									size="sm"
									variant="outline"
									disabled={isBusy}
									onClick={() => handleImport(item)}
									className="h-7 px-2.5 text-[11px] font-bold shrink-0 cursor-pointer hover:bg-primary hover:text-primary-foreground shadow-xs"
								>
									<HugeiconsIcon icon={CloudDownloadIcon} className="size-3.5 mr-1" />
									{isBusy ? "导入中" : "导入"}
								</Button>
							</div>
						);
					})
				)}
			</div>

			{/* 底部缓存指示 */}
			<div className="pt-2 border-t border-border/40 shrink-0 flex items-center justify-between text-[11px] text-muted-foreground">
				<div className="flex items-center gap-1 font-mono">
					<span>本地缓存:</span>
					<span className="font-semibold text-foreground">{opfsUsage}</span>
				</div>
				<button
					type="button"
					onClick={() => {
						void updateStorageUsage();
						void loadAssets();
						toast.info("已刷新本地缓存与素材状态");
					}}
					className="hover:text-foreground text-[10px] flex items-center gap-1 cursor-pointer font-medium"
				>
					<HugeiconsIcon icon={CleanIcon} className="size-3" />
					刷新
				</button>
			</div>

			{/* 微缩版大弹窗组件：未传本地上传回调，弹窗内会隐藏该入口，避免点了没反应 */}
			<AssetLibraryPickerModal
				isOpen={isModalOpen}
				onOpenChange={setIsModalOpen}
			/>
		</PanelView>
	);
}
