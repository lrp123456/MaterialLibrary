#!/usr/bin/env bash
set -euo pipefail
export PATH="/home/lrp/.local/node/bin:$PATH"
cd /mnt/c/Users/lrp/DevEcoStudioProjects/MaterialLibraryServer
curl -sS -m 8 -o /dev/null -w "health:%{http_code}\n" http://127.0.0.1:30001/health
node <<'JS'
const fs = require('fs');
const path = require('path');
const { openDb } = require('./src/db');
const { upsertCatalogItem } = require('./src/base-library/items');
const { listAdapters, parseSwatches } = require('./src/base-library/catalog-sources');

const dataDir = process.env.HOME + '/.dsh-material-library';
const db = openDb(dataDir);
const dir = path.join(dataDir, 'cache', 'base-library', 'catalog');
fs.mkdirSync(dir, { recursive: true });

async function saveImage(url, externalId, pageUrl) {
  const imgRes = await fetch(url, { headers: { 'User-Agent': 'MaterialLibraryCatalog/1.0' } });
  if (!imgRes.ok) return '';
  const bytes = Buffer.from(await imgRes.arrayBuffer());
  if (bytes.length < 32) return '';
  const crypto = require('crypto');
  const ext = path.extname(new URL(url, pageUrl).pathname).slice(0, 8) || '.jpg';
  const file = `${crypto.createHash('sha1').update(String(externalId)).digest('hex').slice(0, 16)}${ext}`;
  fs.writeFileSync(path.join(dir, file), bytes);
  return `cache/base-library/catalog/${file}`;
}

(async () => {
  const report = [];
  for (const adapter of listAdapters()) {
    let status = 0;
    let html = '';
    try {
      const response = await fetch(adapter.startUrl, { headers: { 'User-Agent': 'MaterialLibraryCatalog/1.0' } });
      status = response.status;
      html = await response.text();
    } catch (err) {
      report.push({ id: adapter.id, error: err.message });
      continue;
    }
    const swatches = parseSwatches(adapter, html);
    let saved = 0;
    for (const row of swatches) {
      let preview = '';
      try {
        preview = await saveImage(row.image_url, row.external_id, adapter.startUrl);
      } catch (err) {
        continue;
      }
      if (!preview) continue;
      upsertCatalogItem(db, {
        ...row,
        preview_rel: preview,
        origin: 'brand',
        name_status: 'page',
        kind_key: adapter.kindKey,
        brand: row.brand || adapter.brand
      });
      saved += 1;
    }
    report.push({ id: adapter.id, status, html: html.length, parsed: swatches.length, saved });
  }
  const count = db.prepare('SELECT COUNT(*) AS c FROM ba_items').get().c;
  console.log(JSON.stringify({ report, items: count }, null, 2));
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
JS
