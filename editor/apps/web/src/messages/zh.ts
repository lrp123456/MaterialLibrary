/**
 * 中文文案字典。
 * key 用「区域.语义」命名，值就是界面上的中文；未收录的 key 会回退到英文原文。
 */
export const zh = {
	// 顶栏
	"header.export": "导出",
	"header.backup": "备份到云端",
	"header.shortcuts": "快捷键",
	"header.rename": "重命名",
	"header.delete": "删除工程",
	"header.exit": "退出工程",

	// 导出弹窗
	"export.title": "导出工程",
	"export.title.busy": "正在导出",
	"export.format": "格式",
	"export.quality": "画质",
	"export.audio": "音频",
	"export.deliver": "交付方式",
	"export.deliver.sync": "同步上传到成品库（默认勾选）",
	"export.deliver.hint": "取消勾选则只下载到本地，不进素材库。",
	"export.includeAudio": "导出时包含音频",
	"export.action": "开始导出",
	"export.cancel": "取消",
	"export.copy": "复制错误",
	"export.retry": "重试",
	"export.failed": "导出失败",
	"export.format.mp4": "MP4 (H.264) · 兼容性最好",
	"export.format.webm": "WebM (VP9) · 体积更小",
	"export.quality.low": "低 · 体积最小",
	"export.quality.medium": "中 · 均衡",
	"export.quality.high": "高 · 推荐",
	"export.quality.veryHigh": "极高 · 体积最大",

	// 左侧素材面板
	"assets.media": "媒体",
	"assets.sounds": "音频",
	"assets.text": "文字",
	"assets.stickers": "贴纸",
	"assets.effects": "特效",
	"assets.transitions": "转场",
	"assets.captions": "字幕",
	"assets.settings": "设置",
	"assets.library": "素材库",
	"assets.search": "搜索",

	// 检查器
	"inspector.transform": "变换",
	"inspector.width": "宽度",
	"inspector.height": "高度",
	"inspector.position": "位置",
	"inspector.rotation": "旋转",
	"inspector.opacity": "不透明度",
	"inspector.blend": "混合模式",
	"inspector.mask": "遮罩",
	"inspector.effects": "特效",
	"inspector.audio": "音频",
	"inspector.speed": "速度",

	// 时间轴
	"timeline.split": "分割",
	"timeline.delete": "删除",
	"timeline.duplicate": "复制",
	"timeline.mute": "静音",
	"timeline.lock": "锁定",
	"timeline.hide": "隐藏",

	// 通用
	"common.ok": "确定",
	"common.cancel": "取消",
	"common.save": "保存",
	"common.close": "关闭",
	"common.loading": "加载中…",
	"common.empty": "暂无内容",
	"common.retry": "重试",
} as const;

export type ZhKey = keyof typeof zh;
