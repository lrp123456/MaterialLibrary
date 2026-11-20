"use client";

import { useState } from "react";
import { Button } from "../ui/button";
import { toast } from "sonner";
import { useEditor } from "@/editor/use-editor";
import { backupProject } from "@/services/cloud-snapshots";

/**
 * 备份到云端。
 * 本地仍然是唯一编辑入口，这里只是把当前工程 + 素材清单打成一份只读快照。
 * 素材若还没入库，会先上传再写快照（否则别的机器拉下来是黑块）。
 */
export function CloudBackupButton() {
	const editor = useEditor();
	const project = useEditor((e) => e.project.getActiveOrNull());
	const [busy, setBusy] = useState(false);

	const handleBackup = async () => {
		if (!project || busy) return;
		setBusy(true);
		const toastId = toast.loading("准备备份…");
		try {
			const result = await backupProject({
				project,
				onProgress: (stage, percent) => {
					toast.loading(`${stage} ${percent}%`, { id: toastId });
				},
			});
			toast.success(
				`已备份到云端 · 素材 ${result.assets} 个${result.uploaded ? `（新上传 ${result.uploaded}）` : ""}`,
				{ id: toastId, description: `快照 ${result.snapshotId} · rev ${result.rev}` },
			);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : String(e), { id: toastId });
		} finally {
			setBusy(false);
		}
	};

	return (
		<Button
			variant="outline"
			size="sm"
			className="h-8 gap-1.5 text-xs"
			onClick={handleBackup}
			disabled={!project || busy}
			title="把当前工程备份为云端快照，供其它机器拉取"
		>
			{busy ? "备份中…" : "备份到云端"}
		</Button>
	);
}
