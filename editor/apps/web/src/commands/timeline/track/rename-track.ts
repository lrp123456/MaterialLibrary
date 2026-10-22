import { Command, type CommandResult } from "../../base-command";
import { EditorCore } from "@/core";
import type { SceneTracks } from "@/timeline";

/** 重命名轨道（如把自动命名的「人声」改成自己的名字）。 */
export class RenameTrackCommand extends Command {
	private trackId: string;
	private name: string;
	private savedState: SceneTracks | null = null;

	constructor({ trackId, name }: { trackId: string; name: string }) {
		super();
		this.trackId = trackId;
		this.name = name;
	}

	execute(): CommandResult | undefined {
		const editor = EditorCore.getInstance();
		const scene = editor.scenes.getActiveScene();
		this.savedState = scene.tracks;

		const rename = <T extends { id: string; name: string }>(list: T[]): T[] =>
			list.map((t) => (t.id === this.trackId ? { ...t, name: this.name } : t));

		editor.timeline.updateTracks({
			...scene.tracks,
			main:
				scene.tracks.main.id === this.trackId
					? { ...scene.tracks.main, name: this.name }
					: scene.tracks.main,
			audio: rename(scene.tracks.audio),
			overlay: rename(scene.tracks.overlay),
		});
		return undefined;
	}

	undo(): void {
		if (!this.savedState) return;
		EditorCore.getInstance().timeline.updateTracks(this.savedState);
	}
}
