/**
 * GPU 显存动态调度守护器 (VRAM Arbiter & Dynamic Service Lifecycle Controller)
 * 专为 192.168.1.107:9000 RTX 5070 Ti (16GB VRAM) 打造：
 * - 实时监测 GPU 剩余物理显存；
 * - 动态启停/装载微服务 (POST /api/service/{name}/{action})；
 * - 严格防范 OOM：执行重型任务（如 LatentSync 唇同步、MDX-Net 分离）前自动卸载空闲大服务；
 * - 任务完成后按需降级释放，实现 0 常驻、用完即退。
 */
const { lanFetch } = require('./gen/lan-fetch');

const GPU_PANEL_BASE = String(process.env.CLIP_GPU_PANEL_BASE || 'http://192.168.1.107:9000').replace(/\/$/, '');

/**
 * 查询 GPU 面板整体健康度与显存现状
 */
async function getGpuStatus() {
  try {
    const res = await lanFetch(`${GPU_PANEL_BASE}/api/status`, {
      signal: AbortSignal.timeout(4000)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const memTotal = Number(data?.gpu?.mem_total_mb || 16384);
    const memUsed = Number(data?.gpu?.mem_used_mb || 0);
    const memFree = Math.max(0, memTotal - memUsed);
    return {
      online: true,
      services: data.services || {},
      gpu: {
        memTotalMb: memTotal,
        memUsedMb: memUsed,
        memFreeMb: memFree,
        utilPct: Number(data?.gpu?.util_pct || 0)
      }
    };
  } catch (err) {
    return {
      online: false,
      error: err.message,
      services: {},
      gpu: { memTotalMb: 16384, memUsedMb: 0, memFreeMb: 16384, utilPct: 0 }
    };
  }
}

/**
 * 远程调用面板控制服务启停
 * @param {string} name - 服务名 (如 sepvoice, lipsync, comfyui, indextts)
 * @param {'start'|'stop'|'restart'} action
 */
async function controlService(name, action) {
  try {
    const res = await lanFetch(`${GPU_PANEL_BASE}/api/service/${encodeURIComponent(name)}/${encodeURIComponent(action)}`, {
      method: 'POST',
      signal: AbortSignal.timeout(8000)
    });
    return res.ok;
  } catch (_) {
    return false;
  }
}

/**
 * 动态装载并守护目标 GPU 服务
 * @param {string} targetService - 目标服务名 ('sepvoice' | 'lipsync' | 'indextts' | 'superimage')
 * @param {Object} options
 * @param {number} options.minFreeVramMb - 最低安全空闲显存（默认 4000MB）
 * @param {boolean} options.exclusive - 是否独占显存（如唇同步 LatentSync 需占用 10GB+，设为 true）
 */
async function acquireGpuSlot(targetService, { minFreeVramMb = 4000, exclusive = false } = {}) {
  const status = await getGpuStatus();
  if (!status.online) {
    console.warn(`[vram-arbiter] 9000 面板当前离线，跳过远程装载`);
    return { acquired: false, reason: 'panel_offline' };
  }

  // 1. 若需要独占或显存紧张，暂停非必要的可卸载大服务
  if (exclusive || status.gpu.memFreeMb < minFreeVramMb) {
    console.log(`[vram-arbiter] 为 ${targetService} 腾挪显存（当前空闲: ${status.gpu.memFreeMb}MB，需求: ${minFreeVramMb}MB）`);
    const evictionCandidates = ['acestep', 'comfyui', 'qwimage', 'sepvoice', 'lipsync'].filter(s => s !== targetService);
    for (const svc of evictionCandidates) {
      if (status.services[svc]?.ActiveState === 'active') {
        console.log(`[vram-arbiter] 动态挂起/停止闲置服务: ${svc}`);
        await controlService(svc, 'stop');
        await new Promise(r => setTimeout(r, 600));
      }
    }
  }

  // 2. 确保目标服务处于启动激活状态
  const targetState = status.services[targetService]?.ActiveState;
  if (targetState !== 'active') {
    console.log(`[vram-arbiter] 正在按需拉起目标服务: ${targetService}`);
    await controlService(targetService, 'start');
    // 等待就绪探测
    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, 1000));
      const s = await getGpuStatus();
      if (s.services[targetService]?.ActiveState === 'active') break;
    }
  }

  return { acquired: true, targetService };
}

/**
 * 任务完成后释放指定服务
 */
async function releaseGpuSlot(serviceName) {
  if (!serviceName) return;
  console.log(`[vram-arbiter] 任务完成，按需释放服务显存: ${serviceName}`);
  await controlService(serviceName, 'stop').catch(() => {});
}

module.exports = {
  GPU_PANEL_BASE,
  getGpuStatus,
  controlService,
  acquireGpuSlot,
  releaseGpuSlot
};
