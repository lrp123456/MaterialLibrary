import type { ElementType } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
	Folder03Icon,
	HeadphonesIcon,
	MagicWand05Icon,
	PuzzleIcon,
	Settings01Icon,
	TextIcon,
	TransitionRightIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { t } from "@/i18n";

/**
 * 左栏一级栏：按"往时间线放什么"切 7 栏。
 *
 * 栏内的细分（图片/视频/贴纸/云端…）走顶部 chip（见 assets/sub-tabs.tsx），
 * 不再往这里加 key——一级栏每多一个，竖向 tab 栏就多一层滚动。
 */
export const TAB_KEYS = [
	"media",
	"audio",
	"text",
	"transition",
	"effects",
	"plugins",
	"settings",
] as const;

export type Tab = (typeof TAB_KEYS)[number];

/**
 * 旧版 tab key → 新版 tab key。
 *
 * 9 栏时代用户本地可能存着 library/stickers/captions/ai/sounds，
 * 只要映射缺失，persist 出来的 activeTab 就是非法值，面板会直接空白。
 */
const TAB_MIGRATION: Record<string, Tab> = {
	media: "media",
	library: "media",
	stickers: "media",
	sounds: "audio",
	audio: "audio",
	text: "text",
	captions: "text",
	transition: "transition",
	effects: "effects",
	ai: "plugins",
	plugins: "plugins",
	settings: "settings",
};

/** 把任意历史值收敛成合法 tab，非法值统一回落到 media。 */
export function normalizeTab(value: unknown): Tab {
	if (typeof value !== "string") return "media";
	if (!Object.prototype.hasOwnProperty.call(TAB_MIGRATION, value)) return "media";
	return TAB_MIGRATION[value] as Tab;
}

const createHugeiconsIcon =
	({ icon }: { icon: IconSvgElement }) =>
	({ className }: { className?: string }) => (
		<HugeiconsIcon icon={icon} className={className} />
	);

export const tabs = {
	media: {
		icon: createHugeiconsIcon({ icon: Folder03Icon }),
		get label() { return t("assets.tab.media", "素材"); },
	},
	audio: {
		icon: createHugeiconsIcon({ icon: HeadphonesIcon }),
		get label() { return t("assets.tab.audio", "音频"); },
	},
	text: {
		icon: createHugeiconsIcon({ icon: TextIcon }),
		get label() { return t("assets.tab.text", "文本"); },
	},
	transition: {
		icon: createHugeiconsIcon({ icon: TransitionRightIcon }),
		get label() { return t("assets.tab.transition", "转场"); },
	},
	effects: {
		icon: createHugeiconsIcon({ icon: MagicWand05Icon }),
		get label() { return t("assets.tab.effects", "效果"); },
	},
	plugins: {
		icon: createHugeiconsIcon({ icon: PuzzleIcon }),
		get label() { return t("assets.tab.plugins", "插件"); },
	},
	settings: {
		icon: createHugeiconsIcon({ icon: Settings01Icon }),
		get label() { return t("assets.tab.settings", "工程"); },
	},
} satisfies Record<
	Tab,
	{ icon: ElementType<{ className?: string }>; label: string }
>;

export type MediaViewMode = "grid" | "list";
export type MediaSortKey = "name" | "type" | "duration" | "size";
export type MediaSortOrder = "asc" | "desc";

interface AssetsPanelStore {
	activeTab: Tab;
	setActiveTab: (tab: Tab) => void;
	highlightMediaId: string | null;
	requestRevealMedia: (mediaId: string) => void;
	clearHighlight: () => void;

	/* Media */
	mediaViewMode: MediaViewMode;
	setMediaViewMode: (mode: MediaViewMode) => void;
	mediaSortBy: MediaSortKey;
	mediaSortOrder: MediaSortOrder;
	setMediaSort: (args: { key: MediaSortKey; order: MediaSortOrder }) => void;
}

type PersistedAssetsPanelState = Pick<
	AssetsPanelStore,
	"activeTab" | "mediaViewMode" | "mediaSortBy" | "mediaSortOrder"
>;

export const useAssetsPanelStore = create<AssetsPanelStore>()(
	persist(
		(set) => ({
			activeTab: "media",
			setActiveTab: (tab) => set({ activeTab: tab }),
			highlightMediaId: null,
			requestRevealMedia: (mediaId) =>
				set({ activeTab: "media", highlightMediaId: mediaId }),
			clearHighlight: () => set({ highlightMediaId: null }),
			mediaViewMode: "grid",
			setMediaViewMode: (mode) => set({ mediaViewMode: mode }),
			mediaSortBy: "name",
			mediaSortOrder: "asc",
			setMediaSort: ({ key, order }) =>
				set({ mediaSortBy: key, mediaSortOrder: order }),
		}),
		{
			name: "assets-panel",
			// v2：9 栏 → 7 栏。旧版本是 0（无 version），迁移必须幂等且不给非法值。
			version: 2,
			partialize: (state) => ({
				activeTab: state.activeTab,
				mediaViewMode: state.mediaViewMode,
				mediaSortBy: state.mediaSortBy,
				mediaSortOrder: state.mediaSortOrder,
			}),
			migrate: (persistedState): PersistedAssetsPanelState => {
				const persisted = (persistedState ??
					{}) as Partial<PersistedAssetsPanelState>;

				return {
					activeTab: normalizeTab(persisted.activeTab),
					mediaViewMode: persisted.mediaViewMode ?? "grid",
					mediaSortBy: persisted.mediaSortBy ?? "name",
					mediaSortOrder: persisted.mediaSortOrder ?? "asc",
				};
			},
		},
	),
);
