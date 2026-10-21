"use client";

import { Separator } from "@/components/ui/separator";
import {
	type Tab,
	useAssetsPanelStore,
} from "@/components/editor/panels/assets/assets-panel-store";
import { TabBar } from "./tabbar";
import {
	AudioTabView,
	EffectsTabView,
	MediaTabView,
	PluginsTabView,
	ProjectTabView,
	TextTabView,
	TransitionTabView,
} from "./tab-views";

export function AssetsPanel() {
	const { activeTab } = useAssetsPanelStore();

	const viewMap: Record<Tab, React.ReactNode> = {
		media: <MediaTabView />,
		audio: <AudioTabView />,
		text: <TextTabView />,
		transition: <TransitionTabView />,
		effects: <EffectsTabView />,
		plugins: <PluginsTabView />,
		settings: <ProjectTabView />,
	};

	return (
		<div className="panel bg-background flex h-full rounded-sm border overflow-hidden">
			<TabBar />
			<Separator orientation="vertical" />
			{/* fallback：持久化数据损坏时也不留空白面板 */}
			<div className="flex-1 overflow-hidden">
				{viewMap[activeTab] ?? <MediaTabView />}
			</div>
		</div>
	);
}
