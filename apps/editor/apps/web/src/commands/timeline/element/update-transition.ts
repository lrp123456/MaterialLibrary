import { Command, type CommandResult } from "@/commands/base-command";
import { EditorCore } from "@/core";
import type { ParamValues } from "@/params";
import type { MediaTime } from "@/wasm";
import type { SceneTracks } from "@/timeline";
import {
	updateTransitionInTracks,
	resolveTransitionPair,
} from "@/timeline/transition";

/**
 * 修改转场本身（时长 / 预设 / 参数）。
 *
 * 时间线几何和 ApplyTransitionCommand 共用同一套纯函数：
 * A.end 不动，B.start = A.end - d，后续元素随 d 的变化平移。
 */
export class UpdateTransitionCommand extends Command {
	private savedState: SceneTracks | null = null;
	private readonly elementId: string;
	private readonly type?: string;
	private readonly duration: MediaTime;
	private readonly params?: ParamValues;

	constructor({
		elementId,
		type,
		duration,
		params,
	}: {
		elementId: string;
		type?: string;
		duration: MediaTime;
		params?: ParamValues;
	}) {
		super();
		this.elementId = elementId;
		this.type = type;
		this.duration = duration;
		this.params = params;
	}

	execute(): CommandResult | undefined {
		const editor = EditorCore.getInstance();
		const tracks = editor.scenes.getActiveScene().tracks;
		const pair = resolveTransitionPair({ tracks, elementId: this.elementId });
		if (!pair) return;

		this.savedState = tracks;
		editor.timeline.updateTracks(
			updateTransitionInTracks({
				tracks,
				pair,
				type: this.type,
				duration: this.duration,
				params: this.params,
			}),
		);
		return undefined;
	}

	undo(): void {
		if (this.savedState) {
			EditorCore.getInstance().timeline.updateTracks(this.savedState);
		}
	}
}
