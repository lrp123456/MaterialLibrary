/**
 * 云端快照自动同步（后台队列 + 退避重试 + 断点续传）。
 *
 * 适用对象：已绑定云端快照的工程（拉取下来或备份过的工程都有 binding）。
 * - 工程保存后入队，等待合并窗口后统一推送，避免频繁写云端；
 * - 离开页面（切后台 / 关闭）时立即尝试推送；
 * - 失败进入本地队列，指数退避自动重试，下次打开继续；
 * - 素材 fid 映射存在 localStorage，已上传的素材不会重复上传，天然支持断流续传；
 * - 409 冲突不再自动重试，交由用户手动「先拉取再备份」。
 */
import { storageService } from "@/services/storage/service";
import { backupProject, getSnapshotBinding } from ".";

const QUEUE_KEY = "ml_autosync_queue";
/** 保存后延迟多久推送，合并同一批编辑，避免每次改动都请求云端 */
const DEBOUNCE_MS = 8_000;
/** 扫描周期 */
const TICK_MS = 15_000;
/** 退避上限 */
const MAX_BACKOFF_MS = 5 * 60_000;

interface QueueItem {
	attempts: number;
	nextAt: number;
	lastError?: string;
	/** 服务端 rev 冲突：需要用户先拉取，不再自动重试 */
	blocked?: boolean;
}

type QueueMap = Record<string, QueueItem>;

function readQueue(): QueueMap {
	try {
		return JSON.parse(localStorage.getItem(QUEUE_KEY) || "{}") || {};
	} catch {
		return {};
	}
}

function writeQueue(queue: QueueMap) {
	try {
		localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
	} catch {
		/* 配额满时忽略：下次保存会重新入队 */
	}
}

function backoffMs(attempts: number): number {
	return Math.min(MAX_BACKOFF_MS, 5_000 * 2 ** Math.max(0, attempts - 1));
}

/** 工程有改动：只有已绑定云端的工程才需要同步 */
export function markProjectDirty(projectId: string) {
	if (!projectId) return;
	if (!getSnapshotBinding(projectId)) return;

	const queue = readQueue();
	queue[projectId] = {
		attempts: 0,
		nextAt: Date.now() + DEBOUNCE_MS,
		lastError: undefined,
		blocked: false,
	};
	writeQueue(queue);
}

export function clearProjectSync(projectId: string) {
	const queue = readQueue();
	delete queue[projectId];
	writeQueue(queue);
}

const flushing = new Set<string>();

/** 立即推送单个工程；成功清队列，失败按退避写回 */
export async function flushProject(projectId: string): Promise<boolean> {
	if (flushing.has(projectId)) return false;
	flushing.add(projectId);

	try {
		const result = await storageService.loadProject({ id: projectId });
		if (!result) {
			// 工程已被删除，清掉任务
			clearProjectSync(projectId);
			return false;
		}
		await backupProject({ project: result.project });
		clearProjectSync(projectId);
		return true;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const queue = readQueue();
		const item = queue[projectId] || { attempts: 0, nextAt: 0 };
		const attempts = item.attempts + 1;
		queue[projectId] = {
			attempts,
			nextAt: Date.now() + backoffMs(attempts),
			lastError: message,
			// rev 冲突属于用户决策，自动重试只会一直失败
			blocked: /409|云端已有更新版本/.test(message),
		};
		writeQueue(queue);
		return false;
	} finally {
		flushing.delete(projectId);
	}
}

/** 处理所有到期任务 */
export async function flushDueProjects(): Promise<void> {
	const queue = readQueue();
	const now = Date.now();
	const due = Object.entries(queue)
		.filter(([, item]) => !item.blocked && item.nextAt <= now)
		.map(([projectId]) => projectId);
	// 串行推送，避免同时上传多份大素材把带宽打满
	for (const projectId of due) {
		await flushProject(projectId);
	}
}

/** 离开页面时尽力推送（浏览器可能直接终止请求，失败会留在队列里下次继续） */
export async function flushAll(): Promise<void> {
	const queue = readQueue();
	for (const projectId of Object.keys(queue)) {
		await flushProject(projectId);
	}
}

let started = false;

/** 启动后台自动同步，返回清理函数 */
export function startAutoSync(): () => void {
	if (started || typeof window === "undefined") return () => {};
	started = true;

	const onSaved = (event: Event) => {
		const detail = (event as CustomEvent<{ projectId?: string }>).detail;
		if (detail?.projectId) markProjectDirty(detail.projectId);
	};

	const onVisibility = () => {
		if (document.visibilityState === "hidden") {
			void flushAll();
		}
	};

	const onPageHide = () => {
		void flushAll();
	};

	const timer = window.setInterval(() => {
		void flushDueProjects();
	}, TICK_MS);

	window.addEventListener("mls_project_saved", onSaved);
	document.addEventListener("visibilitychange", onVisibility);
	window.addEventListener("pagehide", onPageHide);

	// 启动时补一次：上次未送出去的改动继续传
	void flushDueProjects();

	return () => {
		started = false;
		window.clearInterval(timer);
		window.removeEventListener("mls_project_saved", onSaved);
		document.removeEventListener("visibilitychange", onVisibility);
		window.removeEventListener("pagehide", onPageHide);
	};
}
