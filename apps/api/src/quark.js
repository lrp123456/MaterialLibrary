/**
 * 夸克网盘服务桩 (已于 Phase 3 彻底退役，仅保留存量记录只读展示兼容)
 */

function resolveQuarkCli() {
  return null;
}

class Quark {
  constructor(cliPath) {
    this.cliPath = null;
    this.decommissioned = true;
  }

  async status() {
    return { ok: false, decommissioned: true, message: '夸克网盘链路已彻底下线退役' };
  }

  async login() {
    throw new Error('夸克网盘链路已退役，不再支持登录');
  }

  async download(fid, destDir) {
    throw new Error('夸克网盘链路已退役，无法下载远程网盘资产');
  }

  async upload(absPath, targetFid) {
    // 静默跳过网盘上传，绝不阻断入库管线
    return { ok: true, skipped: true, decommissioned: true };
  }

  async searchImages() {
    return [];
  }
}

async function runCli() {
  return Promise.reject(new Error('夸克网盘已彻底退役'));
}

module.exports = {
  Quark,
  runCli,
  resolveQuarkCli
};
