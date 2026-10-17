/**
 * _ps_watch.js · 等待打包任务结束并读日志
 */
const http = require('http');
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function get(p) {
  return new Promise((r) => {
    http.get('http://127.0.0.1:3789' + p, { timeout: 15000 }, (s) => {
      let b = ''; s.on('data', d => b += d); s.on('end', () => r(b));
    }).on('error', (e) => r('ERR ' + e.message));
  });
}
(async () => {
  let saw = false;
  for (let i = 0; i < 200; i++) {
    await sleep(2000);
    const s = await get('/api/status');
    if (s.startsWith('ERR')) { console.log('服务异常: ' + s); return; }
    let j; try { j = JSON.parse(s); } catch (e) { continue; }
    if (j.running) { if (!saw) { process.stdout.write('编译中'); saw = true; } process.stdout.write('.'); continue; }
    if (saw) { process.stdout.write('\n'); break; }
    if (i > 2) break;
  }
  const log = await get('/api/log');
  let j; try { j = JSON.parse(log); } catch (e) { console.log(log.slice(0, 3000)); return; }
  console.log(j.log);
})();
