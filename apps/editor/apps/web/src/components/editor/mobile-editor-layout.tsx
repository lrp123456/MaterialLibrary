"use client";

import { useState } from "react";
import { AssetsPanel } from "@/components/editor/panels/assets";
import { PropertiesPanel } from "@/components/editor/panels/properties";
import { Timeline } from "@/timeline/components";
import { PreviewPanel } from "@/preview/components";
import {
	Sheet,
	SheetContent,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useElementSelection } from "@/timeline/hooks/element/use-element-selection";
import type { PreviewOverlayControl, PreviewOverlayInstance } from "@/preview/overlays";
import { SlidersHorizontal, Shapes } from "lucide-react";

interface MobileEditorLayoutProps {
	overlayControls: PreviewOverlayControl[];
	overlayInstances: PreviewOverlayInstance[];
	onOverlayVisibilityChange: (args: {
		overlayId: string;
		isVisible: boolean;
	}) => void;
}

/**
 * 触屏布局：预览占满上半屏，时间轴固定在底部，素材/属性面板改为底部抽屉。
 * 桌面端的三栏 + 可拖拽分栏在手机上无法同时成立，这里用抽屉保持全部能力可达，
 * 不做功能裁剪。
 */
export function MobileEditorLayout({
	overlayControls,
	overlayInstances,
	onOverlayVisibilityChange,
}: MobileEditorLayoutProps) {
	const [activeSheet, setActiveSheet] = useState<"assets" | "properties" | null>(
		null,
	);
	const { selectedElements } = useElementSelection();

	return (
		<div className="flex size-full min-h-0 flex-col">
			<div className="relative min-h-0 flex-1">
				<PreviewPanel
					overlayControls={overlayControls}
					overlayInstances={overlayInstances}
					onOverlayVisibilityChange={onOverlayVisibilityChange}
				/>
				<div className="pointer-events-none absolute right-2 bottom-2 flex flex-col gap-2">
					<Button
						size="sm"
						variant="secondary"
						className="pointer-events-auto h-9 gap-1.5 rounded-full px-3 text-xs shadow-md"
						onClick={() => setActiveSheet("assets")}
					>
						<Shapes className="size-4" />
						素材
					</Button>
					<Button
						size="sm"
						variant="secondary"
						className="pointer-events-auto h-9 gap-1.5 rounded-full px-3 text-xs shadow-md"
						onClick={() => setActiveSheet("properties")}
					>
						<SlidersHorizontal className="size-4" />
						属性{selectedElements.length ? ` (${selectedElements.length})` : ""}
					</Button>
				</div>
			</div>

			<div className="h-[46%] min-h-[200px] shrink-0 px-1 pb-1">
				<Timeline />
			</div>

			<Sheet
				open={activeSheet === "assets"}
				onOpenChange={(open) => setActiveSheet(open ? "assets" : null)}
			>
				<SheetContent
					side="bottom"
					className="flex h-[70vh] flex-col gap-2 p-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]"
				>
					<SheetHeader className="sr-only">
						<SheetTitle>素材面板</SheetTitle>
					</SheetHeader>
					<div className="min-h-0 flex-1">
						<AssetsPanel />
					</div>
				</SheetContent>
			</Sheet>

			<Sheet
				open={activeSheet === "properties"}
				onOpenChange={(open) => setActiveSheet(open ? "properties" : null)}
			>
				<SheetContent
					side="bottom"
					className="flex h-[70vh] flex-col gap-2 p-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]"
				>
					<SheetHeader className="sr-only">
						<SheetTitle>属性面板</SheetTitle>
					</SheetHeader>
					<div className="min-h-0 flex-1">
						<PropertiesPanel />
					</div>
				</SheetContent>
			</Sheet>
		</div>
	);
}
