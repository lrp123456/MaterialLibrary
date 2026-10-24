"use client";

import { useEffect, useState } from "react";
import {
	getMediaStorageIssue,
	getVideoDecodeIssue,
} from "@/media/runtime-capabilities";

/**
 * 局域网 http://IP 打开时，浏览器会禁用 OPFS / WebCodecs，素材导入与视频预览都会失败。
 * 与其等用户撞上「没有素材成功入库」，不如在页面顶部一次说清原因和出路。
 */
export function RuntimeCapabilityBanner() {
	const [message, setMessage] = useState<string | null>(null);

	useEffect(() => {
		const issue = getMediaStorageIssue() ?? getVideoDecodeIssue();
		setMessage(issue?.description ?? null);
	}, []);

	if (!message) return null;

	return (
		<div className="shrink-0 border-b border-amber-500/40 bg-amber-500/10 px-4 py-1.5 text-center text-xs leading-relaxed text-amber-800 dark:text-amber-200">
			{message}
		</div>
	);
}
