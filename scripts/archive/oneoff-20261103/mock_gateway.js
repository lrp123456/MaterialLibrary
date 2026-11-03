/**
 * 统一处理网关 Mock（默认 8798）
 * POST / {action, params, input} → {request_id}
 * POST / {request_id} → {status, progress, result:{url}, error?}
 * GET  /file/:id.jpg → 占位 JPEG
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const PORT = Number(process.env.MOCK_GATEWAY_PORT || 8798);
const jobs = new Map();
const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD//2Q==',
  'base64'
);

http.createServer((req, res) => {
  const url = req.url || '/';
  if (req.method === 'GET' && url.startsWith('/file/')) {
    const name = path.basename(url.slice(6));
    const job = [...jobs.values()].find(j => j.resultUrl && j.resultUrl.endsWith('/' + name));
    if (job?.filePath && fs.existsSync(job.filePath)) {
      res.writeHead(200, { 'Content-Type': 'image/jpeg' });
      return res.end(fs.readFileSync(job.filePath));
    }
    res.writeHead(404);
    return res.end('not found');
  }

  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'POST only' }));
  }

  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', () => {
    let data = {};
    try { data = JSON.parse(body || '{}'); } catch {}
    res.setHeader('Content-Type', 'application/json');

    if (data.request_id) {
      const job = jobs.get(data.request_id);
      if (!job) {
        res.writeHead(404);
        return res.end(JSON.stringify({ error: 'unknown request_id' }));
      }
      job.polls++;
      if (job.polls < 2) {
        return res.end(JSON.stringify({ status: job.polls === 1 ? 'queued' : 'running', progress: job.polls * 40 }));
      }
      if (!job.resultUrl) {
        const out = path.join(os.tmpdir(), `mock_gw_${job.id}.jpg`);
        fs.writeFileSync(out, JPEG);
        job.filePath = out;
        job.resultUrl = `http://127.0.0.1:${PORT}/file/${job.id}.jpg`;
      }
      return res.end(JSON.stringify({
        status: 'done',
        progress: 100,
        result: { url: job.resultUrl, mime: 'image/jpeg', width: 1, height: 1 }
      }));
    }

    if (!data.action) {
      res.writeHead(400);
      return res.end(JSON.stringify({ error: 'missing action' }));
    }
    const id = crypto.randomBytes(8).toString('hex');
    jobs.set(id, { id, action: data.action, params: data.params || {}, polls: 0 });
    console.log(`[mock-gw] submit ${data.action} → ${id}`);
    res.end(JSON.stringify({ request_id: id }));
  });
}).listen(PORT, '127.0.0.1', () => {
  console.log(`[mock-gw] listening http://127.0.0.1:${PORT}`);
});
