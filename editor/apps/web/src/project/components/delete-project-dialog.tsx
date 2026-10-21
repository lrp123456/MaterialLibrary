import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogBody,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { useState } from "react";

const CONFIRM_WORD = "DELETE";

export function DeleteProjectDialog({
	isOpen,
	onOpenChange,
	onConfirm,
	projectNames,
}: {
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
	onConfirm: () => void;
	projectNames: string[];
}) {
	const [confirmText, setConfirmText] = useState("");
	const count = projectNames.length;
	const isSingle = count === 1;
	const singleName = isSingle ? projectNames[0] : null;
	const canDelete = confirmText.trim() === CONFIRM_WORD;

	const handleOpenChange = (open: boolean) => {
		if (open) setConfirmText("");
		onOpenChange(open);
	};

	const handleConfirm = () => {
		if (!canDelete) return;
		onConfirm();
		setConfirmText("");
	};

	return (
		<Dialog open={isOpen} onOpenChange={handleOpenChange}>
			<DialogContent
				onOpenAutoFocus={(event) => {
					event.preventDefault();
					event.stopPropagation();
				}}
			>
				<DialogHeader>
					<DialogTitle>
						{singleName ? (
							<>
								{"删除「"}
								<span className="inline-block max-w-[300px] truncate align-bottom">
									{singleName}
								</span>
								{"」？"}
							</>
						) : (
							`删除 ${count} 个工程？`
						)}
					</DialogTitle>
				</DialogHeader>
				<DialogBody>
					<Alert variant="destructive">
						<AlertTitle>风险提示</AlertTitle>
						<AlertDescription>
							将永久删除{singleName ? `「${singleName}」` : `${count} 个工程`}
							及其关联的全部本地文件，此操作不可恢复。
						</AlertDescription>
					</Alert>
					<div className="flex flex-col gap-3">
						<Label className="text-xs font-semibold text-slate-500">
							输入 {CONFIRM_WORD} 以确认删除
						</Label>
						<Input
							type="text"
							placeholder={CONFIRM_WORD}
							size="lg"
							variant="destructive"
							value={confirmText}
							onChange={(event) => setConfirmText(event.target.value)}
						/>
					</div>
				</DialogBody>
				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						取消
					</Button>
					<Button
						variant="destructive"
						onClick={handleConfirm}
						disabled={!canDelete}
					>
						删除工程
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
