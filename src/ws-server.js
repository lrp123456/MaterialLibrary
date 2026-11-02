/**
 * RFC6455 WebSocket 推送通道（零依赖手写实现）。
 *
 * 为什么不装 ws：node_modules 位于 /mnt/c 共享目录，内含 Linux-ELF 原生模块，
 * 在 Windows 侧 npm install 会触发 better-sqlite3 / sharp 重编并搞挂在跑的
 * 30001 服务。这里手写握手与帧解析，避免任何依赖变更。
 *
 * 端点：GET /api/push?token=<viewer session token>
 * 鉴权：复用 src/auth.js 的 verifySession，与 HTTP API 同一套会话表。
 */
const crypto = require('crypto');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const OP_CONT = 0x0;
const OP_TEXT = 0x1;
const OP_BIN = 0x2;
const OP_CLOSE = 0x8;
const OP_PING = 0x9;
const OP_PONG = 0xa;

const MAX_PAYLOAD = 4 * 1024 * 1024;
const HEARTBEAT_MS = 30000;

const clients = new Set();

function acceptKey(key) {
  return crypto.createHash('sha1').update(String(key || '') + GUID).digest('base64');
}

/** 编码一帧（服务端 → 客户端不加掩码） */
function encodeFrame(opcode, payload) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload || ''), 'utf8');
  const len = data.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeUInt32BE(0, 2);
    header.writeUInt32BE(len, 6);
  }
  header[0] = 0x80 | opcode; // FIN=1
  return Buffer.concat([header, data]);
}

class WsConnection {
  constructor(socket, user) {
    this.socket = socket;
    this.user = user;
    this.buffer = Buffer.alloc(0);
    this.fragments = [];
    this.fragmentOp = 0;
    this.closed = false;
    this.alive = true;
    this.id = crypto.randomBytes(8).toString('hex');

    socket.on('data', (chunk) => this.onData(chunk));
    socket.on('error', () => this.destroy());
    socket.on('close', () => this.destroy());
  }

  onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    // 单次循环最多解析若干帧，避免畸形长度把内存吃满
    for (let guard = 0; guard < 64; guard++) {
      const frame = this.readFrame();
      if (!frame) break;
      this.handleFrame(frame);
      if (this.closed) break;
    }
    if (this.buffer.length > MAX_PAYLOAD) this.close(1009, 'message too big');
  }

  /** 从缓冲区取出一帧；不够则返回 null 等待下次数据 */
  readFrame() {
    const buf = this.buffer;
    if (buf.length < 2) return null;
    const fin = (buf[0] & 0x80) !== 0;
    const opcode = buf[0] & 0x0f;
    const masked = (buf[1] & 0x80) !== 0;
    let len = buf[1] & 0x7f;
    let offset = 2;

    if (len === 126) {
      if (buf.length < offset + 2) return null;
      len = buf.readUInt16BE(offset);
      offset += 2;
    } else if (len === 127) {
      if (buf.length < offset + 8) return null;
      const hi = buf.readUInt32BE(offset);
      const lo = buf.readUInt32BE(offset + 4);
      len = hi * 0x100000000 + lo;
      offset += 8;
    }
    if (len > MAX_PAYLOAD) {
      this.close(1009, 'message too big');
      return null;
    }

    let maskKey = null;
    if (masked) {
      if (buf.length < offset + 4) return null;
      maskKey = buf.slice(offset, offset + 4);
      offset += 4;
    }
    if (buf.length < offset + len) return null;

    const payload = Buffer.from(buf.slice(offset, offset + len));
    if (maskKey) {
      for (let i = 0; i < payload.length; i++) payload[i] ^= maskKey[i % 4];
    }
    this.buffer = buf.slice(offset + len);
    return { fin, opcode, payload };
  }

  handleFrame(frame) {
    const { fin, opcode, payload } = frame;
    if (opcode === OP_CLOSE) {
      this.close(1000, '');
      return;
    }
    if (opcode === OP_PING) {
      this.write(OP_PONG, payload);
      return;
    }
    if (opcode === OP_PONG) {
      this.alive = true;
      return;
    }

    if (opcode === OP_CONT) {
      if (!this.fragmentOp) return;
      this.fragments.push(payload);
      if (!fin) return;
      const op = this.fragmentOp;
      const full = Buffer.concat(this.fragments);
      this.fragments = [];
      this.fragmentOp = 0;
      this.deliver(op, full);
      return;
    }

    if (opcode === OP_TEXT || opcode === OP_BIN) {
      if (fin) {
        this.deliver(opcode, payload);
        return;
      }
      this.fragmentOp = opcode;
      this.fragments = [payload];
    }
  }

  deliver(opcode, payload) {
    if (this.onMessage && (opcode === OP_TEXT || opcode === OP_BIN)) {
      try { this.onMessage(opcode, payload); } catch (e) { console.warn('[ws] onMessage 异常:', e.message); }
      return;
    }
    if (opcode !== OP_TEXT) return;
    const text = payload.toString('utf8');
    // 客户端唯一有效的上行消息：ping 心跳
    if (text === 'ping' || text === '{"type":"ping"}') {
      this.write(OP_TEXT, JSON.stringify({ type: 'pong', t: Date.now() }));
      return;
    }
  }

  write(opcode, payload) {
    if (this.closed || this.socket.destroyed) return false;
    try {
      this.socket.write(encodeFrame(opcode, payload));
      return true;
    } catch (e) {
      this.destroy();
      return false;
    }
  }

  sendJson(obj) {
    return this.write(OP_TEXT, JSON.stringify(obj));
  }

  close(code = 1000, reason = '') {
    if (this.closed) return;
    this.closed = true;
    const reasonBuf = Buffer.from(String(reason || ''), 'utf8');
    const payload = Buffer.alloc(2 + reasonBuf.length);
    payload.writeUInt16BE(code, 0);
    reasonBuf.copy(payload, 2);
    try {
      this.socket.write(encodeFrame(OP_CLOSE, payload));
    } catch (_) {}
    try {
      this.socket.end();
    } catch (_) {}
    clients.delete(this);
  }

  destroy() {
    if (this.closed) return;
    this.closed = true;
    clients.delete(this);
    try {
      this.socket.destroy();
    } catch (_) {}
  }
}

/** 广播事件给所有在线客户端 */
function broadcast(event, payload) {
  try {
    const { eventBus, EVENTS } = require('./events');
    if (event.startsWith('ai.task.')) {
      eventBus.emit(EVENTS.TASK_UPDATED, payload);
    } else if (event === 'asset.ingested') {
      eventBus.emit(EVENTS.ASSET_INGESTED, payload);
    } else if (event === 'asset.deleted') {
      eventBus.emit(EVENTS.ASSET_DELETED, payload);
    }
  } catch (_) {}

  if (!clients.size) return 0;
  let sent = 0;
  for (const c of Array.from(clients)) {
    if (c.closed) continue;
    if (c.sendJson({ type: 'event', event, payload: payload || null, t: Date.now() })) sent++;
  }
  return sent;
}

/**
 * 把 WebSocket 挂到已有 http server 上。
 * @param {import('http').Server} httpServer
 * @param {object} services
 */
function attachWebSocketServer(httpServer, services) {
  if (!httpServer || httpServer.__wsAttached) return;
  httpServer.__wsAttached = true;

  httpServer.on('upgrade', (req, socket, head) => {
    let pathname = '';
    let query = null;
    try {
      const u = new URL(req.url, 'http://127.0.0.1');
      pathname = u.pathname;
      query = u.searchParams;
    } catch (_) {}

    if (pathname !== '/api/push' && pathname !== '/ws') {
      // /api/asr/* 的升级请求由 asr.js 自己的 upgrade 监听处理，这里必须放行，
      // 否则语音输入会拿到 404 而不是 101。
      if (pathname.startsWith('/api/asr/')) return;
      socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    const upgrade = String(req.headers.upgrade || '').toLowerCase();
    const key = req.headers['sec-websocket-key'];
    if (upgrade !== 'websocket' || !key) {
      socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    // 鉴权：与 HTTP API 共用 sessions 表
    let user = null;
    try {
      const { verifySession } = require('./auth');
      const token = (query && query.get('token')) || '';
      user = verifySession(services.db, token);
    } catch (e) {
      console.warn('[ws] 会话校验异常:', e.message);
    }
    if (!user) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    socket.setNoDelay(true);
    socket.setTimeout(0);
    socket.write(
      [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        'Sec-WebSocket-Accept: ' + acceptKey(key),
        '',
        '',
      ].join('\r\n')
    );

    const conn = new WsConnection(socket, user);
    clients.add(conn);
    conn.sendJson({ type: 'hello', username: user.username, role: user.role, t: Date.now() });
    console.log(`[ws] 客户端已连接: ${user.username} (在线 ${clients.size})`);

    if (head && head.length) conn.onData(head);
  });

  // 心跳：清理僵死连接
  const timer = setInterval(() => {
    for (const c of Array.from(clients)) {
      if (c.closed) {
        clients.delete(c);
        continue;
      }
      if (!c.alive) {
        c.destroy();
        clients.delete(c);
        continue;
      }
      c.alive = false;
      c.write(OP_PING, Buffer.from(String(Date.now())));
    }
  }, HEARTBEAT_MS);
  if (timer.unref) timer.unref();

  console.log('[ws] 推送通道已就绪: /api/push');
  return { clients };
}

function clientCount() {
  return clients.size;
}

/**
 * 把一条已经完成 HTTP→WS 握手的连接交给调用方（语音输入等扩展通道用）。
 * 不做鉴权，鉴权由调用方在升级前完成。
 */
function acceptWebSocket(req, socket, head, opts = {}) {
  const key = req.headers['sec-websocket-key'];
  const upgrade = String(req.headers.upgrade || '').toLowerCase();
  if (upgrade !== 'websocket' || !key) {
    socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return null;
  }
  socket.setNoDelay(true);
  socket.setTimeout(0);
  socket.write(
    [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      'Sec-WebSocket-Accept: ' + acceptKey(key),
      '',
      '',
    ].join('\r\n')
  );
  const conn = new WsConnection(socket, opts.user || { username: 'ws' });
  if (opts.onMessage) conn.onMessage = opts.onMessage;
  if (opts.onClose) {
    const origDestroy = conn.destroy.bind(conn);
    conn.destroy = () => { try { opts.onClose(); } catch (_) {} origDestroy(); };
  }
  if (head && head.length) conn.onData(head);
  return conn;
}

module.exports = {
  attachWebSocketServer,
  broadcast,
  clientCount,
  acceptWebSocket,
  encodeFrame,
  OP_TEXT,
  OP_BIN,
  OP_CLOSE,
};
