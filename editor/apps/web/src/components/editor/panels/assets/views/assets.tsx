"use client";

import { t } from "@/i18n";

import Image from "next/image";
import { useMemo, useState } from "react";
import { PanelView } from "@/components/editor/panels/assets/views/base-panel";
import {
	AssetLibraryPickerModal,
	type MaterialAssetItem,
} from "@/components/editor/asset-library-picker-modal";
import { MediaDragOverlay } from "@/components/editor/panels/assets/drag-overlay";
import { DraggableItem } from "@/components/editor/panels/assets/draggable-item";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
	cloudRowSelectionId,
	hasPendingCloudElement,
	insertPendingCloudElement,
	mergeMediaRows,
	useCloudMediaList,
	pendingMediaIdForFid,
	registerPendingMediaAsset,
	releasePendingMediaAsset,
	resolvePendingCloudElement,
	type MergedMediaRow,
} from "@/components/editor/panels/assets/views/media-merged";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { DEFAULT_NEW_ELEMENT_DURATION } from "@/timeline/creation";
import { mediaTimeFromSeconds, type MediaTime } from "@/wasm";
import { useEditor } from "@/editor/use-editor";
import { useFileUpload } from "@/media/use-file-upload";
import { invokeAction } from "@/actions";
import { processMediaAssets } from "@/media/processing";
import { showMediaUploadToast } from "@/media/upload-toast";
import {
	SelectableItem,
	SelectableSurface,
	useSelection,
	useSelectionScope,
} from "@/selection";
import { buildElementFromMedia } from "@/timeline/element-utils";
import {
	type MediaSortKey,
	type MediaSortOrder,
	type MediaViewMode,
	useAssetsPanelStore,
} from "@/components/editor/panels/assets/assets-panel-store";
import { MASKABLE_ELEMENT_TYPES } from "@/timeline";
import type { MediaAsset } from "@/media/types";
import { cn } from "@/utils/ui";
import {
	AlertCircleIcon,
	CloudDownloadIcon,
	CloudUploadIcon,
	GridViewIcon,
	LeftToRightListDashIcon,
	Loading03Icon,
	SortingOneNineIcon,
	Image02Icon,
	MusicNote03Icon,
	Video01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";

/** 素材栏一级 tab 的二级 chip 传给本视图的过滤条件。 */
export type MediaTypeFilter = "all" | "image" | "video";

export function MediaView({ filter = "all" }: { filter?: MediaTypeFilter }) {
	const editor = useEditor();
	const mediaFiles = useEditor((e) => e.media.getAssets());
	const activeProject = useEditor((e) => e.project.getActiveOrNull());
	// 云端只读目录：与本地素材在同一个列表里混排，靠 fid 去重
	const cloud = useCloudMediaList();

	const {
		mediaViewMode,
		setMediaViewMode,
		highlightMediaId,
		clearHighlight,
		mediaSortBy,
		mediaSortOrder,
		setMediaSort,
	} = useAssetsPanelStore();

	const [isProcessing, setIsProcessing] = useState(false);
	const [progress, setProgress] = useState(0);
	const [isPickerOpen, setIsPickerOpen] = useState(false);

	const processFiles = async ({ files }: { files: File[] }) => {
		if (!files || files.length === 0) return;
		if (!activeProject) {
			toast.error("当前没有打开的工程");
			return;
		}

		setIsProcessing(true);
		setProgress(0);
		try {
			await showMediaUploadToast({
				filesCount: files.length,
				promise: async () => {
					const processedAssets = await processMediaAssets({
						files,
						onProgress: (progress: { progress: number }) =>
							setProgress(progress.progress),
					});
					for (const asset of processedAssets) {
						await editor.media.addMediaAsset({
							projectId: activeProject.metadata.id,
							asset,
						});
					}
					return {
						uploadedCount: processedAssets.length,
						assetNames: processedAssets.map((asset) => asset.name),
					};
				},
			});
		} catch (error) {
			console.error("Error processing files:", error);
		} finally {
			setIsProcessing(false);
			setProgress(0);
		}
	};

	const { isDragOver, dragProps, openFilePicker, fileInputProps } =
		useFileUpload({
			accept: "image/*,video/*,audio/*",
			multiple: true,
			onFilesSelected: (files) => processFiles({ files }),
		});

	const handleRemove = ({
		event,
		ids,
	}: {
		event: React.MouseEvent;
		ids: string[];
	}) => {
		event.stopPropagation();

		if (!activeProject) {
			toast.error("当前没有打开的工程");
			return;
		}

		invokeAction("remove-media-assets", {
			projectId: activeProject.metadata.id,
			assetIds: ids,
		});
	};

	const handleSort = ({ key }: { key: MediaSortKey }) => {
		if (mediaSortBy === key) {
			setMediaSort({
				key,
				order: mediaSortOrder === "asc" ? "desc" : "asc",
			});
		} else {
			setMediaSort({ key, order: "asc" });
		}
	};

	const mergedRows = useMemo(
		() =>
			mergeMediaRows({
				localAssets: mediaFiles,
				cloudItems: cloud.items,
				filter,
				sortBy: mediaSortBy,
				sortOrder: mediaSortOrder,
			}),
		[mediaFiles, cloud.items, filter, mediaSortBy, mediaSortOrder],
	);

	// 选中/框选的有序 id：本地用 mediaId，云端用 cloud:<fid>
	const orderedMediaIds = useMemo(() => {
		return mergedRows.map((row) =>
			row.origin === "local"
				? row.asset.id
				: cloudRowSelectionId({ fid: row.item.fid }),
		);
	}, [mergedRows]);

	return (
		<>
			<input {...fileInputProps} />
			<AssetLibraryPickerModal
				isOpen={isPickerOpen}
				onOpenChange={setIsPickerOpen}
				onLocalFilesSelected={(files) => processFiles({ files })}
			/>

			<PanelView
				title={t("assets.media.unified", "素材（本地 + 云端）")}
				actions={
					<MediaActions
						mediaViewMode={mediaViewMode}
						setMediaViewMode={setMediaViewMode}
						isProcessing={isProcessing}
						sortBy={mediaSortBy}
						sortOrder={mediaSortOrder}
						onSort={handleSort}
						onImport={() => setIsPickerOpen(true)}
					/>
				}
				className={cn(isDragOver && "bg-accent/30")}
				contentClassName="h-full"
				{...dragProps}
			>
				<CloudStatus
					isLoading={cloud.isLoading}
					error={cloud.error}
					onRetry={() => void cloud.reload()}
				/>
				{isDragOver || (mergedRows.length === 0 && !cloud.isLoading) ? (
					<MediaDragOverlay
						isVisible={true}
						isProcessing={isProcessing}
						progress={progress}
						onClick={openFilePicker}
					/>
				) : (
					<SelectableSurface
						ariaLabel={t("assets.media", "素材")}
						orderedIds={orderedMediaIds}
						revealId={highlightMediaId}
						onRevealComplete={clearHighlight}
					>
						<MediaScopeRegistrar />
						<MediaItemList
							rows={mergedRows}
							mode={mediaViewMode}
							onRemove={handleRemove}
						/>
					</SelectableSurface>
				)}
			</PanelView>
		</>
	);
}

/** 云端目录的加载/失败状态条：本地列表照常可用，不阻塞编辑。 */
function CloudStatus({
	isLoading,
	error,
	onRetry,
}: {
	isLoading: boolean;
	error: string;
	onRetry: () => void;
}) {
	if (!isLoading && !error) return null;

	if (error) {
		return (
			<div className="text-muted-foreground mb-2 flex items-center gap-1.5 rounded-sm border border-dashed border-border/60 px-2 py-1.5 text-[11px]">
				<HugeiconsIcon icon={AlertCircleIcon} className="size-3.5 shrink-0 text-destructive" />
				<span className="min-w-0 flex-1 truncate" title={error}>
					云端素材未加载：{error}
				</span>
				<button
					type="button"
					onClick={onRetry}
					className="hover:text-foreground shrink-0 cursor-pointer font-bold"
				>
					重试
				</button>
			</div>
		);
	}

	return (
		<div className="text-muted-foreground mb-2 flex items-center gap-1.5 px-1 py-1 text-[11px]">
			<HugeiconsIcon icon={Loading03Icon} className="size-3.5 animate-spin" />
			正在加载云端素材…
		</div>
	);
}

function MediaScopeRegistrar() {
	useSelectionScope();
	return null;
}

function MediaAssetDraggable({
	item,
	preview,
	variant,
	isRounded,
	trailing,
}: {
	item: MediaAsset;
	preview: React.ReactNode;
	variant: "card" | "compact";
	isRounded?: boolean;
	trailing?: React.ReactNode;
}) {
	const editor = useEditor();

	const addElementAtTime = ({
		asset,
		startTime,
	}: {
		asset: MediaAsset;
		startTime: MediaTime;
	}) => {
		const duration =
			asset.duration != null
				? mediaTimeFromSeconds({ seconds: asset.duration })
				: DEFAULT_NEW_ELEMENT_DURATION;
		const element = buildElementFromMedia({
			mediaId: asset.id,
			mediaType: asset.type,
			name: asset.name,
			duration,
			startTime,
		});
		editor.timeline.insertElement({
			element,
			placement: { mode: "auto" },
		});
	};

	return (
		<DraggableItem
			name={item.name}
			preview={preview}
			dragData={{
				id: item.id,
				type: "media",
				mediaType: item.type,
				name: item.name,
				...(item.type !== "audio" && {
					targetElementTypes: [...MASKABLE_ELEMENT_TYPES],
				}),
			}}
			shouldShowPlusOnDrag={false}
			onAddToTimeline={({ currentTime }) =>
				addElementAtTime({ asset: item, startTime: currentTime })
			}
			variant={variant}
			isRounded={isRounded}
			trailing={trailing}
		/>
	);
}

function MediaItemWithContextMenu({
	item,
	children,
	onRemove,
}: {
	item: MediaAsset;
	children: React.ReactNode;
	onRemove: ({
		event,
		ids,
	}: {
		event: React.MouseEvent;
		ids: string[];
	}) => void;
}) {
	const { isSelected, selectedIds } = useSelection();
	const idsToDelete = isSelected(item.id) ? selectedIds : [item.id];
	const deleteLabel =
		idsToDelete.length > 1 ? `移除选中的 ${idsToDelete.length} 项素材` : t("assets.context.delete", "从媒体池移除");

	return (
		<ContextMenu>
			<ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
			<ContextMenuContent>
				<ContextMenuItem>{t("assets.context.exportClip", "导出片段")}</ContextMenuItem>
				<ContextMenuItem
					variant="destructive"
					onClick={(event: React.MouseEvent<HTMLDivElement>) =>
						onRemove({ event, ids: idsToDelete })
					}
				>
					{deleteLabel}
				</ContextMenuItem>
			</ContextMenuContent>
		</ContextMenu>
	);
}

function MediaItemList({
	rows,
	mode,
	onRemove,
}: {
	rows: MergedMediaRow[];
	mode: MediaViewMode;
	onRemove: ({
		event,
		ids,
	}: {
		event: React.MouseEvent;
		ids: string[];
	}) => void;
}) {
	const isGrid = mode === "grid";

	return (
		<div
			className={cn(isGrid ? "grid gap-4" : "flex flex-col gap-1.5")}
			style={
				isGrid ? { gridTemplateColumns: "repeat(auto-fill, 7rem)" } : undefined
			}
		>
			{rows.map((row) =>
				row.origin === "local" ? (
					<LocalMediaRow
						key={row.asset.id}
						asset={row.asset}
						isGrid={isGrid}
						onRemove={onRemove}
					/>
				) : (
					<CloudMediaRow key={row.item.fid} item={row.item} isGrid={isGrid} />
				),
			)}
		</div>
	);
}

function LocalMediaRow({
	asset,
	isGrid,
	onRemove,
}: {
	asset: MediaAsset;
	isGrid: boolean;
	onRemove: ({
		event,
		ids,
	}: {
		event: React.MouseEvent;
		ids: string[];
	}) => void;
}) {
	return (
		<MediaItemWithContextMenu item={asset} onRemove={onRemove}>
			<SelectableItem className={cn(!isGrid && "w-full")} id={asset.id}>
				<MediaAssetDraggable
					item={asset}
					preview={
						<div className="relative size-full">
							<MediaPreview
								item={asset}
								variant={isGrid ? "grid" : "compact"}
							/>
							{isGrid ? <LocalOriginBadge /> : null}
						</div>
					}
					variant={isGrid ? "card" : "compact"}
					isRounded={isGrid ? false : undefined}
					trailing={
						isGrid ? undefined : (
							<MediaRowMeta duration={asset.duration} origin="local" />
						)
					}
				/>
			</SelectableItem>
		</MediaItemWithContextMenu>
	);
}

/** 云端行：不在本地素材池里，拖到时间线时才下载。 */
function CloudMediaRow({
	item,
	isGrid,
}: {
	item: MaterialAssetItem;
	isGrid: boolean;
}) {
	return (
		<SelectableItem
			className={cn(!isGrid && "w-full")}
			id={cloudRowSelectionId({ fid: item.fid })}
		>
			<CloudMediaDraggable item={item} isGrid={isGrid} />
		</SelectableItem>
	);
}

/**
 * 云端项的拖拽外壳。
 *
 * 时序（拖拽路径）：
 * 1. dragstart：把云端项临时挂成一条 ephemeral 媒体（id = pendingMediaIdForFid），
 *    drop 控制器才有媒体可查，能正常算出落点、轨道和时长；
 * 2. dragend：摘掉临时媒体 → 若时间线上出现了引用该 pendingMediaId 的占位元素，
 *    就并发下载，成功替换 mediaId，失败删除占位并 toast；
 * 3. 加号按钮走 insertPendingCloudElement，落点用播放头，收尾逻辑完全相同。
 */
function CloudMediaDraggable({
	item,
	isGrid,
}: {
	item: MaterialAssetItem;
	isGrid: boolean;
}) {
	const editor = useEditor();
	const [isPending, setIsPending] = useState(false);
	const mediaId = pendingMediaIdForFid({ fid: item.fid });

	const handleDragStart = () => {
		try {
			registerPendingMediaAsset({ editor, item, mediaId });
		} catch (error) {
			// 临时媒体只在内存里，注册失败只是拖拽不落占位，不该打断用户操作
			console.error("注册云端占位媒体失败:", error);
		}
	};

	const handleDragEnd = () => {
		releasePendingMediaAsset({ editor, mediaId });
		// 落点不在时间线（面板内、预览区等）就不会有占位元素，不必下载
		if (!hasPendingCloudElement({ editor, mediaId })) return;

		setIsPending(true);
		void resolvePendingCloudElement({ editor, mediaId, item })
			.catch((error) => {
				console.error("云端素材下载收尾失败:", error);
				toast.error(`「${item.file_name}」下载失败`);
			})
			.finally(() => setIsPending(false));
	};

	const handleAddToTimeline = ({ currentTime }: { currentTime: MediaTime }) => {
		setIsPending(true);
		void insertPendingCloudElement({ editor, item, startTime: currentTime })
			.catch((error) => {
				console.error("云端素材插入失败:", error);
				toast.error(`「${item.file_name}」插入失败`);
			})
			.finally(() => setIsPending(false));
	};

	return (
		<div className={cn("relative", !isGrid && "w-full")}>
			<DraggableItem
				name={item.file_name}
				preview={
					<CloudPreview item={item} variant={isGrid ? "grid" : "compact"} />
				}
				dragData={{
					id: mediaId,
					type: "media",
					mediaType: item.kind,
					name: item.file_name,
					targetElementTypes: [...MASKABLE_ELEMENT_TYPES],
				}}
				onDragStart={handleDragStart}
				onDragEnd={handleDragEnd}
				onAddToTimeline={handleAddToTimeline}
				variant={isGrid ? "card" : "compact"}
				isRounded={isGrid ? false : undefined}
				trailing={
					isGrid ? undefined : (
						<MediaRowMeta duration={item.duration} origin="cloud" />
					)
				}
			/>
			{isPending ? (
				<div className="bg-background/75 text-foreground pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-sm text-[10px] font-bold">
					下载中…
				</div>
			) : null}
		</div>
	);
}

/** 列表行的元信息：时长 + 来源角标。 */
function MediaRowMeta({
	duration,
	origin,
}: {
	duration?: number;
	origin: "local" | "cloud";
}) {
	return (
		<span className="text-muted-foreground flex shrink-0 items-center gap-1 text-[10px]">
			{duration ? <span className="font-mono">{formatDuration({ duration })}</span> : null}
			<span
				className={cn(
					"rounded px-1 font-bold",
					origin === "cloud"
						? "bg-primary/15 text-primary"
						: "bg-muted text-muted-foreground",
				)}
			>
				{origin === "cloud" ? "云 · 未下载" : "本地"}
			</span>
		</span>
	);
}

function LocalOriginBadge() {
	return (
		<span className="absolute top-1 left-1 rounded bg-black/55 px-1 text-[0.6rem] font-bold text-white">
			本地
		</span>
	);
}

function CloudOriginBadge() {
	return (
		<span className="bg-primary/85 text-primary-foreground absolute top-1 right-1 rounded px-1 text-[0.6rem] font-bold">
			云
		</span>
	);
}

/** 云端项缩略图：半透明 + 下载角标，表示"还没落到本地"。 */
function CloudPreview({
	item,
	variant,
}: {
	item: MaterialAssetItem;
	variant: "grid" | "compact";
}) {
	const isGrid = variant === "grid";

	return (
		<div className="relative size-full">
			<div className="bg-muted absolute inset-0" />
			{item.thumb_url ? (
				<img
					src={item.thumb_url}
					alt={item.file_name}
					loading="lazy"
					className="absolute inset-0 size-full object-cover opacity-70"
					onError={(event) => {
						(event.target as HTMLElement).style.display = "none";
					}}
				/>
			) : (
				<div className="text-muted-foreground absolute inset-0 flex items-center justify-center">
					<HugeiconsIcon
						icon={item.kind === "video" ? Video01Icon : Image02Icon}
						className={isGrid ? "size-6" : "size-4"}
					/>
				</div>
			)}
			<div
				className={cn(
					"absolute inset-0 flex items-center justify-center",
					isGrid && "bg-black/20",
				)}
			>
				<HugeiconsIcon
					icon={CloudDownloadIcon}
					className={cn(
						"text-white drop-shadow",
						isGrid ? "size-5" : "size-3.5",
					)}
				/>
			</div>
			{isGrid ? (
				<>
					<CloudOriginBadge />
					<MediaDurationBadge duration={item.duration} />
				</>
			) : null}
		</div>
	);
}

function formatDuration({ duration }: { duration: number }) {
	const min = Math.floor(duration / 60);
	const sec = Math.floor(duration % 60);
	return `${min}:${sec.toString().padStart(2, "0")}`;
}

function MediaDurationBadge({ duration }: { duration?: number }) {
	if (!duration) return null;

	return (
		<div className="absolute right-1 bottom-1 rounded bg-black/70 px-1 text-xs text-white">
			{formatDuration({ duration })}
		</div>
	);
}

function MediaDurationLabel({ duration }: { duration?: number }) {
	if (!duration) return null;

	return (
		<span className="text-xs opacity-70">{formatDuration({ duration })}</span>
	);
}

function MediaTypePlaceholder({
	icon,
	label,
	duration,
	variant,
}: {
	icon: IconSvgElement;
	label: string;
	duration?: number;
	variant: "muted" | "bordered";
}) {
	const iconClassName = cn("size-6", variant === "bordered" && "mb-1");

	return (
		<div
			className={cn(
				"text-muted-foreground flex size-full flex-col items-center justify-center rounded",
				variant === "muted" ? "bg-muted/30" : "border",
			)}
		>
			<HugeiconsIcon icon={icon} className={iconClassName} />
			<span className="text-xs">{label}</span>
			<MediaDurationLabel duration={duration} />
		</div>
	);
}

function MediaPreview({
	item,
	variant = "grid",
}: {
	item: MediaAsset;
	variant?: "grid" | "compact";
}) {
	const shouldShowDurationBadge = variant === "grid";

	if (item.type === "image") {
		return (
			<div className="relative flex size-full items-center justify-center bg-muted">
				<Image
					src={item.url ?? ""}
					alt={item.name}
					fill
					sizes="100vw"
					className="object-cover"
					loading="lazy"
					unoptimized
				/>
			</div>
		);
	}

	if (item.type === "video") {
		if (item.thumbnailUrl) {
			return (
				<div className="relative size-full">
					<Image
						src={item.thumbnailUrl}
						alt={item.name}
						fill
						sizes="100vw"
						className="rounded object-cover"
						loading="lazy"
						unoptimized
					/>
					{shouldShowDurationBadge ? (
						<MediaDurationBadge duration={item.duration} />
					) : null}
				</div>
			);
		}

		return (
			<MediaTypePlaceholder
				icon={Video01Icon}
				label="视频"
				duration={item.duration}
				variant="muted"
			/>
		);
	}

	if (item.type === "audio") {
		return (
			<MediaTypePlaceholder
				icon={MusicNote03Icon}
				label="音频"
				duration={item.duration}
				variant="bordered"
			/>
		);
	}

	return (
		<MediaTypePlaceholder icon={Image02Icon} label="未知类型" variant="muted" />
	);
}

function MediaActions({
	mediaViewMode,
	setMediaViewMode,
	isProcessing,
	sortBy,
	sortOrder,
	onSort,
	onImport,
}: {
	mediaViewMode: MediaViewMode;
	setMediaViewMode: (mode: MediaViewMode) => void;
	isProcessing: boolean;
	sortBy: MediaSortKey;
	sortOrder: MediaSortOrder;
	onSort: ({ key }: { key: MediaSortKey }) => void;
	onImport: () => void;
}) {
	return (
		<div className="flex gap-1.5">
			<TooltipProvider>
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							size="icon"
							variant="ghost"
							onClick={() =>
								setMediaViewMode(mediaViewMode === "grid" ? "list" : "grid")
							}
							disabled={isProcessing}
							className="items-center justify-center"
						>
							{mediaViewMode === "grid" ? (
								<HugeiconsIcon icon={LeftToRightListDashIcon} />
							) : (
								<HugeiconsIcon icon={GridViewIcon} />
							)}
						</Button>
					</TooltipTrigger>
					<TooltipContent>
						<p>
							{mediaViewMode === "grid"
								? "切换到列表视图"
								: "切换到网格视图"}
						</p>
					</TooltipContent>
				</Tooltip>
				<Tooltip>
					<DropdownMenu>
						<TooltipTrigger asChild>
							<DropdownMenuTrigger asChild>
								<Button
									size="icon"
									variant="ghost"
									disabled={isProcessing}
									className="items-center justify-center"
								>
									<HugeiconsIcon icon={SortingOneNineIcon} />
								</Button>
							</DropdownMenuTrigger>
						</TooltipTrigger>
						<DropdownMenuContent align="end">
							<SortMenuItem
								label="名称"
								sortKey="name"
								currentSortBy={sortBy}
								currentSortOrder={sortOrder}
								onSort={onSort}
							/>
							<SortMenuItem
								label="类型"
								sortKey="type"
								currentSortBy={sortBy}
								currentSortOrder={sortOrder}
								onSort={onSort}
							/>
							<SortMenuItem
								label="时长"
								sortKey="duration"
								currentSortBy={sortBy}
								currentSortOrder={sortOrder}
								onSort={onSort}
							/>
							<SortMenuItem
								label="文件大小"
								sortKey="size"
								currentSortBy={sortBy}
								currentSortOrder={sortOrder}
								onSort={onSort}
							/>
						</DropdownMenuContent>
					</DropdownMenu>
					<TooltipContent>
						<p>
							按「{({ name: "名称", type: "类型", duration: "时长", size: "文件大小" } as Record<string, string>)[sortBy] ?? sortBy}」
							{sortOrder === "asc" ? "升序" : "降序"}排列
						</p>
					</TooltipContent>
				</Tooltip>
			</TooltipProvider>
			<Button
				variant="outline"
				onClick={onImport}
				disabled={isProcessing}
				size="sm"
				className="items-center justify-center gap-1.5"
			>
				<HugeiconsIcon icon={CloudUploadIcon} />
				导入
			</Button>
		</div>
	);
}

function SortMenuItem({
	label,
	sortKey,
	currentSortBy,
	currentSortOrder,
	onSort,
}: {
	label: string;
	sortKey: MediaSortKey;
	currentSortBy: MediaSortKey;
	currentSortOrder: MediaSortOrder;
	onSort: ({ key }: { key: MediaSortKey }) => void;
}) {
	const isActive = currentSortBy === sortKey;
	const arrow = isActive ? (currentSortOrder === "asc" ? "↑" : "↓") : "";

	return (
		<DropdownMenuItem onClick={() => onSort({ key: sortKey })}>
			{label} {arrow}
		</DropdownMenuItem>
	);
}
