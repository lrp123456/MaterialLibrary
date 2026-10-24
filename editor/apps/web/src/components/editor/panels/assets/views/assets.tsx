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
	authHeaders,
	cloudRowSelectionId,
	downloadCloudAssetToLocal,
	mergeMediaRows,
	useCloudMediaList,
	type MergedMediaRow,
} from "@/components/editor/panels/assets/views/media-merged";
import { snapshotDownloadPath } from "@/services/cloud-snapshots/fid-ref";
import { downloadMediaAsset, downloadMediaUrl } from "@/media/download-asset";
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
import { getMediaStorageIssue, getVideoDecodeIssue } from "@/media/runtime-capabilities";
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
	/** 本次素材（本工程素材池）/ 云素材（素材库只读目录）分开看 */
	const [mediaSource, setMediaSource] = useState<"local" | "cloud">("local");

	const processFiles = async ({ files }: { files: File[] }) => {
		if (!files || files.length === 0) return;
		if (!activeProject) {
			toast.error("当前没有打开的工程");
			return;
		}

		const storageIssue = getMediaStorageIssue();
		if (storageIssue) {
			toast.error(storageIssue.title, {
				description: storageIssue.description,
				duration: 12000,
			});
			return;
		}

		const videos = files.filter((file) => file.type.startsWith("video/"));
		const videoIssue = videos.length > 0 ? getVideoDecodeIssue() : null;
		if (videoIssue) {
			toast.warning(`${videoIssue.title}（已跳过 ${videos.length} 个视频）`, {
				description: videoIssue.description,
				duration: 12000,
			});
		}
		const importable = videoIssue
			? files.filter((file) => !file.type.startsWith("video/"))
			: files;
		if (importable.length === 0) return;

		setIsProcessing(true);
		setProgress(0);
		try {
			await showMediaUploadToast({
				filesCount: importable.length,
				promise: async () => {
					const processedAssets = await processMediaAssets({
						files: importable,
						onProgress: (progress: { progress: number }) =>
							setProgress(progress.progress),
					});
					const createdAssets: typeof processedAssets = [];
					for (const asset of processedAssets) {
						const created = await editor.media.addMediaAsset({
							projectId: activeProject.metadata.id,
							asset,
						});
						if (created) createdAssets.push(asset);
					}
					return {
						uploadedCount: createdAssets.length,
						assetNames: createdAssets.map((asset) => asset.name),
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

	/**
	 * 两组数据分开算，不再混排：
	 * - 本次素材 = 本工程素材池（可以直接上轨）
	 * - 云素材   = 素材库只读目录（必须先「导入到本次」才能上轨）
	 */
	const localRows = useMemo(
		() =>
			mergeMediaRows({
				localAssets: mediaFiles,
				cloudItems: [],
				filter,
				sortBy: mediaSortBy,
				sortOrder: mediaSortOrder,
			}),
		[mediaFiles, filter, mediaSortBy, mediaSortOrder],
	);

	const cloudRows = useMemo(
		() =>
			mergeMediaRows({
				localAssets: [],
				cloudItems: cloud.items,
				filter,
				sortBy: mediaSortBy,
				sortOrder: mediaSortOrder,
			}),
		[cloud.items, filter, mediaSortBy, mediaSortOrder],
	);

	const visibleRows = mediaSource === "local" ? localRows : cloudRows;

	// 选中/框选的有序 id：本地用 mediaId，云端用 cloud:<fid>
	const orderedMediaIds = useMemo(() => {
		return visibleRows.map((row) =>
			row.origin === "local"
				? row.asset.id
				: cloudRowSelectionId({ fid: row.item.fid }),
		);
	}, [visibleRows]);

	return (
		<>
			<input {...fileInputProps} />
			<AssetLibraryPickerModal
				isOpen={isPickerOpen}
				onOpenChange={setIsPickerOpen}
				onLocalFilesSelected={(files) => processFiles({ files })}
			/>

			<PanelView
				title={t("assets.media.unified", "素材")}
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
				className={cn(isDragOver && mediaSource === "local" && "bg-accent/30")}
				contentClassName="h-full"
				{...dragProps}
			>
				<CloudStatus
					isLoading={cloud.isLoading}
					error={cloud.error}
					onRetry={() => void cloud.reload()}
				/>
				{mediaSource === "local" &&
				(isDragOver || (localRows.length === 0 && !cloud.isLoading)) ? (
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
						{visibleRows.length === 0 ? (
							<CloudEmptyHint
								source={mediaSource}
								isLoading={cloud.isLoading}
							/>
						) : (
							<MediaItemList
								rows={visibleRows}
								mode={mediaViewMode}
								onRemove={handleRemove}
							/>
						)}
						{mediaSource === "cloud" &&
						!cloud.isLoading &&
						cloud.total > cloudRows.length ? (
							<button
								type="button"
								onClick={() => cloud.loadMore()}
								disabled={cloud.isLoadingMore}
								className="text-muted-foreground hover:text-foreground mx-auto mt-3 block cursor-pointer rounded-md border border-dashed border-border/60 px-3 py-1.5 text-[11px] font-bold transition-colors disabled:opacity-50"
							>
								{cloud.isLoadingMore
									? "加载中…"
									: `加载更多（已显示 ${cloudRows.length} / ${cloud.total}）`}
							</button>
						) : null}
					</SelectableSurface>
				)}
			</PanelView>
		</>
	);
}

/**
 * 素材来源切换：本次素材 / 云素材。
 *
 * 为什么要分开：两者可用性完全不同——本次素材可直接上轨，云素材是只读仓库，
 * 必须先导入。混在一个列表里，用户分不清"拖不动"和"没下载"。
 */
function MediaSourceSwitch({
	source,
	onChange,
	localCount,
	cloudCount,
}: {
	source: "local" | "cloud";
	onChange: (next: "local" | "cloud") => void;
	localCount: number;
	cloudCount: number;
}) {
	const items = [
		{ key: "local" as const, label: "本次素材", count: localCount },
		{ key: "cloud" as const, label: "云素材", count: cloudCount },
	];
	return (
		<div className="mb-2 flex items-center gap-1 rounded-md bg-accent/40 p-0.5">
			{items.map((item) => (
				<button
					key={item.key}
					type="button"
					onClick={() => onChange(item.key)}
					className={cn(
						"flex-1 cursor-pointer rounded px-2 py-1 text-[11px] font-semibold transition-colors",
						source === item.key
							? "bg-background text-foreground shadow-sm"
							: "text-muted-foreground hover:text-foreground",
					)}
				>
					{item.label}
					<span className="ml-1 font-mono opacity-60">{item.count}</span>
				</button>
			))}
		</div>
	);
}

function CloudEmptyHint({
	source,
	isLoading,
}: {
	source: "local" | "cloud";
	isLoading: boolean;
}) {
	if (isLoading) return null;
	return (
		<div className="text-muted-foreground flex h-24 items-center justify-center px-3 text-center text-[11px] leading-relaxed">
			{source === "local"
				? "本次还没有素材，把文件拖进来或点右上角导入。"
				: "素材库里还没有素材。云素材需要先「导入到本次」才能上轨。"}
		</div>
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
	const assets = useEditor((e) => e.media.getAssets());
	const idsToDelete = isSelected(item.id) ? selectedIds : [item.id];
	const deleteLabel =
		idsToDelete.length > 1 ? `移除选中的 ${idsToDelete.length} 项素材` : t("assets.context.delete", "从媒体池移除");
	const exportLabel =
		idsToDelete.length > 1
			? `导出所选 ${idsToDelete.length} 项素材`
			: t("assets.context.exportClip", "导出素材文件");

	const handleExport = (event: React.MouseEvent) => {
		event.stopPropagation();
		const targets = assets.filter((asset) => idsToDelete.includes(asset.id));
		const exported = targets.filter((asset) => downloadMediaAsset(asset)).length;
		if (!exported) {
			toast.error("找不到原始文件，无法导出");
			return;
		}
		toast.success(exported > 1 ? `已开始导出 ${exported} 个文件` : "已开始导出");
	};

	return (
		<ContextMenu>
			<ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
			<ContextMenuContent>
				<ContextMenuItem onClick={handleExport}>{exportLabel}</ContextMenuItem>
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

/**
 * 云素材行：只读。
 *
 * 规则：云端素材**不允许直接上轨**，必须先「导入到本次」变成本地素材。
 * 这样也避开了旧的「占位元素 + 后台下载替换」机制——那套在下载失败时会静默删掉元素，
 * 且 pending id 是确定性的，同一素材拖两次会互相干扰。
 */
function CloudMediaRow({
	item,
	isGrid,
}: {
	item: MaterialAssetItem;
	isGrid: boolean;
}) {
	const editor = useEditor();
	const activeProject = useEditor((e) => e.project.getActiveOrNull());
	const [isImporting, setIsImporting] = useState(false);

	const handleImport = (event: React.MouseEvent) => {
		event.stopPropagation();
		if (isImporting) return;
		if (!activeProject) {
			toast.error("请先打开或创建一个工程");
			return;
		}
		setIsImporting(true);
		void showMediaUploadToast({
			filesCount: 1,
			promise: async () => {
				const created = await downloadCloudAssetToLocal({
					editor,
					projectId: activeProject.metadata.id,
					item,
				});
				return { uploadedCount: 1, assetNames: [created.name] };
			},
		})
			.catch((error) => {
				console.error("云素材导入失败:", error);
				toast.error(`「${item.file_name}」导入失败`);
			})
			.finally(() => setIsImporting(false));
	};

	const handleExport = async (event: React.MouseEvent) => {
		event.stopPropagation();
		try {
			await downloadMediaUrl(snapshotDownloadPath(item.fid), item.file_name, {
				headers: authHeaders(),
			});
			toast.success(`已开始导出「${item.file_name}」`);
		} catch (error) {
			toast.error(
				`导出「${item.file_name}」失败：${error instanceof Error ? error.message : "未知错误"}`,
			);
		}
	};

	return (
		<ContextMenu>
			<ContextMenuTrigger asChild>
				<SelectableItem
					className={cn(!isGrid && "w-full")}
					id={cloudRowSelectionId({ fid: item.fid })}
				>
					<div className={cn("relative", !isGrid && "w-full")}>
						<DraggableItem
							name={item.file_name}
							preview={
								<CloudPreview item={item} variant={isGrid ? "grid" : "compact"} />
							}
							dragData={{
								id: cloudRowSelectionId({ fid: item.fid }),
								type: "media",
								mediaType: item.kind,
								name: item.file_name,
								targetElementTypes: [...MASKABLE_ELEMENT_TYPES],
							}}
							// 关键：不可拖拽，只能导入
							isDraggable={false}
							variant={isGrid ? "card" : "compact"}
							isRounded={isGrid ? false : undefined}
							trailing={
								isGrid ? undefined : (
									<MediaRowMeta duration={item.duration} origin="cloud" />
								)
							}
						/>
						{isImporting ? (
							<div className="bg-background/75 text-foreground pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-sm text-[10px] font-bold">
								导入中…
							</div>
						) : (
							<button
								type="button"
								onClick={handleImport}
								title="下载到本次素材，之后才能拖到时间线"
								className={cn(
									"absolute z-10 cursor-pointer rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-bold text-white transition-colors hover:bg-black/85",
									isGrid
										? "bottom-1 left-1 right-1 text-center"
										: "right-1 top-1/2 -translate-y-1/2",
								)}
							>
								导入到本次
							</button>
						)}
					</div>
				</SelectableItem>
			</ContextMenuTrigger>
			<ContextMenuContent>
				<ContextMenuItem onClick={handleExport}>
					{t("assets.context.exportClip", "导出素材文件")}
				</ContextMenuItem>
			</ContextMenuContent>
		</ContextMenu>
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
