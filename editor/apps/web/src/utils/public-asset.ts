const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/** public/ 下的静态资源必须带上 basePath，否则子路径部署会拿到网关的 HTML 兜底页。 */
export function publicAssetUrl(path: string): string {
	return `${BASE_PATH}${path.startsWith("/") ? path : `/${path}`}`;
}
