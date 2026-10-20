"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
	listCloudSnapshots,
	pullSnapshot,
	type SnapshotSummary,
} from "@/services/cloud-snapshots";

/**
 * 云端工程（只读快照）。
 *
 * 语义：本地是唯一编辑入口；这里只做「拉取到本地」与删除云端副本。
 * 拉取会新建一个本地工程（新 id），不会覆盖本地同名工程。
 */
export default function CloudProjectsPage() {
	const router = useRouter();
	const [items, setItems] = useState<SnapshotSummary[] | null>(null);
	const [error, setError] = useState("");
	const [busyId, setBusyId] = useState<string | null>(null);

	const load = async () => {
		setError("");
		try {
			setItems(await listCloudSnapshots());
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
			setItems([]);
		}
	};

	useEffect(() => {
		void load();
	}, []);

	const handlePull = async (snap: SnapshotSummary) => {
		if (busyId) return;
		setBusyId(snap.id);
		const toastId = toast.loading("准备拉取…");
		try {
			const result = await pullSnapshot({
				snapshotId: snap.id,
				onProgress: (stage, percent) => {
					toast.loading(`${stage} ${percent}%`, { id: toastId });
				},
			});
			if (result.missing.length) {
				toast.warning(`已拉取，但 ${result.missing.length} 个素材下载失败`, {
					id: toastId,
					description: "工程结构完整，缺失素材会在时间线上显示为黑块。",
				});
			} else {
				toast.success(`已拉取到本地 · ${result.imported} 个素材`, { id: toastId });
			}
			router.push(`/editor/${result.localProjectId}`);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : String(e), { id: toastId });
		} finally {
			setBusyId(null);
		}
	};

	return (
		<div className="mx-auto w-full max-w-6xl px-6 py-10">
			<div className="mb-6 flex items-end justify-between gap-4">
				<div>
					<h1 className="text-2xl font-semibold">云端工程</h1>
					<p className="text-muted-foreground mt-1 text-sm">
						这些是备份到服务器的只读快照。拉取后会在本地新建一份工程，可继续编辑再备份回去。
					</p>
				</div>
				<div className="flex gap-2">
					<Button variant="outline" onClick={() => void load()}>
						刷新
					</Button>
					<Button asChild>
						<Link href="/projects">返回工程列表</Link>
					</Button>
				</div>
			</div>

			{error && (
				<div className="border-destructive/40 bg-destructive/5 text-destructive mb-4 rounded-md border px-3 py-2 text-sm">
					读取失败：{error}
				</div>
			)}

			{items === null && (
				<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
					{[0, 1, 2].map((i) => (
						<Skeleton key={i} className="h-28 w-full rounded-lg" />
					))}
				</div>
			)}

			{items && items.length === 0 && !error && (
				<div className="text-muted-foreground rounded-lg border border-dashed px-6 py-16 text-center text-sm">
					还没有云端工程。在编辑器里点「备份到云端」即可创建一份快照。
				</div>
			)}

			{items && items.length > 0 && (
				<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
					{items.map((snap) => (
						<Card key={snap.id} className="overflow-hidden">
							<CardContent className="flex h-full flex-col gap-3 p-4">
								<div className="min-w-0">
									<div className="truncate text-sm font-medium">{snap.name}</div>
									<div className="text-muted-foreground mt-1 text-xs">
										rev {snap.rev} · {snap.assetsCount} 个素材 ·{" "}
										{(snap.sizeBytes / 1024).toFixed(0)} KB
									</div>
									<div className="text-muted-foreground/80 mt-0.5 text-[11px]">
										{new Date(snap.updatedAt).toLocaleString("zh-CN")}
									</div>
								</div>
								<div className="mt-auto flex gap-2">
									<Button
										size="sm"
										className="flex-1"
										disabled={busyId === snap.id}
										onClick={() => void handlePull(snap)}
									>
										{busyId === snap.id ? "拉取中…" : "拉取到本地"}
									</Button>
								</div>
							</CardContent>
						</Card>
					))}
				</div>
			)}
		</div>
	);
}
