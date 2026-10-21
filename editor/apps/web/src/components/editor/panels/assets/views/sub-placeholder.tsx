"use client";

import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";

/**
 * 二级分类的统一空态。
 *
 * 用于"入口已就位、渲染通道还没接"的二级栏（转场、滤镜、调节、录音、提取），
 * 明确告知原因，避免用户点到一片空白以为面板坏了。
 */
export function SubPlaceholder({
	icon,
	title,
	description,
}: {
	icon?: IconSvgElement;
	title: string;
	description: string;
}) {
	return (
		<div className="flex h-full flex-col items-center justify-center gap-3 px-6 py-10 text-center">
			{icon && (
				<HugeiconsIcon
					icon={icon}
					className="text-muted-foreground size-10"
					strokeWidth={1}
				/>
			)}
			<div className="flex flex-col gap-1.5">
				<span className="text-foreground text-sm font-semibold">{title}</span>
				<span className="text-muted-foreground text-xs text-balance">
					{description}
				</span>
			</div>
		</div>
	);
}
