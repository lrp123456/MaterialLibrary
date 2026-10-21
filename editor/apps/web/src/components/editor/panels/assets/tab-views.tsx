"use client";

import { t } from "@/i18n";
import { SubTabShell, type SubTabItem } from "./sub-tabs";
import { MediaView, type MediaTypeFilter } from "./views/assets";
import { LibraryView } from "./views/library";
import { AiView } from "./views/ai";
import { AiToolsView, PackListView } from "./views/plugins";
import { SettingsView } from "./views/settings";
import { SubPlaceholder } from "./views/sub-placeholder";
import { TransitionView } from "./views/transition";
import { SoundsView } from "@/sounds/components/assets-view";
import { StickersView } from "@/stickers/components/assets-view";
import { TextView } from "@/text/components/assets-view";
import { EffectsView } from "@/effects/components/assets-view";
import { Captions } from "@/subtitles/components/assets-view";
import {
	AudioWave01Icon,
	FilterIcon,
	Mic01Icon,
	SlidersHorizontalIcon,
} from "@hugeicons/core-free-icons";

/**
 * 7 个一级栏的二级 chip 与内容映射。
 *
 * 约定：内容一律复用既有视图组件，本文件只决定"哪一格渲染谁"，
 * 不改视图内部逻辑，改动面尽量停在包装层。
 */

type MediaSubTab = MediaTypeFilter | "sticker" | "cloud";
type AudioSubTab = "music" | "sfx" | "record" | "extract";
type TextSubTab = "title" | "styledText" | "caption" | "autoCaption";
type TransitionSubTab = "all" | "favorite";
type EffectsSubTab = "effect" | "filter" | "adjust";
type PluginsSubTab = "ai" | "packs" | "tasks";
type ProjectSubTab = "canvas" | "fps" | "background";

const MEDIA_SUB_TABS: readonly SubTabItem<MediaSubTab>[] = [
	{ key: "all", label: t("assets.sub.all", "全部") },
	{ key: "image", label: t("assets.sub.image", "图片") },
	{ key: "video", label: t("assets.sub.video", "视频") },
	{ key: "sticker", label: t("assets.sub.sticker", "贴纸") },
	{ key: "cloud", label: t("assets.sub.cloud", "云端") },
];

const AUDIO_SUB_TABS: readonly SubTabItem<AudioSubTab>[] = [
	{ key: "music", label: t("assets.sub.music", "音乐") },
	{ key: "sfx", label: t("assets.sub.sfx", "音效") },
	{ key: "record", label: t("assets.sub.record", "录音") },
	{ key: "extract", label: t("assets.sub.extract", "提取") },
];

const TEXT_SUB_TABS: readonly SubTabItem<TextSubTab>[] = [
	{ key: "title", label: t("assets.sub.title", "标题") },
	{ key: "styledText", label: t("assets.sub.styledText", "花字") },
	{ key: "caption", label: t("assets.sub.caption", "字幕") },
	{ key: "autoCaption", label: t("assets.sub.autoCaption", "智能字幕") },
];

const TRANSITION_SUB_TABS: readonly SubTabItem<TransitionSubTab>[] = [
	{ key: "all", label: t("assets.sub.all", "全部") },
	{ key: "favorite", label: t("assets.sub.favorite", "收藏") },
];

const EFFECTS_SUB_TABS: readonly SubTabItem<EffectsSubTab>[] = [
	{ key: "effect", label: t("assets.sub.effect", "特效") },
	{ key: "filter", label: t("assets.sub.filter", "滤镜") },
	{ key: "adjust", label: t("assets.sub.adjust", "调节") },
];

const PLUGINS_SUB_TABS: readonly SubTabItem<PluginsSubTab>[] = [
	{ key: "ai", label: t("assets.sub.aiTools", "AI 工具") },
	{ key: "packs", label: t("assets.sub.packs", "已装资源包") },
	// 旧的通用 AI 任务表单（字幕/抠像/美颜/瘦脸/超分）不能因为改版失去入口
	{ key: "tasks", label: t("assets.sub.aiTasks", "任务队列") },
];

const PROJECT_SUB_TABS: readonly SubTabItem<ProjectSubTab>[] = [
	{ key: "canvas", label: t("assets.sub.canvas", "画布") },
	{ key: "fps", label: t("assets.sub.fps", "帧率") },
	{ key: "background", label: t("assets.sub.background", "背景") },
];

export function MediaTabView() {
	return (
		<SubTabShell
			items={MEDIA_SUB_TABS}
			render={(key) => {
				if (key === "sticker") return <StickersView />;
				if (key === "cloud") return <LibraryView />;
				return <MediaView filter={key} />;
			}}
		/>
	);
}

export function AudioTabView() {
	return (
		<SubTabShell
			items={AUDIO_SUB_TABS}
			render={(key) => {
				if (key === "record") {
					return (
						<SubPlaceholder
							icon={Mic01Icon}
							title={t("assets.placeholder.record.title", "录音功能接入中")}
							description={t(
								"assets.placeholder.record.desc",
								"麦克风录制通道尚未接入，当前可先用「导入本地文件」把录音成品加进素材池。",
							)}
						/>
					);
				}
				if (key === "extract") {
					return (
						<SubPlaceholder
							icon={AudioWave01Icon}
							title={t("assets.placeholder.extract.title", "音频提取接入中")}
							description={t(
								"assets.placeholder.extract.desc",
								"从视频抽音轨依赖人声分离 runner，接入后可从时间轴片段直接提取。",
							)}
						/>
					);
				}
				return <SoundsView />;
			}}
		/>
	);
}

export function TextTabView() {
	return (
		<SubTabShell
			items={TEXT_SUB_TABS}
			render={(key) =>
				key === "title" || key === "styledText" ? <TextView /> : <Captions />
			}
		/>
	);
}

export function TransitionTabView() {
	return (
		<SubTabShell
			items={TRANSITION_SUB_TABS}
			render={() => <TransitionView />}
		/>
	);
}

export function EffectsTabView() {
	return (
		<SubTabShell
			items={EFFECTS_SUB_TABS}
			render={(key) => {
				if (key === "filter") {
					return (
						<SubPlaceholder
							icon={FilterIcon}
							title={t("assets.placeholder.filter.title", "滤镜库接入中")}
							description={t(
								"assets.placeholder.filter.desc",
								"LUT 需要 shader 侧支持，资源包已就位，渲染通道接入后自动出现在这里。",
							)}
						/>
					);
				}
				if (key === "adjust") {
					return (
						<SubPlaceholder
							icon={SlidersHorizontalIcon}
							title={t("assets.placeholder.adjust.title", "调节面板接入中")}
							description={t(
								"assets.placeholder.adjust.desc",
								"亮度/对比度/饱和度等基础调节正在接入调色 shader，暂请在属性面板调整。",
							)}
						/>
					);
				}
				return <EffectsView />;
			}}
		/>
	);
}

export function PluginsTabView() {
	return (
		<SubTabShell
			items={PLUGINS_SUB_TABS}
			// 三个二级：AI 工具（能力卡片 + TTS）/ 已装资源包（逐包状态）/ 任务队列（旧表单）
			render={(key) =>
				key === "packs" ? (
					<PackListView />
				) : key === "tasks" ? (
					<AiView />
				) : (
					<AiToolsView />
				)
			}
		/>
	);
}

export function ProjectTabView() {
	return <SubTabShell items={PROJECT_SUB_TABS} render={() => <SettingsView />} />;
}
