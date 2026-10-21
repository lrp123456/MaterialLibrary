/**
 * 素材库选择弹窗的共享类型、筛选项常量与轻量格式化工具。
 *
 * 设计原则：筛选维度对齐主应用「创作库」的选择平台
 * （web-pro/src/components/AssetPickerModal.vue）与环境主应用的素材库页面
 * （web-pro/src/views/LibraryView.vue），参数名与 /api/viewer/assets 的查询解析
 * （src/api.js -> queryAssets）逐字对应。
 *
 * 这里只声明「前端如何表达筛选」，不负责「如何过滤」——真正的过滤全部由服务端完成。
 */

/** 素材卡片的最小视图模型；外部（媒体池/素材面板）也按这个结构消费。 */
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
	/** 列表接口附带的标签文案，仅用于卡片展示；筛选走服务端标签维度。 */
	tag_labels?: string[];
	/** 是否已收藏（服务端 favorited_at 非空）。 */
	favorited?: boolean;
	/** 是否 AI 生成，用于卡片角标。 */
	is_ai?: boolean;
	created_at?: number;
	category?: string;
}

/** 媒体大类；all 表示不传 media_type，交给服务端返回混合列表。 */
export type AssetMediaKind = "all" | "image" | "video" | "audio";

/** 来源板块，对应服务端 shelf 参数：original / retouched / finished。 */
export type AssetShelfKey = "original" | "retouched" | "finished";

/** 排序；latest 为服务端默认排序，不需要显式传 sort。 */
export type AssetSortKey = "latest" | "name" | "size" | "earliest" | "recommend";

/** 入库时间范围；空字符串表示不限（服务端 created_within 只认 7d / 30d）。 */
export type AssetCreatedWithin = "" | "7d" | "30d";

/** 服务端 filterOptions 里各标签维度的条目。 */
export interface FacetOption {
	dir: string;
	label: string;
	count?: number;
}

/** 服务端随列表返回的动态候选值（空间/风格/材质/画幅/主色等）。 */
export interface AssetFacets {
	space: FacetOption[];
	styleAtom: FacetOption[];
	materialKind: FacetOption[];
	orientation: FacetOption[];
	colors: FacetOption[];
	furnitureItem: FacetOption[];
	furnitureCraft: FacetOption[];
}

/**
 * 弹窗的完整筛选状态。
 * 每个字段最终都映射成一个或多个 /api/viewer/assets 查询参数，不做前端二次过滤。
 */
export interface AssetFilterState {
	shelf: AssetShelfKey;
	mediaKind: AssetMediaKind;
	/** 媒体大类下的子分类，取值见 SUB_CATEGORY_OPTIONS。 */
	subCategory: string;
	/** 空间标签，服务端参数 space，多选以逗号分隔（维度内 OR）。 */
	space: string[];
	/** 风格标签，服务端参数 style（style_atom）。 */
	style: string[];
	/** 材质标签，服务端参数 material（material_kind，多选为严格 AND）。 */
	material: string[];
	/** 画幅，服务端参数 orientation（单值）。 */
	orientation: string;
	/** 主色，服务端参数 colors（dominant_color 多选 IN）。 */
	colors: string[];
	/** 只看收藏，服务端参数 only_favorite=1。 */
	onlyFavorite: boolean;
	/** 收藏时间范围，服务端参数 favorite_within（仅在只看收藏时生效）。 */
	favoriteWithin: "" | "today" | "7d" | "30d";
	/** 拍摄/入库时间，服务端参数 date，支持 YYYY-MM-DD 与 YYYY-MM。 */
	date: string;
	/** 入库时间范围，服务端参数 created_within：7d / 30d；与 date 互斥。 */
	createdWithin: AssetCreatedWithin;
	/** 视频来源，服务端参数 video_source：sync=手机实拍，ai=AI 创作。 */
	videoSource: "" | "sync" | "ai";
	/** 人像姿态，服务端参数 pose。 */
	pose: string[];
	/** 人物角色，服务端参数 character。 */
	character: string[];
	/** 景别类型，服务端参数 shot_type。 */
	shotType: string[];
	/** 穿搭品类，服务端参数 clothing_category。 */
	clothingCategory: string[];
	/** 季节，服务端参数 season。 */
	season: string[];
	/** 家具品类，服务端参数 furniture_item。 */
	furnitureItem: string[];
	/** 工艺材质，服务端参数 furniture_craft。 */
	furnitureCraft: string[];
	/** 音频情绪氛围，服务端参数 mood。 */
	mood: string[];
}

/** 默认筛选：原素材 + 全部类型，等价于主应用素材库的初始视图。 */
export function createDefaultFilters(): AssetFilterState {
	return {
		shelf: "original",
		mediaKind: "all",
		subCategory: "all",
		space: [],
		style: [],
		material: [],
		orientation: "",
		colors: [],
		onlyFavorite: false,
		favoriteWithin: "",
		date: "",
		createdWithin: "",
		videoSource: "",
		pose: [],
		character: [],
		shotType: [],
		clothingCategory: [],
		season: [],
		furnitureItem: [],
		furnitureCraft: [],
		mood: [],
	};
}

/**
 * 清掉与当前「媒体大类 + 细分类目」无关的隐藏维度。
 *
 * 筛选面板会按大类隐藏部分维度（见 asset-library-filter-panel 里的 show* 开关），
 * 若不清理，切换大类后那些看不见的条件仍会下发到服务端，把结果压成空列表。
 * 这里的可见性判定必须与筛选面板保持一致。
 */
export function sanitizeFilters(filters: AssetFilterState): AssetFilterState {
	const isInterior =
		filters.mediaKind === "all" ||
		(filters.mediaKind === "image" &&
			(filters.subCategory === "all" || filters.subCategory === "interior_exterior"));
	const isPortrait = filters.mediaKind === "image" && filters.subCategory === "portrait";
	const isClothing = filters.mediaKind === "image" && filters.subCategory === "clothing";
	const isFurniture = filters.mediaKind === "image" && filters.subCategory === "furniture";
	const isVideo = filters.mediaKind === "video";
	const isAudio = filters.mediaKind === "audio";

	return {
		...filters,
		space: isInterior ? filters.space : [],
		style: isInterior ? filters.style : [],
		material: isInterior ? filters.material : [],
		colors: isInterior ? filters.colors : [],
		orientation: isInterior || isVideo ? filters.orientation : "",
		pose: isPortrait ? filters.pose : [],
		character: isPortrait ? filters.character : [],
		shotType: isPortrait ? filters.shotType : [],
		clothingCategory: isClothing ? filters.clothingCategory : [],
		season: isClothing ? filters.season : [],
		furnitureItem: isFurniture ? filters.furnitureItem : [],
		furnitureCraft: isFurniture ? filters.furnitureCraft : [],
		mood: isAudio ? filters.mood : [],
		videoSource: isVideo ? filters.videoSource : "",
	};
}

/** 空候选值集合：首次拉取前先用它占位，避免侧栏闪一下空列表。 */
export const EMPTY_FACETS: AssetFacets = {
	space: [],
	styleAtom: [],
	materialKind: [],
	orientation: [],
	colors: [],
	furnitureItem: [],
	furnitureCraft: [],
};

/** 来源板块（对应 /api/viewer/assets 的 shelf 白名单）。 */
export const SHELF_PLATES = [
	{ key: "original", label: "原素材", hint: "未精修的母素材" },
	{ key: "retouched", label: "精修素材", hint: "AI 精修与衍生版本" },
	{ key: "finished", label: "成品素材", hint: "成品输出与商业短片" },
] as const;

/**
 * 空间标签兜底项。
 *
 * 正常情况下空间标签由列表接口随 filterOptions.space 返回（带计数），
 * 这里的常量只在接口没给出候选值（旧后端 / facets 被缓存成空）时补位，
 * 点击后仍然把 space 参数交给服务端过滤，不做前端过滤。
 */
export const SPACE_TAGS = [
	"客厅",
	"卧室",
	"厨房",
	"餐厅",
	"卫生间",
	"玄关",
	"阳台",
	"书房",
];

/** 媒体大类切换。 */
export const MEDIA_KIND_OPTIONS = [
	{ key: "all", label: "全部类型" },
	{ key: "image", label: "图片" },
	{ key: "video", label: "视频" },
	{ key: "audio", label: "音频" },
] as const;

/**
 * 子分类：与主应用素材库完全一致（LibraryView 的 SUB_CATEGORIES_CONFIG）。
 * 音频没有 bgm / sfx 的服务端参数，因此只保留「全部音频」，
 * 氛围区分改用服务端 mood 标签维度（见 MOOD_OPTIONS）。
 */
export const SUB_CATEGORY_OPTIONS: Record<
	Exclude<AssetMediaKind, "all">,
	{ key: string; label: string }[]
> = {
	image: [
		{ key: "all", label: "全部图片" },
		{ key: "interior_exterior", label: "室内外设计" },
		{ key: "portrait", label: "空间人像" },
		{ key: "clothing", label: "服装服饰" },
		{ key: "furniture", label: "单品家具" },
	],
	video: [
		{ key: "all", label: "全部视频" },
		{ key: "walkthrough", label: "空间漫游" },
		{ key: "ad", label: "商业短片" },
	],
	audio: [{ key: "all", label: "全部音频" }],
};

/** 人像姿态（服务端 tag 维度 pose）。 */
export const POSE_OPTIONS = ["站姿", "坐姿", "行走", "倚靠", "交谈/互动"];

/** 人物角色（服务端 tag 维度 character）。 */
export const CHARACTER_OPTIONS = ["商务精英", "居家男女", "亲子家庭", "青年学生", "休闲独处"];

/** 景别类型（服务端 tag 维度 shot_type）。 */
export const SHOT_TYPE_OPTIONS = ["全身照", "半身特写", "面部微距"];

/** 穿搭品类（服务端 tag 维度 clothing_category）。 */
export const CLOTHING_CATEGORY_OPTIONS = ["上衣外套", "裤装裙装", "西服套装", "鞋履配饰"];

/** 季节（服务端 tag 维度 season）。 */
export const SEASON_OPTIONS = ["春季", "夏季", "秋季", "冬季"];

/** 音频情绪氛围（服务端 tag 维度 mood）。 */
export const MOOD_OPTIONS = ["舒缓放松", "现代轻奢", "空灵静谧", "明快活力", "科技未来"];

/** 家具品类兜底项：服务端 facets 没返回时仍可筛选（参数仍交给服务端）。 */
export const FURNITURE_ITEM_FALLBACK = [
	{ key: "sofa", label: "组合沙发" },
	{ key: "armchair", label: "单人扶手椅" },
	{ key: "dining_table", label: "餐桌" },
	{ key: "coffee_table", label: "茶几" },
	{ key: "wardrobe", label: "衣柜" },
	{ key: "sideboard", label: "餐边柜" },
	{ key: "pendant_lamp", label: "吊灯" },
	{ key: "wall_sconce", label: "壁灯" },
];

/** 工艺材质（服务端 tag 维度 furniture_craft）。 */
export const FURNITURE_CRAFT_OPTIONS = [
	"木蜡油天然",
	"拉丝金属",
	"哑光烤漆",
	"做旧复古",
	"真皮",
	"岩板",
];

/** 收藏时间范围（服务端仅支持 today / 7d / 30d）。 */
export const FAVORITE_WINDOW_OPTIONS = [
	{ key: "", label: "全部时间" },
	{ key: "today", label: "今天收藏" },
	{ key: "7d", label: "近 7 天" },
	{ key: "30d", label: "近 30 天" },
] as const;

/** 排序（服务端 queryAssets 支持 name / size / earliest / recommend，latest 走默认倒序）。 */
export const SORT_OPTIONS = [
	{ key: "latest", label: "最新优先" },
	{ key: "name", label: "名称顺序" },
	{ key: "size", label: "体积大小" },
	{ key: "earliest", label: "最早优先" },
	{ key: "recommend", label: "推荐优先" },
] as const;

/** 入库时间范围快选（服务端 created_within）。 */
export const CREATED_WITHIN_OPTIONS = [
	{ key: "", label: "全部时间" },
	{ key: "7d", label: "最近 7 天" },
	{ key: "30d", label: "最近 30 天" },
] as const;

/** 每页数量：服务端 pageSize 上限 100。 */
export const PAGE_SIZE_OPTIONS = [24, 48, 96] as const;

/** 查询参数输入：筛选状态 + 工具栏（关键词/排序/分页）。 */
export interface AssetQueryInput {
	filters: AssetFilterState;
	/** 已确认的关键词（回车或点「检索」后才生效，避免每次击键都打服务端）。 */
	keyword: string;
	sort: AssetSortKey;
	page: number;
	pageSize: number;
}

/**
 * 子分类 → 服务端 category 参数。
 *
 * 服务端 queryAssets 对 category 的判定是一张白名单映射表：
 * interior_exterior / portrait / clothing / furniture / video / finished / music ...
 * 视频的「商业短片」其实就是成品库，所以映射到 finished。
 */
function resolveCategoryParam(filters: AssetFilterState): string {
	if (filters.subCategory === "all") return "";
	if (filters.mediaKind === "video") {
		if (filters.subCategory === "walkthrough") return "video";
		if (filters.subCategory === "ad") return "finished";
		return "";
	}
	// 音频没有 bgm/sfx 的服务端分类参数，子分类只有「全部音频」，无需映射
	if (filters.mediaKind === "audio") return "";
	return filters.subCategory;
}

/**
 * 把筛选状态翻译成 /api/viewer/assets 的查询参数。
 *
 * 原则：只要服务端 queryAssets 认这个参数，就一定交给服务端过滤，
 * 前端不再对结果做二次过滤 —— 否则总数（total）与分页会和服务端口径打架。
 * 参数名与 web-pro（创作库选择平台 / 素材库页面）逐字一致，便于两端共用同一套语义。
 */
export function buildAssetQueryParams({
	filters,
	keyword,
	sort,
	page,
	pageSize,
}: AssetQueryInput): Record<string, string> {
	const q: Record<string, string> = {
		page: String(Math.max(1, page)),
		pageSize: String(pageSize),
	};

	// 关键词：服务端 q（keyword 的短别名）同时匹配文件名与标签 label/dir
	const trimmed = keyword.trim();
	if (trimmed) q.q = trimmed;

	// 来源板块：original / retouched / finished（服务端 shelf 白名单）
	q.shelf = filters.shelf;

	// 媒体大类：视频 video、音频映射到服务端的 music（同时覆盖 kind=audio 与 *.mp3）
	if (filters.mediaKind === "video") q.media_type = "video";
	else if (filters.mediaKind === "audio") q.media_type = "music";
	else if (filters.mediaKind === "image") q.media_type = "image";

	// 细分类目：仅在有具体子分类时下发，避免 category=all 被服务端当成未知分类
	const category = resolveCategoryParam(filters);
	if (category) q.category = category;

	// 视频来源：sync=手机实拍（is_ai=0）、ai=AI 创作（is_ai=1），服务端只在视频范围内生效
	if (filters.videoSource) q.video_source = filters.videoSource;

	// 标签维度：服务端对同一维度内的多值取 OR，跨维度取 AND
	if (filters.space.length) q.space = filters.space.join(",");
	if (filters.style.length) q.style = filters.style.join(",");
	// 材质是服务端唯一「多值严格 AND」的维度（必须同时包含所有已选材质）
	if (filters.material.length) q.material = filters.material.join(",");
	if (filters.colors.length) q.colors = filters.colors.join(",");
	if (filters.pose.length) q.pose = filters.pose.join(",");
	if (filters.character.length) q.character = filters.character.join(",");
	if (filters.shotType.length) q.shot_type = filters.shotType.join(",");
	if (filters.clothingCategory.length) q.clothing_category = filters.clothingCategory.join(",");
	if (filters.season.length) q.season = filters.season.join(",");
	if (filters.furnitureItem.length) q.furniture_item = filters.furnitureItem.join(",");
	if (filters.furnitureCraft.length) q.furniture_craft = filters.furnitureCraft.join(",");
	if (filters.mood.length) q.mood = filters.mood.join(",");

	// 画幅：单值，9:16 / 3:4 服务端还会把「已重构出该画幅」的素材一并算进来
	if (filters.orientation) q.orientation = filters.orientation;

	// 时间：服务端只认 YYYY-MM-DD（当天）与 YYYY-MM（整月）
	if (filters.date) q.date = filters.date;
	// 相对范围：服务端 created_within 只认 7d / 30d，与精确 date 互斥
	else if (filters.createdWithin) q.created_within = filters.createdWithin;

	// 收藏：favorite_within 只在只看收藏时才有意义
	if (filters.onlyFavorite) {
		q.only_favorite = "1";
		if (filters.favoriteWithin) q.favorite_within = filters.favoriteWithin;
	}

	// 排序：latest 是服务端默认（时间倒序），不必显式下发
	if (sort !== "latest") q.sort = sort;

	return q;
}

/** 主色色块：与服务端 dominant_color 的中文取值对齐，未知颜色用中性灰。 */
const COLOR_HEX_MAP: Record<string, string> = {
	"原木/木色": "#B45309",
	"米/奶油": "#FDE68A",
	灰: "#94A3B8",
	白: "#FFFFFF",
	黑: "#1E293B",
	绿: "#10B981",
	蓝: "#3B82F6",
	红: "#EF4444",
	黄: "#EAB308",
	橙: "#F97316",
	粉: "#EC4899",
	紫: "#8B5CF6",
};

/** 主色 → 色块颜色。 */
export function colorHex(label: string): string {
	if (COLOR_HEX_MAP[label]) return COLOR_HEX_MAP[label];
	if (label.includes("木")) return COLOR_HEX_MAP["原木/木色"];
	if (label.includes("米") || label.includes("奶油")) return COLOR_HEX_MAP["米/奶油"];
	return "#64748B";
}

/** 文件体积。 */
export function formatBytes(bytes: number): string {
	if (!bytes || bytes <= 0) return "0 B";
	const k = 1024;
	const sizes = ["B", "KB", "MB", "GB"];
	const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(k)));
	return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

/** 时长。 */
export function formatDuration(seconds?: number): string {
	if (!seconds || seconds <= 0) return "";
	return `${seconds.toFixed(1)} 秒`;
}

/** 在候选值里找显示文案，找不到时退回原始 dir。 */
export function facetLabel(options: FacetOption[], dir: string): string {
	return options.find((item) => item.dir === dir)?.label || dir;
}

/** 统计当前生效的细化条件数量，用于侧栏与工具栏的「已筛选 N 项」。 */
export function countActiveFilters(filters: AssetFilterState): number {
	let count = 0;
	count += filters.space.length;
	count += filters.style.length;
	count += filters.material.length;
	count += filters.colors.length;
	count += filters.pose.length;
	count += filters.character.length;
	count += filters.shotType.length;
	count += filters.clothingCategory.length;
	count += filters.season.length;
	count += filters.furnitureItem.length;
	count += filters.furnitureCraft.length;
	count += filters.mood.length;
	if (filters.orientation) count += 1;
	if (filters.date) count += 1;
	if (filters.createdWithin) count += 1;
	if (filters.videoSource) count += 1;
	if (filters.onlyFavorite) count += 1;
	if (filters.mediaKind !== "all") count += 1;
	if (filters.subCategory !== "all") count += 1;
	if (filters.shelf !== "original") count += 1;
	return count;
}
