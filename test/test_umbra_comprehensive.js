/**
 * 已有功能（Umbra 精修与空间漫游）端到端综合测试与诊断脚本
 * 包含：
 * 1. umbra.expand (智能扩图)
 * 2. umbra.remove (精准消除)
 * 3. umbra.spatial_walkthrough (空间漫游成片，限 2s / 480p 最少资源)
 */
const http = require('http');

const BASE_URL = process.env.ML_TEST_HOST || 'http://127.0.0.1:30001';
const USERNAME = process.env.ML_TEST_USER || 'viewer';
const PASSWORD = process.env.ML_TEST_PASS || '';

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request(method, path, body = null, token = null) {
  const url = new URL(path, BASE_URL);
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(url.toString(), {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000)
  });

  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: res.status, ok: res.ok, data: json };
}

async function pollRun(token, engine, runId, maxWaitSec = 90) {
  const start = Date.now();
  console.log(`  ⏳ 开始轮询任务 [${engine}/${runId}] (上限 ${maxWaitSec}s)...`);
  while (Date.now() - start < maxWaitSec * 1000) {
    const res = await request('GET', `/api/viewer/lab/runs/${engine}/${runId}`, null, token);
    const item = res.data?.data || res.data;
    const status = item?.status;
    const progress = item?.progress ?? 0;
    const error = item?.error;
    console.log(`    [${Math.round((Date.now() - start) / 1000)}s] status: ${status}, progress: ${progress}%, error: ${error || 'none'}`);

    if (status === 'success' || status === 'completed' || status === 'done') {
      return { success: true, item };
    }
    if (status === 'failed' || status === 'error') {
      return { success: false, item, error };
    }
    await sleep(4000);
  }
  return { success: false, timeout: true };
}

async function main() {
  console.log('══════════════════════════════════════════════════════════════');
  console.log('  🧪 Umbra 核心能力（精修与空间漫游）端到端诊断测试');
  console.log('  目标服务器:', BASE_URL);
  console.log('══════════════════════════════════════════════════════════════\n');

  // 1. 登录
  const loginRes = await request('POST', '/api/auth/login', { username: USERNAME, password: PASSWORD });
  if (!loginRes.ok || !loginRes.data?.data?.token) {
    console.error('❌ 登录失败:', loginRes.data);
    process.exit(1);
  }
  const token = loginRes.data.data.token;
  console.log('✔ [PASS] 登录成功，获取会话 Token');

  // 2. 获取测试用真实素材
  const assetsRes = await request('GET', '/api/viewer/assets?page=1&pageSize=4&kind=image', null, token);
  const assets = assetsRes.data?.data?.items || [];
  if (assets.length < 2) {
    console.error('❌ 素材库中有效图片素材不足 2 张，无法完整测试');
    process.exit(1);
  }
  const fid1 = assets[0].fid;
  const fid2 = assets[1].fid;
  console.log(`✔ [PASS] 获取测试源素材: FID1=${fid1} (${assets[0].file_name}), FID2=${fid2} (${assets[1].file_name})\n`);

  const report = [];

  // =========================================================================
  // 测试 1: 触控精修 - 智能扩图 (umbra.expand)
  // =========================================================================
  console.log('──────────────────────────────────────────────────────────────');
  console.log('  测试项 1: 智能扩图 (umbra.expand)');
  console.log('──────────────────────────────────────────────────────────────');
  try {
    const runRes = await request('POST', '/api/viewer/lab/runs', {
      entryId: 'umbra.expand',
      fid: fid1,
      params: { expand_ratio: '16:9' }
    }, token);

    console.log('  提交响应:', runRes.status, runRes.data);
    if (!runRes.ok || !runRes.data?.data?.runId) {
      report.push({ name: 'umbra.expand', success: false, stage: 'submit', error: runRes.data?.error });
    } else {
      const runId = runRes.data.data.runId;
      const pollResult = await pollRun(token, 'umbra', runId, 45);
      report.push({ name: 'umbra.expand', ...pollResult });
    }
  } catch (e) {
    report.push({ name: 'umbra.expand', success: false, error: e.message });
  }

  // =========================================================================
  // 测试 2: 触控精修 - 区域消除 (umbra.remove)
  // =========================================================================
  console.log('\n──────────────────────────────────────────────────────────────');
  console.log('  测试项 2: 精准消除 (umbra.remove)');
  console.log('──────────────────────────────────────────────────────────────');
  try {
    const runRes = await request('POST', '/api/viewer/lab/runs', {
      entryId: 'umbra.remove',
      fid: fid1,
      params: { bbox: '100,120,400,450' }
    }, token);

    console.log('  提交响应:', runRes.status, runRes.data);
    if (!runRes.ok || !runRes.data?.data?.runId) {
      report.push({ name: 'umbra.remove', success: false, stage: 'submit', error: runRes.data?.error });
    } else {
      const runId = runRes.data.data.runId;
      const pollResult = await pollRun(token, 'umbra', runId, 45);
      report.push({ name: 'umbra.remove', ...pollResult });
    }
  } catch (e) {
    report.push({ name: 'umbra.remove', success: false, error: e.message });
  }

  // =========================================================================
  // 测试 3: 空间漫游成片 (umbra.spatial_walkthrough)
  // 按照最小资源限制：2 张图片、单段时长 2 秒、画幅 16:9
  // =========================================================================
  console.log('\n──────────────────────────────────────────────────────────────');
  console.log('  测试项 3: 空间漫游成片 (umbra.spatial_walkthrough) [最省资源模式]');
  console.log('──────────────────────────────────────────────────────────────');
  try {
    const runRes = await request('POST', '/api/viewer/lab/runs', {
      entryId: 'umbra.spatial_walkthrough',
      fids: [fid1, fid2],
      params: {
        camera_style: 'smooth_walk',
        aspect_ratio: '16:9',
        scene_duration: 2,
        spaces: '客厅,餐厅'
      }
    }, token);

    console.log('  提交响应:', runRes.status, runRes.data);
    if (!runRes.ok || !runRes.data?.data?.runId) {
      report.push({ name: 'umbra.spatial_walkthrough', success: false, stage: 'submit', error: runRes.data?.error });
    } else {
      const runId = runRes.data.data.runId;
      const pollResult = await pollRun(token, 'umbra', runId, 60);
      report.push({ name: 'umbra.spatial_walkthrough', ...pollResult });
    }
  } catch (e) {
    report.push({ name: 'umbra.spatial_walkthrough', success: false, error: e.message });
  }

  // =========================================================================
  // 汇总报告
  // =========================================================================
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  测试总结与根因分析 (Summary & Diagnosis):');
  console.log('══════════════════════════════════════════════════════════════');
  for (const r of report) {
    const icon = r.success ? '✔ [PASS]' : '❌ [FAIL]';
    console.log(`${icon} ${r.name}: ${r.success ? '执行完成' : (r.error || (r.timeout ? '轮询超时' : '失败'))}`);
    if (r.item) {
      console.log('    状态产物/输出详情:', JSON.stringify(r.item.outputs || r.item.outputFid || r.item.error || {}));
    }
  }
}

main().catch(console.error);
