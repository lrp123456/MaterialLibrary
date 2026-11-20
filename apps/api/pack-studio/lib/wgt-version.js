/**
 * wgt-version.js · 出包版本号分配（Pack Studio 专用）
 *
 * 为什么需要它 —— 这是 2026-10-03 真实踩到的死锁：
 *
 *   客户端的更新判定里有这么一行（修复前的代码）：
 *       if (remoteMax > 0 && localMax >= remoteMax) return { hasUpdate: false }
 *   其中 localMax = Math.max(clientVersionCode(), 运行时 wgtVersion 的数字部分)
 *   而 clientVersionCode() 是**编译期写死**在 app-service.js 里的，
 *   来自 src/version-state.json 的 buildCode。
 *
 *   于是出现：
 *       设备上跑的旧包，编译时 buildCode = 2030005
 *       这次推送的 wgtVersion  = 2030005   ← 同一个数！
 *       → localMax(2030005) >= remoteMax(2030005) → 判定"已是最新"
 *       → 永远不下载新包。
 *
 *   修复代码就在新包里，但新包装不进去 —— 死锁。
 *
 * 解决：让每一次出包的 wgtVersion **严格大于** 上一次出包的，
 * 并且大于 version-state.json 里的 buildCode。
 * 这样无论客户端用哪种比较方式（>= 还是 >），都必然判定"有更新"。
 *
 * 版本号状态存在 pack-studio/state/wgt-version.json（Pack Studio 自己的目录，
 * 不污染用户的 App 源码）。
 */
const fs = require('fs');
const path = require('path');

const STATE_DIR = path.join(__dirname, '..', 'state');
const STATE_FILE = path.join(STATE_DIR, 'wgt-version.json');

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8').replace(/^﻿/, ''));
  } catch {
    return { lastIssued: 0, history: [] };
  }
}

function writeState(s) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2), 'utf8');
}

function bumpVersionName(name) {
  const m = String(name || '1.0.0').match(/^(\d+)\.(\d+)\.(\d+)(.*)$/);
  if (m) {
    const patch = Number(m[3]) + 1;
    return `${m[1]}.${m[2]}.${patch}${m[4] || ''}`;
  }
  return name || '1.0.1';
}

/**
 * 分配一个严格递增的 wgtVersion。
 *
 * @param {object} opt
 *   buildCode    src/version-state.json 的 buildCode
 *   versionCode  基版本号，如 203
 *   versionName  版本名称，如 1.0.3
 *   bumpVersion  是否正式发版（+1，机器号清零）
 *   appRoot      App 项目根
 *   note         备注
 */
function allocateWgtVersion(opt) {
  const currentBuildCode = Number(opt.buildCode || 0);
  const currentVersionName = String(opt.versionName || '1.0.3');
  const currentVersionCode = Number(opt.versionCode || Math.floor(currentBuildCode / 10000) || 203);
  const bumpVersion = !!opt.bumpVersion;
  const st = readState();
  const prev = Number(st.lastIssued || 0);

  let wgtVersion = 0;
  let versionName = currentVersionName;
  let versionCode = currentVersionCode;
  let machineCode = 0;

  if (bumpVersion) {
    // 正式版本号 +1，机器号清零
    versionCode = currentVersionCode + 1;
    versionName = bumpVersionName(currentVersionName);
    machineCode = 0;
    wgtVersion = versionCode * 10000;
    if (wgtVersion <= prev) {
      versionCode = Math.floor(prev / 10000) + 1;
      wgtVersion = versionCode * 10000;
    }
  } else {
    // 仅机器号 +1
    const base = Math.max(currentBuildCode, prev, 0);
    wgtVersion = base + 1;
    const baseCode = Math.floor(wgtVersion / 10000);
    if (baseCode > 0) versionCode = baseCode;
    machineCode = wgtVersion - versionCode * 10000;
  }

  writeState({
    lastIssued: wgtVersion,
    updatedAt: new Date().toISOString(),
    lastNote: String(opt.note || ''),
    lastBuildCode: currentBuildCode,
    versionName,
    versionCode,
    machineCode,
    history: (st.history || []).concat([
      { at: new Date().toISOString(), wgtVersion, versionName, versionCode, machineCode, note: String(opt.note || '') },
    ]).slice(-50),
  });

  return { wgtVersion, versionName, versionCode, machineCode, bumped: true, prev };
}

/** 只读查询，不分配 */
function peekWgtVersion(opt) {
  const buildCode = Number((opt && opt.buildCode) || 0);
  const st = readState();
  return {
    lastIssued: Number(st.lastIssued || 0),
    buildCode,
    next: Math.max(buildCode, Number(st.lastIssued || 0), 0) + 1,
  };
}

module.exports = { allocateWgtVersion, peekWgtVersion, STATE_FILE, bumpVersionName };
