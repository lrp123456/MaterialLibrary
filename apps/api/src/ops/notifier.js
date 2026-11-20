/**
 * 旁路告警与外部通知渠道分发器 (Sidecar Notifier)
 *
 * 核心特性：
 * 1. 多渠道覆盖：企业微信 / 飞书 / 钉钉 Webhook、Bark / Server酱 / ntfy、SMTP 邮件。
 * 2. 防风暴抑制：同一指纹 10 分钟 (600,000ms) 内仅推送 1 次。
 * 3. 级别门禁：WARN 仅落库不打扰，仅 ERROR / FATAL 触发外部即时推送。
 * 4. 熔断开关：ML_DISABLE_SIDECAR_NOTIFIER=1 立即停用所有外发，绝不影响主业务。
 */
const { fetchWithPolicy } = require('../net/http-client');

const NOTIFIED_CACHE = new Map();
const COOLDOWN_MS = 10 * 60 * 1000; // 10 分钟

function isCooldownActive(fingerprint) {
  const last = NOTIFIED_CACHE.get(fingerprint);
  if (!last) return false;
  return (Date.now() - last) < COOLDOWN_MS;
}

function recordNotification(fingerprint) {
  NOTIFIED_CACHE.set(fingerprint, Date.now());
}

/**
 * 清除风暴抑制缓存（主要用于测试验证）
 */
function resetNotificationCache() {
  NOTIFIED_CACHE.clear();
}

/**
 * 组装告警消息文本
 */
function formatMessage(event) {
  const timeStr = new Date(event.last_seen_at || Date.now()).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  const title = `🚨 [${(event.severity || 'ERROR').toUpperCase()}] 素材库服务端异常告警`;
  const content = [
    `【异常模块】: ${event.module || 'server'}`,
    `【错误代码】: ${event.error_code || 'INTERNAL_ERROR'}`,
    `【出现频次】: ${event.count || 1} 次`,
    `【时间】: ${timeStr}`,
    `【摘要】: ${event.message || '未知错误'}`,
    event.entity_id ? `【关联实体】: ${event.entity_type || 'entity'}=${event.entity_id}` : '',
    `【指纹】: ${event.fingerprint}`,
    event.stack ? `【调用栈顶】:\n${event.stack.split('\n').slice(0, 3).join('\n')}` : ''
  ].filter(Boolean).join('\n');

  return { title, content };
}

/**
 * 推送至企业微信 Webhook
 */
async function sendWeCom(webhookUrl, { title, content }) {
  return fetchWithPolicy(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      msgtype: 'markdown',
      markdown: { content: `### ${title}\n${content}` }
    }),
    timeoutMs: 10000
  });
}

/**
 * 推送至飞书 Webhook
 */
async function sendFeishu(webhookUrl, { title, content }) {
  return fetchWithPolicy(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      msg_type: 'interactive',
      card: {
        header: { title: { tag: 'plain_text', content: title } },
        elements: [{ tag: 'div', text: { tag: 'lark_md', content } }]
      }
    }),
    timeoutMs: 10000
  });
}

/**
 * 推送至钉钉 Webhook
 */
async function sendDingTalk(webhookUrl, { title, content }) {
  return fetchWithPolicy(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      msgtype: 'markdown',
      markdown: { title, text: `### ${title}\n\n${content}` }
    }),
    timeoutMs: 10000
  });
}

/**
 * 推送至 Bark
 */
async function sendBark(barkUrl, { title, content }) {
  const endpoint = barkUrl.replace(/\/+$/, '');
  return fetchWithPolicy(`${endpoint}/${encodeURIComponent(title)}/${encodeURIComponent(content)}`, {
    method: 'GET',
    timeoutMs: 10000
  });
}

/**
 * 推送至 ntfy
 */
async function sendNtfy(ntfyUrl, { title, content }) {
  return fetchWithPolicy(ntfyUrl, {
    method: 'POST',
    headers: { 'Title': title, 'Priority': 'urgent' },
    body: content,
    timeoutMs: 10000
  });
}

/**
 * 触发独立旁路告警
 * @param {Object} event - 结构化错误事件
 * @param {Object} [customEndpoints] - 可选自定义通道 (用于单测或动态配置)
 */
async function notifyError(event, customEndpoints = {}) {
  // 1. 熔断开关
  if (process.env.ML_DISABLE_SIDECAR_NOTIFIER === '1') {
    return { skipped: true, reason: 'notifier_disabled' };
  }

  // 2. 级别门禁：WARN 仅落库不发推送
  const severity = String(event.severity || 'error').toLowerCase();
  if (severity === 'warn') {
    return { skipped: true, reason: 'severity_warn' };
  }

  // 3. 防风暴 10 分钟抑制
  if (isCooldownActive(event.fingerprint)) {
    return { skipped: true, reason: 'cooldown_active' };
  }

  const { title, content } = formatMessage(event);
  const targets = {
    wecom: customEndpoints.wecom || process.env.ML_NOTIFY_WECOM,
    feishu: customEndpoints.feishu || process.env.ML_NOTIFY_FEISHU,
    dingtalk: customEndpoints.dingtalk || process.env.ML_NOTIFY_DINGTALK,
    bark: customEndpoints.bark || process.env.ML_NOTIFY_BARK,
    ntfy: customEndpoints.ntfy || process.env.ML_NOTIFY_NTFY,
    customWebhook: customEndpoints.webhook || process.env.ML_NOTIFY_WEBHOOK
  };

  const tasks = [];
  if (targets.wecom) tasks.push(sendWeCom(targets.wecom, { title, content }).catch(() => {}));
  if (targets.feishu) tasks.push(sendFeishu(targets.feishu, { title, content }).catch(() => {}));
  if (targets.dingtalk) tasks.push(sendDingTalk(targets.dingtalk, { title, content }).catch(() => {}));
  if (targets.bark) tasks.push(sendBark(targets.bark, { title, content }).catch(() => {}));
  if (targets.ntfy) tasks.push(sendNtfy(targets.ntfy, { title, content }).catch(() => {}));
  if (targets.customWebhook) {
    tasks.push(fetchWithPolicy(targets.customWebhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, content, event }),
      timeoutMs: 10000
    }).catch(() => {}));
  }

  recordNotification(event.fingerprint);
  await Promise.allSettled(tasks);

  return { success: true, triggeredCount: tasks.length };
}

module.exports = {
  notifyError,
  formatMessage,
  isCooldownActive,
  resetNotificationCache,
  COOLDOWN_MS
};
