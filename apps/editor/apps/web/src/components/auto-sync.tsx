"use client";

import { useEffect } from "react";
import { startAutoSync } from "@/services/cloud-snapshots/auto-sync";

/**
 * 后台自动同步挂载点：只对已绑定云端快照的工程生效。
 * 用户退出/切后台时推送，失败进入本地队列并指数退避重试。
 */
export function AutoSync() {
	useEffect(() => {
		const stop = startAutoSync();
		return stop;
	}, []);
	return null;
}
