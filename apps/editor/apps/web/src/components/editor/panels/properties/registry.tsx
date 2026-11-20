import { t } from "@/i18n";
import type { ReactNode } from "react";
import type {
	EffectElement,
	GraphicElement,
	ImageElement,
	MaskableElement,
	RetimableElement,
	StickerElement,
	TextElement,
	VisualElement,
	VideoElement,
	AudioElement,
	TimelineElement,
} from "@/timeline";
import type { MediaAsset } from "@/media/types";
import { HugeiconsIcon } from "@hugeicons/react";
import {
	TextFontIcon,
	ArrowExpandIcon,
	RainDropIcon,
	MusicNote03Icon,
	MagicWand05Icon,
	DashboardSpeed02Icon,
	Exchange01Icon,
} from "@hugeicons/core-free-icons";
import { ElementParamsTab } from "./components/element-params-tab";
import { ClipEffectsTab, StandaloneEffectTab } from "@/effects/components/effects-tab";
import { MasksTab } from "@/masks/components/masks-tab";
import { SpeedTab } from "@/speed/components/speed-tab";
import { GraphicTab } from "@/graphics/components/graphic-tab";
import { TransitionTab } from "./components/transition-tab";
import { OcShapesIcon } from "@/components/icons";

const TRANSFORM_PARAM_KEYS = [
	"transform.positionX",
	"transform.positionY",
	"transform.scaleX",
	"transform.scaleY",
	"transform.rotate",
] as const;

const BLENDING_PARAM_KEYS = ["opacity", "blendMode"] as const;
const AUDIO_PARAM_KEYS = ["volume", "muted"] as const;
const TEXT_PARAM_KEYS = [
	"content",
	"fontFamily",
	"fontSize",
	"color",
	"textAlign",
	"fontWeight",
	"fontStyle",
	"textDecoration",
	"letterSpacing",
	"lineHeight",
	"background.enabled",
	"background.color",
	"background.cornerRadius",
	"background.paddingX",
	"background.paddingY",
	"background.offsetX",
	"background.offsetY",
] as const;

export type TabContentProps = {
	trackId: string;
};

export type PropertiesTabDef = {
	id: string;
	label: string;
	icon: ReactNode;
	content: (props: TabContentProps) => ReactNode;
};

export type ElementPropertiesConfig = {
	defaultTab: string;
	tabs: PropertiesTabDef[];
};

function buildTransformTab({
	element,
}: {
	element: VisualElement;
}): PropertiesTabDef {
	return {
		id: "transform",
		get label() { return t("inspector.tabs.transform", "基础变换"); },
		icon: <HugeiconsIcon icon={ArrowExpandIcon} size={16} />,
		content: ({ trackId }) => (
			<ElementParamsTab
				element={element}
				trackId={trackId}
				paramKeys={TRANSFORM_PARAM_KEYS}
				sectionKey="transform"
			/>
		),
	};
}

function buildBlendingTab({
	element,
}: {
	element: VisualElement;
}): PropertiesTabDef {
	return {
		id: "blending",
		get label() { return t("inspector.tabs.blending", "混合模式"); },
		icon: <HugeiconsIcon icon={RainDropIcon} size={16} />,
		content: ({ trackId }) => (
			<ElementParamsTab
				element={element}
				trackId={trackId}
				paramKeys={BLENDING_PARAM_KEYS}
				sectionKey="blending"
			/>
		),
	};
}

function buildAudioTab({
	element,
}: {
	element: AudioElement | VideoElement;
}): PropertiesTabDef {
	return {
		id: "audio",
		get label() { return t("inspector.tabs.audio", "音频参数"); },
		icon: <HugeiconsIcon icon={MusicNote03Icon} size={16} />,
		content: ({ trackId }) => (
			<ElementParamsTab
				element={element}
				trackId={trackId}
				paramKeys={AUDIO_PARAM_KEYS}
				sectionKey="audio"
			/>
		),
	};
}

function buildSpeedTab({
	element,
}: {
	element: RetimableElement;
}): PropertiesTabDef {
	return {
		id: "speed",
		get label() { return t("inspector.tabs.speed", "变速控制"); },
		icon: <HugeiconsIcon icon={DashboardSpeed02Icon} size={16} />,
		content: ({ trackId }) => <SpeedTab element={element} trackId={trackId} />,
	};
}

function buildMasksTab({
	element,
}: {
	element: MaskableElement;
}): PropertiesTabDef {
	return {
		id: "masks",
		get label() { return t("inspector.tabs.masks", "形状遮罩"); },
		icon: <OcShapesIcon size={16} />,
		content: ({ trackId }) => <MasksTab element={element} trackId={trackId} />,
	};
}

function buildClipEffectsTab({
	element,
}: {
	element: VisualElement;
}): PropertiesTabDef {
	return {
		id: "effects",
		get label() { return t("inspector.tabs.effects", "特效滤镜"); },
		icon: <HugeiconsIcon icon={MagicWand05Icon} size={16} />,
		content: ({ trackId }) => (
			<ClipEffectsTab element={element} trackId={trackId} />
		),
	};
}

function buildTextTab({ element }: { element: TextElement }): PropertiesTabDef {
	return {
		id: "text",
		get label() { return t("inspector.tabs.text", "文字排版"); },
		icon: <HugeiconsIcon icon={TextFontIcon} size={16} />,
		content: ({ trackId }) => (
			<ElementParamsTab
				element={element}
				trackId={trackId}
				paramKeys={TEXT_PARAM_KEYS}
				sectionKey="text"
			/>
		),
	};
}

function buildGraphicTab({
	element,
}: {
	element: GraphicElement;
}): PropertiesTabDef {
	return {
		id: "graphic",
		get label() { return t("inspector.tabs.graphic", "图形外观"); },
		icon: <OcShapesIcon size={16} />,
		content: ({ trackId }) => <GraphicTab element={element} trackId={trackId} />,
	};
}

function buildStandaloneEffectTab({
	element,
}: {
	element: EffectElement;
}): PropertiesTabDef {
	return {
		id: "effects",
		label: "特效",
		icon: <HugeiconsIcon icon={MagicWand05Icon} size={16} />,
		content: ({ trackId }) => (
			<StandaloneEffectTab element={element} trackId={trackId} />
		),
	};
}

function buildTransitionTab({
	element,
}: {
	element: VideoElement | ImageElement;
}): PropertiesTabDef {
	return {
		id: "transition",
		get label() { return t("inspector.tabs.transition", "转场"); },
		icon: <HugeiconsIcon icon={Exchange01Icon} size={16} />,
		content: ({ trackId }) => (
			<TransitionTab element={element} trackId={trackId} />
		),
	};
}

function getTextConfig({
	element,
}: {
	element: TextElement;
}): ElementPropertiesConfig {
	return {
		defaultTab: "text",
		tabs: [
			buildTextTab({ element }),
			buildTransformTab({ element }),
			buildBlendingTab({ element }),
		],
	};
}

function getVideoConfig({
	element,
	mediaAsset,
}: {
	element: VideoElement;
	mediaAsset: MediaAsset | undefined;
}): ElementPropertiesConfig {
	const showAudioTab = mediaAsset?.hasAudio !== false;
	return {
		defaultTab: "transform",
		tabs: [
			buildTransformTab({ element }),
			...(showAudioTab ? [buildAudioTab({ element })] : []),
			buildSpeedTab({ element }),
			buildBlendingTab({ element }),
			buildMasksTab({ element }),
			buildClipEffectsTab({ element }),
			...(element.transitionOut ? [buildTransitionTab({ element })] : []),
		],
	};
}

function getImageConfig({
	element,
}: {
	element: ImageElement;
}): ElementPropertiesConfig {
	return {
		defaultTab: "transform",
		tabs: [
			buildTransformTab({ element }),
			buildBlendingTab({ element }),
			buildMasksTab({ element }),
			buildClipEffectsTab({ element }),
			...(element.transitionOut ? [buildTransitionTab({ element })] : []),
		],
	};
}

function getStickerConfig({
	element,
}: {
	element: StickerElement;
}): ElementPropertiesConfig {
	return {
		defaultTab: "transform",
		tabs: [
			buildTransformTab({ element }),
			buildBlendingTab({ element }),
			buildClipEffectsTab({ element }),
		],
	};
}

function getGraphicConfig({
	element,
}: {
	element: GraphicElement;
}): ElementPropertiesConfig {
	return {
		defaultTab: "graphic",
		tabs: [
			buildGraphicTab({ element }),
			buildTransformTab({ element }),
			buildBlendingTab({ element }),
			buildMasksTab({ element }),
			buildClipEffectsTab({ element }),
		],
	};
}

function getAudioConfig({
	element,
}: {
	element: AudioElement;
}): ElementPropertiesConfig {
	return {
		defaultTab: "audio",
		tabs: [buildAudioTab({ element }), buildSpeedTab({ element })],
	};
}

function getEffectConfig({
	element,
}: {
	element: EffectElement;
}): ElementPropertiesConfig {
	return {
		defaultTab: "effects",
		tabs: [buildStandaloneEffectTab({ element })],
	};
}

export function getPropertiesConfig({
	element,
	mediaAssets,
}: {
	element: TimelineElement;
	mediaAssets: MediaAsset[];
}): ElementPropertiesConfig {
	switch (element.type) {
		case "text":
			return getTextConfig({ element });
		case "video": {
			const mediaAsset = mediaAssets.find((a) => a.id === element.mediaId);
			return getVideoConfig({ element, mediaAsset });
		}
		case "image":
			return getImageConfig({ element });
		case "sticker":
			return getStickerConfig({ element });
		case "graphic":
			return getGraphicConfig({ element });
		case "audio":
			return getAudioConfig({ element });
		case "effect":
			return getEffectConfig({ element });
	}
}
