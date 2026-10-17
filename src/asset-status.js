/**
 * assets.status 的唯一真源（2026-10-03 状态收敛）
 *
 * 背景：历史上 assets.status 有 10 个字面值，但实测真实库只有 4 个在用
 *   （ready / deleted / rejected / excluded），其余是零数据的僵尸状态：
 *     ready_with_flags / tagging_done / gating_passed / qc
 * 更糟的是这 4 个僵尸**都在列表白名单里** —— 流水线一旦跑到中间节点
 * 就会把半成品素材写成一个「列表可见」的状态。
 *
 * 收敛为 5 个：
 *   discovered  已入库，流水线未跑（stream-upload 建行时的默认值）
 *   processing  流水线跑中（gate/tag/画幅未完成）← 替代原 gating_passed/tagging_done
 *   ready       完整可用，**唯一进列表的**
 *   rejected    网关/闸门拒收（已落回收站，dispose_source 记录具体来源）
 *   deleted     已进回收站，保留窗口内可恢复
 *
 * 不变量：
 *   1. 只有 'ready' 进列表。中间态一律不可见。
 *   2. 任何废弃路径都必须走 assets-delete.softDeleteAsset()，
 *      绕过去就会出现「列表里有、点进去 404」的幽灵 fid。
 *   3. 被判定为「非素材」不是 deleted 的同义词 —— 前者用 rejected + 回收站，
 *      保留 14 天给用户翻案；后者是用户主动删，保留 3 天。
 */

/** 完整可用，唯一进列表 */
const STATUS_READY = 'ready';
/** 已入库，流水线未开始 */
const STATUS_DISCOVERED = 'discovered';
/** 流水线跑中（半成品，不可���） */
const STATUS_PROCESSING = 'processing';
/** 被判定拒收（已落回收站） */
const STATUS_REJECTED = 'rejected';
/** 已废弃（已落回收站，窗口内可恢复） */
const STATUS_DELETED = 'deleted';

/**
 * 列表可见判据：只有 ready。
 * 列表接口与详情接口必须用同一个判据，否则会出现
 * 「详情 200 但列表没有」或「列表有但详情 404」的不一致。
 */
const BROWSE_VISIBLE_STATUSES = [STATUS_READY, 'ready_with_flags'];

/** SQL 片段：status 属于列表可见态 */
const BROWSE_READY_SQL = "a.status IN ('ready', 'ready_with_flags')";

/** 流水线中间态（用于「处理中」统计与异常页查询） */
const PROCESSING_STATUSES = [STATUS_DISCOVERED, STATUS_PROCESSING];

/**
 * 已废弃的历史状态（2026-10-03 起不应再被写入，仅供迁移脚本识别）。
 * excluded：闸门早期用的「非素材」标记，语义与 rejected 完全重复，
 *   是「同一个意思两个状态」的产物。迁移时统一并入 rejected。
 */
const LEGACY_STATUSES = ['excluded'];

/** 全部有效状态（用于数据校验与迁移断言） */
const VALID_STATUSES = [
  STATUS_READY,
  STATUS_DISCOVERED,
  STATUS_PROCESSING,
  STATUS_REJECTED,
  STATUS_DELETED,
];

/** 终态：不会再变化（除恢复） */
const TERMINAL_STATUSES = [STATUS_REJECTED, STATUS_DELETED];

module.exports = {
  STATUS_READY,
  STATUS_DISCOVERED,
  STATUS_PROCESSING,
  STATUS_REJECTED,
  STATUS_DELETED,
  BROWSE_VISIBLE_STATUSES,
  BROWSE_READY_SQL,
  PROCESSING_STATUSES,
  LEGACY_STATUSES,
  VALID_STATUSES,
  TERMINAL_STATUSES,
};
