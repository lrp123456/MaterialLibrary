import { Command, type CommandResult } from "@/commands/base-command";
import { EditorCore } from "@/core";
import type { SceneTracks } from "@/timeline";
import {
	removeTransitionFromTracks,
	resolveTransitionPair,
} from "@/timeline/transition";

/**
 * 删除 A 尾部的转场，按记录的 duration 反向还原。
 * 与 ApplyTransitionCommand 对称：一条命令 = 一个 undo 步。
 */
export class RemoveTransitionCommand extends Command {
	private savedState: SceneTracks | null = null;
	private readonly elementId: string;

	constructor({ elementId }: { elementId: string }) {
		super();
		this.elementId = elementId;
	}

	execute(): CommandResult | undefined {
		const editor = EditorCore.getInstance();
		const tracks = editor.scenes.getActiveScene().tracks;
		const pair = resolveTransitionPair({
			tracks,
			elementId: this.elementId,
		});
		if (!pair) {
			console.error("当前片段没有可移除的转场");
			return;
		}

		this.savedState = tracks;
		editor.timeline.updateTracks(
			removeTransitionFromTracks({ tracks, pair }),
		);
		return undefined;
	}

	undo(): void {
		if (this.savedState) {
			EditorCore.getInstance().timeline.updateTracks(this.savedState);
		}
	}
}
