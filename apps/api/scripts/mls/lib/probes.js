/**
 * HTTP 探活：所有探针并发、统一超时，只依赖 node 内置模块。
 * 任何单个目标不可达都不影响其它结果 —— 调用方按 up:false 降级渲染。
 */
const http = require('http');

const TEST_API_PORT = Number(process.env.ML_TEST_API_PORT || 30000);
const TEST_WEB_PORT = Number(process.env.ML_TEST_WEB_PORT || 30003);

/** id 稳定，供 service-hub / JSON 消费方引用 */
const TARGETS = [
  { id: 'prod-api', label: '正式 API', port: 30001, path: '/api/health', expectJson: true },
  { id: 'test-api', label: '测试 API', port: TEST_API_PORT, path: '/api/health', expectJson: true },
  { id: 'prod-web', label: '正式 Web 网关', port: 30002, path: '/__ml/channel', expectJson: true },
  { id: 'test-web', label: '测试 Web 网关', port: TEST_WEB_PORT, path: '/__ml/channel', expectJson: true },
  { id: 'service-hub', label: '服务面板', port: 3790, path: '/api/services', expectJson: true },
  { id: 'pack-studio', label: '打包工作台', port: 3789, path: '/api/status', expectJson: true },
  { id: 'clip-editor', label: '剪辑编辑器', port: 3010, path: '/' },
  { id: 'asr', label: '语音识别', port: 10095, path: '/' },
];

/**
 * 探一个目标。任何响应（含 404）都说明端口在监听；连接被拒/超时才算 down。
 * 返回 { up, statusCode, data?, error?, ms }
 */
function probeOne(target, timeoutMs = 800) {
  const start = Date.now();
  return new Promise((resolve) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: target.port,
        path: target.path,
        method: 'GET',
        // 部分服务对 Host 敏感，统一给本机名
        headers: { Host: '127.0.0.1' },
        // 明确不自动走系统代理（否则代理软件会把拒绝连接变成 502）
        agent: false,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          const out = {
            id: target.id,
            label: target.label,
            port: target.port,
            path: target.path,
            up: true,
            statusCode: res.statusCode,
            ms: Date.now() - start,
          };
          if (target.expectJson) {
            try {
              const j = JSON.parse(body);
              // 体积控制：pack /services 全量列表较大，外面只取需要的字段
              out.data = j;
            } catch (_) {
              out.parseError = true;
            }
          }
          resolve(out);
        });
      }
    );
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('timeout'));
    });
    req.on('error', (e) => {
      resolve({
        id: target.id,
        label: target.label,
        port: target.port,
        path: target.path,
        up: false,
        error: e.message,
        ms: Date.now() - start,
      });
    });
    req.end();
  });
}

/** 并发探全部（或指定子集），返回 id → result 映射，永不 reject */
async function probeAll(targets = TARGETS, timeoutMs = 800) {
  const results = await Promise.all(targets.map((t) => probeOne(t, timeoutMs)));
  const map = new Map();
  for (const r of results) map.set(r.id, r);
  return map;
}

module.exports = { TARGETS, TEST_API_PORT, TEST_WEB_PORT, probeOne, probeAll };
