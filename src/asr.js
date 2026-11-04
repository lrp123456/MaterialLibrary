/**
 * 语音输入（ASR）网关 —— 两条链路，两个上游
 *
 * 浏览器只跟同源的 /api/asr/* 说话：
 *   1) 麦克风实时听写（/api/asr/stream，WS）→ 本机 Python 服务（素材库控制台一键启动）
 *        HTTP  http://127.0.0.1:10095  /health 健康探针
 *        WS    ws://127.0.0.1:10096    边录边出字（16k PCM16 二进制帧 + JSON 控制帧）
 *   2) 整段语音条转写（/api/asr/transcribe，POST multipart webm/opus）
 *        → GPU 面板 naite@192.168.1.107:9000（FunASR，能解 webm；本机 Python 只收 WAV/PCM）
 *
 * 为什么不直接让浏览器连 Python：ASR 只监听本机，且需要复用登录会话鉴权；
 * 代理一层后，局域网/公网访问走的是同一个入口（30001/30002/30000/30003）。
 */
const http = require('http');
const { URL } = require('url');

// 两条语音链路的上游是不同服务，刻意分开配置：
//   实时听写（WS）：本机 hub 启动的 scripts/asr/asr_server.py，裸 PCM16，10095/10096
//   整段转写（HTTP multipart webm 语音条）：GPU 面板 naite@192.168.1.107:9000
//   （本机 Python 只收 WAV/PCM 裸流，解不了浏览器 MediaRecorder 的 webm/opus）
const ASR_HTTP = (process.env.ASR_HTTP_URL || 'http://192.168.1.107:9000').replace(/\/$/, '');
const ASR_WS = process.env.ASR_WS_URL || 'ws://127.0.0.1:10096';
// 实时听写服务的健康探针：默认与 WS 同源的本机 Python（/health）
const ASR_LOCAL_HTTP = (process.env.ASR_LOCAL_HTTP_URL || 'http://127.0.0.1:10095').replace(/\/$/, '');
const MAX_UPLOAD = 30 * 1024 * 1024;

// 正式端跑在 WSL 里，Node 版本可能是 18/20；全局 WebSocket 只有 21+ 才有，
// 所以这里退回 undici 自带的实现（项目依赖里已有 undici）。
const WSClient = (() => {
  if (typeof globalThis.WebSocket === 'function') return globalThis.WebSocket;
  try { return require('undici').WebSocket; } catch (_) { return null; }
})();

let healthCache = { at: 0, data: null };

function probeOne(base, pathname, label) {
  return new Promise((resolve) => {
    let u;
    try { u = new URL(`${base}${pathname}`); } catch (_) { return resolve({ ready: false }); }
    const req = http.get(
      { hostname: u.hostname, port: u.port, path: u.pathname + u.search, timeout: 1500 },
      (res) => {
        let text = '';
        res.on('data', (c) => { text += c; });
        res.on('end', () => {
          let ready = res.statusCode >= 200 && res.statusCode < 400;
          try {
            const j = JSON.parse(text);
            if ((j.status && j.status !== 'ok') || j.ready === false) ready = false;
          } catch (_) {}
          resolve({ ready, label });
        });
      }
    );
    req.on('timeout', () => { req.destroy(); resolve({ ready: false, label }); });
    req.on('error', () => resolve({ ready: false, label }));
    res.on('error', () => resolve({ ready: false, label }));
  });
}

async function probeHealth({ force = false } = {}) {
  if (!force && healthCache.data && Date.now() - healthCache.at < 5000) {
    return healthCache.data;
  }
  // 并行探测：实时听写（本机 Python）决定麦克风按钮可用性；
  // 整段转写（GPU 面板）只影响「录语音条」，独立上报
  const [stream, transcribe] = await Promise.all([
    probeOne(ASR_LOCAL_HTTP, '/health', 'stream'),
    probeOne(ASR_HTTP, '/api/asr/health', 'transcribe'),
  ]);
  const out = {
    ready: stream.ready,               // 麦克风实时听写的真值
    transcribeReady: transcribe.ready, // 语音条整段转写（GPU 面板）
    model: 'sensevoice',
    engine: 'sherpa-onnx/FunASR',
    streamUrl: ASR_LOCAL_HTTP,
    httpUrl: ASR_HTTP,
    hint: stream.ready
      ? (transcribe.ready ? '' : '实时听写可用；整段语音转写服务（GPU 面板）未响应')
      : '实时听写服务未启动：请在素材库控制台（3790）启动「语音识别 (FunASR)」',
  };
  healthCache = { at: Date.now(), data: out };
  return out;
}

async function handleAsrApi(services, req, res, pathname) {
  if (pathname === '/asr/status' && req.method === 'GET') {
    const h = await probeHealth({ force: true });
    const body = JSON.stringify({
      ok: true,
      ...h,
      streaming: h.ready, // 麦克风实时听写（本机 Python 10096）是否可用
      hint: h.hint || h.error || '',
    });
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(body);
    return true;
  }

  if (pathname === '/asr/transcribe' && req.method === 'POST') {
    const len = Number(req.headers['content-length'] || 0);
    if (len > MAX_UPLOAD) {
      res.writeHead(413, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: '音频过大（上限 30MB）' }));
      return true;
    }
    const u = new URL(`${ASR_HTTP}/api/asr/transcribe?model=sensevoice&language=zh&clean=1`);
    const upstream = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method: 'POST',
        timeout: 120000,
        headers: {
          'content-type': req.headers['content-type'] || 'application/octet-stream',
          ...(len ? { 'content-length': len } : {}),
        },
      },
      (up) => {
        res.writeHead(up.statusCode || 502, {
          'Content-Type': up.headers['content-type'] || 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        up.pipe(res);
      }
    );
    upstream.on('timeout', () => {
      upstream.destroy();
      if (!res.headersSent) {
        res.writeHead(504, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: '识别超时' }));
      }
    });
    upstream.on('error', (e) => {
      if (!res.headersSent) {
        res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          error: `整段语音转写服务不可用：${e.code || e.message}`,
          hint: '语音条转写依赖 GPU 面板 naite@192.168.1.107:9000，请检查该机 FunASR 服务；麦克风实时听写走本机服务，不受此影响',
        }));
      }
    });
    req.pipe(upstream);
    return true;
  }

  return false;
}

/**
 * 流式识别：浏览器 WS ↔ Node 代理 ↔ Python WS。
 * 鉴权复用登录会话（?token=...），与 /api/push 同一套。
 */
function attachAsrWebSocket(httpServer, services) {
  if (!httpServer || httpServer.__asrAttached) return;
  httpServer.__asrAttached = true;
  const { acceptWebSocket } = require('./ws-server');

  httpServer.on('upgrade', (req, socket, head) => {
    let url;
    try { url = new URL(req.url, 'http://127.0.0.1'); } catch (_) { return; }
    if (url.pathname !== '/api/asr/stream') return;

    let user = null;
    try {
      const { verifySession } = require('./auth');
      user = verifySession(services.db, url.searchParams.get('token') || '');
    } catch (_) {}
    if (!user) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    let upstream = null;
    let upstreamOpen = false;
    const pending = [];

    const sendLocal = (obj) => {
      try { conn && conn.sendJson(obj); } catch (_) {}
    };

    const conn = acceptWebSocket(req, socket, head, {
      user,
      onMessage: (opcode, payload) => {
        // 0x1 文本（start/end/flush 控制帧）必须以字符串发给 Python，
        // 否则会被当成 PCM 二进制拼进音频流，导致松手时永远收不到 final。
        const msg = opcode === 0x1 ? payload.toString('utf8') : payload;
        if (upstreamOpen && upstream && upstream.readyState === 1) {
          try { upstream.send(msg); } catch (_) {}
        } else if (pending.length < 200) {
          pending.push(msg);
        }
      },
      onClose: () => {
        try {
          if (upstream && upstream.readyState === 1) {
            upstream.send(JSON.stringify({ type: 'end' }));
            setTimeout(() => { try { upstream.close(); } catch (_) {} }, 800);
          }
        } catch (_) {}
      },
    });
    if (!conn) return;

    try {
      if (!WSClient) throw new Error('当前 Node 不支持 WebSocket 客户端');
      upstream = new WSClient(ASR_WS);
    } catch (e) {
      sendLocal({ type: 'error', message: `无法连接语音服务：${e.message}` });
      conn.close(1011, 'asr unavailable');
      return;
    }
    upstream.binaryType = 'arraybuffer';

    const failTimer = setTimeout(() => {
      if (!upstreamOpen) {
        sendLocal({ type: 'error', message: '语音服务连接超时，请确认素材库控制台中的「语音识别 (FunASR)」已启动' });
        try { conn.close(1011, 'timeout'); } catch (_) {}
        try { upstream.close(); } catch (_) {}
      }
    }, 4000);

    upstream.addEventListener('open', () => {
      clearTimeout(failTimer);
      upstreamOpen = true;
      while (pending.length) {
        try { upstream.send(pending.shift()); } catch (_) {}
      }
    });
    upstream.addEventListener('message', (ev) => {
      const data = typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString('utf8');
      try { conn.write(0x1, Buffer.from(data, 'utf8')); } catch (_) {}
    });
    const closeUpstream = () => {
      clearTimeout(failTimer);
      upstreamOpen = false;
      try { conn.close(1000, 'asr closed'); } catch (_) {}
    };
    upstream.addEventListener('close', closeUpstream);
    upstream.addEventListener('error', () => {
      sendLocal({ type: 'error', message: '语音服务异常，请检查 ASR 进程' });
      clearTimeout(failTimer);
    });

    console.log(`[asr] 语音流已连接: ${user.username}`);
  });
}

module.exports = { handleAsrApi, attachAsrWebSocket, probeHealth, ASR_HTTP, ASR_WS };
