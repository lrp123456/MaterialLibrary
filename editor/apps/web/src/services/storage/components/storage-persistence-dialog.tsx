"use client";

import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogBody,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { useStoragePersistence } from "@/services/storage/use-storage-persistence";

export function StoragePersistenceDialog() {
	const { showDialog, onConfirm, onDismiss } = useStoragePersistence();

	return (
		<Dialog open={showDialog} onOpenChange={(open) => !open && onDismiss()}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>别让工程丢失</DialogTitle>
				</DialogHeader>
				<DialogBody>
					<p className="text-base text-muted-foreground">
						浏览器在存储空间不足时，可能会自动清理你本地的剪辑工程。
					</p>
					<p className="text-base text-muted-foreground">
						是否允许剪辑工作台申请持久化存储保护这些工程？
					</p>
				</DialogBody>
				<DialogFooter>
					<Button variant="outline" onClick={onDismiss}>
						暂不开启
					</Button>
					<Button onClick={onConfirm}>允许保护</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
