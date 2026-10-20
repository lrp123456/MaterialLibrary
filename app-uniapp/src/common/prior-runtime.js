/* Extracted shared runtime helpers from a prior known-good build. */
/* eslint-disable */
function formatAppLog(type, filename, ...args) {
  if (uni.__log__) {
    uni.__log__(type, filename, ...args);
  } else {
    console[type].apply(console, [...args, filename]);
  }
}
var lookup = [
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  62,
  0,
  62,
  0,
  63,
  52,
  53,
  54,
  55,
  56,
  57,
  58,
  59,
  60,
  61,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  1,
  2,
  3,
  4,
  5,
  6,
  7,
  8,
  9,
  10,
  11,
  12,
  13,
  14,
  15,
  16,
  17,
  18,
  19,
  20,
  21,
  22,
  23,
  24,
  25,
  0,
  0,
  0,
  0,
  63,
  0,
  26,
  27,
  28,
  29,
  30,
  31,
  32,
  33,
  34,
  35,
  36,
  37,
  38,
  39,
  40,
  41,
  42,
  43,
  44,
  45,
  46,
  47,
  48,
  49,
  50,
  51
];
function base64Decode(source, target) {
  var sourceLength = source.length;
  var paddingLength = source[sourceLength - 2] === "=" ? 2 : source[sourceLength - 1] === "=" ? 1 : 0;
  var tmp;
  var byteIndex = 0;
  var baseLength = sourceLength - paddingLength & 4294967292;
  for (var i = 0; i < baseLength; i += 4) {
    tmp = lookup[source.charCodeAt(i)] << 18 | lookup[source.charCodeAt(i + 1)] << 12 | lookup[source.charCodeAt(i + 2)] << 6 | lookup[source.charCodeAt(i + 3)];
    target[byteIndex++] = tmp >> 16 & 255;
    target[byteIndex++] = tmp >> 8 & 255;
    target[byteIndex++] = tmp & 255;
  }
  if (paddingLength === 1) {
    tmp = lookup[source.charCodeAt(i)] << 10 | lookup[source.charCodeAt(i + 1)] << 4 | lookup[source.charCodeAt(i + 2)] >> 2;
    target[byteIndex++] = tmp >> 8 & 255;
    target[byteIndex++] = tmp & 255;
  }
  if (paddingLength === 2) {
    tmp = lookup[source.charCodeAt(i)] << 2 | lookup[source.charCodeAt(i + 1)] >> 4;
    target[byteIndex++] = tmp & 255;
  }
}
const crypto = {
  getRandomValues(arr) {
    if (!(arr instanceof Int8Array || arr instanceof Uint8Array || arr instanceof Int16Array || arr instanceof Uint16Array || arr instanceof Int32Array || arr instanceof Uint32Array || arr instanceof Uint8ClampedArray)) {
      throw new Error("Expected an integer array");
    }
    if (arr.byteLength > 65536) {
      throw new Error("Can only request a maximum of 65536 bytes");
    }
    var crypto2 = requireNativePlugin("DCloud-Crypto");
    base64Decode(crypto2.getRandomValues(arr.byteLength), new Uint8Array(
      arr.buffer,
      arr.byteOffset,
      arr.byteLength
    ));
    return arr;
  }
};
const KEY_DEVICE_ID = "device_id";
const KEY_SERVER_URL = "server_url";
const KEY_SERVER_TOKEN = "server_token";
const KEY_AUTO_SYNC_ENABLED = "auto_sync_enabled";
const KEY_LAST_SYNC_TIME = "last_sync_time";
const KEY_LAST_SYNC_RESULT = "last_sync_result";
const KEY_LAST_SYNC_COUNT = "last_sync_count";
const KEY_LAST_SYNC_COST = "last_sync_cost_ms";
const KEY_PENDING_COUNT = "pending_count";
const KEY_FALLBACK_DIR = "fallback_dir";
const KEY_WINDOW_DAYS = "window_days";
const KEY_PHOTO_PERM = "photo_permission_granted";
const KEY_VIEWER_TOKEN = "viewer_token";
const KEY_USERNAME = "username";
const KEY_ROLE = "role";
const DEFAULT_WINDOW_DAYS = 3;
const SNAPSHOT_SCAN_DAYS = 3;
const WINDOW_DAY_OPTIONS = [3, 1, 2, 7, 30, 0];
const DEFAULT_SERVER_URL = "http://127.0.0.1:30001";
const SERVER_URL_CANDIDATES = [
  "http://127.0.0.1:30001",
  "http://192.168.1.59:30001",
  "http://10.0.2.2:30001"
  // 公网地址不入库：在应用内手动填写，或构建时注入 PUBLIC_BASE_URL
];
const API_SNAPSHOT_PATH = "/api/snapshot";
const PAGE_SIZE = 500;
const UPLOAD_RETRY_TIMES = 3;
const RETRY_BACKOFF_BASE_MS = 1e3;
const HTTP_TIMEOUT_MS = 1e4;
const FALLBACK_FILE_PREFIX = "album_snapshot_";
const APP_VERSION = "1.0.1-uniappx";
const RESULT_SUCCESS = "success";
const RESULT_FAILED = "failed";
const RESULT_PENDING_UPLOAD = "pending_upload";
const RESULT_UNAUTHORIZED = "unauthorized";
const RESULT_NONE = "none";
function uuid() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID().replace(/-/g, "");
  }
  return "xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx".replace(
    /x/g,
    () => (Math.random() * 16 | 0).toString(16)
  );
}
const storage$1 = uni.getStorageSync.bind(uni);
function get$1(key, def) {
  try {
    const v = storage$1(key);
    return v === "" || v === void 0 || v === null ? def : v;
  } catch {
    return def;
  }
}
function set$1(key, value) {
  try {
    uni.setStorageSync(key, value);
  } catch (e) {
    formatAppLog("error", "at service/SyncStateStore.js:41", "[SyncStateStore]", key, e);
  }
}
const store = {
  getDeviceId() {
    let id = String(get$1(KEY_DEVICE_ID, "") || "").trim();
    if (id)
      return id;
    try {
      if (typeof plus !== "undefined" && plus.os && plus.os.name === "Android") {
        const Settings = plus.android.importClass("android.provider.Settings");
        const mainActivity = plus.android.runtimeMainActivity();
        if (mainActivity && Settings && Settings.Secure) {
          const androidId = Settings.Secure.getString(mainActivity.getContentResolver(), "android_id");
          if (androidId && androidId.length >= 8 && androidId !== "9774d56d682e549c") {
            id = `and_${androidId}`;
            set$1(KEY_DEVICE_ID, id);
            return id;
          }
        }
      }
    } catch (e) {
      formatAppLog("warn", "at service/SyncStateStore.js:66", "[SyncStateStore] read android_id error", e);
    }
    try {
      if (typeof plus !== "undefined" && plus.device && plus.device.uuid) {
        const devUuid = String(plus.device.uuid).trim();
        if (devUuid && devUuid.length >= 8) {
          id = `dev_${devUuid.replace(/[^a-zA-Z0-9_-]/g, "")}`;
          set$1(KEY_DEVICE_ID, id);
          return id;
        }
      }
    } catch (e) {
    }
    try {
      const sys = uni.getSystemInfoSync();
      if (sys && sys.deviceId && String(sys.deviceId).trim().length >= 8) {
        id = `sys_${String(sys.deviceId).trim()}`;
        set$1(KEY_DEVICE_ID, id);
        return id;
      }
    } catch (e) {
    }
    id = uuid();
    set$1(KEY_DEVICE_ID, id);
    return id;
  },
  getServerUrl() {
    let url = String(get$1(KEY_SERVER_URL, "") || "").replace(/\/+$/, "");
    if (!url) {
      url = DEFAULT_SERVER_URL;
      set$1(KEY_SERVER_URL, url);
    }
    return url;
  },
  setServerUrl(url) {
    set$1(KEY_SERVER_URL, String(url || "").trim().replace(/\/+$/, ""));
  },
  /** 快照上传用 Bearer Token（AlbumSync） */
  getServerToken() {
    return String(get$1(KEY_SERVER_TOKEN, "") || "");
  },
  setServerToken(token) {
    set$1(KEY_SERVER_TOKEN, String(token || "").trim());
  },
  /** 素材库会话 Token（MaterialViewer / ViewerApi） */
  getToken() {
    return String(get$1(KEY_VIEWER_TOKEN, "") || "");
  },
  setToken(token) {
    set$1(KEY_VIEWER_TOKEN, String(token || ""));
  },
  getUsername() {
    return String(get$1(KEY_USERNAME, "") || "");
  },
  setUsername(name) {
    set$1(KEY_USERNAME, String(name || ""));
  },
  getRole() {
    return String(get$1(KEY_ROLE, "") || "");
  },
  setRole(role) {
    set$1(KEY_ROLE, String(role || ""));
  },
  /** 清除登录态（保留 username 方便下次重新登录时预填） */
  clearSession() {
    set$1(KEY_VIEWER_TOKEN, "");
    set$1(KEY_ROLE, "");
  },
  isAutoSyncEnabled() {
    const v = get$1(KEY_AUTO_SYNC_ENABLED, true);
    return v === true || v === "true";
  },
  setAutoSyncEnabled(enabled) {
    set$1(KEY_AUTO_SYNC_ENABLED, !!enabled);
  },
  /** 仅在 Wi-Fi 网络下同步原图/视频（防止消耗蜂窝流量） */
  isWifiOnlyEnabled() {
    const v = get$1("sync_wifi_only", true);
    return v === true || v === "true";
  },
  setWifiOnlyEnabled(enabled) {
    set$1("sync_wifi_only", !!enabled);
  },
  /** 实时媒体上传队列状态 */
  _queueListeners: [],
  _queueStats: {
    isUploading: false,
    total: 0,
    current: 0,
    currentFileName: "",
    progressPercent: 0,
    successCount: 0,
    failCount: 0
  },
  getMediaQueueStatus() {
    return { ...this._queueStats };
  },
  updateMediaQueueStatus(stats) {
    this._queueStats = { ...this._queueStats, ...stats };
    for (const fn of this._queueListeners) {
      try {
        fn(this._queueStats);
      } catch (_) {
      }
    }
  },
  onMediaQueueChange(fn) {
    if (typeof fn === "function")
      this._queueListeners.push(fn);
    return () => {
      this._queueListeners = this._queueListeners.filter((f) => f !== fn);
    };
  },
  getWindowDays() {
    const n2 = Number(get$1(KEY_WINDOW_DAYS, DEFAULT_WINDOW_DAYS));
    return Number.isNaN(n2) ? DEFAULT_WINDOW_DAYS : n2;
  },
  setWindowDays(days) {
    set$1(KEY_WINDOW_DAYS, Number(days));
  },
  getFallbackDir() {
    return String(get$1(KEY_FALLBACK_DIR, "") || "");
  },
  setFallbackDir(uri) {
    set$1(KEY_FALLBACK_DIR, String(uri || ""));
  },
  getPendingCount() {
    const n2 = Number(get$1(KEY_PENDING_COUNT, 0));
    return Number.isNaN(n2) ? 0 : n2;
  },
  setPendingCount(c) {
    set$1(KEY_PENDING_COUNT, Number(c) || 0);
  },
  isPhotoPermissionGranted() {
    return get$1(KEY_PHOTO_PERM, false) === true || get$1(KEY_PHOTO_PERM, "true") === "true";
  },
  setPhotoPermissionGranted(ok) {
    set$1(KEY_PHOTO_PERM, !!ok);
  },
  getAppVersion() {
    return APP_VERSION;
  },
  recordSync(result, count, costMs) {
    set$1(KEY_LAST_SYNC_RESULT, result);
    set$1(KEY_LAST_SYNC_TIME, Date.now());
    set$1(KEY_LAST_SYNC_COUNT, count);
    set$1(KEY_LAST_SYNC_COST, costMs);
  },
  getLastSync() {
    return {
      result: String(get$1(KEY_LAST_SYNC_RESULT, RESULT_NONE) || RESULT_NONE),
      time: Number(get$1(KEY_LAST_SYNC_TIME, 0)) || 0,
      count: Number(get$1(KEY_LAST_SYNC_COUNT, 0)) || 0,
      cost: Number(get$1(KEY_LAST_SYNC_COST, 0)) || 0,
      pending: store.getPendingCount()
    };
  },
  resultText(result) {
    if (result === RESULT_SUCCESS)
      return "同步成功";
    if (result === RESULT_FAILED)
      return "同步失败";
    if (result === RESULT_PENDING_UPLOAD)
      return "已存待重传";
    if (result === RESULT_UNAUTHORIZED)
      return "未授权";
    return "尚未同步";
  },
  resultColor(result) {
    if (result === RESULT_SUCCESS)
      return "#059669";
    if (result === RESULT_FAILED)
      return "#DC2626";
    if (result === RESULT_PENDING_UPLOAD || result === RESULT_UNAUTHORIZED)
      return "#D97706";
    return "#94A3B8";
  },
  formatTime(ts) {
    if (!ts || ts <= 0)
      return "暂无记录";
    const d = new Date(ts);
    const pad = (n2) => n2 < 10 ? `0${n2}` : `${n2}`;
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  },
  listPending() {
    try {
      const raw = storage$1("pending_queue");
      const arr = Array.isArray(raw) ? raw : [];
      return arr;
    } catch {
      return [];
    }
  },
  savePending(json) {
    try {
      const arr = store.listPending();
      arr.push({ id: String(Date.now()), json, savedAt: Date.now() });
      set$1("pending_queue", arr);
      store.setPendingCount(arr.length);
      return true;
    } catch (e) {
      formatAppLog("error", "at service/SyncStateStore.js:282", "[SyncStateStore] savePending", e);
      return false;
    }
  },
  removePending(id) {
    try {
      const arr = store.listPending().filter((x) => x.id !== id);
      set$1("pending_queue", arr);
      store.setPendingCount(arr.length);
    } catch (e) {
      formatAppLog("error", "at service/SyncStateStore.js:293", "[SyncStateStore] removePending", e);
    }
  },
  /** 复制文本到剪贴板（device_id 等） */
  copyText(text, tip = "已复制") {
    uni.setClipboardData({
      data: String(text || ""),
      success: () => uni.showToast({ title: tip, icon: "none" }),
      fail: () => uni.showToast({ title: "复制失败", icon: "none" })
    });
  },
  /** 登记已从 App 保存到系统相册的媒体，防止相册扫描重复入库 */
  recordExportedMedia(fileName, hash = "") {
    try {
      const records = get$1("exported_media_records", []) || [];
      const fn = (fileName || "").trim().toLowerCase();
      if (!records.some((r) => (r.name || "").toLowerCase() === fn || hash && r.hash === hash)) {
        records.push({ name: fileName, hash, time: Date.now() });
        set$1("exported_media_records", records.slice(-500));
      }
    } catch (e) {
      formatAppLog("warn", "at service/SyncStateStore.js:316", "[SyncStateStore] recordExportedMedia failed", e);
    }
  },
  /** 检查文件是否为本端导出的媒体（三重防重复判定） */
  isExportedMedia(filePath, fileName) {
    try {
      const fn = (fileName || "").trim().toLowerCase();
      const fp = (filePath || "").trim().toLowerCase();
      if (fn.startsWith("ml_saved_") || fp.includes("materiallibrary") || fp.includes("material_library")) {
        return true;
      }
      const records = get$1("exported_media_records", []) || [];
      return records.some((r) => (r.name || "").toLowerCase() === fn);
    } catch {
      return false;
    }
  }
};
const STORAGE_KEY_LIST = "album_viewer_cache_list";
const STORAGE_KEY_DETAIL = "album_viewer_cache_detail";
const DEFAULT_TTL = 5 * 60 * 1e3;
const MAX_LIST_CACHE = 20;
const MAX_DETAIL_CACHE = 100;
class ViewerCacheService {
  constructor() {
    this._listMap = /* @__PURE__ */ new Map();
    this._detailMap = /* @__PURE__ */ new Map();
    this._pendingDetailPreview = null;
    this._restoreFromStorage();
  }
  _restoreFromStorage() {
    try {
      const listData = uni.getStorageSync(STORAGE_KEY_LIST);
      if (listData && typeof listData === "object") {
        for (const [k, v] of Object.entries(listData)) {
          if (v && v.data)
            this._listMap.set(k, v);
        }
      }
      const detailData = uni.getStorageSync(STORAGE_KEY_DETAIL);
      if (detailData && typeof detailData === "object") {
        for (const [k, v] of Object.entries(detailData)) {
          if (v && v.data)
            this._detailMap.set(k, v);
        }
      }
    } catch (e) {
      formatAppLog("warn", "at service/ViewerCache.js:37", "[ViewerCache] restore failed", e);
    }
  }
  _saveToStorage(type = "both") {
    try {
      if (type === "list" || type === "both") {
        const obj = {};
        for (const [k, v] of this._listMap.entries()) {
          obj[k] = v;
        }
        uni.setStorageSync(STORAGE_KEY_LIST, obj);
      }
      if (type === "detail" || type === "both") {
        const obj = {};
        for (const [k, v] of this._detailMap.entries()) {
          obj[k] = v;
        }
        uni.setStorageSync(STORAGE_KEY_DETAIL, obj);
      }
    } catch (e) {
      formatAppLog("warn", "at service/ViewerCache.js:58", "[ViewerCache] save failed", e);
    }
  }
  /**
   * 生成列表查询缓存 Key（包含所有多维筛选参数，杜绝脏缓存）
   */
  makeListKey(opts = {}) {
    const {
      page = 1,
      keyword = "",
      space = "",
      style = "",
      material = "",
      colors = "",
      furniture_item = "",
      furniture_category = "",
      orientation = "",
      sort = "latest",
      mediaType = "image",
      videoSource = "",
      mood = "",
      pose = "",
      character = ""
    } = opts;
    return `list:m=${mediaType}:vs=${videoSource}:p=${page}:k=${keyword}:sp=${space}:st=${style}:mat=${material}:c=${colors}:f=${furniture_item || furniture_category}:mood=${mood}:pose=${pose}:char=${character}:o=${orientation}:s=${sort}`;
  }
  /**
   * 生成详情缓存 Key
   */
  makeDetailKey(fid) {
    return `detail:${String(fid || "")}`;
  }
  /**
   * 获取列表缓存（SWR）
   */
  getList(key, ttl = DEFAULT_TTL) {
    const item = this._listMap.get(key);
    if (!item)
      return null;
    const age = Date.now() - (item.timestamp || 0);
    return {
      data: item.data,
      timestamp: item.timestamp,
      isFresh: age < ttl,
      age
    };
  }
  /**
   * 设置列表缓存
   */
  setList(key, data) {
    if (!key || !data)
      return;
    if (this._listMap.size >= MAX_LIST_CACHE && !this._listMap.has(key)) {
      const oldestKey = this._listMap.keys().next().value;
      this._listMap.delete(oldestKey);
    }
    this._listMap.set(key, {
      data,
      timestamp: Date.now()
    });
    this._saveToStorage("list");
  }
  /**
   * 获取详情缓存（SWR）
   */
  getDetail(fid, ttl = DEFAULT_TTL) {
    const key = this.makeDetailKey(fid);
    const item = this._detailMap.get(key);
    if (!item)
      return null;
    const age = Date.now() - (item.timestamp || 0);
    return {
      data: item.data,
      timestamp: item.timestamp,
      isFresh: age < ttl,
      age
    };
  }
  /**
   * 设置详情缓存
   */
  setDetail(fid, data) {
    const key = this.makeDetailKey(fid);
    if (!fid || !data)
      return;
    if (this._detailMap.size >= MAX_DETAIL_CACHE && !this._detailMap.has(key)) {
      const oldestKey = this._detailMap.keys().next().value;
      this._detailMap.delete(oldestKey);
    }
    this._detailMap.set(key, {
      data,
      timestamp: Date.now()
    });
    this._saveToStorage("detail");
  }
  /**
   * 设置待进入详情页的列表预览元数据（跨页秒开桥接）
   */
  setPendingDetailPreview(item) {
    this._pendingDetailPreview = item ? { ...item } : null;
  }
  /**
   * 获取并消费待进入详情页的预览元数据
   */
  getPendingDetailPreview(fid) {
    if (this._pendingDetailPreview && (!fid || this._pendingDetailPreview.fid === fid)) {
      const p = this._pendingDetailPreview;
      this._pendingDetailPreview = null;
      return p;
    }
    return null;
  }
  /**
   * 获取缓存统计指标
   */
  getStats() {
    return {
      queryCount: this._listMap.size,
      detailCount: this._detailMap.size,
      totalCount: this._listMap.size + this._detailMap.size
    };
  }
  /**
   * 清空所有业务数据缓存
   */
  clearAll() {
    this._listMap.clear();
    this._detailMap.clear();
    this._pendingDetailPreview = null;
    try {
      uni.removeStorageSync(STORAGE_KEY_LIST);
      uni.removeStorageSync(STORAGE_KEY_DETAIL);
    } catch (_) {
    }
  }
}
const viewerCache = new ViewerCacheService();
const API_BASE = "/api/viewer";
const TIMEOUT = 1e4;
function buildUrl(path, query = [], serverOverride) {
  const server = serverOverride || store.getServerUrl();
  let url = server + API_BASE + path;
  const valid = query.filter(Boolean);
  if (valid.length)
    url += "?" + valid.join("&");
  return url;
}
function authHeader() {
  const h = { "Content-Type": "application/json" };
  const t = store.getToken();
  if (t)
    h["Authorization"] = "Bearer " + t;
  return h;
}
function serverCandidates() {
  const saved = String(store.getServerUrl() || "").replace(/\/+$/, "");
  const list = [];
  if (saved) list.push(saved);
  for (const u of SERVER_URL_CANDIDATES) {
    const n = String(u).replace(/\/+$/, "");
    if (n && !list.includes(n)) list.push(n);
  }
  return list;
}
function request$1(path, { method = "GET", query = [], body = "", timeout = TIMEOUT } = {}) {
  const servers = serverCandidates();
  let idx = 0;
  const tryOne = () => {
    const server = servers[idx];
    return new Promise((resolve, reject) => {
      uni.request({
        url: buildUrl(path, query, server),
        method,
        header: authHeader(),
        data: body || void 0,
        timeout: timeout || TIMEOUT,
        success: (res) => {
          const code = res.statusCode || 0;
          // 当前地址有响应（含 401/4xx）说明连得上，固定该地址
          store.setServerUrl(server);
          if (code === 401 && path !== "/auth/login") {
            store.clearSession();
            viewerCache.clearAll();
            reject(new Error("未登录或会话已过期"));
            return;
          }
          const root = res.data;
          if (root == null || typeof root !== "object") {
            reject(new Error(`服务端响应异常（HTTP ${code}），请确认地址是否正确`));
            return;
          }
          const ok = root.success === true || root.success === "true";
          if (code < 200 || code >= 300 || !ok) {
            reject(new Error(root.error || `HTTP ${code}`));
            return;
          }
          resolve(root.data);
        },
        fail: (err) => {
          const msg = err && err.errMsg || "网络错误";
          const netFail = /timeout|fail|refused|network|clear/i.test(msg);
          // 网络不通：按 本机→局域网→模拟器宿主→公网 回退
          if (netFail && idx < servers.length - 1) {
            idx += 1;
            tryOne().then(resolve, reject);
            return;
          }
          if (/timeout/i.test(msg)) {
            reject(new Error("连接超时，请检查服务器地址与网络"));
          } else if (/cleartext|not allowed/i.test(msg)) {
            reject(new Error("无法建立连接（HTTP 明文请求可能被系统拦截）"));
          } else if (/fail/i.test(msg)) {
            reject(new Error("无法连接服务器，请检查地址与网络"));
          } else {
            reject(new Error(msg));
          }
        }
      });
    });
  };
  return tryOne();
}
async function login(username, password) {
  const data = await request$1("/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password })
  });
  const token = data.token || "";
  const user = data.user || {};
  store.setToken(token);
  store.setUsername(user.username || username);
  store.setRole(user.role || "viewer");
  return data;
}
async function fetchMe() {
  return request$1("/auth/me");
}
async function logout() {
  try {
    await request$1("/auth/logout", { method: "POST" });
  } catch (e) {
    formatAppLog("warn", "at service/ViewerApi.js:91", "[ViewerApi] logout notify failed (ignored)", e);
  } finally {
    store.clearSession();
    viewerCache.clearAll();
  }
}
async function fetchAssets(opts = {}) {
  const {
    page = 1,
    pageSize = 30,
    keyword = "",
    space = "",
    style = "",
    material = "",
    colors = "",
    colorStyle = "",
    color_style = "",
    orientation = "",
    sort = "latest",
    mediaType = "",
    videoSource = "",
    furniture_item = "",
    furniture_category = "",
    mood = "",
    genre = "",
    pose = "",
    character = ""
  } = opts;
  const resolvedColorStyle = colorStyle || color_style;
  const query = [
    `page=${page}`,
    `pageSize=${pageSize}`,
    keyword ? `keyword=${encodeURIComponent(keyword)}` : "",
    space ? `space=${encodeURIComponent(space)}` : "",
    style ? `style=${encodeURIComponent(style)}` : "",
    material ? `material=${encodeURIComponent(material)}` : "",
    furniture_item ? `furniture_item=${encodeURIComponent(furniture_item)}` : "",
    furniture_category ? `furniture_category=${encodeURIComponent(furniture_category)}` : "",
    mood ? `mood=${encodeURIComponent(mood)}` : "",
    genre ? `genre=${encodeURIComponent(genre)}` : "",
    pose ? `pose=${encodeURIComponent(pose)}` : "",
    character ? `character=${encodeURIComponent(character)}` : "",
    colors ? `colors=${encodeURIComponent(colors)}` : "",
    resolvedColorStyle ? `color_style=${encodeURIComponent(resolvedColorStyle)}` : "",
    orientation ? `orientation=${encodeURIComponent(orientation)}` : "",
    sort ? `sort=${encodeURIComponent(sort)}` : "",
    mediaType ? `media_type=${encodeURIComponent(mediaType)}` : "",
    videoSource ? `video_source=${encodeURIComponent(videoSource)}` : ""
  ];
  const data = await request$1("/assets", { query });
  if (data) {
    const key = viewerCache.makeListKey(opts);
    viewerCache.setList(key, data);
  }
  return data;
}
async function downloadAndSaveToAlbum({ url, fileName = "", isVideo = false, isAudio = false }) {
  if (!url)
    throw new Error("无效的下载地址");
  const isAudioFile = isAudio || /\.(mp3|wav|m4a|aac|flac)$/i.test(fileName || url);
  const isVideoFile2 = isVideo || /\.(mp4|mov|avi|mkv|webm)$/i.test(fileName || url);
  let saveName = fileName || (isAudioFile ? `ML_AUDIO_${Date.now()}.mp3` : isVideoFile2 ? `ML_VIDEO_${Date.now()}.mp4` : `ML_IMAGE_${Date.now()}.jpg`);
  if (!saveName.toLowerCase().startsWith("ml_saved_")) {
    saveName = `ML_SAVED_${saveName}`;
  }
  uni.showLoading({ title: "正在保存素材...", mask: true });
  const saveLocalFile = (filePath) => {
    return new Promise((resolve, reject) => {
      if (isAudioFile) {
        uni.saveFile({
          tempFilePath: filePath,
          success: (res) => {
            uni.hideLoading();
            store.recordExportedMedia(saveName);
            if (fileName && fileName !== saveName) {
              store.recordExportedMedia(fileName);
            }
            uni.showToast({ title: "音频已保存到手机", icon: "success" });
            resolve({ success: true, savedFilePath: res.savedFilePath, fileName: saveName });
          },
          fail: (saveErr) => {
            uni.hideLoading();
            const errMsg = saveErr && saveErr.errMsg || "保存音频失败";
            uni.showToast({ title: errMsg, icon: "none" });
            reject(new Error(errMsg));
          }
        });
        return;
      }
      const saveFn = isVideoFile2 ? uni.saveVideoToPhotosAlbum : uni.saveImageToPhotosAlbum;
      saveFn({
        filePath,
        success: () => {
          uni.hideLoading();
          store.recordExportedMedia(saveName);
          if (fileName && fileName !== saveName) {
            store.recordExportedMedia(fileName);
          }
          uni.showToast({ title: "已成功保存至相册", icon: "success" });
          resolve({ success: true, fileName: saveName });
        },
        fail: (saveErr) => {
          uni.hideLoading();
          const errMsg = saveErr && saveErr.errMsg || "保存相册失败";
          uni.showToast({ title: errMsg, icon: "none" });
          reject(new Error(errMsg));
        }
      });
    });
  };
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    return saveLocalFile(url);
  }
  return new Promise((resolve, reject) => {
    uni.downloadFile({
      url,
      success: async (res) => {
        if (res.statusCode === 200 && res.tempFilePath) {
          try {
            const r = await saveLocalFile(res.tempFilePath);
            resolve(r);
          } catch (e) {
            reject(e);
          }
        } else {
          uni.hideLoading();
          const msg = `下载文件失败 (HTTP ${res.statusCode})`;
          uni.showToast({ title: msg, icon: "none" });
          reject(new Error(msg));
        }
      },
      fail: (err) => {
        uni.hideLoading();
        const errMsg = err && err.errMsg || "网络下载失败";
        uni.showToast({ title: errMsg, icon: "none" });
        reject(new Error(errMsg));
      }
    });
  });
}
async function fetchDetail(fid) {
  const data = await request$1("/assets/" + encodeURIComponent(fid));
  if (data) {
    viewerCache.setDetail(fid, data);
  }
  return data;
}
function mediaUrl(fid, derivativeId = 0, dl = false) {
  const server = store.getServerUrl();
  const token = store.getToken();
  const q = [`token=${encodeURIComponent(token)}`];
  if (derivativeId > 0)
    q.push(`derivative=${derivativeId}`);
  if (dl)
    q.push("dl=1");
  return server + API_BASE + "/assets/" + encodeURIComponent(fid) + "/image?" + q.join("&");
}
function videoUrl(fid, dl = false) {
  return mediaUrl(fid, 0, dl);
}
function posterUrl(fid) {
  const server = store.getServerUrl();
  const token = store.getToken();
  const q = [`token=${encodeURIComponent(token)}`];
  return server + API_BASE + "/assets/" + encodeURIComponent(fid) + "/poster?" + q.join("&");
}
async function submitAiTask(fid, payload = {}) {
  return request$1("/ai/tasks", {
    method: "POST",
    body: JSON.stringify({ fid, ...payload })
  });
}
function uploadAiFile(filePath, filename = "upload.png") {
  return new Promise((resolve, reject) => {
    const server = store.getServerUrl();
    const token = store.getToken();
    uni.uploadFile({
      url: server + API_BASE + "/ai/upload",
      filePath,
      name: "file",
      header: token ? { Authorization: "Bearer " + token } : {},
      formData: { filename },
      timeout: 6e4,
      success: (res) => {
        try {
          const root = typeof res.data === "string" ? JSON.parse(res.data) : res.data;
          if (res.statusCode >= 200 && res.statusCode < 300 && root && root.success) {
            resolve(root.data);
            return;
          }
          reject(new Error(root && root.error || `上传失败 HTTP ${res.statusCode}`));
        } catch (e) {
          reject(new Error("上传响应无法解析"));
        }
      },
      fail: (err) => reject(new Error(err && err.errMsg || "上传失败"))
    });
  });
}
async function queryAiTask(fid) {
  return request$1(`/assets/${encodeURIComponent(fid)}/ai/tasks`, {
    method: "GET"
  });
}
async function queryAiTaskById(taskId) {
  return request$1(`/ai/tasks/${encodeURIComponent(taskId)}`, {
    method: "GET"
  });
}
async function triggerRestage(fid, { ratios = ["9:16", "3:4"], mainRatio = "9:16" } = {}) {
  return request$1(`/assets/${encodeURIComponent(fid)}/restage`, {
    method: "POST",
    body: JSON.stringify({ ratios, mainRatio }),
    timeout: 6e4
  });
}
async function fetchLabCapabilities() {
  return request$1("/lab/capabilities", { method: "GET" });
}
async function submitLabRun(payload = {}) {
  return request$1("/lab/runs", {
    method: "POST",
    body: JSON.stringify(payload),
    timeout: 9e4
  });
}
async function pollLabRun(engine, runId) {
  return request$1(`/lab/runs/${encodeURIComponent(engine)}/${encodeURIComponent(runId)}`, {
    method: "GET",
    timeout: 15e3
  });
}
async function fetchChatSessions() {
  return request$1("/chat/sessions", { method: "GET" });
}
async function createChatSession(payload = {}) {
  return request$1("/chat/sessions", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}
async function deleteChatSession(sessionId) {
  return request$1(`/chat/sessions/${encodeURIComponent(sessionId)}`, {
    method: "DELETE"
  });
}
async function fetchChatMessages(sessionId = "default_session", limit = 100) {
  return request$1("/chat/messages", {
    method: "GET",
    query: [`sessionId=${encodeURIComponent(sessionId)}`, `limit=${limit}`]
  });
}
async function saveChatMessage(payload = {}) {
  return request$1("/chat/messages", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}
async function clearChatMessages(sessionId = "default_session") {
  return request$1("/chat/messages", {
    method: "DELETE",
    query: [`sessionId=${encodeURIComponent(sessionId)}`]
  });
}
function uploadRefImage(filePath, name = "ref.jpg") {
  return new Promise((resolve, reject) => {
    const server = store.getServerUrl();
    if (!server || !filePath) {
      reject(new Error("缺少服务器或本地文件"));
      return;
    }
    const token = store.getToken();
    const header = {};
    if (token)
      header["Authorization"] = "Bearer " + token;
    uni.uploadFile({
      url: server + API_BASE + "/ai/upload",
      filePath,
      name: "file",
      header,
      formData: { filename: name },
      timeout: 6e4,
      success: (res) => {
        try {
          const body = typeof res.data === "string" ? JSON.parse(res.data) : res.data;
          if (res.statusCode >= 200 && res.statusCode < 300 && body && body.success !== false) {
            const data = body.data || body;
            let u = data.url || "";
            const srv = String(server || "").replace(/\/$/, "");
            if (u && /^https?:\/\//i.test(u)) {
              if (/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/i.test(u) && srv && !/^https?:\/\/(127\.0\.0\.1|localhost)/i.test(srv)) {
                try {
                  const pathPart = u.replace(/^https?:\/\/[^/]+/i, "");
                  u = srv + pathPart;
                } catch (e) {
                }
              }
            } else if (u) {
              u = srv + (u.startsWith("/") ? u : "/" + u);
            }
            resolve({ id: data.id || "", url: u });
          } else {
            reject(new Error(body && body.error || `HTTP ${res.statusCode}`));
          }
        } catch (e) {
          reject(new Error("上传响应解析失败"));
        }
      },
      fail: (err) => reject(new Error(err && err.errMsg || "上传失败"))
    });
  });
}
async function uploadRefImages(filePaths = []) {
  const out = [];
  for (const p of filePaths) {
    if (!p)
      continue;
    if (/^https?:\/\//i.test(p)) {
      out.push({ url: p, id: "" });
      continue;
    }
    out.push(await uploadRefImage(p));
  }
  return out;
}
async function optimizePrompt(prompt, { modelId, mode, slots, locked, imageUrls, images } = {}) {
  return request$1("/chat/optimize-prompt", {
    method: "POST",
    body: JSON.stringify({ prompt, modelId, mode, slots, locked, imageUrls, images }),
    timeout: 9e4
  });
}
async function segmentImage(payload = {}) {
  return request$1("/ai/segment", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}
async function fetchLocalModels() {
  return request$1("/lab/local-models", { method: "GET" });
}
async function fetchProductPresets() {
  return request$1("/products/presets", {
    method: "GET"
  });
}
async function deleteAsset(fid) {
  if (!fid)
    return false;
  const res = await request$1(`/assets/${encodeURIComponent(fid)}`, {
    method: "DELETE"
  });
  viewerCache.clear();
  return res;
}
function sessionValid() {
  return !!store.getToken();
}
function createPhotoMeta(id, name, size2, modified, localPath = "", mediaType = "image") {
  return {
    id: String(id || ""),
    name: String(name || ""),
    size: Number(size2) || 0,
    modified: Number(modified) || 0,
    fingerprint: `${id}_${size2}_${modified}`,
    localPath: String(localPath || ""),
    mediaType: String(mediaType || "image")
  };
}
function createSnapshot(deviceId, appVersion, windowDays, photos) {
  return {
    device_id: deviceId,
    timestamp: Date.now(),
    app_version: appVersion,
    window_days: windowDays,
    total_count: photos.length,
    photos
  };
}
const UploadStatus = {
  SUCCESS: "SUCCESS",
  FALLBACK: "FALLBACK",
  ERROR: "ERROR"
};
function mockPhotos() {
  const now = Date.now();
  const day = 864e5;
  const names = [
    "IMG_001.jpg",
    "IMG_002.jpg",
    "VID_001.mp4",
    "screenshot.png",
    "camera_2024.jpg",
    "old_outside_window.jpg"
  ];
  return names.map((name, i) => {
    const modified = i === 5 ? now - 10 * day : now - i * 36e5;
    const size2 = 102400 + i * 4096;
    const id = `mock_${i}_${size2}`;
    return createPhotoMeta(id, name, size2, modified);
  });
}
async function scanAlbum() {
  const cutoff = Date.now() - SNAPSHOT_SCAN_DAYS * 864e5;
  try {
    const photos = await scanViaMediaStore();
    return photos.filter((p) => p.modified >= cutoff || p.modified === 0).slice(0, 5e3);
  } catch (e) {
    formatAppLog("warn", "at service/AlbumScanner.js:39", "[AlbumScanner] native scan failed, fallback mock", e);
    return mockPhotos().filter((p) => p.modified >= cutoff);
  }
}
function scanViaMediaStore() {
  return new Promise((resolve, reject) => {
    try {
      if (typeof plus === "undefined" || !plus.android) {
        reject(new Error("plus.android unavailable"));
        return;
      }
      const main = plus.android.runtimeMainActivity();
      try {
        plus.android.importClass(main);
      } catch (_) {
      }
      let resolver = null;
      try {
        resolver = main.getContentResolver();
      } catch (_) {
      }
      if (!resolver)
        resolver = plus.android.invoke(main, "getContentResolver");
      if (!resolver) {
        reject(new Error("ContentResolver unavailable"));
        return;
      }
      try {
        plus.android.importClass(resolver);
      } catch (_) {
      }
      const MediaStore = plus.android.importClass("android.provider.MediaStore");
      const cutoff = Date.now() - SNAPSHOT_SCAN_DAYS * 864e5;
      const photos = [];
      const COL_ID = "_id";
      const COL_NAME = "_display_name";
      const COL_SIZE = "_size";
      const COL_MOD = "date_modified";
      const COL_DATA = "_data";
      const projection = [COL_ID, COL_NAME, COL_SIZE, COL_MOD, COL_DATA];
      const sortOrder = COL_MOD + " DESC";
      const MAX = PAGE_SIZE * 10;
      const readCursor = (cursor, mediaKind = "image") => {
        if (!cursor)
          return;
        try {
          const idIdx = plus.android.invoke(cursor, "getColumnIndex", COL_ID);
          const nameIdx = plus.android.invoke(cursor, "getColumnIndex", COL_NAME);
          const sizeIdx = plus.android.invoke(cursor, "getColumnIndex", COL_SIZE);
          const modIdx = plus.android.invoke(cursor, "getColumnIndex", COL_MOD);
          const dataIdx = plus.android.invoke(cursor, "getColumnIndex", COL_DATA);
          while (plus.android.invoke(cursor, "moveToNext") && photos.length < MAX) {
            const id = String(plus.android.invoke(cursor, "getString", idIdx) || "");
            const name = String(plus.android.invoke(cursor, "getString", nameIdx) || "");
            const size2 = Number(plus.android.invoke(cursor, "getLong", sizeIdx) || 0);
            const modSec = Number(plus.android.invoke(cursor, "getLong", modIdx) || 0);
            const modified = modSec > 0 ? modSec * 1e3 : 0;
            let localPath = "";
            if (dataIdx >= 0) {
              try {
                localPath = String(plus.android.invoke(cursor, "getString", dataIdx) || "");
              } catch (_) {
              }
            }
            if (!localPath && id) {
              localPath = mediaKind === "video" ? `content://media/external/video/media/${id}` : `content://media/external/images/media/${id}`;
            }
            if (!id)
              continue;
            if (modified > 0 && modified < cutoff)
              continue;
            if (store.isExportedMedia(localPath, name))
              continue;
            photos.push(createPhotoMeta(id, name, size2, modified, localPath, mediaKind));
          }
        } finally {
          try {
            plus.android.invoke(cursor, "close");
          } catch (_) {
          }
        }
      };
      const queryUri = (uri, label, mediaKind = "image") => {
        if (!uri)
          return;
        let cursor = null;
        try {
          cursor = plus.android.invoke(resolver, "query", uri, projection, null, null, sortOrder);
        } catch (e1) {
          try {
            cursor = resolver.query(uri, projection, null, null, sortOrder);
          } catch (e2) {
            formatAppLog("warn", "at service/AlbumScanner.js:129", "[AlbumScanner] query fail", label, e1 && e1.message, e2 && e2.message);
          }
        }
        if (cursor)
          readCursor(cursor, mediaKind);
        else
          formatAppLog("warn", "at service/AlbumScanner.js:133", "[AlbumScanner] cursor null", label);
      };
      try {
        queryUri(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, "images", "image");
      } catch (e) {
        formatAppLog("warn", "at service/AlbumScanner.js:139", "[AlbumScanner] images uri", e);
      }
      try {
        queryUri(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, "video", "video");
      } catch (e) {
        formatAppLog("warn", "at service/AlbumScanner.js:142", "[AlbumScanner] video uri", e);
      }
      if (!photos.length) {
        try {
          const Files = plus.android.importClass("android.provider.MediaStore$Files");
          const fileUri = plus.android.invoke(Files, "getContentUri", "external");
          queryUri(fileUri, "files");
        } catch (e) {
          formatAppLog("warn", "at service/AlbumScanner.js:150", "[AlbumScanner] files uri", e);
        }
      }
      if (!photos.length) {
        const permOk = store.isPhotoPermissionGranted();
        if (!permOk) {
          reject(new Error("no media permission or empty album"));
          return;
        }
      }
      formatAppLog("log", "at service/AlbumScanner.js:161", "[AlbumScanner] scanned", photos.length, "items");
      resolve(photos);
    } catch (e) {
      reject(e);
    }
  });
}
const STORAGE_KEY$3 = "album_local_media_index";
const MAX_ENTRIES = 5e3;
function isVideoFile(fileName) {
  return /\.(mp4|mov|avi|mkv|webm|m4v|3gp|wmv)$/i.test(String(fileName || ""));
}
class LocalMediaIndexService {
  constructor() {
    this._map = /* @__PURE__ */ new Map();
    this._typeMap = /* @__PURE__ */ new Map();
    this._initialized = false;
    this._scanning = false;
    this._restoreFromStorage();
  }
  _restoreFromStorage() {
    try {
      const data = uni.getStorageSync(STORAGE_KEY$3);
      if (data && typeof data === "object") {
        const entries = Array.isArray(data) ? data : Object.entries(data);
        for (const [key, val] of entries) {
          if (key && val) {
            this._map.set(key, String(val));
          }
        }
      }
    } catch (e) {
      formatAppLog("warn", "at service/LocalMediaIndex.js:36", "[LocalMediaIndex] restore from storage failed", e);
    }
  }
  _saveToStorage() {
    try {
      const entries = Array.from(this._map.entries());
      const trimmed = entries.length > MAX_ENTRIES ? entries.slice(entries.length - MAX_ENTRIES) : entries;
      const obj = {};
      for (const [k, v] of trimmed) {
        obj[k] = v;
      }
      uni.setStorageSync(STORAGE_KEY$3, obj);
    } catch (e) {
      formatAppLog("warn", "at service/LocalMediaIndex.js:51", "[LocalMediaIndex] save to storage failed", e);
    }
  }
  /**
   * 应用启动或后台触发异步初始化更新
   */
  async initAsync() {
    if (this._scanning)
      return;
    this._scanning = true;
    try {
      if (store.isPhotoPermissionGranted()) {
        const photos = await scanAlbum();
        if (Array.isArray(photos) && photos.length > 0) {
          this.updateFromPhotos(photos);
        }
      }
    } catch (e) {
      formatAppLog("warn", "at service/LocalMediaIndex.js:70", "[LocalMediaIndex] initAsync scan skipped or failed", e);
    } finally {
      this._scanning = false;
      this._initialized = true;
    }
  }
  /**
   * 使用相册扫描结果更新索引（增量/全量）
   * @param {Array} photos PhotoMeta 数组
   */
  updateFromPhotos(photos) {
    if (!Array.isArray(photos) || photos.length === 0)
      return;
    let changed = false;
    for (const p of photos) {
      if (!p || !p.name || !p.localPath)
        continue;
      this._map.set(p.name, p.localPath);
      const isVid = p.mediaType === "video" || isVideoFile(p.name);
      this._typeMap.set(p.name, isVid ? "video" : "image");
      if (p.size) {
        this._map.set(`${p.name}|${p.size}`, p.localPath);
      }
      changed = true;
    }
    if (changed) {
      this._saveToStorage();
    }
  }
  /**
   * 快速同步查找本地图库绝对路径
   * @param {string} fileName 文件名，如 IMG_2024.jpg
   * @param {number} [size] 文件大小（可选）
   * @returns {string} 本地路径或空字符串
   */
  getLocalPath(fileName, size2 = 0) {
    if (!fileName)
      return "";
    if (size2 > 0) {
      const exact = this._map.get(`${fileName}|${size2}`);
      if (exact)
        return exact;
    }
    return this._map.get(fileName) || "";
  }
  /**
   * 判断文件是否为视频
   */
  isVideo(fileName) {
    if (!fileName)
      return false;
    return this._typeMap.get(fileName) === "video" || isVideoFile(fileName);
  }
  /**
   * 标记某个本地路径失效（例如本地被删除或权限不足）
   * @param {string} fileName
   */
  invalidate(fileName) {
    if (!fileName)
      return;
    this._map.delete(fileName);
    this._saveToStorage();
  }
  /**
   * 获取索引统计信息
   */
  getStats() {
    return {
      count: this._map.size
    };
  }
  /**
   * 清空所有本地索引
   */
  clear() {
    this._map.clear();
    try {
      uni.removeStorageSync(STORAGE_KEY$3);
    } catch (_) {
    }
  }
}
const localMediaIndex = new LocalMediaIndexService();
const _export_sfc = (sfc, props) => {
  const target = sfc.__vccOpts || sfc;
  for (const [key, val] of props) {
    target[key] = val;
  }
  return target;
};
const DEFAULT_SPACES$1 = ["客厅", "卧室", "餐厅", "厨房", "卫生间", "书房", "玄关", "阳台", "衣帽间", "儿童房", "商业空间"];
const DEFAULT_STYLES$1 = ["现代简约", "极简主义", "奶油风", "原木风", "新中式", "轻奢风", "侘寂风", "法式复古", "工业风", "北欧风"];
const DEFAULT_FURNITURE$1 = [
  "三人/组合沙发",
  "单人沙发",
  "休闲椅/扶手椅",
  "茶几",
  "餐桌",
  "餐椅",
  "电视柜",
  "餐边柜",
  "书架/展示柜",
  "书桌/工作台",
  "床/床架",
  "床头柜",
  "衣柜",
  "地毯",
  "吊灯",
  "落地灯",
  "台灯",
  "壁灯",
  "花器/花瓶",
  "摆件/雕塑",
  "浴缸"
];
const DEFAULT_MATERIALS$1 = ["木质/实木", "大理石/岩板", "拉丝金属", "布艺/绒面", "皮革", "玻璃/长虹玻", "石材/原石", "微水泥", "瓷砖/地砖", "黄铜"];
const DEFAULT_COLORS$1 = ["米/奶油", "原木/木色", "灰", "白", "黑", "绿", "蓝", "红", "粉", "橙", "黄"];
function coerceAssetTs(v) {
  if (v == null || v === "")
    return 0;
  if (typeof v === "number") {
    if (v > 0 && v < 1e12)
      return Math.round(v * 1e3);
    return v > 0 ? v : 0;
  }
  const n2 = Number(v);
  if (!isNaN(n2) && n2 > 0) {
    if (n2 < 1e12)
      return Math.round(n2 * 1e3);
    return n2;
  }
  const p = Date.parse(String(v));
  return isNaN(p) ? 0 : p;
}


export {
  formatAppLog,
  base64Decode,
  uuid,
  get$1,
  set$1,
  buildUrl,
  authHeader,
  request$1,
  login,
  fetchMe,
  logout,
  fetchAssets,
  downloadAndSaveToAlbum,
  fetchDetail,
  mediaUrl,
  videoUrl,
  posterUrl,
  submitAiTask,
  uploadAiFile,
  queryAiTask,
  queryAiTaskById,
  triggerRestage,
  fetchLabCapabilities,
  submitLabRun,
  pollLabRun,
  fetchChatSessions,
  createChatSession,
  deleteChatSession,
  fetchChatMessages,
  saveChatMessage,
  clearChatMessages,
  uploadRefImage,
  uploadRefImages,
  optimizePrompt,
  segmentImage,
  fetchLocalModels,
  fetchProductPresets,
  deleteAsset,
  sessionValid,
  createPhotoMeta,
  createSnapshot,
  mockPhotos,
  scanAlbum,
  scanViaMediaStore,
  isVideoFile,
  coerceAssetTs,
  lookup,
  crypto,
  KEY_DEVICE_ID,
  KEY_SERVER_URL,
  KEY_SERVER_TOKEN,
  KEY_AUTO_SYNC_ENABLED,
  KEY_LAST_SYNC_TIME,
  KEY_LAST_SYNC_RESULT,
  KEY_LAST_SYNC_COUNT,
  KEY_LAST_SYNC_COST,
  KEY_PENDING_COUNT,
  KEY_FALLBACK_DIR,
  KEY_WINDOW_DAYS,
  KEY_PHOTO_PERM,
  KEY_VIEWER_TOKEN,
  KEY_USERNAME,
  KEY_ROLE,
  DEFAULT_WINDOW_DAYS,
  SNAPSHOT_SCAN_DAYS,
  WINDOW_DAY_OPTIONS,
  DEFAULT_SERVER_URL,
  API_SNAPSHOT_PATH,
  PAGE_SIZE,
  UPLOAD_RETRY_TIMES,
  RETRY_BACKOFF_BASE_MS,
  HTTP_TIMEOUT_MS,
  FALLBACK_FILE_PREFIX,
  APP_VERSION,
  RESULT_SUCCESS,
  RESULT_FAILED,
  RESULT_PENDING_UPLOAD,
  RESULT_UNAUTHORIZED,
  RESULT_NONE,
  storage$1,
  store,
  STORAGE_KEY_LIST,
  STORAGE_KEY_DETAIL,
  DEFAULT_TTL,
  MAX_LIST_CACHE,
  MAX_DETAIL_CACHE,
  ViewerCacheService,
  viewerCache,
  API_BASE,
  TIMEOUT,
  UploadStatus,
  STORAGE_KEY$3,
  MAX_ENTRIES,
  LocalMediaIndexService,
  localMediaIndex,
  _export_sfc,
  DEFAULT_SPACES$1,
  DEFAULT_STYLES$1,
  DEFAULT_FURNITURE$1,
  DEFAULT_MATERIALS$1,
  DEFAULT_COLORS$1
};
