"use client";

import { Button } from "../ui/button";
import { useRef, useState } from "react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { RenameProjectDialog } from "@/project/components/rename-project-dialog";
import { DeleteProjectDialog } from "@/project/components/delete-project-dialog";
import { useRouter } from "next/navigation";
import { ExportButton } from "./export-button";
import { CloudBackupButton } from "./cloud-backup-button";
import { toast } from "sonner";
import { useEditor } from "@/editor/use-editor";
import { CommandIcon, Logout05Icon, Edit02Icon, Delete02Icon, VideoReplayIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { ShortcutsDialog } from "@/actions/components/shortcuts-dialog";
import { cn } from "@/utils/ui";
import { t } from "@/i18n";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Archive } from "lucide-react";
import { exportProjectFile } from "@/services/mlsclip";

export function EditorHeader() {
	return (
		<header className="bg-background flex h-[3.4rem] items-center justify-between px-3 pt-0.5 border-b border-border/60">
			<div className="flex items-center gap-2">
				<ProjectDropdown />
				<EditableProjectName />
			</div>
			<nav className="flex items-center gap-2.5">
				<ExportProjectButton />
				<CloudBackupButton />
				<ExportButton />
			</nav>
		</header>
	);
}

function formatSize(bytes: number): string {
	if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)}GB`;
	if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
	return `${Math.max(1, Math.round(bytes / 1024))}KB`;
}

/**
 * 导出工程文件（.mlsclip）。
 * 默认只打清单（小、快）；勾选"包含媒体"才把素材原文件一起塞进包，
 * 这样换机器/交给桌面版离线导出时不用再回素材库找一遍。
 */
function ExportProjectButton() {
	const editor = useEditor();
	const project = useEditor((e) => e.project.getActiveOrNull());
	const [open, setOpen] = useState(false);
	const [includeMedia, setIncludeMedia] = useState(false);
	const [busy, setBusy] = useState(false);

	const handleExport = async () => {
		if (!project || busy) return;
		setBusy(true);
		const toastId = toast.loading("准备导出工程…");
		try {
			// 先把内存里的时间线落盘，再按落盘后的工程导出，避免导出旧画面
			await editor.project.saveCurrentProject();
			const latest = editor.project.getActiveOrNull() || project;
			const result = await exportProjectFile({
				project: latest,
				includeMedia,
				onProgress: (stage, percent) => {
					toast.loading(`${stage} ${percent}%`, { id: toastId });
				},
			});
			toast.success(`已导出「${result.filename}」`, {
				id: toastId,
				description: [
					`${formatSize(result.size)} · 素材 ${result.assets} 个${result.embedded ? `（内嵌 ${result.embedded} 个）` : "（未内嵌）"}`,
					...result.warnings.slice(0, 3),
					...(result.warnings.length > 3 ? [`还有 ${result.warnings.length - 3} 条提示`] : []),
				].join("\n"),
			});
			setOpen(false);
		} catch (error) {
			toast.error("导出工程失败", {
				id: toastId,
				description: error instanceof Error ? error.message : "请重试",
			});
		} finally {
			setBusy(false);
		}
	};

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					variant="outline"
					size="sm"
					className="h-8 gap-1.5 text-xs"
					disabled={!project || busy}
					title="把工程打包成 .mlsclip 单文件，可备份、换机打开"
				>
					<Archive className="size-3.5" />
					{busy ? "导出中…" : "导出工程"}
				</Button>
			</PopoverTrigger>
			<PopoverContent align="end" className="bg-background w-80 p-3">
				<div className="flex flex-col gap-3">
					<div className="flex flex-col gap-1">
						<span className="text-sm font-medium">导出工程文件</span>
						<span className="text-muted-foreground text-xs">
							生成 .mlsclip 单文件，含工程结构与素材清单，可备份或换机打开。
						</span>
					</div>

					<div className="flex items-start gap-2">
						<Checkbox
							id="mlsclip-include-media"
							checked={includeMedia}
							onCheckedChange={(checked) => setIncludeMedia(checked === true)}
						/>
						<div className="flex flex-col gap-1">
							<Label htmlFor="mlsclip-include-media" className="text-sm">
								包含媒体文件
							</Label>
							<span className="text-muted-foreground text-xs">
								素材原件一起打包（体积可能很大）。单个素材超过 500MB 时不内嵌，只在清单里标注。
							</span>
						</div>
					</div>

					<Button onClick={handleExport} disabled={busy} className="w-full gap-2">
						<Archive className="size-4" />
						{busy ? "导出中…" : "开始导出"}
					</Button>
				</div>
			</PopoverContent>
		</Popover>
	);
}

function ProjectDropdown() {
	const [openDialog, setOpenDialog] = useState<
		"delete" | "rename" | "shortcuts" | null
	>(null);
	const [isExiting, setIsExiting] = useState(false);
	const router = useRouter();
	const editor = useEditor();
	const activeProject = useEditor((e) => e.project.getActiveOrNull());

	const handleExit = async () => {
		if (isExiting) return;
		setIsExiting(true);

		try {
			await editor.project.prepareExit();
			editor.project.closeProject();
		} catch (error) {
			console.error("Failed to prepare project exit:", error);
		} finally {
			editor.project.closeProject();
			router.push("/projects");
		}
	};

	const handleSaveProjectName = async (newName: string) => {
		if (
			activeProject &&
			newName.trim() &&
			newName !== activeProject.metadata.name
		) {
			try {
				await editor.project.renameProject({
					id: activeProject.metadata.id,
					name: newName.trim(),
				});
				toast.success(t("common.success", "重命名成功"));
			} catch (error) {
				toast.error("重命名工程失败", {
					description:
						error instanceof Error ? error.message : "请重试",
				});
			} finally {
				setOpenDialog(null);
			}
		}
	};

	const handleDeleteProject = async () => {
		if (activeProject) {
			try {
				await editor.project.deleteProjects({
					ids: [activeProject.metadata.id],
				});
				toast.success(t("common.success", "已成功删除工程"));
				router.push("/projects");
			} catch (error) {
				toast.error("删除工程失败", {
					description:
						error instanceof Error ? error.message : "请重试",
				});
			} finally {
				setOpenDialog(null);
			}
		}
	};

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button
						variant="ghost"
						size="icon"
						className="p-1 rounded-lg size-8 hover:bg-accent/80 text-primary cursor-pointer"
						title="工程菜单"
					>
						<div className="flex items-center justify-center size-6 rounded-md bg-primary/10 text-primary">
							<HugeiconsIcon icon={VideoReplayIcon} className="size-4" />
						</div>
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="start" className="z-100 w-48">
					<DropdownMenuItem
						onClick={() => setOpenDialog("rename")}
						icon={<HugeiconsIcon icon={Edit02Icon} />}
					>
						{t("header.rename", "重命名工程")}
					</DropdownMenuItem>

					<DropdownMenuItem
						onClick={() => setOpenDialog("shortcuts")}
						icon={<HugeiconsIcon icon={CommandIcon} />}
					>
						{t("header.shortcuts", "快捷键指南")}
					</DropdownMenuItem>

					<DropdownMenuSeparator />

					<DropdownMenuItem
						onClick={() => setOpenDialog("delete")}
						variant="destructive"
						icon={<HugeiconsIcon icon={Delete02Icon} />}
					>
						{t("header.delete", "删除工程")}
					</DropdownMenuItem>

					<DropdownMenuSeparator />

					<DropdownMenuItem
						onClick={handleExit}
						disabled={isExiting}
						icon={<HugeiconsIcon icon={Logout05Icon} />}
					>
						{t("header.exit", "退出到工程列表")}
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
			<RenameProjectDialog
				isOpen={openDialog === "rename"}
				onOpenChange={(isOpen) => setOpenDialog(isOpen ? "rename" : null)}
				onConfirm={(newName) => handleSaveProjectName(newName)}
				projectName={activeProject?.metadata.name || ""}
			/>
			<DeleteProjectDialog
				isOpen={openDialog === "delete"}
				onOpenChange={(isOpen) => setOpenDialog(isOpen ? "delete" : null)}
				onConfirm={handleDeleteProject}
				projectNames={[activeProject?.metadata.name || ""]}
			/>
			<ShortcutsDialog
				isOpen={openDialog === "shortcuts"}
				onOpenChange={(isOpen) => setOpenDialog(isOpen ? "shortcuts" : null)}
			/>
		</>
	);
}

function EditableProjectName() {
	const editor = useEditor();
	const activeProject = useEditor((e) => e.project.getActiveOrNull());
	const [isEditing, setIsEditing] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);
	const originalNameRef = useRef("");

	const projectName = activeProject?.metadata.name || "";

	const startEditing = () => {
		if (isEditing) return;
		originalNameRef.current = projectName;
		setIsEditing(true);

		requestAnimationFrame(() => {
			inputRef.current?.select();
		});
	};

	const saveEdit = async () => {
		if (!inputRef.current || !activeProject) return;
		const newName = inputRef.current.value.trim();
		setIsEditing(false);

		if (!newName) {
			inputRef.current.value = originalNameRef.current;
			return;
		}

		if (newName !== originalNameRef.current) {
			try {
				await editor.project.renameProject({
					id: activeProject.metadata.id,
					name: newName,
				});
				toast.success(t("common.success", "重命名成功"));
			} catch (error) {
				toast.error("重命名工程失败", {
					description:
						error instanceof Error ? error.message : "请重试",
				});
			}
		}
	};

	const handleKeyDown = (event: React.KeyboardEvent) => {
		if (event.key === "Enter") {
			event.preventDefault();
			inputRef.current?.blur();
		} else if (event.key === "Escape") {
			event.preventDefault();
			if (inputRef.current) {
				inputRef.current.value = originalNameRef.current;
				inputRef.current.setSelectionRange(0, 0);
			}
			setIsEditing(false);
			inputRef.current?.blur();
		}
	};

	return (
		<input
			ref={inputRef}
			type="text"
			defaultValue={projectName}
			readOnly={!isEditing}
			onClick={startEditing}
			onBlur={saveEdit}
			onKeyDown={handleKeyDown}
			style={{ fieldSizing: "content" }}
			className={cn(
				"text-[0.9rem] font-medium h-8 px-2 py-1 rounded-sm bg-transparent outline-none cursor-pointer hover:bg-accent hover:text-accent-foreground transition-all",
				isEditing && "ring-1 ring-ring cursor-text hover:bg-transparent",
			)}
		/>
	);
}
