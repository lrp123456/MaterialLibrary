const http = require('http');
function post(body) {
  return new Promise((res, rej) => {
    const d = JSON.stringify(body);
    const r = http.request({
      host: '127.0.0.1', port: 8798, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(d) }
    }, x => {
      let b = '';
      x.on('data', c => b += c);
      x.on('end', () => { try { res(JSON.parse(b || '{}')); } catch (e) { rej(e); } });
    });
    r.on('error', rej);
    r.end(d);
  });
}
(async () => {
  const s = await post({ action: 'watermark_remove', params: {}, input: { fid: 't' } });
  console.log('submit', s);
  await new Promise(r => setTimeout(r, 800));
  console.log('poll1', await post({ request_id: s.request_id }));
  await new Promise(r => setTimeout(r, 800));
  console.log('poll2', await post({ request_id: s.request_id }));
})().catch(e => { console.error(e); process.exit(1); });
