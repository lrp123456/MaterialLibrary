/**
 * ASR 双上游健康探针回归测试（离线，只打 127.0.0.1 临时端口）
 *
 * 背景：/api/asr/status 的 ready 必须反映「麦克风实时听写」（本机 Python 10095），
 * 而不是 GPU 面板（192.168.1.107:9000，只负责整段 webm 语音条转写）。
 * 同时防回归：probeOne 里 res.on('error') 一度被误放在 http.get 回调外，
 * 语法检查通过但运行时 ReferenceError，状态接口直接 500。
 *
 * 运行：node test/asr-health-probe.test.js
 */
const http = require('http');
const assert = require('assert');

const ASR_PATH = require.resolve('../src/asr.js');

function startUpstream(handler) {
  return new Promise((resolve, reject) => {
    const srv = http.createServer(handler);
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

function closeServer(srv) {
  return new Promise((resolve) => srv.close(() => resolve()));
}

// asr.js 的上游地址在模块加载时从环境变量读取常量；每次重新 require 一份
function loadAsr(env) {
  const saved = {};
  for (const [k, v] of Object.entries(env)) {
    saved[k] = Object.prototype.hasOwnProperty.call(process.env, k) ? process.env[k] : null;
    process.env[k] = v;
  }
  delete require.cache[ASR_PATH];
  const mod = require('../src/asr.js');
  for (const [k, v] of Object.entries(saved)) {
    if (v === null) delete process.env[k];
    else process.env[k] = v;
  }
  return mod;
}

// 退出前把缓存还原成默认环境的模块，避免污染同进程后续 require
function restoreDefaultAsr() {
  for (const k of ['ASR_LOCAL_HTTP_URL', 'ASR_HTTP_URL', 'ASR_WS_URL']) delete process.env[k];
  delete require.cache[ASR_PATH];
  require('../src/asr.js');
}

async function main() {
  // 上游 1：本机 Python 实时听写（/health）
  const py = await startUpstream((req, res) => {
    if (req.url === '/health') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: true, ready: true, engine: 'sherpa-onnx/sense-voice' }));
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  // 上游 2：GPU 面板整段转写（/api/asr/health）
  const panel = await startUpstream((req, res) => {
    if (req.url === '/api/asr/health') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }
    res.statusCode = 404;
    res.end();
  });

  try {
    const pyUrl = `http://127.0.0.1:${py.address().port}`;
    const panelUrl = `http://127.0.0.1:${panel.address().port}`;
    const asr = loadAsr({ ASR_LOCAL_HTTP_URL: pyUrl, ASR_HTTP_URL: panelUrl });

    // 1) 双上游在线：不抛异常、两路就绪
    const h1 = await asr.probeHealth({ force: true });
    assert.strictEqual(h1.ready, true, '双在线：实时听写应就绪');
    assert.strictEqual(h1.transcribeReady, true, '双在线：整段转写应就绪');
    assert.strictEqual(h1.hint, '', '双在线：无提示');

    // 2) 仅 GPU 面板宕：麦克风状态不受影响
    await closeServer(panel);
    const h2 = await asr.probeHealth({ force: true });
    assert.strictEqual(h2.ready, true, '面板宕：实时听写仍就绪（两条链路独立）');
    assert.strictEqual(h2.transcribeReady, false, '面板宕：整段转写应未就绪');
    assert.ok(/GPU/.test(h2.hint || ''), '面板宕：hint 应点名 GPU 面板');

    // 3) 本机 Python 也宕：ready=false，hint 指向控制台 3790
    await closeServer(py);
    const h3 = await asr.probeHealth({ force: true });
    assert.strictEqual(h3.ready, false, 'Python 宕：实时听写应未就绪');
    assert.strictEqual(h3.transcribeReady, false, 'Python 宕：整段转写也未就绪');
    assert.ok(/3790/.test(h3.hint || ''), 'Python 宕：hint 应引导到素材库控制台 3790');

    // 4) 健康缓存 5s：非强制探测返回同一对象（不重新发请求）
    assert.strictEqual(await asr.probeHealth(), h3, '缓存窗口内应复用上次结果');

    console.log('asr-health-probe: 10/10 断言通过');
  } finally {
    await Promise.allSettled([closeServer(py), closeServer(panel)]);
    restoreDefaultAsr();
  }
}

main().catch((e) => {
  console.error('asr-health-probe 失败：', e);
  process.exit(1);
});
