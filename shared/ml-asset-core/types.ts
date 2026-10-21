/** 版本选择器的共享类型：web-pro(Vue) 与 editor(React) 共用，不依赖任何框架。 */

/** 素材种类（与素材库接口的 kind 对齐）。 */
export type AssetKind = "image" | "video" | "audio";

/** 素材列表项的最小视图模型；两端字段名不同，由调用方负责归一化。 */
export interface AssetLike {
	fid: string;
	name?: string;
	kind?: string;
	mediaToken?: string;
	url?: string;
}

/** 详情接口 `/api/viewer/assets/<fid>` 返回的衍生版本条目（只取用到的字段）。 */
export interface DerivativeLike {
	id: string;
	kind?: string;
	mime?: string;
}

/**
 * 一个可选中的素材版本。
 * key 是唯一身份：原图为裸 fid，衍生版为 `fid::derivativeId`。
 */
export interface AssetVersion {
	key: string;
	fid: string;
	mediaToken: string;
	derivativeId: string;
	derivativeKind: string;
	geometry?: boolean;
	label: string;
	url: string;
	kind: string;
	name: string;
}

/** 两端各自实现的 URL 构造器（鉴权方式不同，因此由调用方注入）。 */
export interface VersionUrlBuilders {
	originUrl: (item: AssetLike) => string;
	derivativeUrl: (item: AssetLike, derivativeId: string) => string;
}
