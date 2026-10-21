"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { PanelView } from "./base-panel";
import { getClipPackStatus, type ClipPackStatus } from "@/services/clip-packs";
import { t } from "@/i18n";
import { RefreshIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

/** 资源包类型 → 中文词条 key，缺词条时退回原始 type。 */
const PACK_TYPE_KEYS: Record<string, string> = {
	effect: "assets.packs.type.effect",
	transition: "assets.packs.type.transition",
	textTemplate: "assets.packs.type.textTemplate",
	lut: "assets.packs.type.lut",
	sticker: "assets.packs.type.sticker",
	assetPack: "assets.packs.type.assetPack",
};

/**
 * "已装资源包"：只读展示 clip-packs 加载器的状态快照。
 *
 * 加载器是单例且原地更新的，所以每次进入/点刷新时重新取一次快照，
 * 不做轮询——资源包只在编辑器启动或手动 reload 时变化。
 */
export function PackStatusView() {
	const [status, setStatus] = useState<ClipPackStatus>(() => snapshot());

	return (
		<PanelView
			title={t("assets.packs.title", "已装资源包")}
			contentClassName="px-2 flex flex-col gap-3 pb-4"
			actions={
				<Button
					size="icon"
					variant="ghost"
					aria-label={t("assets.packs.refresh", "刷新资源包状态")}
					onClick={() => setStatus(snapshot())}
				>
					<HugeiconsIcon icon={RefreshIcon} />
				</Button>
			}
		>
			<div className="flex flex-wrap items-center gap-1.5">
				<span
					className={
						status.loaded
							? "rounded-full border border-emerald-500/40 px-2 py-0.5 text-[11px] text-emerald-500"
							: "text-muted-foreground rounded-full border border-dashed px-2 py-0.5 text-[11px]"
					}
				>
					{status.loaded
						? t("assets.packs.loaded", "已加载")
						: t("assets.packs.notLoaded", "未加载")}
				</span>
				<span className="text-muted-foreground rounded-full border px-2 py-0.5 text-[11px]">
					{withCount(
						t("assets.packs.registeredCount", "已注册 {count} 个"),
						status.registered.length,
					)}
				</span>
				<span className="text-muted-foreground rounded-full border px-2 py-0.5 text-[11px]">
					{withCount(
						t("assets.packs.blockedCount", "被拦截 {count} 个"),
						status.blocked.length,
					)}
				</span>
			</div>

			{status.error && (
				<div className="border-destructive/20 bg-destructive/10 rounded-md border p-2 text-xs text-destructive break-all">
					{status.error}
				</div>
			)}

			<div className="flex flex-col gap-1">
				<span className="text-xs font-medium">
					{t("assets.packs.byType", "按类型统计")}
				</span>
				{Object.keys(status.byType).length === 0 ? (
					<span className="text-muted-foreground text-xs">
						{t("assets.packs.empty", "尚未加载任何资源包")}
					</span>
				) : (
					<div className="flex flex-wrap gap-1.5">
						{Object.entries(status.byType).map(([type, count]) => (
							<span
								key={type}
								className="bg-muted/40 rounded px-2 py-0.5 text-[11px]"
							>
								{t(PACK_TYPE_KEYS[type] ?? "", type)} · {count}
							</span>
						))}
					</div>
				)}
			</div>

			{status.registered.length > 0 && (
				<div className="flex flex-col gap-1">
					<span className="text-xs font-medium">
						{t("assets.packs.registered", "已注册")}
					</span>
					<div className="flex flex-col gap-1">
						{status.registered.map((id) => (
							<div
								key={id}
								className="rounded border px-2 py-1 font-mono text-[11px] break-all"
							>
								{id}
							</div>
						))}
					</div>
				</div>
			)}

			{status.blocked.length > 0 && (
				<div className="flex flex-col gap-1">
					<span className="text-xs font-medium">
						{t("assets.packs.blocked", "被拦截")}
					</span>
					<div className="flex flex-col gap-1">
						{status.blocked.map((item) => (
							<div
								key={`${item.id}-${item.reason}`}
								className="rounded border px-2 py-1.5 text-[11px]"
							>
								<div className="font-mono break-all">{item.id}</div>
								<div className="text-muted-foreground mt-0.5 break-all">
									{item.reason}
								</div>
							</div>
						))}
					</div>
				</div>
			)}
		</PanelView>
	);
}

/** 词条里的 {count} 占位替换（zh.ts 只存模板，不做格式化）。 */
function withCount(template: string, count: number): string {
	return template.replace("{count}", String(count));
}

/** 取资源包状态快照：加载器是单例且原地更新的，直接引用会让 React 认为没变。 */
function snapshot(): ClipPackStatus {
	const status = getClipPackStatus();
	return {
		...status,
		registered: [...status.registered],
		blocked: [...status.blocked],
		byType: { ...status.byType },
	};
}
