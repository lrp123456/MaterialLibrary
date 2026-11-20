/**
 * 旁路错误监控与上报中枢 (Sidecar Error Reporter)
 *
 * 核心机制：
 * 1. 结构化指纹聚合：sha1(module + errorCode + topStackFrame) 聚合同类异常。
 * 2. 强安全脱敏：敏感信息（Authorization, token, apiKey, password, cookie 等）全链路抹除。
 * 3. 异步双写：SQLite system_error_events 表 + $ML_DATA_DIR/logs/errors-YYYY-MM-DD.jsonl。
 * 4. 零次生异常：内部完整 try/catch 兜底，自身发生任何异常绝不崩掉主服务。
 * 5. 业务隔离红线：绝不向业务 Web 端 (30002) WS/SSE 投送运维报错。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { notifyError } = require('./notifier');

let activeDb = null;
let activeConfig = null;
let gitCommitHash = '';

try {
  const commitFile = path.resolve(__dirname, '../../../apps/web-pro/dist/build-info.json');
  if (fs.existsSync(commitFile)) {
    const info = JSON.parse(fs.readFileSync(commitFile, 'utf8'));
    gitCommitHash = info.commit || '';
  }
} catch (_) {}

/**
 * 敏感字段与凭据强制脱敏
 */
function sanitizeValue(key, val) {
  if (val === null || val === undefined) return val;
  const isSensitiveKey = /authorization|token|apikey|api_key|password|passwd|secret|cookie/i.test(key);
  if (isSensitiveKey) {
    return '[REDACTED]';
  }
  if (typeof val === 'string') {
    // 抹除 Bearer token 与常见 Key
    let s = val.replace(/Bearer\s+[A-Za-z0-9_\-\.]+/gi, 'Bearer [REDACTED]');
    s = s.replace(/(?:api[_-]?key|secret|password)=([^&\s]+)/gi, '$1=[REDACTED]');
    return s;
  }
  if (Array.isArray(val)) {
    return val.map((item, idx) => sanitizeValue(String(idx), item));
  }
  if (typeof val === 'object') {
    const clean = {};
    for (const [k, v] of Object.entries(val)) {
      clean[k] = sanitizeValue(k, v);
    }
    return clean;
  }
  return val;
}

function sanitizeContext(context) {
  if (!context || typeof context !== 'object') return {};
  return sanitizeValue('root', context);
}

/**
 * 提取顶层调用栈帧作为指纹特征
 */
function extractTopFrame(stack) {
  if (!stack || typeof stack !== 'string') return 'unknown_frame';
  const lines = stack.split('\n').map(l => l.trim()).filter(l => l.startsWith('at '));
  // 过滤内部 runtime/node_modules，寻找首个业务代码帧
  const appFrame = lines.find(l => !l.includes('node:internal') && !l.includes('node_modules')) || lines[0];
  return appFrame ? appFrame.replace(/^at\s+/, '') : 'unknown_frame';
}

/**
 * 归一化错误对象
 */
function normalizeError(err) {
  if (!err) return { message: 'Unknown error', stack: '', code: 'ERR_UNKNOWN' };
  if (typeof err === 'string') return { message: err, stack: '', code: 'ERR_STRING' };
  const message = String(err.message || err.toString() || 'Unknown error');
  const stack = String(err.stack || '');
  const code = String(err.code || err.statusCode || err.status || 'ERR_INTERNAL');
  return { message, stack, code };
}

/**
 * 格式化当天日期 YYYY-MM-DD
 */
function getTodayDateStr() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * 上报错误主入口 (永不抛出异常)
 */
async function reportError({
  module = 'server',
  err = null,
  errorCode = null,
  context = {},
  entityType = null,
  entityId = null,
  severity = 'error',
  customNotifiers = {}
} = {}) {
  try {
    const { message, stack, code } = normalizeError(err);
    const finalCode = errorCode || code;
    const topFrame = extractTopFrame(stack);
    const sanitizedCtx = sanitizeContext(context);

    // 1. 指纹计算: sha1(module + finalCode + topFrame)
    const fpSource = `${module}:${finalCode}:${topFrame}`;
    const fingerprint = crypto.createHash('sha1').update(fpSource).digest('hex');

    const now = Date.now();
    const event = {
      fingerprint,
      module,
      error_code: finalCode,
      message,
      stack,
      entity_type: entityType,
      entity_id: entityId ? String(entityId) : null,
      context_json: JSON.stringify(sanitizedCtx),
      severity,
      count: 1,
      first_seen_at: now,
      last_seen_at: now,
      status: 'open'
    };

    // 2. 数据库落库 (SQLite system_error_events)
    if (activeDb) {
      try {
        const existing = activeDb.prepare(
          "SELECT id, count, first_seen_at FROM system_error_events WHERE fingerprint=? AND status != 'resolved'"
        ).get(fingerprint);

        if (existing) {
          event.count = existing.count + 1;
          event.first_seen_at = existing.first_seen_at;
          activeDb.prepare(`
            UPDATE system_error_events
            SET count = count + 1,
                last_seen_at = ?,
                message = ?,
                stack = ?,
                context_json = ?
            WHERE id = ?
          `).run(now, message, stack, event.context_json, existing.id);
          event.id = existing.id;
        } else {
          const r = activeDb.prepare(`
            INSERT INTO system_error_events (
              fingerprint, module, error_code, message, stack,
              entity_type, entity_id, context_json, severity,
              count, first_seen_at, last_seen_at, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 'open')
          `).run(
            fingerprint, module, finalCode, message, stack,
            event.entity_type, event.entity_id, event.context_json, severity,
            now, now
          );
          event.id = r.lastInsertRowid;
        }
      } catch (dbErr) {
        console.warn('[error-reporter] 数据库落库失败:', dbErr.message);
      }
    }

    // 3. 文件落盘: $ML_DATA_DIR/logs/errors-YYYY-MM-DD.jsonl
    const dataDir = (activeConfig && activeConfig.dataDir) || process.env.ML_DATA_DIR || path.join(os.homedir(), '.dsh-material-library');
    try {
      const logsDir = path.join(dataDir, 'logs');
      fs.mkdirSync(logsDir, { recursive: true });
      const logFile = path.join(logsDir, `errors-${getTodayDateStr()}.jsonl`);
      const logRecord = {
        timestamp: new Date(now).toISOString(),
        at: now,
        id: event.id || null,
        fingerprint,
        module,
        errorCode: finalCode,
        severity,
        message,
        stack,
        entityType,
        entityId: event.entity_id,
        context: sanitizedCtx,
        gitCommit: gitCommitHash
      };
      fs.appendFileSync(logFile, JSON.stringify(logRecord) + '\n', 'utf8');
    } catch (fsErr) {
      console.warn('[error-reporter] 日志文件写入失败:', fsErr.message);
    }

    // 4. 触发旁路异步推送
    try {
      await notifyError(event, customNotifiers);
    } catch (notifErr) {
      console.warn('[error-reporter] 外部通知分发异常:', notifErr.message);
    }

    return event;
  } catch (outerErr) {
    // 绝对安全底线：绝不引发二次异常
    console.error('[error-reporter] 严重内部异常兜底:', outerErr.message);
    return null;
  }
}

/**
 * 全局拦截初始化
 */
function initErrorReporter({ db, config }) {
  activeDb = db;
  activeConfig = config;

  process.on('uncaughtException', (err) => {
    console.error('[FATAL] 未捕获的全局异常:', err);
    reportError({
      module: 'process',
      err,
      errorCode: 'UNCAUGHT_EXCEPTION',
      severity: 'fatal'
    });
  });

  process.on('unhandledRejection', (reason) => {
    console.error('[ERROR] 未处理的 Promise Rejection:', reason);
    reportError({
      module: 'process',
      err: reason,
      errorCode: 'UNHANDLED_REJECTION',
      severity: 'error'
    });
  });
}

function setReporterDb(db) {
  activeDb = db;
}

module.exports = {
  reportError,
  initErrorReporter,
  setReporterDb,
  sanitizeContext,
  extractTopFrame
};
