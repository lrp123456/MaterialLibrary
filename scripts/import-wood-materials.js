/**
 * 木纹策展目录导入 / 校准报告
 *
 *   node scripts/import-wood-materials.js --calibrate
 *   node scripts/import-wood-materials.js --dry-run
 *   node scripts/import-wood-materials.js --apply
 *   node scripts/import-wood-materials.js --apply --source treezo
 *   node scripts/import-wood-materials.js --apply --limit 5 --force
 *
 * 校准模式只下载缩略图并生成对照表，不写数据库。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const sharp = require('sharp');
const { fetch } = require('undici');
const { WOOD_CATALOG } = require('../src/base-library/wood-catalog');
const {
  WOOD_SPECIES_LABELS,
  WOOD_TONE_LABELS,
  GRAIN_TYPE_LABELS,
  GRAIN_SCALE_LABELS,
  GRAIN_DIRECTION_LABELS,
  WOOD_LAYOUT_LABELS,
  SURFACE_FINISH_LABELS,
  rgbToHex,
  rgbToLab,
  classifyTone
} = require('../src/base-library/wood-taxonomy');

const dataDir = process.env.ML_DATA_DIR || path.join(os.homedir(), '.dsh-material-library');
const args = process.argv.slice(2);
const calibrate = args.includes('--calibrate');
const apply = args.includes('--apply');
const dryRun = !apply && !calibrate || args.includes('--dry-run');
const force = args.includes('--force');
const sourceArg = (() => {
  const i = args.indexOf('--source');
  return i >= 0 ? String(args[i + 1] || '').split(',').map((s) => s.trim()).filter(Boolean) : [];
})();
const limitArg = (() => {
  const i = args.indexOf('--limit');
  return i >= 0 ? Math.max(1, Number(args[i + 1]) || 0) : 0;
})();

const catalogDir = path.join(dataDir, 'cache', 'base-library', 'catalog');
const calibrationDir = path.join(dataDir, 'cache', 'base-library', 'calibration');
const docsDir = path.join(__dirname, '..', 'docs');
const stamp = new Date().toISOString().slice(0, 10);
const reportBase = path.join(docsDir, `wood-calibration-${stamp}`);

function selectedEntries() {
  let rows = WOOD_CATALOG;
  if (sourceArg.length) rows = rows.filter((row) => sourceArg.includes(row.source));
  if (limitArg) rows = rows.slice(0, limitArg);
  return rows;
}

function glossFromFinish(finish) {
  if (finish === 'gloss') return 'gloss';
  if (finish === 'semi_gloss' || finish === 'satin') return 'satin';
  return 'matte';
}

function promptFor(row) {
  const bits = [
    WOOD_SPECIES_LABELS[row.wood_species],
    GRAIN_TYPE_LABELS[row.grain_type],
    GRAIN_SCALE_LABELS[row.grain_scale],
    GRAIN_DIRECTION_LABELS[row.grain_direction],
    WOOD_LAYOUT_LABELS[row.wood_layout],
    SURFACE_FINISH_LABELS[row.surface_finish]
  ].filter(Boolean);
  return `${row.name_zh}（${bits.join('·')}）`;
}

async function fetchBuffer(url, { timeoutMs = 45000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'DSH-MaterialLibrary/1.0 (+wood-catalog)' },
      redirect: 'follow',
      signal: controller.signal
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
    return Buffer.from(await res.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

async function downloadFull(row) {
  if (row.download.type === 'direct') return fetchBuffer(row.download.url);
  if (row.download.type === 'polyhaven') {
    const { resolvePolyHavenDownloadUrl } = require('../src/base-library/sources/polyhaven');
    const url = await resolvePolyHavenDownloadUrl(row.download.asset);
    return fetchBuffer(url);
  }
  if (row.download.type === 'ambientcg') {
    const { extractFileFromZip } = require('../src/base-library/sources/ambientcg');
    const zip = await fetchBuffer(`https://ambientcg.com/get?file=${row.download.asset}_1K-JPG.zip`);
    const jpg = extractFileFromZip(zip, '_Color.jpg');
    if (!jpg) throw new Error(`${row.download.asset} ZIP 中没有 _Color.jpg`);
    return jpg;
  }
  throw new Error(`未知下载类型 ${row.download.type}`);
}

async function downloadThumb(row) {
  // ambientCG 的 thumbnail 是 3D 球体预览，校准需要平面色卡，直接取 1K Color map。
  const buf = row.download.type === 'ambientcg'
    ? await downloadFull(row)
    : await fetchBuffer(row.image_url, { timeoutMs: 30000 });
  return sharp(buf)
    .rotate()
    .resize(240, 240, { fit: 'cover', position: 'centre' })
    .jpeg({ quality: 82 })
    .toBuffer();
}

async function averageColor(buf) {
  const { data, info } = await sharp(buf)
    .resize(1, 1, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const channels = info.channels || 3;
  const r = data[0];
  const g = data[channels > 1 ? 1 : 0];
  const b = data[channels > 2 ? 2 : 0];
  return { r, g, b, hex: rgbToHex(r, g, b), lab: rgbToLab(r, g, b) };
}

function csvEscape(value) {
  const s = value == null ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function label(key, map) {
  return map[key] || key || '';
}

function reviewFlags(row, tone) {
  const flags = [];
  if (Number(row.confidence) < 0.75) flags.push('低置信');
  if (row.wood_species === 'engineered' || row.wood_species === 'mixed') flags.push('木种待确认');
  if (row.wood_species_source === 'inferred') flags.push('按名称推断');
  if (!['horizontal', 'vertical'].includes(row.grain_direction)) flags.push('方向需目检');
  return flags;
}

async function buildContactSheet(rows, thumbs) {
  const cols = 5;
  const cellW = 280;
  const cellH = 320;
  const width = cols * cellW;
  const height = Math.ceil(rows.length / cols) * cellH;
  const composites = [];
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const x = (i % cols) * cellW + 20;
    const y = Math.floor(i / cols) * cellH + 16;
    const img = await sharp(thumbs[i]).resize(240, 240, { fit: 'cover' }).jpeg({ quality: 82 }).toBuffer();
    composites.push({ input: img, left: x, top: y });
    const line1 = `#${String(i + 1).padStart(2, '0')} ${row.name_en || row.name_zh}`.slice(0, 38);
    const line2 = `${row.wood_species} · ${row.wood_tone || ''} · ${row.grain_type}`;
    const line3 = `${row.wood_layout} · ${row.surface_finish} · ${Math.round(Number(row.confidence) * 100)}%`;
    const svg = Buffer.from(`<svg width="240" height="58" xmlns="http://www.w3.org/2000/svg">
      <rect width="240" height="58" fill="#ffffff"/>
      <text x="0" y="14" font-family="DejaVu Sans, Arial, sans-serif" font-size="12" fill="#111111">${escapeXml(line1)}</text>
      <text x="0" y="31" font-family="DejaVu Sans, Arial, sans-serif" font-size="10" fill="#444444">${escapeXml(line2)}</text>
      <text x="0" y="47" font-family="DejaVu Sans, Arial, sans-serif" font-size="10" fill="#666666">${escapeXml(line3)}</text>
    </svg>`);
    composites.push({ input: svg, left: x, top: y + 244 });
  }
  return sharp({
    create: { width, height, channels: 3, background: '#ffffff' }
  }).composite(composites).jpeg({ quality: 88 }).toBuffer();
}

function escapeXml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildHtml(rows, thumbs) {
  const sourceCounts = {};
  for (const row of rows) sourceCounts[row.source] = (sourceCounts[row.source] || 0) + 1;
  const low = rows.filter((row) => Number(row.confidence) < 0.75 || ['engineered', 'mixed'].includes(row.wood_species));
  const cards = rows.map((row, i) => {
    const tone = row.wood_tone || '';
    const flags = reviewFlags(row, tone);
    return `<tr class="${flags.length ? 'review' : ''}">
      <td class="idx">${String(i + 1).padStart(2, '0')}</td>
      <td><img src="data:image/jpeg;base64,${thumbs[i].toString('base64')}" alt="${escapeXml(row.name_zh)}"></td>
      <td><b>${escapeXml(row.name_zh)}</b><br><span class="muted">${escapeXml(row.name_en || '')}</span></td>
      <td>${escapeXml(row.brand)}<br><span class="muted">${escapeXml(row.brand_series || '')}</span></td>
      <td>${escapeXml(label(row.wood_species, WOOD_SPECIES_LABELS))}<br><span class="muted">${escapeXml(row.wood_species_source)}</span></td>
      <td>${escapeXml(label(tone, WOOD_TONE_LABELS))}<br><span class="muted">L* ${row.lab_l ?? '-'} / a* ${row.lab_a ?? '-'} / b* ${row.lab_b ?? '-'}</span></td>
      <td>${escapeXml(label(row.grain_type, GRAIN_TYPE_LABELS))} · ${escapeXml(label(row.grain_scale, GRAIN_SCALE_LABELS))}<br><span class="muted">${escapeXml(label(row.grain_direction, GRAIN_DIRECTION_LABELS))}</span></td>
      <td>${escapeXml(label(row.wood_layout, WOOD_LAYOUT_LABELS))}<br><span class="muted">${escapeXml(label(row.surface_finish, SURFACE_FINISH_LABELS))}</span></td>
      <td>${Math.round(Number(row.confidence) * 100)}%${flags.length ? `<br><span class="flag">${escapeXml(flags.join(' / '))}</span>` : ''}</td>
      <td class="muted">${escapeXml(row.license || '')}<br><a href="${escapeXml(row.source_url)}" target="_blank">来源</a></td>
    </tr>`;
  }).join('\n');
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>木纹词表校准 ${stamp}</title>
<style>
  body{font:14px/1.5 "Microsoft YaHei","Noto Sans CJK SC",Arial,sans-serif;color:#1f2937;margin:24px;background:#f8fafc}
  h1{font-size:20px;margin:0 0 6px}
  .sub{color:#64748b;margin-bottom:18px}
  .summary{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:18px}
  .pill{background:#fff;border:1px solid #e2e8f0;border-radius:999px;padding:6px 12px}
  .warn{background:#fff7ed;border-color:#fdba74;color:#9a3412}
  table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden}
  th,td{padding:8px 10px;border-bottom:1px solid #eef2f7;vertical-align:top;text-align:left}
  th{background:#f1f5f9;font-size:12px;color:#475569;position:sticky;top:0}
  tr.review{background:#fffaf0}
  img{width:120px;height:120px;object-fit:cover;border-radius:8px;display:block}
  .idx{font-weight:700;color:#64748b}
  .muted{color:#94a3b8;font-size:12px}
  .flag{color:#c2410c;font-size:12px;font-weight:700}
  .foot{margin-top:16px;color:#64748b;font-size:12px}
</style>
</head>
<body>
<h1>木纹词表校准 v1 · ${stamp}</h1>
<div class="sub">共 ${rows.length} 条样本。黄色行表示低置信或木种/方向需要人工确认。确认词表后再执行批量落库。</div>
<div class="summary">
  <span class="pill">千年舟 ${sourceCounts.treezo || 0}</span>
  <span class="pill">Poly Haven ${sourceCounts.polyhaven || 0}</span>
  <span class="pill">ambientCG ${sourceCounts.ambientcg || 0}</span>
  <span class="pill">需复核 ${low.length}</span>
  <span class="pill warn">浅色 L*≥65 · 深色 L*&lt;35</span>
</div>
<table>
<thead><tr><th>#</th><th>原图</th><th>花色名</th><th>品牌 / 系列</th><th>木种</th><th>颜色</th><th>纹理</th><th>拼法 / 质感</th><th>置信</th><th>来源</th></tr></thead>
<tbody>
${cards}
</tbody>
</table>
<div class="foot">方向只记录源图方向，不生成旋转横竖变体。品牌花色名的木种均为按名称推断（wood_species_source=inferred），后续可人工修正。</div>
</body>
</html>`;
}

function buildCsv(rows) {
  const header = [
    'index', 'id', 'name_zh', 'name_en', 'brand', 'brand_series', 'source', 'source_id',
    'wood_species', 'wood_species_source', 'wood_tone', 'lab_l', 'lab_a', 'lab_b', 'hex',
    'grain_type', 'grain_scale', 'grain_direction', 'wood_layout', 'surface_finish',
    'confidence', 'review_flags', 'mounts', 'license', 'source_url'
  ];
  const lines = [header.join(',')];
  rows.forEach((row, i) => {
    lines.push([
      i + 1, row.id, row.name_zh, row.name_en, row.brand, row.brand_series, row.source, row.source_id,
      row.wood_species, row.wood_species_source, row.wood_tone, row.lab_l, row.lab_a, row.lab_b, row.hex,
      row.grain_type, row.grain_scale, row.grain_direction, row.wood_layout, row.surface_finish,
      row.confidence, reviewFlags(row, row.wood_tone).join(' / '), (row.mounts || []).join('|'), row.license, row.source_url
    ].map(csvEscape).join(','));
  });
  return '\ufeff' + lines.join('\n');
}

async function runCalibration() {
  const rows = selectedEntries();
  fs.mkdirSync(calibrationDir, { recursive: true });
  fs.mkdirSync(docsDir, { recursive: true });
  const thumbs = [];
  const failures = [];
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const cachePath = path.join(calibrationDir, `${row.id}.jpg`);
    try {
      let thumb;
      if (!force && fs.existsSync(cachePath)) {
        thumb = fs.readFileSync(cachePath);
      } else {
        thumb = await downloadThumb(row);
        fs.writeFileSync(cachePath, thumb);
      }
      const avg = await averageColor(thumb);
      row.hex = avg.hex;
      row.lab_l = avg.lab.l;
      row.lab_a = avg.lab.a;
      row.lab_b = avg.lab.b;
      row.wood_tone = classifyTone(avg.lab);
      thumbs.push(thumb);
      console.log(`[${i + 1}/${rows.length}] ${row.name_zh} ${row.hex} L*${row.lab_l} ${row.wood_tone}`);
    } catch (err) {
      failures.push({ id: row.id, name: row.name_zh, error: err.message });
      thumbs.push(await sharp({
        create: { width: 240, height: 240, channels: 3, background: '#e2e8f0' }
      }).jpeg().toBuffer());
      console.error(`[${i + 1}/${rows.length}] ❌ ${row.name_zh}: ${err.message}`);
    }
  }
  const html = buildHtml(rows, thumbs);
  fs.writeFileSync(`${reportBase}.html`, html, 'utf8');
  fs.writeFileSync(`${reportBase}.csv`, buildCsv(rows), 'utf8');
  fs.writeFileSync(`${reportBase}.json`, JSON.stringify({ generated_at: Date.now(), rows, failures }, null, 2), 'utf8');
  const sheet = await buildContactSheet(rows, thumbs);
  fs.writeFileSync(`${reportBase}.jpg`, sheet);
  console.log(JSON.stringify({
    mode: 'calibrate',
    samples: rows.length,
    failures,
    report_html: `${reportBase}.html`,
    report_csv: `${reportBase}.csv`,
    report_json: `${reportBase}.json`,
    contact_sheet: `${reportBase}.jpg`
  }, null, 2));
}

async function runApply() {
  const rows = selectedEntries();
  const { openDb } = require('../src/db');
  const { ensureItems, upsertCatalogItem, setItemMount } = require('../src/base-library/items');
  const db = openDb(dataDir);
  ensureItems(db);
  fs.mkdirSync(catalogDir, { recursive: true });
  const result = { mode: dryRun ? 'dry-run' : 'apply', imported: [], failed: [] };
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const rel = `cache/base-library/catalog/${row.id}.jpg`;
    const abs = path.join(catalogDir, `${row.id}.jpg`);
    if (dryRun) {
      result.imported.push({
        id: row.id, name: row.name_zh, source: row.source, species: row.wood_species,
        grain: row.grain_type, layout: row.wood_layout, preview_rel: rel
      });
      continue;
    }
    try {
      let buf;
      if (!force && fs.existsSync(abs)) {
        buf = fs.readFileSync(abs);
      } else {
        const raw = await downloadFull(row);
        buf = await sharp(raw)
          .rotate()
          .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 90 })
          .toBuffer();
        fs.writeFileSync(abs, buf);
      }
      const avg = await averageColor(buf);
      const tone = classifyTone(avg.lab);
      const updated = upsertCatalogItem(db, {
        id: row.id,
        kind: 'texture',
        kind_key: 'wood',
        name_zh: row.name_zh,
        name_en: row.name_en,
        prompt_name: promptFor({ ...row, wood_tone: tone }),
        hex: avg.hex,
        brand: row.brand,
        brand_series: row.brand_series,
        source_url: row.source_url,
        external_id: row.external_id,
        preview_rel: rel,
        gloss: glossFromFinish(row.surface_finish),
        pattern: row.pattern || 'wood',
        origin: row.origin,
        zone: 'any',
        name_status: 'manual',
        wood_species: row.wood_species,
        wood_species_source: row.wood_species_source,
        wood_tone: tone,
        grain_type: row.grain_type,
        grain_scale: row.grain_scale,
        grain_direction: row.grain_direction,
        wood_layout: row.wood_layout,
        surface_finish: row.surface_finish,
        lab_l: avg.lab.l,
        lab_a: avg.lab.a,
        lab_b: avg.lab.b,
        tags: row.tags
      });
      for (const mount of row.mounts || []) setItemMount(db, updated.id, mount);
      result.imported.push({ ...updated, name: row.name_zh, hex: avg.hex, tone, preview_rel: rel });
      console.log(`[${i + 1}/${rows.length}] ✅ ${row.name_zh} -> ${updated.id} ${avg.hex} ${tone}`);
    } catch (err) {
      result.failed.push({ id: row.id, name: row.name_zh, error: err.message });
      console.error(`[${i + 1}/${rows.length}] ❌ ${row.name_zh}: ${err.message}`);
    }
  }
  console.log(JSON.stringify(result, null, 2));
  if (dryRun) console.log('dry-run：未下载、未写库。');
  process.exit(result.failed.length ? 1 : 0);
}

(async () => {
  if (calibrate) return runCalibration();
  return runApply();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
