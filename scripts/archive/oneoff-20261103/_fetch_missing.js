const fs = require('fs');
const { loadProjectEnv } = require('../src/env-secrets');
loadProjectEnv();

const ba_map = JSON.parse(fs.readFileSync('scripts/ba_records_map.json', 'utf8'));
const missing = JSON.parse(fs.readFileSync('scripts/missing_templates.json', 'utf8'));
console.log('Missing count:', missing.length);

const keywords = new Set();
for (const m of missing) {
  const clean = m.prompt.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '');
  for (let i = 0; i < Math.min(clean.length, 10); i++) {
    keywords.add(clean.slice(i, i + 2));
    keywords.add(clean.slice(i, i + 1));
  }
}
console.log('Keywords to try:', keywords.size);

const config = {
  base: String(process.env.BA_RESOURCE_BASE || '').trim().replace(/\/+$/, ''),
  username: String(process.env.BA_RESOURCE_USER || '').trim(),
  password: String(process.env.BA_RESOURCE_PASSWORD || '').trim()
};

async function main() {
  const loginRes = await fetch(`${config.base}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: config.username, password: config.password })
  });
  const token = (await loginRes.json()).token;

  for (const kw of keywords) {
    if (!kw) continue;
    let current = 1;
    while (true) {
      try {
        const url = new URL(`${config.base}/resource/v1/search`);
        url.searchParams.set('keyword', kw);
        url.searchParams.set('type', 'all');
        url.searchParams.set('current', String(current));
        url.searchParams.set('size', '50');
        const res = await fetch(url.toString(), {
          headers: { Authorization: `Bearer ${token}` }
        });
        const data = await res.json();
        const records = data.data?.records || [];
        for (const r of records) {
          if (r.id && r.createTime) {
            ba_map[String(r.id)] = {
              id: r.id,
              createTime: r.createTime,
              type: r.type,
              context: r.context,
              info: r.info,
              url: r.url
            };
          }
        }
        if (current >= (data.data?.pages || 1)) break;
        current++;
      } catch (err) {
        break;
      }
    }
  }

  fs.writeFileSync('scripts/ba_records_map.json', JSON.stringify(ba_map, null, 2));
  const stillMissing = missing.filter(r => !ba_map[r.id.slice(3)]);
  console.log('Still missing count:', stillMissing.length);
}

main().catch(console.error);
