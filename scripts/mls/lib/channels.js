/**
 * Windows 侧分支通道（test / 遗留 gray）操作封装。
 * 核心职责是在 branch-channel 之上补两件它没有的事：
 *   1. test 与 gray 共用 30000/30003 的真互斥（启动一方前处理掉另一方）；
 *   2. 陈旧 PID / 未知占用的显式判定。
 * prod 通道不在这里 —— 它只能经 wsl.js 的 start.sh 操作。
 */
const path = require('path');
const bc = require('../../branch-channel');

function getLane(key) {
  const lane = bc.LANES[key];
  if (!lane) {
    throw new Error(`未知通道：${key}（可用：${Object.keys(bc.LANES).join(' / ')}）`);
  }
  return lane;
}

function requireManaged(key) {
  const lane = getLane(key);
  if (!lane.managed) {
    throw new Error(`${lane.label}(${lane.key}) 由 WSL start.sh 管理，请用 prod 目标`);
  }
  return lane;
}

/**
 * 找同端口组的其它「活着」的托管通道。
 * 活 = 记录的 PID 仍在 或 端口在监听（两者任一都算，覆盖陈旧 PID 文件的情况）。
 */
async function findConflicts(lane) {
  const hits = [];
  for (const other of Object.values(bc.LANES)) {
    if (other.key === lane.key || !other.managed) continue;
    if (other.apiPort !== lane.apiPort && other.webPort !== lane.webPort) continue;
    const apiPid = bc.readPid(path.join(other.dataDir, 'api.pid'));
    const webPid = bc.readPid(path.join(other.dataDir, 'web.pid'));
    const apiUp = await bc.portOpen(other.apiPort);
    const webUp = await bc.portOpen(other.webPort);
    if (apiPid || webPid || apiUp || webUp) {
      hits.push({
        key: other.key,
        label: other.label,
        legacy: Boolean(other.legacy),
        apiPid,
        webPid,
        apiUp,
        webUp,
      });
    }
  }
  return hits;
}

/** 端口在监听但自己的 PID 文件缺失/陈旧：被「未知进程」占了（典型：第三数据平面） */
async function unknownOccupation(lane) {
  const out = [];
  const apiPid = bc.readPid(path.join(lane.dataDir, 'api.pid'));
  const webPid = bc.readPid(path.join(lane.dataDir, 'web.pid'));
  if ((await bc.portOpen(lane.apiPort)) && !apiPid) out.push(`API ${lane.apiPort}`);
  if ((await bc.portOpen(lane.webPort)) && !webPid) out.push(`Web ${lane.webPort}`);
  return out;
}

async function startManaged(key, { skipBuild = false, takeover = false, syncData = false } = {}) {
  const lane = requireManaged(key);
  const conflicts = await findConflicts(lane);
  if (conflicts.length) {
    const desc = conflicts
      .map((c) => `${c.label}(${c.key}) pid=${c.apiPid || '?'}/${c.webPid || '?'}`)
      .join('；');
    if (!takeover) {
      throw new Error(
        `端口组 ${lane.apiPort}/${lane.webPort} 已被其它通道占用：${desc}。\n` +
          `       先停掉对方，或加 --takeover（会先自动停止对方再启动 ${lane.key}）`
      );
    }
    for (const c of conflicts) {
      console.log(`[mls] --takeover：先停止 ${c.label}(${c.key})`);
      bc.stop(bc.LANES[c.key]);
    }
  }
  const unknown = await unknownOccupation(lane);
  if (unknown.length) {
    throw new Error(
      `${unknown.join('、')} 正被未知进程占用（PID 文件缺失）。\n` +
        `       这通常是第三数据平面/手工启动的残留，请先用 service-hub 或任务管理器确认后结束该进程`
    );
  }
  // 与 branch-channel CLI 的 --start 行为对齐：首启准备数据快照，已存在则不重复复制
  bc.prepareData(lane, { sync: syncData });
  await bc.start(lane, { skipBuild });
}

function stopManaged(key) {
  const lane = requireManaged(key);
  bc.stop(lane);
}

async function restartManaged(key, { skipBuild = true, takeover = false } = {}) {
  const lane = requireManaged(key);
  // restart 语义：通道必须在跑；若实际跑的是对手通道，交给 start 的互斥逻辑处理
  stopManaged(key);
  await startManaged(key, { skipBuild, takeover });
}

/**
 * promote 默认 dry-run；只有显式 execute:true 才真合并。
 * 真合并时 branch-channel 会经 WSL start.sh restart 同时重启 30001+30002。
 */
async function promote(key, { execute = false, force = false } = {}) {
  const lane = getLane(key);
  if (!lane.branch) throw new Error(`${lane.key} 没有独立分支，无法发布`);
  await bc.promote(lane, { dryRun: !execute, force });
}

module.exports = {
  getLane,
  findConflicts,
  unknownOccupation,
  startManaged,
  stopManaged,
  restartManaged,
  promote,
};
