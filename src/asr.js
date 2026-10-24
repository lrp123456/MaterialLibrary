/**
 * 语音输入（ASR）网关
 *
 * 浏览器只跟同源的 /api/asr/* 说话，真正的识别在本机 Python 服务里：
 *   HTTP  http://127.0.0.1:10095  一次性识别（WAV / PCM16）
 *   WS    ws://127.0.0.1:10096    边录边出字（16k PCM16 二进制帧 + JSON 控制帧）
 *
 * 为什么不直接让浏览器连 Python：ASR 只监听本机，且需要复用登录会话鉴权；
 * 代理一层后，局域网/公网访问走的是同一个入口（30001/30002/30000/30003）。
 */
const http = require('http');
const { URL } = require('url');

const ASR_HTTP = (process.env.ASR_HTTP_URL || 'http://127.0.0.1:10095').replace(/\/$/, '');
const ASR_WS = process.env.ASR_WS_URL || 'ws://127.0.0.1:10096';
const MAX_UPLOAD = 30 * 1024 * 1024;

// 正式端跑在 WSL 里，Node 版本可能是 18/20；全局 WebSocket 只有 21+ 才有，
// 所以这里退回 undici 自带的实现（项目依赖里已有 undici）。
const WSClient = (() => {
  if (typeof globalThis.WebSocket === 'function') return globalThis.WebSocket;
  try { return require('undici').WebSocket; } catch (_) { return null; }
})();

let healthCache = { at: 0, data: null };

function probeHealth({ force = false } = {}) {
  if (!force && healthCache.data && Date.now() - healthCache.at < 5000) {
    return Promise.resolve(healthCache.data);
  }
  return new Promise((resolve) => {
    const u = new URL(`${ASR_HTTP}/health`);
    const req = http.get(
      { hostname: u.hostname, port: u.port, path: u.pathname, timeout: 1500 },
      (res) => {
        let text = '';
        res.on('data', (c) => { text += c; });
        res.on('end', () => {
          let data = null;
          try { data = JSON.parse(text); } catch (_) {}
          const out = data
            ? { ready: true, ...data, wsUrl: ASR_WS, httpUrl: ASR_HTTP }
            : { ready: false, error: 'ASR 返回非 JSON' };
          healthCache = { at: Date.now(), data: out };
          resolve(out);
        });
      }
    );
    req.on('timeout', () => { req.destroy(); resolve({ ready: false, error: 'ASR 服务响应超时' }); });
    req.on('error', (e) => resolve({ ready: false, error: `ASR 服务未启动（${e.code || e.message}）` }));
  });
}

async function handleAsrApi(services, req, res, pathname) {
  if (pathname === '/asr/status' && req.method === 'GET') {
    const h = await probeHealth({ force: true });
    const body = JSON.stringify({
      ok: true,
      ...h,
      streaming: !!h.ready,
      hint: h.ready ? '' : '运行「启动语音识别.bat」后再试',
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
    const u = new URL(`${ASR_HTTP}/transcribe`);
    const upstream = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname,
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
        res.end(JSON.stringify({ error: `语音服务不可用：${e.code || e.message}`, hint: '运行「启动语音识别.bat」' }));
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
        sendLocal({ type: 'error', message: '语音服务连接超时，请确认「启动语音识别.bat」已运行' });
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
