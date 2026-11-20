import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogBody,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useState } from "react";

/**
 * 移动到分组：输入新分组名或点选已有分组。
 * 分组只是工程元数据上的一个字符串，会随工程一起备份到云端。
 */
export function MoveToGroupDialog({
	isOpen,
	onOpenChange,
	projectCount,
	groups,
	currentGroup = "",
	onConfirm,
}: {
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
	projectCount: number;
	groups: string[];
	currentGroup?: string;
	onConfirm: (group: string) => void;
}) {
	const [group, setGroup] = useState(currentGroup);

	const handleOpenChange = (open: boolean) => {
		if (open) {
			setGroup(currentGroup);
		}
		onOpenChange(open);
	};

	return (
		<Dialog open={isOpen} onOpenChange={handleOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>
						移动到分组（{projectCount} 个工程）
					</DialogTitle>
				</DialogHeader>

				<DialogBody className="gap-3">
					<Label>分组名称</Label>
					<Input
						value={group}
						onChange={(e) => setGroup(e.target.value)}
						placeholder="例如：张三的作品 / 极简风"
						onKeyDown={(e) => {
							if (e.key === "Enter") {
								e.preventDefault();
								onConfirm(group.trim());
							}
						}}
					/>
					{groups.length > 0 && (
						<div className="flex flex-wrap gap-2">
							{groups.map((item) => (
								<Button
									key={item}
									size="sm"
									variant={group === item ? "default" : "outline"}
									onClick={() => setGroup(item)}
								>
									{item}
								</Button>
							))}
						</div>
					)}
					<p className="text-muted-foreground text-xs">
						留空表示取消分组。分组会随工程一起备份到云端，拉取后保持一致。
					</p>
				</DialogBody>

				<DialogFooter>
					<Button
						variant="outline"
						onClick={(e) => {
							e.preventDefault();
							e.stopPropagation();
							onOpenChange(false);
						}}
					>
						取消
					</Button>
					<Button onClick={() => onConfirm(group.trim())}>确定</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
