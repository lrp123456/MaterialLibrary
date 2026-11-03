/**
 * 全局常量（自鸿蒙 Constants.ets 迁移）
 */
export const PREF_STORE_NAME = 'album_sync_store'
export const KEY_DEVICE_ID = 'device_id'
export const KEY_SERVER_URL = 'server_url'
/** 用户在设置页手动填写的服务器地址（探活不会覆盖它） */
export const KEY_MANUAL_SERVER_URL = 'manual_server_url'
export const KEY_SERVER_TOKEN = 'server_token'
export const KEY_AUTO_SYNC_ENABLED = 'auto_sync_enabled'
export const KEY_LAST_SYNC_TIME = 'last_sync_time'
export const KEY_LAST_SYNC_RESULT = 'last_sync_result'
export const KEY_LAST_SYNC_COUNT = 'last_sync_count'
export const KEY_LAST_SYNC_COST = 'last_sync_cost_ms'
export const KEY_PENDING_COUNT = 'pending_count'
export const KEY_FALLBACK_DIR = 'fallback_dir'
export const KEY_WINDOW_DAYS = 'window_days'
export const KEY_PHOTO_PERM = 'photo_permission_granted'
/** 素材库会话（MaterialViewer） */
export const KEY_VIEWER_TOKEN = 'viewer_token'
export const KEY_USERNAME = 'username'
export const KEY_ROLE = 'role'

/** 窗口默认 3 天（快照 payload 记录用；扫描固定 SNAPSHOT_SCAN_DAYS，不再驱动冻结/撤销） */
export const DEFAULT_WINDOW_DAYS = 3
export const SNAPSHOT_SCAN_DAYS = 3
export const WINDOW_DAY_OPTIONS = [3, 1, 2, 7, 30, 0]

/** 服务端回退链：本机 → 局域网 → 公网 */
export const API_PORT = 30001
export const SERVER_URL_CANDIDATES = [
  `http://39.107.120.55:${API_PORT}`,
  `http://127.0.0.1:${API_PORT}`
]
/** 默认用回退链第一个（公网直连） */
export const DEFAULT_SERVER_URL = `http://39.107.120.55:${API_PORT}`
/** 已知局域网地址（服务端所在机器的历史 IP） */
export const KNOWN_LAN_HOSTS = ['192.168.1.59']

export function defaultServerUrl() {
  return DEFAULT_SERVER_URL
}
export const API_SNAPSHOT_PATH = '/api/snapshot'
export const API_HEALTH_PATH = '/api/health'
export const PAGE_SIZE = 500
export const UPLOAD_RETRY_TIMES = 3
export const RETRY_BACKOFF_BASE_MS = 1000
export const HTTP_TIMEOUT_MS = 10000
export const PENDING_DIR = 'pending_snapshots'
export const FALLBACK_FILE_PREFIX = 'album_snapshot_'
export const APP_VERSION = '1.0.1-uniappx'

export const RESULT_SUCCESS = 'success'
export const RESULT_FAILED = 'failed'
export const RESULT_PENDING_UPLOAD = 'pending_upload'
export const RESULT_UNAUTHORIZED = 'unauthorized'
export const RESULT_NONE = 'none'
