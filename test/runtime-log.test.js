/**
 * 运行日志：挂起原因、致命行、增量读、adb 设备行。
 * 不连生产库、不拉 watchdog。
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const log = require('../service-hub/lib/runtime-log');

function testPickReason() {
  const text = [
    '[proxy] 已启用全局 HTTP 代理',
    'Error: Cannot find module \'undici\'',
    '    at Module._resolveFilename (node:internal/modules/cjs/loader:1212:15)',
    '    at Module._load (node:internal/modules/cjs/loader:1043:27)',
    '{',
    "  code: 'MODULE_NOT_FOUND',",
    '}',
  ].join('\n');
  assert.strictEqual(log.pickReason(text), "Error: Cannot find module 'undici'");
}

function testIgnoresJsonError() {
  const text = '[restage] HTTP 429: {"error":{"message":"rate limit","code":"rate_limit_exceeded"}}';
  assert.strictEqual(log.lineIsFatal(text), false);
  assert.deepStrictEqual(log.scanFatals('server', text), []);
  assert.strictEqual(log.pickReason(text), text);
}

function testEaddr() {
  const text = 'Error: listen EADDRINUSE: address already in use :::30001\n    at Server.setupListenHandle';
  const hits = log.scanFatals('server', text);
  assert.strictEqual(hits.length, 1);
  assert.ok(hits[0].line.includes('EADDRINUSE'));
  assert.strictEqual(log.pickReason(text).includes('EADDRINUSE'), true);
}

function testParseHold() {
  const raw = [
    'service=main',
    'label=服务端',
    'port=30001',
    'exit_code=7',
    'uptime_sec=0',
    'at=2026-11-04 09:40:00',
    'kind=startup',
    'reason=Error: Cannot find module test-mod',
    '---',
    'Error: Cannot find module test-mod',
    '',
  ].join('\n');
  const f = log.parseHold(raw);
  assert.strictEqual(f.service, 'main');
  assert.strictEqual(f.label, '服务端');
  assert.strictEqual(f.exitCode, 7);
  assert.strictEqual(f.uptimeSec, 0);
  assert.strictEqual(f.reason, 'Error: Cannot find module test-mod');
  assert.ok(f.tail.includes('test-mod'));
}

function testReadFaultDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-fault-'));
  try {
    fs.writeFileSync(path.join(dir, 'main.hold'), 'service=main\nlabel=服务端\nexit_code=1\nuptime_sec=0\nat=t\nkind=startup\nreason=boom\n---\nboom\n');
    const faults = log.readFaultDir(dir);
    assert.strictEqual(faults.length, 1);
    assert.strictEqual(faults[0].reason, 'boom');
    assert.strictEqual(log.readFaultDir(path.join(dir, 'missing')).length, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function testReadTail() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-tail-'));
  const file = path.join(dir, 'a.log');
  try {
    fs.writeFileSync(file, 'line1\nline2\nline3\n');
    const first = log.readTail(file, null, { initialBytes: 1000, maxBytes: 1000 });
    assert.strictEqual(first.ok, true);
    assert.ok(first.text.includes('line1'));
    assert.strictEqual(first.next, first.size);
    fs.appendFileSync(file, 'Error: listen EADDRINUSE :::30001\npartial');
    const second = log.readTail(file, first.next, { maxBytes: 1000 });
    assert.ok(second.text.includes('EADDRINUSE'));
    assert.ok(!second.text.includes('partial'), '未写完的行先留住');
    const hits = log.scanFatals('server', second.text);
    assert.strictEqual(hits.length, 1);
    const third = log.readTail(file, second.next, { maxBytes: 1000 });
    assert.strictEqual(third.text, '');
    fs.appendFileSync(file, '-done\n');
    const fourth = log.readTail(file, second.next, { maxBytes: 1000 });
    assert.ok(fourth.text.includes('partial-done'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function testAdbDevices() {
  const text = [
    'List of devices attached',
    'emulator-5554 device product:sdk',
    'abc offline',
    'ZX1G22B device',
    'bad serial device',
  ].join('\n');
  assert.deepStrictEqual(log.parseAdbDevices(text), ['emulator-5554', 'ZX1G22B']);
  assert.strictEqual(log.lineMatchesApp('11-04 09:01:00.000  123  456 E AndroidRuntime: FATAL EXCEPTION: main'), true);
  assert.strictEqual(log.lineMatchesApp('11-04 09:01:00.000  1  1 I wifi: scan'), false);
}

function main() {
  testPickReason();
  testIgnoresJsonError();
  testEaddr();
  testParseHold();
  testReadFaultDir();
  testReadTail();
  testAdbDevices();
  console.log('✔ runtime-log');
}

main();
