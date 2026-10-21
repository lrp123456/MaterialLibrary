"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/utils/ui";
import {
	TAB_KEYS,
	tabs,
	useAssetsPanelStore,
} from "@/components/editor/panels/assets/assets-panel-store";

export function TabBar() {
	const { activeTab, setActiveTab } = useAssetsPanelStore();
	const [showTopFade, setShowTopFade] = useState(false);
	const [showBottomFade, setShowBottomFade] = useState(false);
	const scrollRef = useRef<HTMLDivElement>(null);

	const checkScrollPosition = useCallback(() => {
		const element = scrollRef.current;
		if (!element) return;

		const { scrollTop, scrollHeight, clientHeight } = element;
		setShowTopFade(scrollTop > 0);
		setShowBottomFade(scrollTop < scrollHeight - clientHeight - 1);
	}, []);

	useEffect(() => {
		const element = scrollRef.current;
		if (!element) return;

		checkScrollPosition();
		element.addEventListener("scroll", checkScrollPosition);

		const resizeObserver = new ResizeObserver(checkScrollPosition);
		resizeObserver.observe(element);

		return () => {
			element.removeEventListener("scroll", checkScrollPosition);
			resizeObserver.disconnect();
		};
	}, [checkScrollPosition]);

	return (
		<div className="relative flex w-20 shrink-0 bg-muted/20 border-r border-border/40 select-none">
			<div
				ref={scrollRef}
				className="scrollbar-none relative flex size-full p-2 flex-col items-center justify-start gap-2 overflow-y-auto"
			>
				{TAB_KEYS.map((tabKey) => {
					const tab = tabs[tabKey];
					const isActive = activeTab === tabKey;
					return (
						<button
							key={tabKey}
							type="button"
							aria-label={tab.label}
							onClick={() => setActiveTab(tabKey)}
							className={cn(
								"w-full h-16 rounded-xl flex flex-col items-center justify-center gap-1.5 transition-all cursor-pointer shrink-0",
								isActive
									? "bg-primary text-primary-foreground font-extrabold shadow-sm"
									: "text-muted-foreground hover:bg-muted/70 hover:text-foreground font-semibold"
							)}
						>
							<div className="size-6 flex items-center justify-center">
								<tab.icon className="size-6 shrink-0" />
							</div>
							<span className="text-xs leading-none tracking-tight">
								{tab.label}
							</span>
						</button>
					);
				})}
			</div>

			<FadeOverlay direction="top" show={showTopFade} />
			<FadeOverlay direction="bottom" show={showBottomFade} />
		</div>
	);
}

function FadeOverlay({
	direction,
	show,
}: {
	direction: "top" | "bottom";
	show: boolean;
}) {
	return (
		<div
			className={cn(
				"pointer-events-none absolute right-0 left-0 h-4 z-10",
				direction === "top" && show
					? "from-background top-0 bg-linear-to-b to-transparent"
					: "from-background bottom-0 bg-linear-to-t to-transparent",
			)}
		/>
	);
}
