/**
 * 对抗性实测挑战套件 2 (Adversarial Challenger 2 Test Suite)
 * 覆盖五大核心攻防与边界实测：
 * 1. 熔断器 (CircuitBreaker) 并发峰值穿透、状态漂移与滑动窗口缺失实测
 * 2. WebSocket lastEventId 增量重放、环形缓冲区空洞与重启序列失效实测
 * 3. SQLite WAL 断电恢复、临时表丢弃与 PASSIVE 检查点饥饿实测
 * 4. streamImageFile / createReadStream 管道在客户端提前断开时的磁盘 I/O 浪费与句柄状态实测
 * 5. parseBody 改造与 Slowloris（慢速请求头/慢速请求体）对抗实测
 */

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const { performance } = require('node:perf_hooks');
const Database = require('better-sqlite3');

const results = [];

function testCase(name, fn) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      console.log(`[PASS] ${name}`);
      results.push({ name, passed: true });
    })
    .catch((err) => {
      console.error(`[FAIL / VULNERABILITY CONFIRMED] ${name}:`, err.message);
      results.push({ name, passed: false, error: err.message, stack: err.stack });
    });
}

// =========================================================================
// 1. 熔断器 (CircuitBreaker) 实测模型（来自治理方案第 4.1 节原文实现）
// =========================================================================
class ProposedCircuitBreaker {
  constructor(name, options = {}) {
    this.name = name;
    this.failureThreshold = options.failureThreshold || 5;
    this.cooldownPeriod = options.cooldownPeriod || 120000;
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.nextAttempt = Date.now();
  }

  canExecute() {
    if (this.state === 'CLOSED') return true;
    if (this.state === 'OPEN') {
      if (Date.now() > this.nextAttempt) {
        this.state = 'HALF-OPEN';
        return true;
      }
      return false;
    }
    // HALF-OPEN 状态下只放行单笔试探 (方案原文第 500-501 行)
    return true;
  }

  recordSuccess() {
    this.failureCount = 0;
    if (this.state !== 'CLOSED') {
      this.state = 'CLOSED';
    }
  }

  recordFailure() {
    this.failureCount++;
    if (this.state === 'HALF-OPEN' || this.failureCount >= this.failureThreshold) {
      this.state = 'OPEN';
      this.nextAttempt = Date.now() + this.cooldownPeriod;
    }
  }
}

async function runAllTests() {
  console.log('================================================================');
  console.log('  对抗挑战专家 2 (Challenger 2) 实测与攻防套件开始执行');
  console.log('================================================================\n');

  // -----------------------------------------------------------------------
  // 挑战 1.1: HALF-OPEN 状态下的并发穿透缺陷（Canary 隔离失效）
  // -----------------------------------------------------------------------
  await testCase('1.1 熔断器 HALF-OPEN 并发穿透缺陷实测', async () => {
    const cb = new ProposedCircuitBreaker('test_provider', {
      failureThreshold: 3,
      cooldownPeriod: 100
    });

    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();
    assert.strictEqual(cb.state, 'OPEN', '初始应为 OPEN');

    await new Promise(r => setTimeout(r, 120));

    // 模拟 10 个并发请求同时调用 canExecute()
    const allowed = [];
    for (let i = 0; i < 10; i++) {
      allowed.push(cb.canExecute());
    }

    const allowedCount = allowed.filter(Boolean).length;
    console.log(`    -> HALF-OPEN 状态下并发 10 笔请求，实际放行数: ${allowedCount}`);

    if (allowedCount > 1) {
      throw new Error(`【严重设计缺陷确认】HALF-OPEN 状态未加并发锁或原子标志，并发 10 笔请求全部放行 (${allowedCount}/10)，未能实现单笔金丝雀试探！下游服务将被并发突刺直接打死！`);
    }
  });

  // -----------------------------------------------------------------------
  // 挑战 1.2: 熔断器累计计数无滑动窗口衰减缺陷
  // -----------------------------------------------------------------------
  await testCase('1.2 熔断器缺少滑动窗口时间衰减导致偶发误熔断', async () => {
    const cb = new ProposedCircuitBreaker('test_provider', {
      failureThreshold: 3,
      cooldownPeriod: 60000
    });

    cb.recordFailure(); // 失败 1
    cb.recordFailure(); // 失败 2
    cb.recordFailure(); // 失败 3

    assert.strictEqual(cb.state, 'OPEN', '3 次跨时段偶发错误导致熔断器跳闸');
    console.log('    -> 方案声称“在 60 秒滑动窗口内连续发生 5 次失败”，但代码无任何时间戳记录或滑动窗口桶，历史偶发错误永久累加！');
    throw new Error('【契约不符缺陷确认】代码未实现任何滑动窗口（Sliding Window）算法，failureCount 永不按时间自动衰减，低频偶发网络抖动将无辜触发系统长时间熔断！');
  });

  // -----------------------------------------------------------------------
  // 挑战 2.1: WebSocket lastEventId 缓冲区空洞与丢事件实测
  // -----------------------------------------------------------------------
  await testCase('2.1 WebSocket lastEventId 环形缓冲区超限空洞实测', async () => {
    class RingEventBuffer {
      constructor(maxSize = 100) {
        this.maxSize = maxSize;
        this.events = [];
        this.seq = 0;
      }
      push(payload) {
        this.seq++;
        const item = { id: this.seq, payload };
        this.events.push(item);
        if (this.events.length > this.maxSize) {
          this.events.shift();
        }
        return item;
      }
      getReplayEvents(lastEventId) {
        return this.events.filter(e => e.id > lastEventId);
      }
    }

    const ring = new RingEventBuffer(100);
    for (let i = 1; i <= 250; i++) {
      ring.push({ task: `task_${i}`, status: 'done' });
    }

    const replayed = ring.getReplayEvents(50);
    const earliestInBuf = ring.events[0].id; // 151
    console.log(`    -> 缓冲区最早事件 ID: ${earliestInBuf}, 客户端请求从 50 开始重放, 实际收到事件数: ${replayed.length}`);

    assert.strictEqual(replayed[0].id, 151);
    const missedCount = earliestInBuf - 51;
    console.log(`    -> 丢失的中间事件数: ${missedCount} 条 (51 ~ 150)！`);

    throw new Error(`【数据一致性缺陷确认】当客户端下线时间超出环形缓冲容量时，直接 filter(> lastEventId) 导致客户端静默丢失 ${missedCount} 条事件且未收到任何 GAP 警告，造成端云状态不可逆分叉！必须引入 GAP 检测与 RESET_REQUIRED 信号！`);
  });

  // -----------------------------------------------------------------------
  // 挑战 2.2: 服务端重启导致 lastEventId 序列失效实测
  // -----------------------------------------------------------------------
  await testCase('2.2 服务端重启后内存 lastEventId 归零导致全量重放死锁', async () => {
    let serverSeq = 0;
    const serverBuffer = [];
    function emitServerEvent(data) {
      serverSeq++;
      serverBuffer.push({ id: serverSeq, data });
    }
    emitServerEvent('event_after_restart_1');
    emitServerEvent('event_after_restart_2');

    const clientLastEventId = 188;
    const replay = serverBuffer.filter(e => e.id > clientLastEventId);
    console.log(`    -> 服务端重启后当前 seq=${serverSeq}, 客户端携带重启前的 lastEventId=${clientLastEventId}, 重放数量: ${replay.length}`);

    assert.strictEqual(replay.length, 0);
    throw new Error('【重启恢复缺陷确认】纯内存自增 lastEventId 在服务端重启后重置为 1，导致所有携带旧 ID (>当前新seq) 的在线客户端无法感知任何新事件，状态全部死锁！必须使用 epoch/session_uuid + seq 联合序列号！');
  });

  // -----------------------------------------------------------------------
  // 挑战 3.1: SQLite 临时表在异常重启/崩溃时的生命周期与 PASSIVE 饥饿实测
  // -----------------------------------------------------------------------
  await testCase('3.1 SQLite 临时表崩溃丢弃与 WAL 恢复边界实测', async () => {
    const tmpDir = path.join(os.tmpdir(), 'sqlite_wal_test_' + Date.now());
    fs.mkdirSync(tmpDir, { recursive: true });
    const dbFile = path.join(tmpDir, 'test.db');

    let db = new Database(dbFile);
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');

    db.exec(`
      CREATE TABLE IF NOT EXISTS persistent_data (id INT PRIMARY KEY, val TEXT);
      CREATE TEMPORARY TABLE temp_staging_queue (id INT PRIMARY KEY, action TEXT);
    `);

    db.prepare("INSERT INTO persistent_data VALUES (1, 'persisted')").run();
    db.prepare("INSERT INTO temp_staging_queue VALUES (1, 'transient_task')").run();

    const tempCountBefore = db.prepare('SELECT COUNT(*) as c FROM temp_staging_queue').get().c;
    assert.strictEqual(tempCountBefore, 1);

    // 模拟异常终止（直接 close 或模拟进程崩溃）
    db.close();

    // 重新打开数据库
    const db2 = new Database(dbFile);
    const persVal = db2.prepare('SELECT val FROM persistent_data WHERE id=1').get()?.val;
    assert.strictEqual(persVal, 'persisted', '持久表数据在 WAL 下应完整');

    let tempExists = true;
    try {
      db2.prepare('SELECT COUNT(*) FROM temp_staging_queue').get();
    } catch (e) {
      tempExists = false;
    }

    console.log(`    -> 重启后持久表数据: ${persVal}, 临时表是否存在: ${tempExists}`);
    assert.strictEqual(tempExists, false, '临时表必须在进程重启后完全消失');

    // 测试 PASSIVE checkpoint 饥饿
    const readConn = new Database(dbFile);
    readConn.pragma('busy_timeout = 1000');
    // 开启长读事务
    readConn.exec('BEGIN DEFERRED');
    const row = readConn.prepare('SELECT * FROM persistent_data').all();

    // 在写连接上产生新写入
    const writeConn = new Database(dbFile);
    writeConn.prepare("INSERT INTO persistent_data VALUES (2, 'new_write')").run();

    // 执行 PASSIVE 检查点
    const cpRes = writeConn.pragma('wal_checkpoint(PASSIVE)');
    console.log(`    -> 存在活跃读事务时 wal_checkpoint(PASSIVE) 结果:`, cpRes);
    // checkpoint 返回 [busy, log, checkpointed]
    const [busy, logPages, checkpointedPages] = Object.values(cpRes[0]);
    console.log(`    -> busy=${busy}, wal总页数=${logPages}, 成功合并页数=${checkpointedPages}`);

    readConn.exec('COMMIT');
    readConn.close();
    writeConn.close();
    db2.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });

    if (tempExists === false) {
      console.log('    -> [确证] SQLite 临时表生命周期与连接强绑定，任何崩溃或服务重启均无法保留临时表数据！');
    }
    if (checkpointedPages < logPages) {
      console.log('    -> [确证] PASSIVE 模式下只要有未释放的读连接，检查点就无法推进到最新事务，长期运行存在 WAL 爆盘风险！');
    }
  });

  // -----------------------------------------------------------------------
  // 挑战 4.1: 流式传输客户端中断时的磁盘 I/O 浪费与句柄对比实测
  // -----------------------------------------------------------------------
  await testCase('4.1 streamImageFile 客户端中途断开时的 ReadStream 行为对比实测', async () => {
    // 构造一个 5MB 临时测试文件
    const testFile = path.join(os.tmpdir(), 'stream_leak_test_' + Date.now() + '.bin');
    fs.writeFileSync(testFile, Buffer.alloc(5 * 1024 * 1024, 0xbb));

    let naiveBytesRead = 0;
    let safeBytesRead = 0;

    // 1. 测试旧式/现有原生 pipe 模式（无 res.on('close') 拦截）
    const srvNaive = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      const rs = fs.createReadStream(testFile, { highWaterMark: 64 * 1024 });
      rs.on('data', (c) => { naiveBytesRead += c.length; });
      rs.pipe(res);
      srvNaive.__rs = rs;
    });
    await new Promise(r => srvNaive.listen(0, '127.0.0.1', r));
    const portNaive = srvNaive.address().port;

    // 客户端连接，只读 64KB 后立即 destroy
    await new Promise((resolve) => {
      const client = net.createConnection({ host: '127.0.0.1', port: portNaive }, () => {
        client.write('GET /test HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n');
      });
      let rec = 0;
      client.on('data', (c) => {
        rec += c.length;
        if (rec >= 65536) {
          client.destroy();
          setTimeout(resolve, 200);
        }
      });
    });

    console.log(`    -> [旧式原生 pipe] 客户端中断(仅收64KB)后: ReadStream 读盘总量=${(naiveBytesRead/1024).toFixed(1)} KB`);

    // 2. 测试增加 res.on('close', () => rs.destroy()) 或 stream.pipeline 的安全模式
    const srvSafe = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      const rs = fs.createReadStream(testFile, { highWaterMark: 64 * 1024 });
      rs.on('data', (c) => { safeBytesRead += c.length; });
      res.on('close', () => {
        if (!res.writableEnded) {
          rs.destroy();
        }
      });
      rs.pipe(res);
      srvSafe.__rs = rs;
    });
    await new Promise(r => srvSafe.listen(0, '127.0.0.1', r));
    const portSafe = srvSafe.address().port;

    await new Promise((resolve) => {
      const client = net.createConnection({ host: '127.0.0.1', port: portSafe }, () => {
        client.write('GET /test HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n');
      });
      let rec = 0;
      client.on('data', (c) => {
        rec += c.length;
        if (rec >= 65536) {
          client.destroy();
          setTimeout(resolve, 200);
        }
      });
    });

    console.log(`    -> [安全防御模式] 客户端中断后: ReadStream 读盘总量=${(safeBytesRead/1024).toFixed(1)} KB`);

    srvNaive.close();
    srvSafe.close();
    fs.unlinkSync(testFile);

    console.log(`    -> I/O 节省比率: 减少无用读盘 ${(((naiveBytesRead - safeBytesRead) / naiveBytesRead) * 100).toFixed(1)}%`);
    if (naiveBytesRead > safeBytesRead) {
      console.log('    -> [确证] 原生 pipe 在客户端断开后不会立即停止物理读取，存在明显的 I/O 资源浪费与管道悬垂！');
    }
  });

  // -----------------------------------------------------------------------
  // 挑战 5.1: StringDecoder 与 Slowloris 慢速攻击防御有效性检验
  // -----------------------------------------------------------------------
  await testCase('5.1 StringDecoder 防御 Slowloris 属性边界检验', async () => {
    const { StringDecoder } = require('node:string_decoder');
    const decoder = new StringDecoder('utf8');

    const chunk1 = Buffer.from([0xE6]);
    const chunk2 = Buffer.from([0xB5, 0x8B]);

    const str1 = decoder.write(chunk1);
    const str2 = decoder.write(chunk2);
    assert.strictEqual(str1 + str2, '测');

    console.log('    -> StringDecoder 成功解决 UTF-8 跨分包字符截断');
    console.log('    -> 但 StringDecoder 内部无计时器、无流速统计，根本不具备网络层 Slowloris 防护功能！');

    // 实测 Slow Headers 攻击模式：测试当慢速发生在 HTTP Headers 阶段时 parseBody 是否生效
    const srv = http.createServer((req, res) => {
      // 如果进入这里说明 Headers 接收完毕
      srv.__headersReceived = true;
      res.end('ok');
    });
    await new Promise(r => srv.listen(0, '127.0.0.1', r));
    const port = srv.address().port;

    const slowClient = net.createConnection({ host: '127.0.0.1', port }, () => {
      // 只发送半截 Header
      slowClient.write('POST /api/test HTTP/1.1\r\nHost: 127.0.0.1\r\nX-Incomplete: ');
    });

    await new Promise(r => setTimeout(r, 300));
    console.log(`    -> 慢速发送 Headers 时，服务器是否进入路由处理 (req.on('data')): ${Boolean(srv.__headersReceived)}`);

    slowClient.destroy();
    srv.close();

    assert.strictEqual(srv.__headersReceived, undefined, '在 Header 发送完毕前，parseBody 根本没有机会被调用');
    console.log('    -> [确证] Slowloris 攻击如果在 Header 阶段慢速发送，parseBody 改造完全无效！必须在 http.Server 层配置 headersTimeout！');
  });

  console.log('\n================================================================');
  console.log(`  实测挑战汇总: 全部 ${results.length} 项边界与漏洞已全部实测完成！`);
  console.log('================================================================');
}

runAllTests().catch(console.error);
