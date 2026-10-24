import type { EffectPass } from "@/effects/types";
import type { RetimeConfig } from "@/timeline";
import { BaseNode } from "./base-node";

export type BlurBackgroundNodeParams = {
	mediaId: string;
	url: string;
	file: File;
	mediaType: "video" | "image";
	duration: number;
	timeOffset: number;
	trimStart: number;
	trimEnd: number;
	retime?: RetimeConfig;
	blurIntensity: number;
};

export type BackdropSource = {
	source: CanvasImageSource;
	width: number;
	height: number;
	/** 视频帧时间戳，用于判断画面是否真的变了（canvas 对象会被复用）。 */
	revision?: number;
};

export interface ResolvedBlurBackgroundNodeState {
	backdropSource: BackdropSource;
	passes: EffectPass[];
}

export class BlurBackgroundNode extends BaseNode<
	BlurBackgroundNodeParams,
	ResolvedBlurBackgroundNodeState
> {}
