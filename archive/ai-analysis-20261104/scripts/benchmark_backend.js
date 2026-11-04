/**
 * Backend Benchmark Collection Script (Zero-Dependency Node.js script)
 * 测量口径：TTFB (Time to First Byte), 总耗时 (Total Latency), P50, P90, P95, P99, 吞吐量 (QPS)
 * 用法:
 *   node scripts/benchmark_backend.js [--base=http://127.0.0.1:30001] [--concurrency=10] [--requests=50]
 */

const http = require('http');
const https = require('https');
const { performance } = require('perf_hooks');

const argv = process.argv.slice(2);
function getArg(name, def) {
  const hit = argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : def;
}

const BASE_URL = getArg('base', process.env.BENCH_BASE_URL || 'http://127.0.0.1:30001');
const CONCURRENCY = parseInt(getArg('concurrency', '10'), 10);
const TOTAL_REQUESTS = parseInt(getArg('requests', '50'), 10);

const TARGET_ENDPOINTS = [
  { name: '健康探活 (Health Ping)', path: '/health', method: 'GET' },
  { name: '字典菜单树 (Menu Tree)', path: '/dict/menu-tree', method: 'GET' },
  { name: '仪表盘统计 (Dashboard Stats)', path: '/stats', method: 'GET' },
  { name: '资产分页带筛选字典 (Assets with Facets)', path: '/assets?page=1&pageSize=24', method: 'GET' },
  { name: '资产分页跳过字典 (Assets skip_facets=1)', path: '/assets?page=1&pageSize=24&skip_facets=1', method: 'GET' },
  { name: '收藏列表查询 (Assets only_favorite=1)', path: '/assets?only_favorite=1&page=1&pageSize=24', method: 'GET' }
];

function makeRequest(url, method = 'GET', headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const client = u.protocol === 'https:' ? https : http;
    const t0 = performance.now();
    let ttfb = 0;

    const req = client.request(u, { method, headers }, (res) => {
      ttfb = performance.now() - t0;
      let bytes = 0;
      res.on('data', chunk => { bytes += chunk.length; });
      res.on('end', () => {
        const total = performance.now() - t0;
        resolve({
          statusCode: res.statusCode,
          ttfb,
          total,
          bytes
        });
      });
    });

    req.on('error', err => reject(err));
    req.setTimeout(15000, () => {
      req.destroy(new Error('Request Timeout (15s)'));
    });
    req.end();
  });
}

function computePercentiles(numbers) {
  if (!numbers.length) return { p50: 0, p90: 0, p95: 0, p99: 0, min: 0, max: 0, avg: 0 };
  const sorted = [...numbers].sort((a, b) => a - b);
  const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    avg: sum / sorted.length,
    p50: q(50),
    p90: q(90),
    p95: q(95),
    p99: q(99)
  };
}

async function runBenchmarkForEndpoint(endpoint) {
  const url = `${BASE_URL.replace(/\/$/, '')}${endpoint.path.startsWith('/') ? '' : '/'}${endpoint.path}`;
  console.log(`\n--------------------------------------------------------------`);
  console.log(`[测试目标] ${endpoint.name}`);
  console.log(`[URL] ${url}`);
  console.log(`[参数] 并发数: ${CONCURRENCY}, 总请求数: ${TOTAL_REQUESTS}`);

  const ttfbList = [];
  const totalList = [];
  let successCount = 0;
  let failCount = 0;
  let totalBytes = 0;

  const tStart = performance.now();
  let remaining = TOTAL_REQUESTS;

  async function worker() {
    while (remaining > 0) {
      remaining--;
      try {
        const r = await makeRequest(url, endpoint.method, {
          'Accept': 'application/json, text/plain, */*',
          'Accept-Encoding': 'gzip, deflate'
        });
        if (r.statusCode >= 200 && r.statusCode < 400) {
          successCount++;
          ttfbList.push(r.ttfb);
          totalList.push(r.total);
          totalBytes += r.bytes;
        } else {
          failCount++;
          totalList.push(r.total);
        }
      } catch (e) {
        failCount++;
      }
    }
  }

  const workers = Array.from({ length: CONCURRENCY }, () => worker());
  await Promise.all(workers);

  const durationMs = performance.now() - tStart;
  const qps = (successCount / (durationMs / 1000)).toFixed(2);
  const ttfbStats = computePercentiles(ttfbList);
  const totalStats = computePercentiles(totalList);

  console.log(`[结果摘要] 成功: ${successCount}, 失败: ${failCount}, 总耗时: ${(durationMs / 1000).toFixed(2)}s, QPS: ${qps}`);
  console.log(`  • TTFB 首字节: 均值=${ttfbStats.avg.toFixed(1)}ms, P50=${ttfbStats.p50.toFixed(1)}ms, P95=${ttfbStats.p95.toFixed(1)}ms, P99=${ttfbStats.p99.toFixed(1)}ms`);
  console.log(`  • 总响应耗时 : 均值=${totalStats.avg.toFixed(1)}ms, P50=${totalStats.p50.toFixed(1)}ms, P95=${totalStats.p95.toFixed(1)}ms, P99=${totalStats.p99.toFixed(1)}ms, Max=${totalStats.max.toFixed(1)}ms`);
  console.log(`  • 平均传输体积: ${(totalBytes / Math.max(1, successCount) / 1024).toFixed(1)} KB`);

  return {
    endpoint: endpoint.name,
    path: endpoint.path,
    qps,
    successRate: ((successCount / TOTAL_REQUESTS) * 100).toFixed(1) + '%',
    ttfbStats,
    totalStats
  };
}

async function main() {
  console.log(`==============================================================`);
  console.log(`  素材库后端接口性能基准采集 (MaterialLibraryServer Benchmark) `);
  console.log(`  目标基址: ${BASE_URL}  时间: ${new Date().toISOString()}`);
  console.log(`==============================================================`);

  // 先探活
  try {
    const probe = await makeRequest(`${BASE_URL}/health`, 'GET');
    console.log(`[服务探活] HTTP /health 响应码: ${probe.statusCode}, 耗时: ${probe.total.toFixed(1)}ms`);
  } catch (e) {
    console.warn(`[服务探活警告] 无法连接到 ${BASE_URL}: ${e.message}`);
    console.warn(`提示：若服务运行在 WSL 且未启动，请在素材库控制台（3790）启动正式端整组，或指定 --base`);
  }

  const summary = [];
  for (const ep of TARGET_ENDPOINTS) {
    try {
      const res = await runBenchmarkForEndpoint(ep);
      summary.push(res);
    } catch (e) {
      console.error(`测试 ${ep.name} 发生异常:`, e.message);
    }
  }

  console.log(`\n==============================================================`);
  console.log(`  性能基准矩阵汇总 (Benchmark Summary Matrix) `);
  console.log(`==============================================================`);
  console.table(summary.map(s => ({
    '接口名称': s.endpoint,
    '路径': s.path,
    'QPS': s.qps,
    '成功率': s.successRate,
    'TTFB P95(ms)': s.ttfbStats.p95.toFixed(1),
    '耗时 P50(ms)': s.totalStats.p50.toFixed(1),
    '耗时 P95(ms)': s.totalStats.p95.toFixed(1),
    '耗时 P99(ms)': s.totalStats.p99.toFixed(1)
  })));
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { runBenchmarkForEndpoint, makeRequest, computePercentiles };
