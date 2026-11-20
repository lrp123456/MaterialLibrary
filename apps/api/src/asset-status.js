/**
 * 资产状态与 Fail-Open 双字段真源 (Phase 3 状态解耦)
 *
 * 核心要求 (Fail-Open 铁律)：
 * - visibility: 'visible' | 'rejected_box' | 'deleted' (入库瞬间默认为 'visible')
 * - pipeline_status: 'queued' | 'running' | 'done' | 'partial_failed'
 * - source_type: 'web_upload' | 'studio_save' | 'app_manual' | 'app_album_sync'
 */

const VISIBILITY_VISIBLE = 'visible';
const VISIBILITY_REJECTED = 'rejected_box';
const VISIBILITY_DELETED = 'deleted';

const PIPELINE_QUEUED = 'queued';
const PIPELINE_RUNNING = 'running';
const PIPELINE_DONE = 'done';
const PIPELINE_PARTIAL_FAILED = 'partial_failed';

const SOURCE_WEB_UPLOAD = 'web_upload';
const SOURCE_STUDIO_SAVE = 'studio_save';
const SOURCE_APP_MANUAL = 'app_manual';
const SOURCE_APP_ALBUM_SYNC = 'app_album_sync';

/** 完整可用（历史兼容状态） */
const STATUS_READY = 'ready';
/** 已入库，流水线未开始 */
const STATUS_DISCOVERED = 'discovered';
/** 流水线跑中（半成品） */
const STATUS_PROCESSING = 'processing';
/** 被判定拒收（已落回收站） */
const STATUS_REJECTED = 'rejected';
/** 已废弃（已落回收站，窗口内可恢复） */
const STATUS_DELETED = 'deleted';

/**
 * 列表可见判据：Fail-Open 铁律 —— 凡 visibility 为 visible 立即进列表（兼容历史 ready 记录）。
 */
const BROWSE_VISIBLE_STATUSES = [STATUS_READY, 'ready_with_flags', VISIBILITY_VISIBLE];

/** SQL 片段：status 属于列表可见态（兼容既有套件与 Fail-Open 架构） */
const BROWSE_READY_SQL = "a.status IN ('ready', 'ready_with_flags')";

/** 流水线中间态（用于「处理中」统计与异常页查询） */
const PROCESSING_STATUSES = [STATUS_DISCOVERED, STATUS_PROCESSING, PIPELINE_QUEUED, PIPELINE_RUNNING];

/** 已废弃的历史状态 */
const LEGACY_STATUSES = ['excluded'];

/** 全部有效状态 */
const VALID_STATUSES = [
  STATUS_READY,
  STATUS_DISCOVERED,
  STATUS_PROCESSING,
  STATUS_REJECTED,
  STATUS_DELETED,
  VISIBILITY_VISIBLE,
  VISIBILITY_REJECTED,
  VISIBILITY_DELETED,
];

/** 终态 */
const TERMINAL_STATUSES = [STATUS_REJECTED, STATUS_DELETED, VISIBILITY_REJECTED, VISIBILITY_DELETED];

module.exports = {
  VISIBILITY_VISIBLE,
  VISIBILITY_REJECTED,
  VISIBILITY_DELETED,
  PIPELINE_QUEUED,
  PIPELINE_RUNNING,
  PIPELINE_DONE,
  PIPELINE_PARTIAL_FAILED,
  SOURCE_WEB_UPLOAD,
  SOURCE_STUDIO_SAVE,
  SOURCE_APP_MANUAL,
  SOURCE_APP_ALBUM_SYNC,
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
