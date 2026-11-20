import { Command, type CommandResult } from "@/commands/base-command";
import { EditorCore } from "@/core";
import type { ParamValues } from "@/params";
import type { MediaTime } from "@/wasm";
import type { SceneTracks } from "@/timeline";
import {
	applyTransitionToTracks,
	findAdjacentSuccessor,
} from "@/timeline/transition";

/**
 * 在 A 尾部与紧邻的 B 之间加一个转场。
 *
 * 一条命令同时改三处（A 尾部 / B 头部 / 后续元素波纹），savedState 整轨快照，
 * 因此 undo 一定是一步还原，不存在"改了一半"的中间态。
 */
export class ApplyTransitionCommand extends Command {
	private savedState: SceneTracks | null = null;
	private readonly elementId: string;
	private readonly type: string;
	private readonly duration: MediaTime;
	private readonly params: ParamValues;

	constructor({
		elementId,
		type,
		duration,
		params = {},
	}: {
		elementId: string;
		type: string;
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
		const pair = findAdjacentSuccessor({
			tracks,
			elementId: this.elementId,
		});
		if (!pair) {
			console.error("转场需要同轨紧邻的下一个片段，当前片段没有剪辑点");
			return;
		}
		if (this.duration <= 0) {
			console.error("转场时长必须大于 0");
			return;
		}

		this.savedState = tracks;
		editor.timeline.updateTracks(
			applyTransitionToTracks({
				tracks,
				pair,
				options: {
					elementId: this.elementId,
					type: this.type,
					duration: this.duration,
					params: this.params,
				},
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
