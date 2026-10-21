"use client";

import { useState } from "react";
import { cn } from "@/utils/ui";

/**
 * 素材栏二级分类（顶部 chip 行）。
 *
 * 左栏按"往时间线放什么"切成 7 个一级栏，栏内再按内容来源细分：
 * 二级 chip 只在栏内切换，不新开一级栏，避免又把 tab 数堆回 9 个。
 */
export interface SubTabItem<K extends string> {
	key: K;
	label: string;
}

export function SubTabs<K extends string>({
	items,
	value,
	onChange,
}: {
	items: readonly SubTabItem<K>[];
	value: K;
	onChange: (key: K) => void;
}) {
	return (
		<div className="bg-muted/20 flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border/40 px-2 py-1.5 scrollbar-none">
			{items.map((item) => {
				const isActive = item.key === value;
				return (
					<button
						key={item.key}
						type="button"
						onClick={() => onChange(item.key)}
						className={cn(
							"shrink-0 cursor-pointer rounded-full px-2.5 py-1 text-[11px] font-bold transition-colors",
							isActive
								? "bg-primary text-primary-foreground shadow-xs"
								: "text-muted-foreground hover:bg-muted hover:text-foreground",
						)}
					>
						{item.label}
					</button>
				);
			})}
		</div>
	);
}

/**
 * 二级栏容器：顶部 chip + 内容区。
 *
 * 各一级栏只提供 items 与 render，内容直接复用既有视图组件（sounds/stickers/
 * text/effects/subtitles 等），因此这一层不持有任何业务状态。
 */
export function SubTabShell<K extends string>({
	items,
	render,
}: {
	items: readonly SubTabItem<K>[];
	render: (key: K) => React.ReactNode;
}) {
	const [value, setValue] = useState<K>(items[0].key);

	return (
		<div className="flex h-full flex-col overflow-hidden">
			<SubTabs items={items} value={value} onChange={setValue} />
			<div className="min-h-0 flex-1 overflow-hidden">{render(value)}</div>
		</div>
	);
}
