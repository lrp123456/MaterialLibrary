import { derivativeLabel, isGeometryKind } from "./labels";
import type { AssetLike, AssetVersion, DerivativeLike, VersionUrlBuilders } from "./types";

/** 版本身份：原图为裸 fid，衍生版为 `fid::derivativeId`。 */
export function versionKey(fid: string, derivativeId?: string): string {
	return derivativeId ? `${fid}::${derivativeId}` : String(fid);
}

/**
 * 把一条素材展开成「原图 + 全部衍生版」列表。
 * 详情接口会把 kind=origin 的衍生项也列出来，这里已用原图占位，故跳过。
 */
export function versionsOf(
	item: AssetLike,
	derivatives: DerivativeLike[] | undefined,
	urls: VersionUrlBuilders,
): AssetVersion[] {
	const fid = String(item.fid || "");
	if (!fid) return [];
	const list: AssetVersion[] = [
		{
			key: versionKey(fid, ""),
			fid,
			mediaToken: item.mediaToken || "",
			derivativeId: "",
			derivativeKind: "origin",
			label: "原图",
			url: urls.originUrl(item),
			kind: item.kind || "image",
			name: item.name || "",
		},
	];
	if (!Array.isArray(derivatives)) return list;
	const isPortraitOrClothing = item.category === 'portrait' || item.category === 'clothing';
	for (const d of derivatives) {
		if (!d || !d.id) continue;
		if (d.kind === "origin") continue;
		if (isPortraitOrClothing && String(d.kind || "").startsWith("restage_")) continue;
		list.push({
			key: versionKey(fid, d.id),
			fid,
			mediaToken: item.mediaToken || "",
			derivativeId: d.id,
			derivativeKind: d.kind || "",
			geometry: isGeometryKind(d.kind),
			label: derivativeLabel(d.kind),
			url: urls.derivativeUrl(item, d.id),
			kind: "image",
			name: item.name || "",
		});
	}
	return list;
}

/** 去掉仅供 UI 选中用的 key，得到可跨模块传递的载荷。 */
export function stripVersionKey(version: AssetVersion): Omit<AssetVersion, "key"> {
	const { key: _key, ...rest } = version;
	return rest;
}
