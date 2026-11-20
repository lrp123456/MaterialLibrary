/**
 * 代理配置与状态管理模块 (Phase 1: 纯按需代理与隔离)
 *
 * 核心原则：
 * 1. 彻底根除全局代理污染：严禁篡改 https.globalAgent，严禁全局劫持直连流量。
 * 2. 彻底消灭同步探测：严禁使用 spawnSync 或阻塞事件循环的脚本拉起。
 * 3. 仅作为海外端点（Google Gemini 等）的代理地址发现与状态缓存中心。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { getExternalProxyUrl, probeProxyAsync } = require('./net/http-client');

function readConfigProxy() {
  const dataDir = process.env.ML_DATA_DIR || path.join(os.homedir(), '.dsh-material-library');
  for (const name of ['providers.json']) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dataDir, name), 'utf8'));
      const p = (raw.network && raw.network.proxy) || raw.proxy;
      if (typeof p === 'string' && p.trim()) return p.trim();
    } catch {}
  }
  return '';
}

function resolveProxyCandidate() {
  const cfgUrl = readConfigProxy();
  if (cfgUrl) return cfgUrl;
  return getExternalProxyUrl();
}

let activeProxy = resolveProxyCandidate();

/**
 * 确保/检查按需代理地址
 */
async function ensureProxy() {
  const candidate = resolveProxyCandidate();
  const ok = await probeProxyAsync(candidate);
  if (ok) {
    activeProxy = candidate;
    return activeProxy;
  }
  return '';
}

module.exports = {
  resolvedProxy: activeProxy,
  resolveAndApplyProxy: () => activeProxy,
  ensureProxy,
  getActiveProxyUrl: () => activeProxy
};
