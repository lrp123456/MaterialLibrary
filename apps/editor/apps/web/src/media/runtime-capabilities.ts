import { OPFSAdapter } from "@/services/storage/opfs-adapter";

export type MediaEnvironmentIssue = {
	title: string;
	description: string;
};

export const hasVideoDecoder = (): boolean =>
	typeof VideoDecoder !== "undefined";

export const hasMediaStorage = (): boolean =>
	typeof navigator !== "undefined" && OPFSAdapter.isSupported();

/** 当前是从局域网/公网地址打开时，给出同一台机器上的 HTTPS 入口。 */
export const getSecureEditorUrl = (): string | null => {
	if (typeof window === "undefined" || window.isSecureContext) return null;

	const { protocol, hostname, port } = window.location;
	if (protocol === "https:") return null;
	if (["127.0.0.1", "localhost", "[::1]", "::1"].includes(hostname)) {
		return null;
	}

	return `https://${hostname}${port ? `:${port}` : ""}/editor/projects`;
};

/** 本机回环地址：HTTP 下也是安全上下文，可作为兜底入口。 */
export const getLocalEditorUrl = (): string | null => {
	if (typeof window === "undefined" || window.isSecureContext) return null;

	const { protocol, hostname, port } = window.location;
	if (protocol === "https:") return null;
	if (["127.0.0.1", "localhost", "[::1]", "::1"].includes(hostname)) {
		return null;
	}

	return `http://127.0.0.1${port ? `:${port}` : ""}/editor/projects`;
};

const describeAccessFix = (): string => {
	const secureUrl = getSecureEditorUrl();
	const localUrl = getLocalEditorUrl();
	if (secureUrl) {
		return `请改用 ${secureUrl} 打开${localUrl ? `（本机也可直接用 ${localUrl}）` : ""}；手机、平板或他人设备首次访问需先安装本机 CA：${new URL("/mls-ca.crt", window.location.href).href}`;
	}
	if (typeof window !== "undefined" && window.isSecureContext) {
		return "请升级到最新版 Chrome / Edge；使用 App 内置 WebView 的请同时升级系统 WebView。";
	}
	return "请改用 HTTPS 打开，或升级到最新版 Chrome / Edge。";
};

export const getMediaStorageIssue = (): MediaEnvironmentIssue | null => {
	if (typeof window === "undefined" || hasMediaStorage()) return null;

	const reason = window.isSecureContext
		? `当前浏览器未开放 OPFS 本地存储（${window.location.origin}）。`
		: `当前地址 ${window.location.origin} 不是安全上下文，浏览器已禁用 OPFS（素材存储）与 WebCodecs（音视频解码）。`;

	return {
		title: "素材无法入库：浏览器本地存储不可用",
		description: `${reason}${describeAccessFix()}`,
	};
};

export const getVideoDecodeIssue = (): MediaEnvironmentIssue | null => {
	if (typeof window === "undefined" || hasVideoDecoder()) return null;

	const reason = window.isSecureContext
		? `当前浏览器没有提供 WebCodecs 视频解码（${window.location.origin}）。`
		: `浏览器没有启用 WebCodecs 视频解码（${window.location.origin} 不是安全上下文）。`;

	return {
		title: "当前环境无法解码视频",
		description: `${reason}这不是视频文件本身的问题，转码也无法解决。${describeAccessFix()}`,
	};
};
