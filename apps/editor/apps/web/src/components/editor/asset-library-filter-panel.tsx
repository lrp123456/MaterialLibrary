"use client";

/**
 * 素材库选择弹窗的左侧筛选栏。
 *
 * 所有维度都对应 /api/viewer/assets 的服务端参数（见 src/api.js -> queryAssets）：
 * shelf / media_type / category / space / style / material / colors / orientation /
 * only_favorite / favorite_within / date / video_source / pose / character /
 * shot_type / clothing_category / season / furniture_item / furniture_craft / mood。
 *
 * 这里只负责「收集用户意图」，不发请求、不做前端过滤。
 */

import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { cn } from "@/utils/ui";
import {
	CHARACTER_OPTIONS,
	CLOTHING_CATEGORY_OPTIONS,
	CREATED_WITHIN_OPTIONS,
	FAVORITE_WINDOW_OPTIONS,
	FURNITURE_CRAFT_OPTIONS,
	FURNITURE_ITEM_FALLBACK,
	MEDIA_KIND_OPTIONS,
	MOOD_OPTIONS,
	POSE_OPTIONS,
	SEASON_OPTIONS,
	SHELF_PLATES,
	SHOT_TYPE_OPTIONS,
	SPACE_TAGS,
	SUB_CATEGORY_OPTIONS,
	colorHex,
	type AssetFacets,
	type AssetFilterState,
	type AssetMediaKind,
	type FacetOption,
} from "./asset-library-picker-shared";

interface AssetLibraryFilterPanelProps {
	filters: AssetFilterState;
	facets: AssetFacets;
	/** 只做局部字段合并；联动重置（换媒体大类/子分类时清空细分维度）由弹窗统一处理。 */
	onPatch: (patch: Partial<AssetFilterState>) => void;
	onReset: () => void;
}

/** 多选维度的点击行为：已选则移除，未选则追加。 */
function toggleValue(list: string[], value: string): string[] {
	return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

/** 单值维度的点击行为：再次点击同一项等于取消。 */
function toggleSingle(current: string, value: string): string {
	return current === value ? "" : value;
}

/** 把服务端 facets 转成统一的选项结构；facets 为空时用兜底静态项。 */
function toOptions(
	list: FacetOption[] | undefined,
	fallback: { key: string; label: string }[] = [],
): { key: string; label: string; count?: number }[] {
	const rows = (list || [])
		.filter((item) => item && (item.dir || item.label))
		.map((item) => ({ key: item.dir || item.label, label: item.label || item.dir, count: item.count }));
	if (rows.length) return rows;
	return fallback.map((item) => ({ key: item.key, label: item.label }));
}

function toOptionsFromLabels(labels: string[]): { key: string; label: string }[] {
	return labels.map((label) => ({ key: label, label }));
}

/** 画幅兜底：服务端 facet 为空时仍可按主应用常用的四种画幅筛选。 */
const ORIENTATION_FALLBACK = [
	{ key: "9:16", label: "9:16 竖图" },
	{ key: "3:4", label: "3:4 竖图" },
	{ key: "16:9", label: "16:9 横图" },
	{ key: "1:1", label: "1:1 方图" },
];

interface OptionChipProps {
	label: string;
	active: boolean;
	count?: number;
	dot?: string;
	onClick: () => void;
}

function OptionChip({ label, active, count, dot, onClick }: OptionChipProps) {
	return (
		<button
			type="button"
			onClick={onClick}
			title={typeof count === "number" ? `${label} · ${count} 件` : label}
			className={cn(
				"flex items-center gap-1 rounded-lg px-2 py-[3px] text-[11px] font-semibold transition-colors cursor-pointer",
				active
					? "bg-foreground text-background shadow-xs"
					: "bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground",
			)}
		>
			{dot ? (
				<span
					className={cn("size-2.5 rounded-full border", active ? "border-white/70" : "border-black/20")}
					style={{ backgroundColor: dot }}
				/>
			) : null}
			<span className="truncate max-w-[116px]">{label}</span>
			{typeof count === "number" && count > 0 ? (
				<span className={cn("font-mono text-[10px]", active ? "opacity-80" : "opacity-60")}>{count}</span>
			) : null}
			{active ? <HugeiconsIcon icon={Tick02Icon} className="size-3 shrink-0" /> : null}
		</button>
	);
}

interface ChipGroupProps {
	id: string;
	title: string;
	options: { key: string; label: string; count?: number }[];
	selected: string[];
	onToggle: (value: string) => void;
	/** 超过该数量后默认折叠，避免侧栏被长标签列表撑爆。 */
	maxVisible?: number;
	/** 主色维度用色块代替文字块。 */
	useColorDot?: boolean;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

function ChipGroup({
	id,
	title,
	options,
	selected,
	onToggle,
	maxVisible = 10,
	useColorDot = false,
	open,
	onOpenChange,
}: ChipGroupProps) {
	const [showAll, setShowAll] = useState(false);
	if (!options.length) return null;
	const visible = showAll ? options : options.slice(0, maxVisible);
	return (
		<section className="space-y-1.5">
			<button
				type="button"
				onClick={() => onOpenChange(!open)}
				className="flex w-full items-center justify-between text-[11px] font-bold text-foreground/80 hover:text-foreground cursor-pointer"
			>
				<span>{title}</span>
				<span className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground">
					{selected.length > 0 ? `已选 ${selected.length}` : ""}
					<HugeiconsIcon
						icon={ArrowDown01Icon}
						className={cn("size-3 transition-transform", open ? "" : "-rotate-90")}
					/>
				</span>
			</button>
			{open ? (
				<>
					<div className="flex flex-wrap gap-1">
						{visible.map((option) => (
							<OptionChip
								key={`${id}-${option.key}`}
								label={option.label}
								count={option.count}
								dot={useColorDot ? colorHex(option.label) : undefined}
								active={selected.includes(option.key)}
								onClick={() => onToggle(option.key)}
							/>
						))}
					</div>
					{options.length > maxVisible ? (
						<button
							type="button"
							onClick={() => setShowAll((prev) => !prev)}
							className="text-[10px] font-semibold text-primary hover:underline cursor-pointer"
						>
							{showAll ? "收起" : `展开全部 ${options.length} 项`}
						</button>
					) : null}
				</>
			) : null}
		</section>
	);
}

export function AssetLibraryFilterPanel({
	filters,
	facets,
	onPatch,
	onReset,
}: AssetLibraryFilterPanelProps) {
	// 分组展开状态：画幅/空间默认展开，其余默认收起，保持侧栏短小。
	const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
		orientation: true,
		space: true,
		style: false,
		material: false,
		colors: false,
		pose: true,
		character: false,
		shotType: false,
		clothing: true,
		season: false,
		furniture: true,
		craft: false,
		mood: true,
	});
	const setGroupOpen = (id: string, open: boolean) =>
		setOpenGroups((prev) => ({ ...prev, [id]: open }));

	const mediaKind = filters.mediaKind;
	const subCategory = filters.subCategory;
	const subOptions = mediaKind === "all" ? [] : SUB_CATEGORY_OPTIONS[mediaKind] || [];

	// 图片展示空间/风格/材质/主色；其他大类只展示与之相关的维度，避免无效筛选。
	const showInteriorDims =
		mediaKind === "all" || (mediaKind === "image" && (subCategory === "all" || subCategory === "interior_exterior"));
	const showPortraitDims = mediaKind === "image" && subCategory === "portrait";
	const showClothingDims = mediaKind === "image" && subCategory === "clothing";
	const showFurnitureDims = mediaKind === "image" && subCategory === "furniture";
	const showVideoDims = mediaKind === "video";
	const showAudioDims = mediaKind === "audio";
	const showOrientation = mediaKind === "all" || mediaKind === "image" || mediaKind === "video";

	const orientationOptions = toOptions(facets.orientation, ORIENTATION_FALLBACK);
	// 空间标签优先用接口 facets（带计数），接口没返回时退回常量，点击后仍由服务端过滤
	const spaceOptions = toOptions(
		facets.space,
		SPACE_TAGS.map((label) => ({ key: label, label })),
	);
	const styleOptions = toOptions(facets.styleAtom);
	const materialOptions = toOptions(facets.materialKind);
	const colorOptions = toOptions(facets.colors);
	const furnitureOptions = toOptions(facets.furnitureItem, FURNITURE_ITEM_FALLBACK);
	const craftOptions = toOptions(facets.furnitureCraft, toOptionsFromLabels(FURNITURE_CRAFT_OPTIONS));

	const dateValue = filters.date.length === 10 ? filters.date : "";
	const now = new Date();
	const todayValue = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
	const monthValue = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

	return (
		<aside className="flex w-60 shrink-0 flex-col border-r border-border/50 bg-muted/10">
			<div className="flex-1 space-y-3.5 overflow-y-auto p-3 scrollbar-thin">
				{/* 来源板块：对应服务端 shelf，决定素材处于哪条业务链路 */}
				<section className="space-y-1.5">
					<div className="text-[11px] font-bold text-foreground/80">来源板块</div>
					<div className="space-y-1">
						{SHELF_PLATES.map((plate) => {
							const active = filters.shelf === plate.key;
							return (
								<button
									key={plate.key}
									type="button"
									onClick={() => onPatch({ shelf: plate.key })}
									className={cn(
										"flex w-full flex-col items-start rounded-lg border px-2.5 py-1.5 text-left transition-colors cursor-pointer",
										active
											? "border-primary/50 bg-primary/10"
											: "border-transparent hover:border-border/60 hover:bg-muted/60",
									)}
								>
									<span
										className={cn(
											"text-[12px] font-bold",
											active ? "text-primary" : "text-foreground/85",
										)}
									>
										{plate.label}
									</span>
									<span className="text-[10px] text-muted-foreground">{plate.hint}</span>
								</button>
							);
						})}
					</div>
				</section>

				{/* 媒体大类 */}
				<section className="space-y-1.5">
					<div className="text-[11px] font-bold text-foreground/80">素材类型</div>
					<div className="grid grid-cols-2 gap-1">
						{MEDIA_KIND_OPTIONS.map((option) => {
							const active = filters.mediaKind === option.key;
							return (
								<button
									key={option.key}
									type="button"
									onClick={() =>
										onPatch({ mediaKind: option.key as AssetMediaKind, subCategory: "all" })
									}
									className={cn(
										"rounded-lg px-2 py-1 text-[11px] font-semibold transition-colors cursor-pointer",
										active
											? "bg-foreground text-background"
											: "bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground",
									)}
								>
									{option.label}
								</button>
							);
						})}
					</div>
				</section>

				{/* 子分类：对应服务端 category */}
				{subOptions.length > 1 ? (
					<section className="space-y-1.5">
						<div className="text-[11px] font-bold text-foreground/80">细分类目</div>
						<div className="space-y-1">
							{subOptions.map((option) => {
								const active = filters.subCategory === option.key;
								return (
									<button
										key={option.key}
										type="button"
										onClick={() => onPatch({ subCategory: option.key })}
										className={cn(
											"flex w-full items-center justify-between rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors cursor-pointer",
											active
												? "bg-primary/15 text-primary"
												: "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
										)}
									>
										<span>{option.label}</span>
										{active ? <HugeiconsIcon icon={Tick02Icon} className="size-3" /> : null}
									</button>
								);
							})}
						</div>
					</section>
				) : null}

				{/* 收藏：服务端 only_favorite + favorite_within */}
				<section className="space-y-1.5 rounded-lg border border-border/40 bg-background/40 p-2">
					<button
						type="button"
						onClick={() =>
							onPatch({
								onlyFavorite: !filters.onlyFavorite,
								favoriteWithin: filters.onlyFavorite ? "" : filters.favoriteWithin,
							})
						}
						className="flex w-full items-center justify-between cursor-pointer"
					>
						<span className="text-[11px] font-bold text-foreground/80">只看我的收藏</span>
						<span
							className={cn(
								"relative h-4 w-7 rounded-full transition-colors",
								filters.onlyFavorite ? "bg-primary" : "bg-muted",
							)}
						>
							<span
								className={cn(
									"absolute top-0.5 size-3 rounded-full bg-white shadow transition-all",
									filters.onlyFavorite ? "left-3.5" : "left-0.5",
								)}
							/>
						</span>
					</button>
					{filters.onlyFavorite ? (
						<select
							value={filters.favoriteWithin}
							onChange={(e) =>
								onPatch({ favoriteWithin: e.target.value as AssetFilterState["favoriteWithin"] })
							}
							className="h-7 w-full cursor-pointer rounded-lg border border-border/60 bg-background px-2 text-[11px] font-semibold"
						>
							{FAVORITE_WINDOW_OPTIONS.map((option) => (
								<option key={option.key} value={option.key}>
									{option.label}
								</option>
							))}
						</select>
					) : null}
				</section>

				{/* 时间：相对范围走服务端 created_within，精确日期走服务端 date，两者互斥 */}
				<section className="space-y-1.5">
					<div className="text-[11px] font-bold text-foreground/80">入库时间</div>
					<div className="flex flex-wrap gap-1">
						{CREATED_WITHIN_OPTIONS.map((option) => (
							<button
								key={`within-${option.key || "all"}`}
								type="button"
								onClick={() => onPatch({ createdWithin: option.key, date: "" })}
								className={cn(
									"rounded-md px-2 py-0.5 text-[10px] font-semibold cursor-pointer",
									filters.createdWithin === option.key && !filters.date
										? "bg-foreground text-background"
										: "bg-muted/50 text-muted-foreground hover:bg-muted",
								)}
							>
								{option.label}
							</button>
						))}
					</div>
					<input
						type="date"
						value={dateValue}
						onChange={(e) => onPatch({ date: e.target.value, createdWithin: "" })}
						className="h-7 w-full cursor-pointer rounded-lg border border-border/60 bg-background px-2 text-[11px] font-semibold"
					/>
					<div className="flex flex-wrap gap-1">
						<button
							type="button"
							onClick={() => onPatch({ date: todayValue, createdWithin: "" })}
							className={cn(
								"rounded-md px-2 py-0.5 text-[10px] font-semibold cursor-pointer",
								filters.date === todayValue
									? "bg-foreground text-background"
									: "bg-muted/50 text-muted-foreground hover:bg-muted",
							)}
						>
							今天
						</button>
						<button
							type="button"
							onClick={() => onPatch({ date: monthValue, createdWithin: "" })}
							className={cn(
								"rounded-md px-2 py-0.5 text-[10px] font-semibold cursor-pointer",
								filters.date === monthValue
									? "bg-foreground text-background"
									: "bg-muted/50 text-muted-foreground hover:bg-muted",
							)}
						>
							本月
						</button>
						{filters.date ? (
							<button
								type="button"
								onClick={() => onPatch({ date: "" })}
								className="rounded-md px-2 py-0.5 text-[10px] font-semibold text-muted-foreground hover:bg-muted cursor-pointer"
							>
								清除日期
							</button>
						) : null}
					</div>
					{filters.date.length === 7 ? (
						<div className="text-[10px] text-muted-foreground">当前按 {filters.date} 整月筛选</div>
					) : null}
				</section>

				{/* 视频来源：服务端 video_source（sync=手机实拍 / ai=AI 创作） */}
				{showVideoDims ? (
					<ChipGroup
						id="video-source"
						title="视频来源"
						options={[
							{ key: "sync", label: "手机实拍" },
							{ key: "ai", label: "AI 创作" },
						]}
						selected={filters.videoSource ? [filters.videoSource] : []}
						onToggle={(value) =>
							onPatch({ videoSource: toggleSingle(filters.videoSource, value) as "" | "sync" | "ai" })
						}
						open={openGroups.videoSource !== false}
						onOpenChange={(open) => setGroupOpen("videoSource", open)}
					/>
				) : null}

				{/* 画幅 */}
				{showOrientation ? (
					<ChipGroup
						id="orientation"
						title="画幅比例"
						options={orientationOptions}
						selected={filters.orientation ? [filters.orientation] : []}
						onToggle={(value) => onPatch({ orientation: toggleSingle(filters.orientation, value) })}
						open={openGroups.orientation}
						onOpenChange={(open) => setGroupOpen("orientation", open)}
					/>
				) : null}

				{/* 空间：服务端 space 标签维度 */}
				{showInteriorDims ? (
					<ChipGroup
						id="space"
						title="空间标签"
						options={spaceOptions}
						selected={filters.space}
						onToggle={(value) => onPatch({ space: toggleValue(filters.space, value) })}
						maxVisible={12}
						open={openGroups.space}
						onOpenChange={(open) => setGroupOpen("space", open)}
					/>
				) : null}

				{/* 风格：服务端 style（style_atom）标签维度 */}
				{showInteriorDims ? (
					<ChipGroup
						id="style"
						title="设计风格"
						options={styleOptions}
						selected={filters.style}
						onToggle={(value) => onPatch({ style: toggleValue(filters.style, value) })}
						maxVisible={10}
						open={openGroups.style}
						onOpenChange={(open) => setGroupOpen("style", open)}
					/>
				) : null}

				{/* 材质：服务端 material（material_kind），多选为严格 AND */}
				{showInteriorDims ? (
					<ChipGroup
						id="material"
						title="表面材质"
						options={materialOptions}
						selected={filters.material}
						onToggle={(value) => onPatch({ material: toggleValue(filters.material, value) })}
						maxVisible={10}
						open={openGroups.material}
						onOpenChange={(open) => setGroupOpen("material", open)}
					/>
				) : null}

				{/* 主色：服务端 colors（dominant_color） */}
				{showInteriorDims ? (
					<ChipGroup
						id="colors"
						title="主色系"
						options={colorOptions}
						selected={filters.colors}
						onToggle={(value) => onPatch({ colors: toggleValue(filters.colors, value) })}
						maxVisible={12}
						useColorDot
						open={openGroups.colors}
						onOpenChange={(open) => setGroupOpen("colors", open)}
					/>
				) : null}

				{/* 空间人像专属维度 */}
				{showPortraitDims ? (
					<>
						<ChipGroup
							id="pose"
							title="人像姿态"
							options={toOptionsFromLabels(POSE_OPTIONS)}
							selected={filters.pose}
							onToggle={(value) => onPatch({ pose: toggleValue(filters.pose, value) })}
							open={openGroups.pose}
							onOpenChange={(open) => setGroupOpen("pose", open)}
						/>
						<ChipGroup
							id="character"
							title="人物角色"
							options={toOptionsFromLabels(CHARACTER_OPTIONS)}
							selected={filters.character}
							onToggle={(value) => onPatch({ character: toggleValue(filters.character, value) })}
							open={openGroups.character}
							onOpenChange={(open) => setGroupOpen("character", open)}
						/>
						<ChipGroup
							id="shot-type"
							title="景别类型"
							options={toOptionsFromLabels(SHOT_TYPE_OPTIONS)}
							selected={filters.shotType}
							onToggle={(value) => onPatch({ shotType: toggleValue(filters.shotType, value) })}
							open={openGroups.shotType}
							onOpenChange={(open) => setGroupOpen("shotType", open)}
						/>
					</>
				) : null}

				{/* 服装服饰专属维度 */}
				{showClothingDims ? (
					<>
						<ChipGroup
							id="clothing"
							title="穿搭品类"
							options={toOptionsFromLabels(CLOTHING_CATEGORY_OPTIONS)}
							selected={filters.clothingCategory}
							onToggle={(value) =>
								onPatch({ clothingCategory: toggleValue(filters.clothingCategory, value) })
							}
							open={openGroups.clothing}
							onOpenChange={(open) => setGroupOpen("clothing", open)}
						/>
						<ChipGroup
							id="season"
							title="季节"
							options={toOptionsFromLabels(SEASON_OPTIONS)}
							selected={filters.season}
							onToggle={(value) => onPatch({ season: toggleValue(filters.season, value) })}
							open={openGroups.season}
							onOpenChange={(open) => setGroupOpen("season", open)}
						/>
					</>
				) : null}

				{/* 单品家具专属维度 */}
				{showFurnitureDims ? (
					<>
						<ChipGroup
							id="furniture"
							title="家具品类"
							options={furnitureOptions}
							selected={filters.furnitureItem}
							onToggle={(value) =>
								onPatch({ furnitureItem: toggleValue(filters.furnitureItem, value) })
							}
							open={openGroups.furniture}
							onOpenChange={(open) => setGroupOpen("furniture", open)}
						/>
						<ChipGroup
							id="craft"
							title="工艺材质"
							options={craftOptions}
							selected={filters.furnitureCraft}
							onToggle={(value) =>
								onPatch({ furnitureCraft: toggleValue(filters.furnitureCraft, value) })
							}
							open={openGroups.craft}
							onOpenChange={(open) => setGroupOpen("craft", open)}
						/>
					</>
				) : null}

				{/* 音频专属维度：服务端没有 bgm / sfx 分类参数，改用 mood 标签 */}
				{showAudioDims ? (
					<ChipGroup
						id="mood"
						title="情绪氛围"
						options={toOptionsFromLabels(MOOD_OPTIONS)}
						selected={filters.mood}
						onToggle={(value) => onPatch({ mood: toggleValue(filters.mood, value) })}
						open={openGroups.mood}
						onOpenChange={(open) => setGroupOpen("mood", open)}
					/>
				) : null}
			</div>

			<div className="shrink-0 border-t border-border/50 p-2">
				<button
					type="button"
					onClick={onReset}
					className="w-full rounded-lg border border-border/60 py-1.5 text-[11px] font-bold text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
				>
					重置全部筛选
				</button>
			</div>
		</aside>
	);
}
