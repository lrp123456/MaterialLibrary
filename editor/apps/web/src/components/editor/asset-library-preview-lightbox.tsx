"use client";

/**
 * 素材版本大图预览灯箱（素材库选择弹窗内部使用）。
 *
 * 交互对齐主应用创作库的选择平台：原图 / 衍生图可放大、左右切换、
 * 与原图并排对比，并可直接在灯箱里选中或取消该版本。
 * 纯展示组件，选中状态与选中回调都由弹窗持有。
 */

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { HugeiconsIcon } from "@hugeicons/react";
import {
	ArrowLeft01Icon,
	ArrowRight01Icon,
	Cancel01Icon,
} from "@hugeicons/core-free-icons";
import { cn } from "@/utils/ui";
import type { AssetVersion } from "../../../../../../shared/ml-asset-core/index";

interface AssetLibraryPreviewLightboxProps {
	/** 同一素材的全部版本：索引 0 固定为原图。 */
	versions: AssetVersion[];
	index: number;
	/** 素材名，用于标题。 */
	title: string;
	/** 某版本当前是否已选中。 */
	isPicked: (version: AssetVersion) => boolean;
	onIndexChange: (index: number) => void;
	onTogglePick: (version: AssetVersion) => void;
	onClose: () => void;
}

export function AssetLibraryPreviewLightbox({
	versions,
	index,
	title,
	isPicked,
	onIndexChange,
	onTogglePick,
	onClose,
}: AssetLibraryPreviewLightboxProps) {
	const [compare, setCompare] = useState(false);
	const current = versions[Math.max(0, Math.min(index, versions.length - 1))];
	const origin = versions.find((version) => !version.derivativeId) || versions[0];

	// 灯箱开着时接管键盘：Esc 关闭灯箱、左右键切换版本。
	// 必须用捕获阶段并阻止冒泡，否则 Radix Dialog 的 Esc 会把整个弹窗一起关掉。
	useEffect(() => {
		const handler = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault();
				event.stopPropagation();
				onClose();
				return;
			}
			if (event.key === "ArrowLeft") {
				event.preventDefault();
				event.stopPropagation();
				step(-1);
				return;
			}
			if (event.key === "ArrowRight") {
				event.preventDefault();
				event.stopPropagation();
				step(1);
			}
		};
		window.addEventListener("keydown", handler, true);
		return () => window.removeEventListener("keydown", handler, true);
	});

	function step(delta: number) {
		if (versions.length < 2) return;
		const next = (index + delta + versions.length) % versions.length;
		setCompare(false);
		onIndexChange(next);
	}

	if (!current) return null;
	const canCompare = Boolean(current.derivativeId && origin && origin.key !== current.key);
	const picked = isPicked(current);

	return (
		<div className="absolute inset-0 z-50 flex flex-col bg-black/95 backdrop-blur-sm">
			{/* 顶栏：版本信息与对比开关 */}
			<div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-5 py-3">
				<div className="flex min-w-0 items-center gap-2.5">
					<span className="truncate text-sm font-bold text-white">{title}</span>
					<span className="shrink-0 rounded-md border border-white/20 bg-white/10 px-1.5 py-0.5 text-[10px] font-bold text-white/80">
						{current.label}
					</span>
					{current.geometry ? (
						<span className="shrink-0 rounded-md bg-amber-400/90 px-1.5 py-0.5 text-[10px] font-bold text-slate-950">
							选中会改画幅
						</span>
					) : null}
					<span className="shrink-0 font-mono text-[10px] text-white/50">
						{index + 1} / {versions.length}
					</span>
				</div>
				<div className="flex shrink-0 items-center gap-2">
					{canCompare ? (
						<Button
							type="button"
							size="sm"
							variant="ghost"
							onClick={() => setCompare((prev) => !prev)}
							className={cn(
								"h-7 cursor-pointer border px-2.5 text-[11px] font-bold",
								compare
									? "border-sky-300/60 bg-sky-400/20 text-sky-300 hover:bg-sky-400/25"
									: "border-white/20 bg-white/10 text-white hover:bg-white/20",
							)}
						>
							{compare ? "退出对比" : "与原图对比"}
						</Button>
					) : null}
					<button
						type="button"
						onClick={onClose}
						title="关闭预览（Esc）"
						className="flex size-8 cursor-pointer items-center justify-center rounded-lg bg-white/10 text-white hover:bg-white/20"
					>
						<HugeiconsIcon icon={Cancel01Icon} className="size-4" />
					</button>
				</div>
			</div>

			{/* 画布 */}
			<div className="flex min-h-0 flex-1 items-stretch justify-center gap-3 p-4">
				{compare ? (
					<>
						<div className="relative flex h-full min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-white/10 bg-black/50">
							<span className="absolute left-2 top-2 z-10 rounded-md border border-white/15 bg-black/80 px-2 py-0.5 text-[10px] font-bold text-white">
								原图
							</span>
							<div className="flex size-full items-center justify-center p-3">
								<img
									src={origin.url}
									alt={`${title} 原图`}
									className="max-h-full max-w-full select-none object-contain"
								/>
							</div>
						</div>
						<div className="relative flex h-full min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-sky-300/40 bg-black/50">
							<span className="absolute left-2 top-2 z-10 rounded-md border border-sky-300/40 bg-white/15 px-2 py-0.5 text-[10px] font-bold text-sky-300">
								{current.label}
							</span>
							<div className="flex size-full items-center justify-center p-3">
								<img
									src={current.url}
									alt={`${title} ${current.label}`}
									className="max-h-full max-w-full select-none object-contain"
								/>
							</div>
						</div>
					</>
				) : (
					<div className="relative flex size-full items-center justify-center">
						<img
							src={current.url}
							alt={`${title} ${current.label}`}
							className="max-h-full max-w-full select-none object-contain"
						/>
						{versions.length > 1 ? (
							<>
								<button
									type="button"
									onClick={() => step(-1)}
									title="上一版本（←）"
									className="absolute left-2 top-1/2 flex size-10 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-white/20 bg-white/10 text-white hover:bg-white/20"
								>
									<HugeiconsIcon icon={ArrowLeft01Icon} className="size-4" />
								</button>
								<button
									type="button"
									onClick={() => step(1)}
									title="下一版本（→）"
									className="absolute right-2 top-1/2 flex size-10 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-white/20 bg-white/10 text-white hover:bg-white/20"
								>
									<HugeiconsIcon icon={ArrowRight01Icon} className="size-4" />
								</button>
							</>
						) : null}
					</div>
				)}
			</div>

			{/* 底栏：切换与选中 */}
			<div className="flex shrink-0 items-center justify-between gap-3 border-t border-white/10 bg-black/60 px-5 py-3">
				<span className="font-mono text-[10px] text-white/50">
					左右方向键切换版本 · Esc 关闭预览
				</span>
				<div className="flex items-center gap-2">
					<Button
						type="button"
						size="sm"
						variant="ghost"
						disabled={versions.length < 2}
						onClick={() => step(-1)}
						className="h-8 cursor-pointer border border-white/15 bg-white/10 px-3 text-[11px] font-bold text-white hover:bg-white/20"
					>
						上一版本
					</Button>
					<Button
						type="button"
						size="sm"
						variant="ghost"
						disabled={versions.length < 2}
						onClick={() => step(1)}
						className="h-8 cursor-pointer border border-white/15 bg-white/10 px-3 text-[11px] font-bold text-white hover:bg-white/20"
					>
						下一版本
					</Button>
					<Button
						type="button"
						size="sm"
						onClick={() => onTogglePick(current)}
						className={cn(
							"h-8 cursor-pointer px-4 text-[11px] font-bold",
							picked
								? "border border-white/20 bg-white/10 text-white hover:bg-white/20"
								: "bg-primary text-primary-foreground hover:bg-primary/90",
						)}
					>
						{picked ? "取消选择此版本" : "选择此版本"}
					</Button>
				</div>
			</div>
		</div>
	);
}
